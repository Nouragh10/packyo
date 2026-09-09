import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getDownloadURL, ref as storageRef, uploadString } from "firebase/storage";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  removeSavedPublicDestination,
  usePacks,
  usePackyoProfile,
  useProfileTripCollections,
  useRecentWishes,
  useSavedDestinations,
  useTrips,
} from "@/hooks/useFirebase";
import { signOut, storage, updateCurrentUserPhoto } from "@/lib/firebase";
import { WikiImage } from "@/components/WikiImage";

const TRIP_IMAGES = [
  "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=600&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&q=80&auto=format&fit=crop",
];

function initials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function tripIsPast(startDate: string | null | undefined, days: number) {
  if (!startDate) return false;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(start.getTime() + Math.max(days || 1, 1) * 86400000);
  return end < new Date();
}

function tripDateLabel(startDate: string | null | undefined, endDate: string | null | undefined, days: number) {
  if (!startDate) return `${days || 0} days · Dates pending`;
  const start = new Date(`${startDate}T00:00:00`);
  const end = endDate
    ? new Date(`${endDate}T00:00:00`)
    : new Date(start.getTime() + Math.max((days || 1) - 1, 0) * 86400000);
  const format = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${format(start)} – ${format(end)}`;
}

function SectionHeading({
  title,
  action,
  onAction,
  colors,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} disabled={!onAction} hitSlop={8}>
          <Text style={[styles.sectionAction, { color: colors.primary, opacity: onAction ? 1 : 0.5 }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AvatarStack({
  names,
  colors,
  max = 4,
}: {
  names: string[];
  colors: ReturnType<typeof useColors>;
  max?: number;
}) {
  const shown = names.slice(0, max);
  return (
    <View style={styles.avatarStack}>
      {shown.map((name, index) => (
        <View
          key={`${name}-${index}`}
          style={[
            styles.stackAvatar,
            {
              marginLeft: index === 0 ? 0 : -8,
              backgroundColor: index % 2 === 0 ? colors.muted : colors.secondary,
              borderColor: colors.card,
            },
          ]}
        >
          <Text style={[styles.stackAvatarText, { color: colors.mutedForeground }]}>{initials(name)}</Text>
        </View>
      ))}
      {names.length > max ? (
        <View style={[styles.stackAvatar, styles.moreAvatar, { borderColor: colors.card, backgroundColor: colors.muted }]}>
          <Text style={[styles.stackAvatarText, { color: colors.mutedForeground }]}>+{names.length - max}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const { trips, loading: tripsLoading, refetch: refetchTrips } = useTrips(user?.uid);
  const { packs } = usePacks(user?.uid);
  const { wishes } = useRecentWishes(user?.uid, trips.map((trip) => trip.id));
  const { profile } = usePackyoProfile(user?.uid);
  const { stays, activities, memories } = useProfileTripCollections(trips, user?.displayName, user?.uid);
  const { savedDestinations, loading: savedDestinationsLoading } = useSavedDestinations(user?.uid);
  const [removingSavedId, setRemovingSavedId] = React.useState<string | null>(null);
  const [savedError, setSavedError] = React.useState("");
  const [showAllPacks, setShowAllPacks] = React.useState(false);
  const [showAllTrips, setShowAllTrips] = React.useState(false);
  const [showAllWishes, setShowAllWishes] = React.useState(false);
  const [showAllActivities, setShowAllActivities] = React.useState(false);
  const [uploadedPhotoURL, setUploadedPhotoURL] = React.useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      refetchTrips();
    }, [refetchTrips]),
  );

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 84 : insets.bottom + 80;
  const displayName = user?.displayName ?? "Traveler";
  const generatedHandle = user?.email
    ? `@${user.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, ".")}`
    : `@${displayName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}`;
  const handle = profile?.username ? `@${profile.username}` : generatedHandle;
  const tripIds = trips.map((trip) => trip.id);
  const destinationVibes = Array.from(new Set(trips.flatMap((trip) => trip.vibes ?? [])));
  const travelVibes = (destinationVibes.length > 0 ? destinationVibes : ["Beach", "Food", "Nightlife", "Culture"]).slice(0, 4);
  const currentYear = new Date().getFullYear();
  const tripsThisYear = trips.filter((trip) => {
    const date = trip.startDate ? new Date(`${trip.startDate}T00:00:00`) : new Date(trip.createdAt);
    return date.getFullYear() === currentYear;
  }).length;
  const completedTrips = trips.filter((trip) => tripIsPast(trip.startDate, trip.days)).length;

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await signOut();
    router.replace("/sign-in");
  };

  const handleChooseProfilePhoto = async () => {
    if (!user || uploadingPhoto) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Photo access needed", "Allow Packyo to access your photos to choose a profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
      base64: Platform.OS === "web",
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri || (Platform.OS === "web" && !asset.base64)) {
      Alert.alert("Could not use photo", "Packyo could not read that image. Please choose another photo.");
      return;
    }

    setUploadingPhoto(true);
    try {
      const profilePhotoRef = storageRef(storage, `profilePhotos/${user.uid}/avatar`);
      if (Platform.OS === "web") {
        await uploadString(profilePhotoRef, asset.base64!, "base64", {
          contentType: asset.mimeType ?? "image/jpeg",
        });
      } else {
        const bucket = storage.app.options.storageBucket;
        if (!bucket) throw new Error("Photo storage is not configured.");
        const idToken = await user.getIdToken();
        const objectName = encodeURIComponent(`profilePhotos/${user.uid}/avatar`);
        const uploadUrl =
          `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}` +
          `/o?uploadType=media&name=${objectName}`;
        const upload = await FileSystem.uploadAsync(uploadUrl, asset.uri, {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Firebase ${idToken}`,
            "Content-Type": asset.mimeType ?? "image/jpeg",
          },
        });
        if (upload.status < 200 || upload.status >= 300) {
          const errorBody = JSON.parse(upload.body || "{}") as {
            error?: { message?: string };
          };
          throw new Error(errorBody.error?.message ?? "Firebase rejected the photo upload.");
        }
      }
      const photoURL = await getDownloadURL(profilePhotoRef);
      await updateCurrentUserPhoto(photoURL);
      setUploadedPhotoURL(photoURL);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(
        "Could not update photo",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openTrip = (tripId: string, hasItinerary: boolean) => {
    if (hasItinerary) {
      router.push({
        pathname: "/itinerary/[id]",
        params: { id: tripId, returnTo: "tripHub" },
      } as any);
    } else {
      router.push(`/trip/${tripId}` as any);
    }
  };

  const removeSavedDestination = async (reviewId: string) => {
    if (!user || removingSavedId) return;
    setRemovingSavedId(reviewId);
    setSavedError("");
    try {
      await removeSavedPublicDestination(user.uid, reviewId);
    } catch {
      setSavedError("We couldn't remove that saved destination. Please try again.");
    } finally {
      setRemovingSavedId(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      >
        <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
          <Pressable
            onPress={() => router.push("/(tabs)/notifications")}
            style={styles.iconButton}
            accessibilityLabel="Open notifications"
          >
            <Feather name="bell" size={19} color={colors.foreground} />
            <View style={[styles.notificationDot, { backgroundColor: colors.primary }]} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Profile</Text>
          <Pressable
            onPress={() => router.push("/settings")}
            style={styles.iconButton}
            accessibilityLabel="Open settings"
            testID="profile-settings-button"
          >
            <Feather name="settings" size={19} color={colors.foreground} />
          </Pressable>
        </View>

        <View style={styles.profileIntro}>
          <Pressable
            onPress={handleChooseProfilePhoto}
            disabled={!user || uploadingPhoto}
            style={({ pressed }) => [styles.avatarWrap, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel="Choose profile picture"
          >
            <Image
              source={{
                uri: uploadedPhotoURL ?? user?.photoURL ?? "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&q=80",
              }}
              style={styles.avatar}
            />
            <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              {uploadingPhoto
                ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                : <Feather name="camera" size={12} color={colors.primaryForeground} />}
            </View>
          </Pressable>
          <View style={styles.identity}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{displayName}</Text>
            <Text style={[styles.handle, { color: colors.mutedForeground }]}>{handle}</Text>
            <View style={styles.locationLine}>
              <Feather name="map-pin" size={12} color={colors.mutedForeground} />
               <Text style={[styles.locationText, { color: colors.mutedForeground }]} numberOfLines={2}>
                 {profile?.bio?.trim() || "Ready for the next adventure"}
               </Text>
            </View>
          </View>
        </View>

        <View style={[styles.statsRow, { borderColor: colors.border }]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{trips.length}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Trips</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{packs.length}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Packs</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{wishes.length}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Wishes</Text>
          </View>
        </View>

        <View style={[styles.vibeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.vibeCardHeader}>
            <View>
              <Text style={[styles.vibeEyebrow, { color: colors.mutedForeground }]}>YOUR TRAVEL VIBE</Text>
              <Text style={[styles.vibeTitle, { color: colors.foreground }]}>The way you like to explore</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.push("/settings")}>
              <Text style={[styles.editLink, { color: colors.primary }]}>Edit preferences</Text>
            </Pressable>
          </View>
          <View style={styles.vibePills}>
            {travelVibes.map((vibe) => (
              <View key={vibe} style={[styles.vibePill, { backgroundColor: colors.primary + "14" }]}>
                <Feather name="check" size={11} color={colors.primary} />
                <Text style={[styles.vibePillText, { color: colors.foreground }]}>{vibe}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.vibeDescription, { color: colors.mutedForeground }]}>
            Relaxed days, great food, and room to discover something unexpected.
          </Text>
          <View style={[styles.vibeAccent, { backgroundColor: colors.primary + "12" }]}>
            <Feather name="sun" size={28} color={colors.primary} />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading
            title="My packs"
            action={packs.length > 3 ? (showAllPacks ? "Show less" : "See all") : undefined}
            onAction={packs.length > 3 ? () => setShowAllPacks((current) => !current) : undefined}
            colors={colors}
          />
          {packs.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="users" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No packs yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Save a group of travel friends after your next itinerary.</Text>
            </View>
          ) : (
            (showAllPacks ? packs : packs.slice(0, 3)).map((pack) => {
              const memberNames = Object.values(pack.members ?? {}).map((member) => member.name);
              const tripCount = Object.keys(pack.tripIds ?? {}).length;
              return (
                <Pressable
                  key={pack.id}
                  onPress={() => router.push(`/groups/${pack.id}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${pack.name}`}
                  testID={`pack-card-${pack.id}`}
                  style={({ pressed }) => [
                    styles.packCard,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <View style={styles.packCardTop}>
                    <AvatarStack names={memberNames} colors={colors} />
                    <View style={[styles.roundArrow, { backgroundColor: colors.muted }]}>
                      <Feather name="chevron-right" size={16} color={colors.foreground} />
                    </View>
                  </View>
                  <Text style={[styles.packName, { color: colors.foreground }]}>{pack.name}</Text>
                  <Text style={[styles.packMeta, { color: colors.mutedForeground }]}>
                    {memberNames.length} members · {tripCount} {tripCount === 1 ? "trip" : "trips"}
                  </Text>
                  {pack.lastTripDestination ? (
                    <View style={styles.packDestination}>
                      <Feather name="map-pin" size={11} color={colors.primary} />
                      <Text style={[styles.packDestinationText, { color: colors.primary }]} numberOfLines={1}>
                        {pack.lastTripDestination}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading
            title="Your trips"
            action={trips.length > 3 ? (showAllTrips ? "Show less" : "See all") : undefined}
            onAction={trips.length > 3 ? () => setShowAllTrips((current) => !current) : undefined}
            colors={colors}
          />
          {tripsLoading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : trips.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="map" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No trips yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Your next adventure starts with a shared plan.</Text>
            </View>
          ) : (
            (showAllTrips ? trips : trips.slice(0, 3)).map((trip, index) => {
              const past = tripIsPast(trip.startDate, trip.days);
              const progress = trip.itinerary ? 100 : trip.destination ? 55 : 20;
              return (
                <Pressable
                  key={trip.id}
                  onPress={() => openTrip(trip.id, !!trip.itinerary)}
                  style={({ pressed }) => [
                    styles.tripCard,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <Image source={{ uri: TRIP_IMAGES[index % TRIP_IMAGES.length] }} style={styles.tripImage} />
                  <View style={styles.tripCardBody}>
                    <View style={styles.tripCardTitleRow}>
                      <Text style={[styles.tripName, { color: colors.foreground }]} numberOfLines={1}>
                        {trip.destination || "Destination TBD"}
                      </Text>
                      <View style={[styles.statusPill, { backgroundColor: past ? colors.muted : colors.primary + "14" }]}>
                        <Text style={[styles.statusText, { color: past ? colors.mutedForeground : colors.primary }]}>
                          {past ? "Past" : trip.itinerary ? "Active" : "Planning"}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.tripDate, { color: colors.mutedForeground }]}>
                      {tripDateLabel(trip.startDate, trip.endDate, trip.days)}
                    </Text>
                    <View style={styles.tripBottomRow}>
                      <View style={styles.tripMemberLine}>
                        <Feather name="users" size={12} color={colors.mutedForeground} />
                        <Text style={[styles.tripMemberText, { color: colors.mutedForeground }]}>
                          {Object.keys(trip.members ?? {}).length} members
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                      <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.primary }]} />
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading title="Memories" colors={colors} />
          {memories.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="book-open" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No memory guides yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                After a trip, add your review and photos to create a keepsake here.
              </Text>
            </View>
          ) : (
            memories.map((memory) => (
              <Pressable
                key={memory.id}
                onPress={() => router.push(`/memory/${memory.tripId}` as any)}
                testID={`memory-guide-${memory.tripId}`}
                style={({ pressed }) => [
                  styles.memoryCard,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                {memory.photo ? (
                  <Image source={{ uri: memory.photo }} style={styles.memoryPhoto} />
                ) : (
                  <View style={[styles.memoryPhotoFallback, { backgroundColor: colors.primary + "16" }]}>
                    <Feather name="book-open" size={20} color={colors.primary} />
                  </View>
                )}
                <View style={styles.memoryCopy}>
                  <Text style={[styles.memoryTitle, { color: colors.foreground }]} numberOfLines={1}>{memory.title}</Text>
                  <Text style={[styles.memoryMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {memory.destination}
                    {memory.generatedAt ? ` · ${new Date(memory.generatedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading
            title="My wishes"
            action={wishes.length > 3 ? (showAllWishes ? "Show less" : "See all") : undefined}
            onAction={wishes.length > 3 ? () => setShowAllWishes((current) => !current) : undefined}
            colors={colors}
          />
          {wishes.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="star" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No wishes yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Add a wish inside one of your trip hubs.</Text>
            </View>
          ) : (
            (showAllWishes ? wishes : wishes.slice(0, 3)).map((wish) => (
              <View key={`${wish.id}-${wish.tripDestination}`} style={[styles.wishRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.wishIcon, { backgroundColor: colors.primary + "14" }]}>
                  <Feather name="heart" size={14} color={colors.primary} />
                </View>
                <View style={styles.wishContent}>
                  <Text style={[styles.wishText, { color: colors.foreground }]} numberOfLines={1}>{wish.text}</Text>
                  <Text style={[styles.wishMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {wish.tripDestination} · {wish.score > 0 ? `${wish.score} votes` : "New wish"}
                  </Text>
                </View>
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading title="My stays" colors={colors} />
          {stays.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="home" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No stays saved yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Confirm an accommodation in a trip and it will appear here.
              </Text>
            </View>
          ) : (
            stays.map((stay, index) => (
              <Pressable
                key={stay.id}
                onPress={() => router.push(`/trip/${stay.tripId}` as any)}
                style={({ pressed }) => [styles.stayRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={styles.stayImageWrap}>
                  <WikiImage
                    name={stay.accommodation.name}
                    context={stay.accommodation.location || stay.destination}
                    query={`${stay.accommodation.name} hotel ${stay.destination}`}
                    initialUri={(stay.accommodation.photos ?? [])[0]}
                    fallbackCategory="stay"
                    fallbackIndex={index}
                    style={styles.stayImage}
                  />
                </View>
                <View style={styles.wishContent}>
                  <Text style={[styles.wishText, { color: colors.foreground }]} numberOfLines={1}>{stay.accommodation.name}</Text>
                  <Text style={[styles.wishMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {stay.destination} · {stay.accommodation.type}
                  </Text>
                </View>
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading
            title="Suggested activities"
            action={activities.length > 3 ? (showAllActivities ? "Show less" : "See all") : undefined}
            onAction={activities.length > 3 ? () => setShowAllActivities((current) => !current) : undefined}
            colors={colors}
          />
          {activities.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="compass" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No activity suggestions yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Your wish-based itinerary picks will show up here.
              </Text>
            </View>
          ) : (
            (showAllActivities ? activities : activities.slice(0, 3)).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/itinerary/${item.tripId}` as any)}
                style={({ pressed }) => [styles.wishRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={[styles.wishIcon, { backgroundColor: colors.primary + "14" }]}>
                  <Feather name="map-pin" size={14} color={colors.primary} />
                </View>
                <View style={styles.wishContent}>
                  <Text style={[styles.wishText, { color: colors.foreground }]} numberOfLines={1}>{item.activity.name}</Text>
                  <Text style={[styles.wishMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.destination} · Day {item.dayNumber}
                  </Text>
                </View>
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))
          )}
        </View>

        <View style={[styles.yearCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.yearCardCopy}>
            <Text style={[styles.yearEyebrow, { color: colors.mutedForeground }]}>YOUR PACKYO YEAR</Text>
            <Text style={[styles.yearTitle, { color: colors.foreground }]}>A year of going places</Text>
            <View style={styles.yearStats}>
              <View>
                <Text style={[styles.yearValue, { color: colors.primary }]}>{tripsThisYear}</Text>
                <Text style={[styles.yearLabel, { color: colors.mutedForeground }]}>Trips</Text>
              </View>
              <View>
                <Text style={[styles.yearValue, { color: colors.primary }]}>{wishes.length}</Text>
                <Text style={[styles.yearLabel, { color: colors.mutedForeground }]}>Wishes</Text>
              </View>
              <View>
                <Text style={[styles.yearValue, { color: colors.primary }]}>{completedTrips}</Text>
                <Text style={[styles.yearLabel, { color: colors.mutedForeground }]}>Made the trip</Text>
              </View>
            </View>
          </View>
          <View style={styles.chart} accessibilityLabel="Travel activity trend">
            {[18, 34, 26, 50, 42, 66, 57].map((height, index) => (
              <View key={index} style={[styles.chartBar, { height, backgroundColor: index === 6 ? colors.primary : colors.primary + "48" }]} />
            ))}
            <Feather name="trending-up" size={16} color={colors.primary} style={styles.chartIcon} />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading title="Saved" colors={colors} />
          <View style={styles.savedGrid}>
            {[
              { icon: "map", label: "Destinations", onPress: () => router.push("/(tabs)/discover") },
              { icon: "activity", label: "Activities", onPress: () => router.push({ pathname: "/saved", params: { section: "activities" } } as any) },
              { icon: "home", label: "Stays", onPress: () => router.push({ pathname: "/saved", params: { section: "stays" } } as any) },
              { icon: "briefcase", label: "Trips", onPress: () => router.push("/") },
            ].map((item) => (
              <Pressable
                key={item.label}
                onPress={item.onPress}
                style={({ pressed }) => [
                  styles.savedTile,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Feather name={item.icon as any} size={19} color={colors.primary} />
                <Text style={[styles.savedLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
          <View style={styles.savedDestinationsHeader}>
            <Text style={[styles.savedDestinationsTitle, { color: colors.foreground }]}>Saved destinations</Text>
            {savedDestinations.length > 0 ? (
              <Text style={[styles.savedDestinationsCount, { color: colors.mutedForeground }]}>
                {savedDestinations.length} {savedDestinations.length === 1 ? "trip" : "trips"}
              </Text>
            ) : null}
          </View>
          {savedDestinationsLoading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : savedDestinations.length === 0 ? (
            <Pressable
              onPress={() => router.push("/(tabs)/discover")}
              style={({ pressed }) => [
                styles.emptyCard,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.82 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Discover trips to save"
            >
              <Feather name="bookmark" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No saved destinations yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Save a top-rated trip from Discover to find it here.
              </Text>
            </Pressable>
          ) : (
            savedDestinations.map((saved, index) => {
              const city = saved.destination.split(",")[0].trim();
              return (
                <View
                  key={saved.id}
                  style={[styles.savedDestinationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Pressable
                    onPress={() => router.push(`/discover-itinerary/${saved.id}` as any)}
                    style={({ pressed }) => [styles.savedDestinationMain, { opacity: pressed ? 0.78 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open saved trip for ${city}`}
                    testID={`saved-destination-${saved.id}`}
                  >
                    <Image
                      source={{ uri: saved.photos[0] || TRIP_IMAGES[index % TRIP_IMAGES.length] }}
                      style={styles.savedDestinationImage}
                    />
                    <View style={styles.savedDestinationCopy}>
                      <Text style={[styles.savedDestinationName, { color: colors.foreground }]} numberOfLines={1}>
                        {city || "Saved destination"}
                      </Text>
                      <Text style={[styles.savedDestinationMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {saved.days > 0 ? `${saved.days} ${saved.days === 1 ? "day" : "days"}` : "Itinerary"}
                        {saved.rating > 0 ? ` · ★ ${saved.rating.toFixed(1)}` : ""}
                      </Text>
                      {saved.highlight ? (
                        <Text style={[styles.savedDestinationHighlight, { color: colors.mutedForeground }]} numberOfLines={1}>
                          “{saved.highlight}”
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => removeSavedDestination(saved.id)}
                    disabled={removingSavedId === saved.id}
                    style={({ pressed }) => [styles.removeSavedButton, { opacity: pressed || removingSavedId === saved.id ? 0.5 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${city} from saved destinations`}
                    testID={`remove-saved-destination-${saved.id}`}
                  >
                    {removingSavedId === saved.id ? (
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    ) : (
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                </View>
              );
            })
          )}
          {savedError ? <Text style={[styles.savedError, { color: colors.primary }]}>{savedError}</Text> : null}
        </View>

        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [styles.signOutButton, { borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <Feather name="log-out" size={16} color={colors.primary} />
          <Text style={[styles.signOutText, { color: colors.primary }]}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  stayRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 9, marginBottom: 10 },
  stayImageWrap: { width: 72, height: 64, borderRadius: 12, overflow: "hidden" },
  stayImage: { width: "100%", height: "100%" },
  topBarTitle: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  iconButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", position: "relative" },
  notificationDot: { position: "absolute", top: 5, right: 5, width: 6, height: 6, borderRadius: 3 },
  profileIntro: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18, gap: 14 },
  avatarWrap: { position: "relative" },
  avatar: { width: 82, height: 82, borderRadius: 41 },
  cameraBadge: { position: "absolute", right: -1, bottom: 2, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  identity: { flex: 1 },
  name: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 24, marginBottom: 2 },
  handle: { fontFamily: "DmSans_400Regular", fontSize: 13, marginBottom: 8 },
  locationLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  locationText: { fontFamily: "DmSans_400Regular", fontSize: 11 },
  statsRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 20, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 21 },
  statLabel: { fontFamily: "DmSans_400Regular", fontSize: 11 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 30 },
  vibeCard: { marginHorizontal: 20, marginTop: 18, padding: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  vibeCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  vibeEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 9, letterSpacing: 1.1, marginBottom: 3 },
  vibeTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  editLink: { fontFamily: "DmSans_600SemiBold", fontSize: 11, paddingTop: 2 },
  vibePills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 13, maxWidth: "90%" },
  vibePill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  vibePillText: { fontFamily: "DmSans_500Medium", fontSize: 11 },
  vibeDescription: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 13, maxWidth: "78%" },
  vibeAccent: { position: "absolute", right: -12, bottom: -14, width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center" },
  section: { marginTop: 24, paddingHorizontal: 20 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  sectionAction: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },
  packCard: { borderRadius: 15, borderWidth: 1, padding: 14, marginBottom: 9 },
  packCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  stackAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stackAvatarText: { fontFamily: "DmSans_700Bold", fontSize: 9 },
  moreAvatar: { marginLeft: -8 },
  roundArrow: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  packName: { fontFamily: "DmSans_700Bold", fontSize: 14, marginTop: 10 },
  packMeta: { fontFamily: "DmSans_400Regular", fontSize: 11, marginTop: 2 },
  packDestination: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  packDestinationText: { fontFamily: "DmSans_600SemiBold", fontSize: 11, flex: 1 },
  emptyCard: { borderRadius: 15, borderWidth: 1, padding: 20, alignItems: "center", gap: 6 },
  emptyTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },
  emptyBody: { fontFamily: "DmSans_400Regular", fontSize: 12, textAlign: "center", lineHeight: 17, maxWidth: 280 },
  inlineLoading: { alignItems: "center", paddingVertical: 22 },
  tripCard: { flexDirection: "row", borderRadius: 15, borderWidth: 1, padding: 9, marginBottom: 9, gap: 11 },
  tripImage: { width: 88, height: 92, borderRadius: 11 },
  tripCardBody: { flex: 1, paddingVertical: 2 },
  tripCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  tripName: { fontFamily: "DmSans_700Bold", fontSize: 14, flex: 1 },
  statusPill: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  statusText: { fontFamily: "DmSans_600SemiBold", fontSize: 9 },
  tripDate: { fontFamily: "DmSans_400Regular", fontSize: 10, marginTop: 4 },
  tripBottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 13 },
  tripMemberLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  tripMemberText: { fontFamily: "DmSans_400Regular", fontSize: 10 },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 8, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  memoryCard: { flexDirection: "row", alignItems: "center", borderRadius: 15, borderWidth: 1, padding: 9, marginBottom: 9, gap: 11 },
  memoryPhoto: { width: 66, height: 66, borderRadius: 11 },
  memoryPhotoFallback: { width: 66, height: 66, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  memoryCopy: { flex: 1 },
  memoryTitle: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  memoryMeta: { fontFamily: "DmSans_400Regular", fontSize: 11, marginTop: 4 },
  wishRow: { flexDirection: "row", alignItems: "center", borderRadius: 13, borderWidth: 1, padding: 11, marginBottom: 8, gap: 10 },
  wishIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  wishContent: { flex: 1 },
  wishText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  wishMeta: { fontFamily: "DmSans_400Regular", fontSize: 10, marginTop: 3 },
  yearCard: { flexDirection: "row", alignItems: "center", marginHorizontal: 20, marginTop: 18, borderRadius: 16, borderWidth: 1, padding: 16, overflow: "hidden" },
  yearCardCopy: { flex: 1 },
  yearEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 9, letterSpacing: 1.1, marginBottom: 4 },
  yearTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 18 },
  yearStats: { flexDirection: "row", gap: 18, marginTop: 14 },
  yearValue: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },
  yearLabel: { fontFamily: "DmSans_400Regular", fontSize: 9, marginTop: 1 },
  chart: { width: 80, height: 80, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 4, paddingBottom: 8, position: "relative" },
  chartBar: { width: 6, borderRadius: 3 },
  chartIcon: { position: "absolute", right: 1, top: 5 },
  savedGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  savedTile: { width: "48.7%", minHeight: 70, borderRadius: 13, borderWidth: 1, padding: 11, justifyContent: "space-between" },
  savedLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },
  savedDestinationsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 9 },
  savedDestinationsTitle: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  savedDestinationsCount: { fontFamily: "DmSans_400Regular", fontSize: 11 },
  savedDestinationCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 9, marginBottom: 8 },
  savedDestinationMain: { flexDirection: "row", alignItems: "center", flex: 1, gap: 10 },
  savedDestinationImage: { width: 64, height: 64, borderRadius: 10 },
  savedDestinationCopy: { flex: 1 },
  savedDestinationName: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  savedDestinationMeta: { fontFamily: "DmSans_400Regular", fontSize: 11, marginTop: 4 },
  savedDestinationHighlight: { fontFamily: "DmSans_400Regular", fontSize: 10, fontStyle: "italic", marginTop: 4 },
  removeSavedButton: { width: 30, height: 36, alignItems: "center", justifyContent: "center" },
  savedError: { fontFamily: "DmSans_400Regular", fontSize: 12, textAlign: "center", marginTop: 4 },
  signOutButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginHorizontal: 20, marginTop: 24, paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
  signOutText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
});
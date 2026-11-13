import Constants from "expo-constants";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { updatePackyoProfile, usePackyoProfile } from "@/hooks/useFirebase";
import {
  deleteAccount,
  signOut,
  updateCurrentUserProfile,
} from "@/lib/firebase";
import {
  DEFAULT_PACKYO_SETTINGS,
  loadPackyoSettings,
  updatePackyoSettings,
  type AppPreferences,
  type PlanningFocus,
  type TravelPace,
  type TravelPreferences,
} from "@/lib/settings";

type SettingIcon = React.ComponentProps<typeof Feather>["name"];
type Panel = "profile" | "travel" | "app" | "support" | "about" | "privacy" | "terms" | null;

function SettingRow({
  icon,
  label,
  description,
  onPress,
  colors,
  destructive = false,
  value,
}: {
  icon: SettingIcon;
  label: string;
  description?: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  destructive?: boolean;
  value?: string;
}) {
  const tint = destructive ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, { opacity: pressed ? 0.68 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: destructive ? colors.destructive + "14" : colors.primary + "14" },
        ]}
      >
        <Feather name={icon} size={17} color={destructive ? colors.destructive : colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{description}</Text>
        ) : null}
      </View>
      {value ? <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text> : null}
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

function Sheet({
  visible,
  title,
  onClose,
  colors,
  children,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <KeyboardAwareScrollViewCompat
      style={styles.sheetScroll}
      contentContainerStyle={[styles.sheetScrollContent, { paddingBottom: insets.bottom + 20 }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </KeyboardAwareScrollViewCompat>
  ) : (
    <View style={[styles.sheetScrollContent, { paddingBottom: insets.bottom + 20 }]}>{children}</View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.foreground + "66" }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close panel"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingTop: 10,
            },
          ]}
        >
          <View style={[styles.sheetGrabber, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              hitSlop={8}
            >
              <Feather name="x" size={20} color={colors.foreground} />
            </Pressable>
          </View>
          {body}
        </View>
      </View>
    </Modal>
  );
}

function SectionLabel({ children, colors }: { children: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{children}</Text>
  );
}

function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.choiceGrid}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? colors.primary + "16" : colors.background,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}: ${option}`}
            >
              {selected ? <Feather name="check" size={14} color={colors.primary} /> : null}
              <Text
                style={[
                  styles.choiceText,
                  { color: selected ? colors.primary : colors.foreground },
                ]}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PreferenceSwitch({
  label,
  description,
  value,
  onChange,
  colors,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.preferenceSwitch, { borderBottomColor: colors.border }]}>
      <View style={styles.preferenceCopy}>
        <Text style={[styles.preferenceLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.preferenceDescription, { color: colors.mutedForeground }]}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.muted, true: colors.primary + "75" }}
        thumbColor={value ? colors.primary : colors.card}
        ios_backgroundColor={colors.muted}
        accessibilityRole="switch"
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [panel, setPanel] = useState<Panel>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [appPreferences, setAppPreferences] = useState<AppPreferences>(DEFAULT_PACKYO_SETTINGS.app);
  const [travelPreferences, setTravelPreferences] =
    useState<TravelPreferences>(DEFAULT_PACKYO_SETTINGS.travel);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const preferenceTouched = useRef(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const { profile: savedProfile } = usePackyoProfile(user?.uid);
  const displayName = profileName ?? user?.displayName ?? "Traveler";
  const email = user?.email ?? "Guest account";
  const appVersion = Constants.expoConfig?.version ?? "1.1.0";
  const isGuest = user?.isAnonymous ?? false;

  useEffect(() => {
    let active = true;
    loadPackyoSettings()
      .then((settings) => {
        if (!active || preferenceTouched.current) return;
        setAppPreferences(settings.app);
        setTravelPreferences(settings.travel);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!savedProfile) return;
    setUsernameDraft(savedProfile.username ?? "");
    setBioDraft(savedProfile.bio ?? "");
    const savedTravel = savedProfile.travelPreferences;
    if (
      savedTravel?.pace &&
      ["Relaxed", "Balanced", "Full days"].includes(savedTravel.pace) &&
      savedTravel.focus &&
      ["Food + culture", "Outdoors", "Mix of everything"].includes(savedTravel.focus)
    ) {
      setTravelPreferences({
        pace: savedTravel.pace as TravelPace,
        focus: savedTravel.focus as PlanningFocus,
      });
    }
  }, [savedProfile]);

  const travelSummary = useMemo(
    () => `${travelPreferences.pace} · ${travelPreferences.focus}`,
    [travelPreferences.focus, travelPreferences.pace],
  );

  const openPanel = (nextPanel: Exclude<Panel, null>) => {
    setPanelError("");
    setPanel(nextPanel);
  };

  const closePanel = () => {
    setPanel(null);
    setPanelError("");
  };

  const updateAppPreference = (patch: Partial<AppPreferences>) => {
    preferenceTouched.current = true;
    setAppPreferences((current) => ({ ...current, ...patch }));
    void updatePackyoSettings({ app: patch }).catch(() => {
      setPanelError("We couldn't save that preference on this device. Please try again.");
    });
  };

  const updateTravelPreference = (patch: Partial<TravelPreferences>) => {
    preferenceTouched.current = true;
    setTravelPreferences((current) => {
      const next = { ...current, ...patch };
      if (user && !user.isAnonymous) {
        void updatePackyoProfile(user.uid, { travelPreferences: next }).catch(() => {
          setPanelError("We couldn't sync that travel preference. Please try again.");
        });
      }
      return next;
    });
    void updatePackyoSettings({ travel: patch }).catch(() => {
      setPanelError("We couldn't save that preference on this device. Please try again.");
    });
  };

  const handleSaveProfile = async () => {
    const nextName = profileDraft.trim();
    const nextUsername = usernameDraft.trim().replace(/^@+/, "").toLowerCase();
    const nextBio = bioDraft.trim();
    if (!nextName) {
      setPanelError("Add a name so your travel group knows who you are.");
      return;
    }
    if (!user || isGuest) {
      setPanelError("Guest profiles cannot be edited. Sign in to personalize your profile.");
      return;
    }
    if (nextUsername && !/^[a-z0-9][a-z0-9._]{2,23}$/.test(nextUsername)) {
      setPanelError("Usernames need 3–24 letters, numbers, dots, or underscores.");
      return;
    }
    setProfileSaving(true);
    setPanelError("");
    try {
      await updateCurrentUserProfile(nextName);
      await updatePackyoProfile(user.uid, {
        username: nextUsername,
        bio: nextBio.slice(0, 180),
      });
      setProfileName(nextName);
      closePanel();
      Alert.alert("Profile updated", "Your name is ready for the next trip.");
    } catch {
      setPanelError("We couldn't update your profile. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSignOut = () => {
    if (signingOut) return;
    Alert.alert("Sign out of Packyo?", "You can sign back in anytime to see your trips.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          if (appPreferences.hapticFeedback) {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          try {
            await signOut();
            router.replace("/sign-in");
          } catch {
            Alert.alert("Couldn't sign out", "Check your connection and try again.");
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const openDeletePanel = () => {
    setDeletePassword("");
    setDeleteError("");
    setPanel("privacy");
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteError("");
    try {
      await deleteAccount(deletePassword || undefined);
      setPanel(null);
      router.replace("/sign-in");
    } catch (error: any) {
      if (error?.code === "auth/needs-password") {
        setDeleteError("For your security, enter your password to confirm deletion.");
      } else if (error?.code === "auth/wrong-password" || error?.code === "auth/invalid-credential") {
        setDeleteError("That password didn't work. Try again or sign in again before deleting.");
      } else if (error?.code === "auth/requires-recent-login") {
        setDeleteError("For your security, sign out and sign back in, then delete your account within a few minutes.");
      } else {
        setDeleteError(
          "We couldn't finish deleting your account. Please retry while signed in; Packyo will safely resume the deletion.",
        );
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleSupport = async () => {
    const url = "mailto:support@gopack.now?subject=Packyo%20help";
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert("Email support", "Send us a note at support@gopack.now and we’ll get back to you.");
    }
  };

  const openProfilePanel = () => {
    setProfileDraft(displayName === "Traveler" ? "" : displayName);
    setUsernameDraft(savedProfile?.username ?? "");
    setBioDraft(savedProfile?.bio ?? "");
    openPanel("profile");
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      "Permanently delete your account?",
      "This removes your Packyo profile and trip data. This can’t be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete account", style: "destructive", onPress: () => void handleDeleteAccount() },
      ],
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topInset + 8, paddingBottom: insets.bottom + 34 },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="chevron-left" size={23} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>
          <View style={styles.headerButton} />
        </View>

        <Pressable
          onPress={openProfilePanel}
          style={({ pressed }) => [
            styles.accountCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.84 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          testID="settings-account-card"
        >
          <Image
            source={{
              uri:
                user?.photoURL ??
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&q=80",
            }}
            style={styles.accountAvatar}
          />
          <View style={styles.accountCopy}>
            <Text style={[styles.accountName, { color: colors.foreground }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.accountEmail, { color: colors.mutedForeground }]} numberOfLines={1}>
              {email}
            </Text>
          </View>
          <View style={[styles.editBadge, { backgroundColor: colors.primary + "14" }]}>
            <Feather name="edit-2" size={15} color={colors.primary} />
          </View>
        </Pressable>

        <SectionLabel colors={colors}>Account</SectionLabel>
        <View style={[styles.settingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="user"
            label="Profile information"
            description="Your name and account details"
            colors={colors}
            onPress={openProfilePanel}
            value={displayName}
          />
          <SettingRow
            icon="compass"
            label="Travel preferences"
            description="Choose the feel of your next itinerary"
            colors={colors}
            onPress={() => openPanel("travel")}
            value={travelSummary}
          />
          <SettingRow
            icon="bell"
            label="Notifications"
            description="Review your trip updates"
            colors={colors}
            onPress={() => router.push("/(tabs)/notifications")}
          />
        </View>

        <SectionLabel colors={colors}>Packyo</SectionLabel>
        <View style={[styles.settingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="sliders"
            label="App preferences"
          description="Sign-out haptics and itinerary cost chips"
            colors={colors}
            onPress={() => openPanel("app")}
          />
          <SettingRow
            icon="help-circle"
            label="Help and feedback"
            description="Contact Packyo support"
            colors={colors}
            onPress={() => openPanel("support")}
          />
          <SettingRow
            icon="info"
            label="About Packyo"
            description="Version, product details, and acknowledgements"
            colors={colors}
            onPress={() => openPanel("about")}
          />
        </View>

        <SectionLabel colors={colors}>Privacy & account</SectionLabel>
        <View style={[styles.settingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="shield"
            label="Privacy and data"
            description="Understand what Packyo stores"
            colors={colors}
            onPress={() => openPanel("privacy")}
          />
          <SettingRow
            icon="file-text"
            label="Terms of use"
            description="The ground rules for using Packyo"
            colors={colors}
            onPress={() => openPanel("terms")}
          />
          <SettingRow
            icon="trash-2"
            label="Delete account"
            description="Permanently remove your Packyo account"
            colors={colors}
            destructive
            onPress={openDeletePanel}
          />
        </View>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.signOutButton,
            {
              borderColor: colors.border,
              opacity: signingOut ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          testID="settings-sign-out"
        >
          {signingOut ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Feather name="log-out" size={16} color={colors.destructive} />
          )}
          <Text style={[styles.signOutLabel, { color: colors.destructive }]}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>

        <Text style={[styles.version, { color: colors.mutedForeground }]}>Packyo {appVersion}</Text>
      </ScrollView>

      <Sheet
        visible={panel === "profile"}
        title="Profile information"
        onClose={closePanel}
        colors={colors}
      >
        <Text style={[styles.sheetIntro, { color: colors.mutedForeground }]}>
          Keep your profile recognizable when you’re planning with friends.
        </Text>
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Display name</Text>
        <TextInput
          value={profileDraft}
          onChangeText={setProfileDraft}
          placeholder="Your name"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="words"
          returnKeyType="done"
          style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          accessibilityLabel="Display name"
          editable={!isGuest}
        />
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Username (optional)</Text>
        <TextInput
          value={usernameDraft}
          onChangeText={setUsernameDraft}
          placeholder="your.travel.handle"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          accessibilityLabel="Username"
          editable={!isGuest}
        />
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Short bio (optional)</Text>
        <TextInput
          value={bioDraft}
          onChangeText={setBioDraft}
          placeholder="What kind of trips are you into?"
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={180}
          style={[styles.textInput, { minHeight: 92, textAlignVertical: "top", color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          accessibilityLabel="Profile bio"
          editable={!isGuest}
        />
        {isGuest ? (
          <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
            Guest profiles are temporary. Sign in to save a profile name across devices.
          </Text>
        ) : null}
        {panelError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{panelError}</Text> : null}
        <Pressable
          onPress={handleSaveProfile}
          disabled={profileSaving || isGuest}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary, opacity: profileSaving || isGuest ? 0.5 : pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
        >
          {profileSaving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
            {profileSaving ? "Saving…" : "Save changes"}
          </Text>
        </Pressable>
      </Sheet>

      <Sheet visible={panel === "travel"} title="Travel preferences" onClose={closePanel} colors={colors}>
        <Text style={[styles.sheetIntro, { color: colors.mutedForeground }]}>
          These preselect matching travel vibes when you start a new trip. You can still change them for any individual plan.
        </Text>
        <ChoiceGroup
          label="Trip pace"
          options={["Relaxed", "Balanced", "Full days"] as const}
          value={travelPreferences.pace}
          onChange={(pace) => updateTravelPreference({ pace })}
          colors={colors}
        />
        <ChoiceGroup
          label="What should we prioritize?"
          options={["Food + culture", "Outdoors", "Mix of everything"] as const}
          value={travelPreferences.focus}
          onChange={(focus) => updateTravelPreference({ focus })}
          colors={colors}
        />
        {panelError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{panelError}</Text> : null}
        <View style={[styles.savedNotice, { backgroundColor: colors.primary + "12" }]}>
          <Feather name="check-circle" size={16} color={colors.primary} />
          <Text style={[styles.savedNoticeText, { color: colors.foreground }]}>
            Synced to your Packyo profile and ready for your next plan.
          </Text>
        </View>
      </Sheet>

      <Sheet visible={panel === "app"} title="App preferences" onClose={closePanel} colors={colors}>
        <Text style={[styles.sheetIntro, { color: colors.mutedForeground }]}>
          Make Packyo feel right for the way you plan and travel.
        </Text>
        <View style={[styles.preferenceCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <PreferenceSwitch
            label="Haptic feedback"
            description="Use a small tap when you sign out"
            value={appPreferences.hapticFeedback}
            onChange={(hapticFeedback) => updateAppPreference({ hapticFeedback })}
            colors={colors}
          />
          <PreferenceSwitch
            label="Show estimated costs"
            description="Show cost chips in the itinerary activity list"
            value={appPreferences.showEstimatedCosts}
            onChange={(showEstimatedCosts) => updateAppPreference({ showEstimatedCosts })}
            colors={colors}
          />
        </View>
        <View style={[styles.appearanceRow, { borderColor: colors.border }]}>
          <View style={[styles.appearanceIcon, { backgroundColor: colors.primary + "14" }]}>
            <Feather name="smartphone" size={16} color={colors.primary} />
          </View>
          <View style={styles.preferenceCopy}>
            <Text style={[styles.preferenceLabel, { color: colors.foreground }]}>Appearance</Text>
            <Text style={[styles.preferenceDescription, { color: colors.mutedForeground }]}>
              Follows your device setting
            </Text>
          </View>
          <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>System</Text>
        </View>
        {panelError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{panelError}</Text> : null}
      </Sheet>

      <Sheet visible={panel === "support"} title="Help and feedback" onClose={closePanel} colors={colors}>
        <View style={[styles.sheetHero, { backgroundColor: colors.primary + "12" }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary }]}>
            <Feather name="message-circle" size={22} color={colors.primaryForeground} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>We’re here to help</Text>
            <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
              Tell us what’s confusing, broken, or worth making better.
            </Text>
          </View>
        </View>
        <Pressable
          onPress={handleSupport}
          style={({ pressed }) => [
            styles.outlineButton,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Email Packyo support"
        >
          <Feather name="mail" size={17} color={colors.primary} />
          <Text style={[styles.outlineButtonText, { color: colors.foreground }]}>Email support</Text>
          <Feather name="arrow-up-right" size={15} color={colors.mutedForeground} />
        </Pressable>
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          Include the trip or screen you were using so we can help faster.
        </Text>
      </Sheet>

      <Sheet visible={panel === "about"} title="About Packyo" onClose={closePanel} colors={colors}>
        <View style={styles.aboutMark}>
          <View style={[styles.aboutMarkCircle, { backgroundColor: colors.primary }]}>
            <Feather name="map" size={26} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.aboutWordmark, { color: colors.foreground }]}>packyo</Text>
          <Text style={[styles.aboutTagline, { color: colors.mutedForeground }]}>Planned together. Better trips.</Text>
        </View>
        <View style={[styles.aboutList, { borderColor: colors.border }]}>
          <View style={styles.aboutListRow}>
            <Text style={[styles.aboutListLabel, { color: colors.mutedForeground }]}>Version</Text>
            <Text style={[styles.aboutListValue, { color: colors.foreground }]}>{appVersion}</Text>
          </View>
          <View style={[styles.aboutListRow, { borderTopColor: colors.border, borderTopWidth: 1 }]}>
            <Text style={[styles.aboutListLabel, { color: colors.mutedForeground }]}>Built for</Text>
            <Text style={[styles.aboutListValue, { color: colors.foreground }]}>Groups who go places</Text>
          </View>
        </View>
        <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>
          Packyo keeps group decisions, shared itineraries, wishlists, and trip details in one calm place.
        </Text>
      </Sheet>

      <Sheet visible={panel === "privacy"} title="Privacy and data" onClose={closePanel} colors={colors}>
        <View style={[styles.infoBlock, { backgroundColor: colors.primary + "12" }]}>
          <Feather name="lock" size={18} color={colors.primary} />
          <Text style={[styles.infoBlockText, { color: colors.foreground }]}>
            Your trips are private to the people you invite. Public previews only appear when you choose to share a review.
          </Text>
        </View>
        <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>
          Packyo uses your account details to identify you, save your trips, and keep group planning in sync. Saved destinations and preferences belong to your account or device and are never used to change public ratings.
        </Text>
        <Text style={[styles.sheetSubheading, { color: colors.foreground }]}>Delete your account</Text>
        <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>
          Deleting your account removes your profile and associated trip data. We confirm the data cleanup before removing your account. This cannot be undone.
        </Text>
        <Pressable
          onPress={confirmDeleteAccount}
          disabled={deletingAccount}
          style={({ pressed }) => [
            styles.dangerButton,
            { backgroundColor: colors.destructive, opacity: deletingAccount ? 0.5 : pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Permanently delete account"
        >
          {deletingAccount ? <ActivityIndicator size="small" color={colors.destructiveForeground} /> : null}
          <Text style={[styles.primaryButtonText, { color: colors.destructiveForeground }]}>
            {deletingAccount ? "Deleting account…" : "Permanently delete account"}
          </Text>
        </Pressable>
        {user?.providerData?.some((p) => p.providerId === "password") ? (
          <TextInput
            value={deletePassword}
            onChangeText={setDeletePassword}
            placeholder="Password, if requested"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            accessibilityLabel="Password for account deletion"
          />
        ) : null}
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          {user?.providerData?.some((p) => p.providerId === "password")
            ? "We may ask for your password before deletion to protect your account."
            : "For your security, you may need to sign out and sign back in right before deleting."}
        </Text>
        {deleteError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{deleteError}</Text> : null}
      </Sheet>

      <Sheet visible={panel === "terms"} title="Terms of use" onClose={closePanel} colors={colors}>
        <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>
          Use Packyo to plan trips honestly and respectfully. Keep invite links within your group, check itinerary details before you travel, and make your own decisions about bookings and safety.
        </Text>
        <Text style={[styles.sheetSubheading, { color: colors.foreground }]}>Shared plans</Text>
        <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>
          Anyone you invite to a trip may see and contribute to that trip’s planning details. You are responsible for sharing information with the right people.
        </Text>
        <Text style={[styles.sheetSubheading, { color: colors.foreground }]}>Travel information</Text>
        <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>
          AI suggestions and estimated costs are starting points, not guarantees. Confirm current availability, local requirements, prices, and opening hours before you go.
        </Text>
        <Text style={[styles.legalUpdated, { color: colors.mutedForeground }]}>
          Packyo’s terms are provided in-app so you can review them before using the service.
        </Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 21,
  },
  headerButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "DmSans_700Bold", fontSize: 18 },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  accountAvatar: { width: 54, height: 54, borderRadius: 27 },
  accountCopy: { flex: 1, marginHorizontal: 12 },
  accountName: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  accountEmail: { fontFamily: "DmSans_400Regular", fontSize: 11, marginTop: 4 },
  editBadge: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionLabel: {
    fontFamily: "DmSans_700Bold",
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginTop: 26,
    marginBottom: 9,
  },
  settingCard: { borderRadius: 15, borderWidth: 1, overflow: "hidden" },
  settingRow: {
    minHeight: 69,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 11,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1 },
  rowLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  rowDescription: { fontFamily: "DmSans_400Regular", fontSize: 10, marginTop: 3 },
  rowValue: {
    fontFamily: "DmSans_500Medium",
    fontSize: 10,
    maxWidth: 88,
    textAlign: "right",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 28,
  },
  signOutLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  version: { fontFamily: "DmSans_400Regular", fontSize: 10, textAlign: "center", marginTop: 18 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 4,
    marginBottom: 5,
  },
  sheetHeader: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  sheetTitle: { fontFamily: "DmSans_700Bold", fontSize: 20 },
  closeButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { paddingHorizontal: 20, paddingTop: 4 },
  sheetIntro: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19, marginBottom: 22 },
  fieldLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 12, marginBottom: 8 },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    marginBottom: 10,
  },
  helperText: { fontFamily: "DmSans_400Regular", fontSize: 11, lineHeight: 17, marginTop: 2, marginBottom: 16 },
  errorText: { fontFamily: "DmSans_500Medium", fontSize: 11, lineHeight: 16, marginTop: 10, marginBottom: 4 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  primaryButtonText: { fontFamily: "DmSans_700Bold", fontSize: 13 },
  choiceGroup: { marginBottom: 23 },
  choiceGrid: { gap: 8 },
  choice: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  choiceText: { fontFamily: "DmSans_500Medium", fontSize: 13 },
  savedNotice: {
    borderRadius: 12,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: -2,
  },
  savedNoticeText: { flex: 1, fontFamily: "DmSans_500Medium", fontSize: 11, lineHeight: 16 },
  preferenceCard: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  preferenceSwitch: {
    minHeight: 68,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
  },
  preferenceSwitchLast: { borderBottomWidth: 0 },
  preferenceCopy: { flex: 1, paddingRight: 12 },
  preferenceLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  preferenceDescription: { fontFamily: "DmSans_400Regular", fontSize: 10, lineHeight: 15, marginTop: 3 },
  appearanceRow: {
    minHeight: 66,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    marginTop: 12,
  },
  appearanceIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10 },
  sheetHero: { borderRadius: 15, padding: 15, flexDirection: "row", alignItems: "center", marginBottom: 16 },
  heroIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", marginRight: 12 },
  heroCopy: { flex: 1 },
  heroTitle: { fontFamily: "DmSans_700Bold", fontSize: 15 },
  heroBody: { fontFamily: "DmSans_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  outlineButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 9,
  },
  outlineButtonText: { flex: 1, fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  aboutMark: { alignItems: "center", paddingVertical: 8, marginBottom: 22 },
  aboutMarkCircle: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  aboutWordmark: { fontFamily: "DmSans_700Bold", fontSize: 23, marginTop: 10 },
  aboutTagline: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 4 },
  aboutList: { borderWidth: 1, borderRadius: 13, overflow: "hidden" },
  aboutListRow: { minHeight: 44, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aboutListLabel: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  aboutListValue: { fontFamily: "DmSans_600SemiBold", fontSize: 12 },
  sheetBody: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 20, marginTop: 17 },
  sheetSubheading: { fontFamily: "DmSans_700Bold", fontSize: 14, marginTop: 24 },
  infoBlock: { borderRadius: 14, padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  infoBlockText: { flex: 1, fontFamily: "DmSans_500Medium", fontSize: 12, lineHeight: 18 },
  dangerButton: {
    minHeight: 48,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  legalUpdated: { fontFamily: "DmSans_400Regular", fontSize: 10, lineHeight: 15, marginTop: 24 },
});
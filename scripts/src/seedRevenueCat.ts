import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "gopack\u2024now";

// Pay-per-itinerary unlocks (one-time, consumable so they can be bought once per trip)
const UNLOCKS = [
  {
    label: "Group Itinerary Unlock",
    identifier: "itinerary_group_unlock_399",
    playIdentifier: "itinerary_group_unlock_399",
    title: "Unlock for the whole pack",
    prices: [{ amount_micros: 3990000, currency: "USD" }], // $3.99
    packageKey: "itinerary_group",
  },
  {
    label: "Personal Itinerary Unlock",
    identifier: "itinerary_personal_unlock_299",
    playIdentifier: "itinerary_personal_unlock_299",
    title: "Unlock just for me",
    prices: [{ amount_micros: 2990000, currency: "USD" }], // $2.99
    packageKey: "itinerary_personal",
  },
] as const;

const APP_STORE_APP_NAME = "Packyo iOS";
const APP_STORE_BUNDLE_ID = "com.gopacknow.app";
const PLAY_STORE_APP_NAME = "Packyo Android";
const PLAY_STORE_PACKAGE_NAME = "com.gopacknow.app";

const OFFERING_IDENTIFIER = "itinerary_unlock";
const OFFERING_DISPLAY_NAME = "Itinerary Unlock";

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });

  if (listProjectsError) throw new Error("Failed to list projects: " + JSON.stringify(listProjectsError));
  console.log("Found projects:", existingProjects.items?.map(p => p.name + " / " + p.id).join(", "));

  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error } = await createProject({ client, body: { name: PROJECT_NAME } });
    if (error) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps || apps.items.length === 0) throw new Error("No apps found");

  let app: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

  if (!app) throw new Error("No test store app found");
  console.log("Test store app:", app.id);

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProduct = async (
    targetApp: App,
    label: string,
    identifier: string,
    isTestStore: boolean,
    displayName: string,
    userFacingTitle: string,
    opts: { type: "subscription"; duration: string } | { type: "non_consumable" } | { type: "consumable" },
  ): Promise<Product> => {
    const existing = existingProducts.items?.find((p) => p.store_identifier === identifier && p.app_id === targetApp.id);
    if (existing) { console.log(label + " product exists:", existing.id); return existing; }

    const body: CreateProductData["body"] = {
      store_identifier: identifier,
      app_id: targetApp.id,
      type: opts.type,
      display_name: displayName,
    };
    if (isTestStore) {
      body.title = userFacingTitle;
      if (opts.type === "subscription" && "duration" in opts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body.subscription = { duration: opts.duration as any };
      }
    }
    const { data: created, error } = await createProduct({ client, path: { project_id: project.id }, body });
    if (error) throw new Error("Failed to create " + label + " product: " + JSON.stringify(error));
    console.log("Created " + label + " product:", created.id);
    return created;
  };

  const addTestStorePrices = async (productId: string, prices: { amount_micros: number; currency: string }[], label: string) => {
    const { error } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: productId },
      body: { prices },
    });
    if (error) {
      if (typeof error === "object" && "type" in error && (error as any).type === "resource_already_exists") {
        console.log(label + " test store prices already exist");
      } else {
        throw new Error("Failed to add " + label + " test store prices: " + JSON.stringify(error));
      }
    } else {
      console.log("Added " + label + " test store prices");
    }
  };

  const appStoreBundle = (appStoreApp as any).app_store?.bundle_id;
  if (appStoreBundle && appStoreBundle !== APP_STORE_BUNDLE_ID) {
    console.warn(`!! App Store app in RevenueCat uses bundle ID ${appStoreBundle}; the app ships as ${APP_STORE_BUNDLE_ID}. Fix it in the RevenueCat dashboard.`);
  }

  let offering: Offering | undefined;
  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOfferingsError) throw new Error("Failed to list offerings");
  offering = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);
  if (offering) {
    console.log("Offering exists:", offering.id);
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: { lookup_key: OFFERING_IDENTIFIER, display_name: OFFERING_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }
  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current (replaces the old subscription offering)");
  }

  const { data: existingPackages, error: listPackagesError } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 20 },
  });
  if (listPackagesError) throw new Error("Failed to list packages");

  for (const u of UNLOCKS) {
    const testProduct = await ensureProduct(app, `Test Store [${u.label}]`, u.identifier, true, u.label, u.title, { type: "consumable" });
    const iosProduct = await ensureProduct(appStoreApp, `App Store [${u.label}]`, u.identifier, false, u.label, u.title, { type: "consumable" });
    const androidProduct = await ensureProduct(playStoreApp, `Play Store [${u.label}]`, u.playIdentifier, false, u.label, u.title, { type: "consumable" });
    await addTestStorePrices(testProduct.id, [...u.prices], u.label);

    let pkg: Package | undefined = existingPackages.items?.find((p) => p.lookup_key === u.packageKey);
    if (!pkg) {
      const { data: created, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: { lookup_key: u.packageKey, display_name: u.title },
      });
      if (error) throw new Error("Failed to create " + u.label + " package: " + JSON.stringify(error));
      pkg = created;
      console.log("Created " + u.label + " package:", pkg.id);
    }
    const { error: attachError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: { products: [testProduct, iosProduct, androidProduct].map((p) => ({ product_id: p.id, eligibility_criteria: "all" as const })) },
    });
    if (attachError && (attachError as any).type !== "unprocessable_entity_error") {
      throw new Error("Failed to attach products to " + u.label + " package");
    }
  }

  const { data: testKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: app.id } });
  const { data: iosKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: appStoreApp.id } });
  const { data: androidKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: playStoreApp.id } });

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", app.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Offering:", OFFERING_IDENTIFIER);
  console.log("Public API Key - Test Store:", testKeys?.items[0]?.key ?? "N/A");
  console.log("Public API Key - iOS:", iosKeys?.items[0]?.key ?? "N/A");
  console.log("Public API Key - Android:", androidKeys?.items[0]?.key ?? "N/A");
  console.log("====================\n");
  console.log("NEXT: Save these as env vars:");
  console.log("  REVENUECAT_PROJECT_ID =", project.id);
  console.log("  REVENUECAT_TEST_STORE_APP_ID =", app.id);
  console.log("  REVENUECAT_APPLE_APP_STORE_APP_ID =", appStoreApp.id);
  console.log("  REVENUECAT_GOOGLE_PLAY_STORE_APP_ID =", playStoreApp.id);
  console.log("  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY =", testKeys?.items[0]?.key ?? "N/A");
  console.log("  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY =", iosKeys?.items[0]?.key ?? "N/A");
  console.log("  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY =", androidKeys?.items[0]?.key ?? "N/A");
}

seedRevenueCat().catch(console.error);

import { createMMKV } from "react-native-mmkv";
import { isHermesIntegrationBuild } from "./build-profile";

export type OptionalSetupCapability = "robot";

export type SetupSkipState = Record<OptionalSetupCapability, boolean>;
export type AppMode = "local" | "legacy_realtime";
const modeListeners = new Set<() => void>();

type SetupStoragePayload = {
  version: 3;
  appMode: AppMode;
  onboardingCompleted: boolean;
  skipped: SetupSkipState;
  updatedAt: string;
};

const SETUP_STORAGE_KEY = "looi.setup.v1";
const ROBOT_ONBOARDING_KEY = "myyaya.companion-onboarding.v1";
const setupStorage = createMMKV({ id: "looi.setup" });

const defaultSetupState: SetupStoragePayload = {
  version: 3,
  appMode: "local",
  onboardingCompleted: false,
  skipped: { robot: false },
  updatedAt: new Date(0).toISOString(),
};

export function getSetupStorageState(): SetupStoragePayload {
  const raw = setupStorage.getString(SETUP_STORAGE_KEY);
  if (!raw) return defaultSetupState;

  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      appMode?: unknown;
      onboardingCompleted?: unknown;
      skipped?: Record<string, unknown>;
      updatedAt?: unknown;
    };
    const migrated: SetupStoragePayload = {
      version: 3,
      // Existing OpenAI credentials never imply consent to enable cloud voice.
      appMode: !isHermesIntegrationBuild() && parsed.appMode === "legacy_realtime" ? "legacy_realtime" : "local",
      onboardingCompleted: Boolean(parsed.onboardingCompleted),
      skipped: { robot: Boolean(parsed.skipped?.robot) },
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : defaultSetupState.updatedAt,
    };
    if (parsed.version !== 3 || parsed.skipped?.camera !== undefined || parsed.skipped?.calendar !== undefined) {
      setupStorage.set(SETUP_STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    setupStorage.remove(SETUP_STORAGE_KEY);
    return defaultSetupState;
  }
}

export function getAppMode(): AppMode {
  return isHermesIntegrationBuild() ? "local" : getSetupStorageState().appMode;
}

export function subscribeAppMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

export function setAppMode(appMode: AppMode): void {
  if (appMode !== "local" && appMode !== "legacy_realtime") throw new Error("Unsupported app mode");
  if (appMode === "legacy_realtime" && isHermesIntegrationBuild()) throw new Error("Legacy voice is unavailable in this integration build");
  const state = getSetupStorageState();
  if (state.appMode === appMode) return;
  setupStorage.set(SETUP_STORAGE_KEY, JSON.stringify({ ...state, appMode, updatedAt: new Date().toISOString() }));
  for (const listener of modeListeners) listener();
}

export function setOptionalCapabilitySkipped(
  capability: OptionalSetupCapability,
  skipped: boolean
): SetupStoragePayload {
  const state = getSetupStorageState();
  const next: SetupStoragePayload = {
    ...state,
    skipped: { ...state.skipped, [capability]: skipped },
    updatedAt: new Date().toISOString(),
  };
  setupStorage.set(SETUP_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function setOnboardingCompleted(completed: boolean): SetupStoragePayload {
  const state = getSetupStorageState();
  const next: SetupStoragePayload = {
    ...state,
    onboardingCompleted: completed,
    updatedAt: new Date().toISOString(),
  };
  setupStorage.set(SETUP_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function resetSetupStorage(): void {
  setupStorage.remove(SETUP_STORAGE_KEY);
  setupStorage.remove(ROBOT_ONBOARDING_KEY);
  for (const listener of modeListeners) listener();
}

/** A separate migration marker makes existing dashboard installs see the new guide once. */
export function hasCompletedRobotOnboarding(): boolean {
  return setupStorage.getString(ROBOT_ONBOARDING_KEY) === "1";
}

export function completeRobotOnboarding(): void {
  setOnboardingCompleted(true);
  setupStorage.set(ROBOT_ONBOARDING_KEY, "1");
}

import { getLooiRobotRuntimeState } from "@/src/device-tools/looi-robot";
import { getSavedLooiRobot } from "@/src/device-tools/looi-robot-autoconnect";
import type { SherpaModelCheck } from "@/src/voice/sherpa-models";
import { getAppMode, getSetupStorageState, hasCompletedRobotOnboarding, type AppMode, type SetupSkipState } from "./setup-storage";

export type SetupStep = "openai" | "models" | "permissions" | "done";

export type SetupModelReadiness = {
  asr: SherpaModelCheck;
  kws: SherpaModelCheck;
  speaker: SherpaModelCheck;
  vad: SherpaModelCheck;
};

export type SetupReadiness = {
  appMode: AppMode;
  legacyVoiceReady: boolean;
  openAiKeyConfigured: boolean;
  modelsReady: boolean;
  modelStatus: SetupModelReadiness | null;
  microphoneReady: boolean;
  robotReady: boolean;
  skipped: SetupSkipState;
  onboardingCompleted: boolean;
  requiredReady: boolean;
  nextStep: SetupStep;
};

export function areSherpaModelsReady(status: SetupModelReadiness): boolean {
  return Boolean(status.asr.ready && status.kws.ready && status.vad.ready);
}

export async function computeSetupReadiness(): Promise<SetupReadiness> {
  const storageState = getSetupStorageState();
  if (storageState.appMode === "local") {
    // Local use needs no cloud key/models, but first launch must show the
    // permission and robot-connection guide, including upgrades from the dashboard.
    const completed = hasCompletedRobotOnboarding();
    return {
      appMode: "local", legacyVoiceReady: false,
      openAiKeyConfigured: false, modelsReady: false, modelStatus: null,
      microphoneReady: false, robotReady: await getRobotReady(),
      skipped: storageState.skipped, onboardingCompleted: storageState.onboardingCompleted,
      requiredReady: completed, nextStep: completed ? "done" : "permissions",
    };
  }
  const [{ hasOpenAiApiKey }, { checkAllSherpaModelReadiness }] = await Promise.all([
    import("@/src/openai/openai-api-key"), import("@/src/voice/sherpa-models"),
  ]);
  const [openAiKeyConfigured, modelResult, microphoneReady, robotReady] = await Promise.all([
    hasOpenAiApiKey(),
    checkAllSherpaModelReadiness().catch((error) => {
      console.warn("[Setup] Failed to check Sherpa model readiness:", error);
      return null;
    }),
    getMicrophoneReady(),
    getRobotReady(),
  ]);

  const modelsReady = modelResult ? areSherpaModelsReady(modelResult) : false;
  const requiredReady = openAiKeyConfigured && modelsReady && microphoneReady;

  return {
    appMode: storageState.appMode,
    legacyVoiceReady: requiredReady,
    openAiKeyConfigured,
    modelsReady,
    modelStatus: modelResult,
    microphoneReady,
    robotReady,
    skipped: storageState.skipped,
    onboardingCompleted: storageState.onboardingCompleted,
    requiredReady,
    nextStep: getNextSetupStep({ openAiKeyConfigured, modelsReady, microphoneReady }),
  };
}

export async function isLegacyVoiceReady(): Promise<boolean> {
  if (getAppMode() !== "legacy_realtime") return false;
  try {
    const readiness = await computeSetupReadiness();
    return getAppMode() === "legacy_realtime" && readiness.legacyVoiceReady;
  } catch (error) {
    console.warn("[Setup] Legacy voice readiness failed:", error);
    return false;
  }
}

function getNextSetupStep(state: {
  openAiKeyConfigured: boolean;
  modelsReady: boolean;
  microphoneReady: boolean;
}): SetupStep {
  if (!state.openAiKeyConfigured) return "openai";
  if (!state.modelsReady) return "models";
  if (!state.microphoneReady) return "permissions";
  return "done";
}

async function getMicrophoneReady(): Promise<boolean> {
  try {
    const { getRecordingPermissionsAsync } = await import("expo-audio");
    const permission = await getRecordingPermissionsAsync();
    return Boolean(permission.granted);
  } catch (error) {
    console.warn("[Setup] Failed to check microphone permission:", error);
    return false;
  }
}

async function getRobotReady(): Promise<boolean> {
  try {
    const runtimeState = getLooiRobotRuntimeState();
    if (runtimeState.connected) return true;
    return Boolean(await getSavedLooiRobot());
  } catch (error) {
    console.warn("[Setup] Failed to check robot readiness:", error);
    return false;
  }
}

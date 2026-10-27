import Constants from "expo-constants";

export function isHermesIntegrationBuild(): boolean {
  return Constants.expoConfig?.extra?.myyaya?.buildProfile === "hermes-integration";
}

import { useSyncExternalStore } from "react";
import { getAppMode, subscribeAppMode } from "./setup-storage";

export function useAppMode() {
  return useSyncExternalStore(subscribeAppMode, getAppMode, getAppMode);
}

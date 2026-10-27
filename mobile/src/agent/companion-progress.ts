import type { CompanionProgress } from "./companion-agent";
let progress: CompanionProgress = { phase: "idle", label: "" };
const listeners = new Set<() => void>();
export const getCompanionProgress = () => progress;
export const subscribeCompanionProgress = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const updateCompanionProgress = (next: CompanionProgress) => { progress = next; listeners.forEach((fn) => fn()); };

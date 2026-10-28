import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "myyaya.tavily.key.v1";

export function normalizeTavilyKey(value: string): string {
  const key = value.trim().replace(/^Bearer\s+/i, "");
  if (!/^tvly-[A-Za-z0-9_-]{16,200}$/.test(key)) throw new Error("请填写有效的 Tavily API Key");
  return key;
}

export async function readTavilyKey(): Promise<string | null> {
  const value = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!value) return null;
  try { return normalizeTavilyKey(value); } catch { return null; }
}

export async function saveTavilyKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, normalizeTavilyKey(value));
}

export async function clearTavilyKey(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

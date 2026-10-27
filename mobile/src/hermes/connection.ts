import * as SecureStore from "expo-secure-store";

export const DEFAULT_HERMES_ORIGIN = "https://hermes.jiazhuangai.com";
export const HERMES_MODEL_ALIAS = "hermes-agent";
const STORAGE_KEY = "myyaya.hermes.connection.v1";
const RUN_FEATURES = ["run_submission", "run_status", "run_events_sse", "run_stop"] as const;

export type HermesConnection = { version: 1; baseUrl: string; token: string };
export type HermesConnectionProbe = {
  passed: boolean;
  health: number;
  modelsWithoutToken: number;
  modelsWithToken: number;
  capabilities: number;
  modelAliasAvailable: boolean;
  features: Record<(typeof RUN_FEATURES)[number], boolean>;
};

export function normalizeHermesOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请输入有效的 HTTPS 服务地址"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash ||
      !["", "/v1"].includes(url.pathname.replace(/\/+$/, ""))) {
    throw new Error("服务地址须使用 HTTPS，不包含账号、查询参数或其他路径");
  }
  return url.origin;
}

export function normalizeHermesToken(value: string): string {
  const token = value.trim().replace(/^Bearer\s+/i, "");
  if (!/^[!-~]{1,2048}$/.test(token) || /^(?:API_SERVER_KEY|Authorization)[:=]/i.test(token)) {
    throw new Error("请仅填写独立的 Hermes API Token，不要粘贴整个 .env");
  }
  return token;
}

export function resolveHermesConnection(
  baseUrl: string, tokenInput: string, existing: HermesConnection | null
): HermesConnection {
  const origin = normalizeHermesOrigin(baseUrl);
  const token = tokenInput.trim()
    ? normalizeHermesToken(tokenInput)
    : existing?.baseUrl === origin ? existing.token : "";
  if (!token) throw new Error("首次连接或更换服务地址时，请填写对应的 API Token");
  return { version: 1, baseUrl: origin, token: normalizeHermesToken(token) };
}

export async function readHermesConnection(): Promise<HermesConnection | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") return null;
    return resolveHermesConnection(parsed.baseUrl, parsed.token, null);
  } catch { return null; }
}

export async function saveHermesConnection(connection: HermesConnection): Promise<void> {
  const valid = resolveHermesConnection(connection.baseUrl, connection.token, null);
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(valid));
}

export async function clearHermesConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

/** Read-only discovery. This never submits a run or executes a terminal command. */
export async function probeHermesConnection(connection: HermesConnection): Promise<HermesConnectionProbe> {
  const config = resolveHermesConnection(connection.baseUrl, connection.token, null);
  const get = async (path: string, authenticated = false) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(config.baseUrl + path, {
        method: "GET", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", ...(authenticated ? { Authorization: `Bearer ${config.token}` } : {}) },
      });
      if (response.url && new URL(response.url).origin !== config.baseUrl) throw new Error("服务地址发生跨站跳转");
      const data = response.ok ? await response.json().catch(() => null) : null;
      return { status: response.status, data };
    } finally { clearTimeout(timeout); }
  };
  const [health, anonymous, models, capabilities] = await Promise.all([
    get("/health"), get("/v1/models"), get("/v1/models", true), get("/v1/capabilities", true),
  ]);
  const features = Object.fromEntries(
    RUN_FEATURES.map((name) => [name, capabilities.data?.features?.[name] === true])
  ) as HermesConnectionProbe["features"];
  const modelAliasAvailable = Array.isArray(models.data?.data) &&
    models.data.data.some((model: { id?: string }) => model?.id === HERMES_MODEL_ALIAS);
  return {
    health: health.status, modelsWithoutToken: anonymous.status,
    modelsWithToken: models.status, capabilities: capabilities.status, modelAliasAvailable, features,
    passed: health.status === 200 && anonymous.status === 401 && models.status === 200 &&
      capabilities.status === 200 && modelAliasAvailable && RUN_FEATURES.every((name) => features[name]),
  };
}

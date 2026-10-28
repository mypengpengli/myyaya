import { fetch } from "expo/fetch";
import { normalizeTavilyKey, readTavilyKey } from "./tavily-config";

export type WebSearchInput = { query: string; topic?: "general" | "news"; timeRange?: "day" | "week" | "month" | "year" };
export type WebSearchResult = { query: string; searchedAt: string; sources: Array<{ title: string; url: string; content: string; publishedAt?: string }> };

/** Only this fixed HTTPS origin receives the independent Tavily credential. */
export async function searchWeb(input: WebSearchInput, signal?: AbortSignal, keyOverride?: string): Promise<WebSearchResult> {
  const query = input.query.trim();
  if (!query || query.length > 500) throw new Error("搜索内容须为 1 到 500 个字符");
  if (input.topic && !["general", "news"].includes(input.topic)) throw new Error("搜索分类无效");
  if (input.timeRange && !["day", "week", "month", "year"].includes(input.timeRange)) throw new Error("搜索时间范围无效");
  if (signal?.aborted) throw new Error("已取消联网搜索");
  const stored = keyOverride ?? await readTavilyKey();
  if (!stored) throw new Error("联网搜索尚未配置，请在左滑菜单的联网搜索设置中填写 Tavily Key");
  const apiKey = normalizeTavilyKey(stored);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 30_000);
  try {
    if (controller.signal.aborted) throw new Error("已取消联网搜索");
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, topic: input.topic ?? "general", ...(input.timeRange ? { time_range: input.timeRange } : {}),
        search_depth: "basic", max_results: 5, auto_parameters: false, include_answer: false,
        include_raw_content: false, include_images: false, safe_search: true }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("Tavily Key 无效，请在联网搜索设置中修改");
      if ([429, 432, 433].includes(response.status)) throw new Error("Tavily 配额不足或请求过快，请稍后重试或检查账户额度");
      throw new Error(`联网搜索失败（HTTP ${response.status}）`);
    }
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error("联网搜索返回格式异常");
    const clean = (value: unknown, length: number) => typeof value === "string" ? value.split(apiKey).join("[已隐藏]").slice(0, length) : "";
    const sources: WebSearchResult["sources"] = [];
    for (const entry of data.results.slice(0, 5)) {
      if (!entry || typeof entry.url !== "string") continue;
      let url: URL;
      try { url = new URL(entry.url); } catch { continue; }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || entry.url.includes(apiKey)) continue;
      sources.push({ title: clean(entry.title, 200), url: url.href.slice(0, 2000), content: clean(entry.content, 1800),
        ...(typeof entry.published_date === "string" ? { publishedAt: clean(entry.published_date, 100) } : {}) });
    }
    if (controller.signal.aborted) throw new Error("已取消联网搜索");
    return { query: clean(query, 500), searchedAt: new Date().toISOString(), sources };
  } catch (error) {
    // Do not display provider bodies/native errors: they may contain request headers.
    if (signal?.aborted) throw new Error("已取消联网搜索");
    if (controller.signal.aborted) throw new Error("联网搜索超时，请检查手机网络后重试");
    if (error instanceof Error && /^(Tavily Key 无效|Tavily 配额|联网搜索失败（HTTP \d+）$|联网搜索返回格式异常$)/.test(error.message)) throw error;
    throw new Error("联网搜索连接失败，请检查手机网络后重试");
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

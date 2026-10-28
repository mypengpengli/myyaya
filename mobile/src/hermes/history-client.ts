import { fetch } from "expo/fetch";
import type { HermesConnection } from "./connection";

export function createHermesHistoryClient(connection: HermesConnection) {
  const json = async (path: string) => {
    const response = await fetch(connection.baseUrl + path, { headers: { Authorization: `Bearer ${connection.token}`, Accept: "application/json" }, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`服务器历史暂时不可用（HTTP ${response.status}），手机本地任务仍保留`);
    return response.json();
  };
  return {
    async list() {
      const data = await json("/api/sessions?source=api_server&limit=50");
      if (!Array.isArray(data?.data)) throw new Error("服务器会话列表无效");
      return data.data.filter((item: { id?: string }) => typeof item.id === "string" && /^myyaya-[A-Za-z0-9_-]{1,180}$/.test(item.id)).slice(0, 20)
        .map((item: { id: string; title?: string; message_count?: number }) => ({ id: item.id, title: String(item.title ?? "手机任务").slice(0, 180), messageCount: item.message_count }));
    },
    async messages(id: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("服务器会话编号无效");
      const data = await json(`/api/sessions/${id}/messages?limit=20&order=latest`);
      if (!Array.isArray(data?.data)) throw new Error("服务器消息历史无效");
      let total = 0;
      return data.data.filter((item: { role?: string; content?: unknown }) => ["user", "assistant"].includes(item.role ?? "") && typeof item.content === "string")
        .map((item: { role: "user" | "assistant"; content: string }) => ({ role: item.role, content: item.content.slice(0, 6000) }))
        .filter((item: { content: string }) => { total += item.content.length; return total <= 24_000; });
    },
  };
}

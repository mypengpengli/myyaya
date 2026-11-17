export type RecentDialogueLine = { role: "user" | "assistant"; content: string; timestamp: string };
/** Historical text is data, never a new user instruction or a tool transcript to execute. */
export function boundedRecentDialogue(rows: RecentDialogueLine[]): string {
  const chosen: RecentDialogueLine[] = []; let budget = 12_000;
  for (const row of rows.slice(-48).reverse()) {
    if (!["user", "assistant"].includes(row.role) || typeof row.content !== "string") continue;
    const content = row.content.trim().slice(0, Math.min(1600, budget));
    if (!content) continue;
    chosen.unshift({ role: row.role, content, timestamp: row.timestamp }); budget -= content.length;
    if (budget <= 0) break;
  }
  return JSON.stringify(chosen);
}

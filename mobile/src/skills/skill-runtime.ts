import * as SQLite from "expo-sqlite";
import { SkillService } from "./skill-service";

let service: SkillService | undefined;
export function getSkillService(): SkillService {
  if (!service) {
    const db = SQLite.openDatabaseSync("myyaya-skills-v1.db");
    db.execSync("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS skills(name TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);");
    service = new SkillService({
      list: () => db.getAllSync<{ data: string }>("SELECT data FROM skills").map((row) => JSON.parse(row.data)),
      save: (skill) => { db.runSync("INSERT INTO skills(name,data) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET data=excluded.data", skill.name, JSON.stringify(skill)); },
      remove: (name) => { db.runSync("DELETE FROM skills WHERE name=?", name); },
    });
  }
  return service;
}
const successfulTools = new Set<string>(), loaded = new Set<string>();
export function observeSkillTool(name: string, isError: boolean, result?: unknown): void {
  if (isError || name.startsWith("skill_")) return;
  // Accepted asynchronous work is not a successful completed workflow.
  if (["create_media", "hermes_submit", "hermes_continue", "record_video"].includes(name)) return;
  const parts = (result as { content?: { type: string; text?: string }[] } | undefined)?.content;
  let value: unknown;
  try { value = JSON.parse(parts?.find((part) => part.type === "text")?.text ?? "null"); } catch { /* Some synchronous tools return plain text. */ }
  if (value && typeof value === "object" && ((value as { cancelled?: boolean }).cancelled || (value as { saved?: boolean }).saved === false)) return;
  if (name === "media_status" && Array.isArray(value) && value.some((job) => job.status === "completed" && job.artifactId)) successfulTools.add("create_media");
  if (name === "hermes_status" && Array.isArray(value) && value.some((task) => task.status === "completed")) successfulTools.add("hermes_submit");
  if (name === "stop_recording" && (value as { saved?: boolean } | undefined)?.saved === true) successfulTools.add("record_video");
  successfulTools.add(name);
}
export function skillEvidence(): string[] { return [...successfulTools]; }
export function observeSkillReply(): void { successfulTools.add("assistant_reply"); }
export function readSkillForAgent(name: string, availableTools: string[]) {
  const result = getSkillService().read(name, availableTools, !loaded.has(name)); loaded.add(name); return result;
}
export function prepareSkillContext(query: string, availableTools: string[]): string {
  loaded.clear();
  const skills = getSkillService(), catalog = skills.catalog(availableTools);
  const selected = skills.matching(query, availableTools).map((skill) => readSkillForAgent(skill.name, availableTools));
  return JSON.stringify({ catalog, loaded: selected });
}

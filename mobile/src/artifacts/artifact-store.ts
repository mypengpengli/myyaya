import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { randomUUID } from "expo-crypto";
import { resultPresentation, type PresentationItem } from "./presentation";
import { fileTypes } from "./file-types";
import { readArtifactFocus, updateArtifactFocus } from "./artifact-focus";
import { resolveImageReference, artifactVersions } from "./artifact-versions";

export type Artifact = PresentationItem & { createdAt: number; mimeType: string; parentId?: string; sourceTaskId?: string };

/** A verified native download/import already lives in this app's private artifact directory. */
export function registerArtifactFile(input: { id: string; uri: string; title: string; mimeType: string; sourceTaskId?: string }): Artifact {
  const type = fileTypes[input.mimeType];
  if (!type || !/^[A-Za-z0-9_-]{1,160}$/.test(input.id) || !input.uri.endsWith(`/myyaya-artifacts/${input.id}.${type.extension}`)) throw new Error("文件类型或保存位置无效");
  const existing = findArtifact(input.id);
  if (existing) {
    if (existing.uri !== input.uri || existing.mimeType !== input.mimeType || existing.sourceTaskId !== input.sourceTaskId) throw new Error("文件编号冲突");
    return existing;
  }
  const item: Artifact = { ...input, title: input.title.slice(0, 180), kind: type.kind, createdAt: Date.now() };
  db().runSync("INSERT INTO artifacts(id,created_at,data) VALUES(?,?,?)", item.id, item.createdAt, JSON.stringify(item));
  return item;
}
let database: SQLite.SQLiteDatabase | undefined;
function db() {
  if (!database) {
    database = SQLite.openDatabaseSync("myyaya-artifacts-v1.db");
    database.execSync("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);");
  }
  return database;
}
export function listArtifacts(): Artifact[] { return db().getAllSync<{ data: string }>("SELECT data FROM artifacts ORDER BY created_at DESC LIMIT 200").map((row) => JSON.parse(row.data)); }
export function findArtifact(id?: string): Artifact | undefined {
  if (!id) { const focus = readArtifactFocus().artifactId; return focus ? findArtifact(focus) ?? listArtifacts()[0] : listArtifacts()[0]; }
  const row = db().getFirstSync<{ data: string }>("SELECT data FROM artifacts WHERE id=?", id);
  return row ? JSON.parse(row.data) : undefined;
}
export async function savePhotoArtifact(base64: string, mimeType: "image/jpeg" | "image/png", title: string, parentId?: string, options: { select?: boolean; sourceTaskId?: string; id?: string } = {}): Promise<Artifact> {
  if (!FileSystem.documentDirectory) throw new Error("手机文件存储不可用");
  const id = options.id ?? randomUUID(), directory = FileSystem.documentDirectory + "myyaya-artifacts/";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("作品编号无效");
  if (options.id) { const existing = findArtifact(id); if (existing) return existing; }
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = directory + id + (mimeType === "image/png" ? ".png" : ".jpg");
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const item: Artifact = { id, title, kind: "image", uri, mimeType, createdAt: Date.now(), ...(parentId ? { parentId } : {}), ...(options.sourceTaskId ? { sourceTaskId: options.sourceTaskId } : {}) };
  try { db().runSync("INSERT INTO artifacts(id,created_at,data) VALUES(?,?,?)", id, item.createdAt, JSON.stringify(item)); }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); throw error; }
  if (options.select !== false) selectArtifact(item);
  return item;
}
export function selectArtifact(item: Artifact) { updateArtifactFocus({ artifactId: item.id, ...(item.kind === "image" ? { imageId: item.id } : {}) }); }
export function selectedImage(id?: string): Artifact {
  return resolveImageReference(listArtifacts(), id, resultPresentation.getSnapshot().active?.id, readArtifactFocus().imageId);
}
export function listArtifactVersions(id?: string): Artifact[] {
  return artifactVersions(listArtifacts(), id ?? selectedImage().id);
}
export function presentArtifact(id?: string): Artifact {
  const item = findArtifact(id);
  if (!item) throw new Error("没有找到之前保存的作品");
  selectArtifact(item); resultPresentation.open(item); return item;
}
export async function saveVideoArtifact(sourceUri: string, options: { title?: string; parentId?: string; sourceTaskId?: string; id?: string } = {}): Promise<Artifact> {
  if (!FileSystem.documentDirectory || !FileSystem.cacheDirectory || !sourceUri.startsWith(FileSystem.cacheDirectory)) throw new Error("录像文件不是本应用的缓存文件");
  const id = options.id ?? randomUUID(), directory = FileSystem.documentDirectory + "myyaya-artifacts/";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("作品编号无效");
  if (options.id) { const existing = findArtifact(id); if (existing) return existing; }
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = directory + id + ".mp4";
  await FileSystem.copyAsync({ from: sourceUri, to: uri });
  const item: Artifact = { id, title: options.title ?? "手机录像", kind: "video", uri, mimeType: "video/mp4", createdAt: Date.now(), ...(options.parentId ? { parentId: options.parentId } : {}), ...(options.sourceTaskId ? { sourceTaskId: options.sourceTaskId } : {}) };
  try { db().runSync("INSERT INTO artifacts(id,created_at,data) VALUES(?,?,?)", id, item.createdAt, JSON.stringify(item)); }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); throw error; }
  await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
  return item;
}

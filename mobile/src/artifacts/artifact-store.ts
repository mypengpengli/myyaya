import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { randomUUID } from "expo-crypto";
import { resultPresentation, type PresentationItem } from "./presentation";

export type Artifact = PresentationItem & { createdAt: number; mimeType: string; parentId?: string };
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
  if (!id) return listArtifacts()[0];
  const row = db().getFirstSync<{ data: string }>("SELECT data FROM artifacts WHERE id=?", id);
  return row ? JSON.parse(row.data) : undefined;
}
export async function savePhotoArtifact(base64: string, mimeType: "image/jpeg" | "image/png", title: string, parentId?: string): Promise<Artifact> {
  if (!FileSystem.documentDirectory) throw new Error("手机文件存储不可用");
  const id = randomUUID(), directory = FileSystem.documentDirectory + "myyaya-artifacts/";
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = directory + id + (mimeType === "image/png" ? ".png" : ".jpg");
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const item: Artifact = { id, title, kind: "image", uri, mimeType, createdAt: Date.now(), ...(parentId ? { parentId } : {}) };
  try { db().runSync("INSERT INTO artifacts(id,created_at,data) VALUES(?,?,?)", id, item.createdAt, JSON.stringify(item)); }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); throw error; }
  return item;
}
export function presentArtifact(id?: string): Artifact {
  const item = findArtifact(id);
  if (!item) throw new Error("没有找到之前保存的作品");
  resultPresentation.open(item); return item;
}
export async function saveVideoArtifact(sourceUri: string): Promise<Artifact> {
  if (!FileSystem.documentDirectory || !FileSystem.cacheDirectory || !sourceUri.startsWith(FileSystem.cacheDirectory)) throw new Error("录像文件不是本应用的缓存文件");
  const id = randomUUID(), directory = FileSystem.documentDirectory + "myyaya-artifacts/";
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = directory + id + ".mp4";
  await FileSystem.copyAsync({ from: sourceUri, to: uri });
  const item: Artifact = { id, title: "手机录像", kind: "video", uri, mimeType: "video/mp4", createdAt: Date.now() };
  try { db().runSync("INSERT INTO artifacts(id,created_at,data) VALUES(?,?,?)", id, item.createdAt, JSON.stringify(item)); }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); throw error; }
  await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
  return item;
}

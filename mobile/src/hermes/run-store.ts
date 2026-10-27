import * as SQLite from "expo-sqlite";
import type { HermesTask, TaskRepository } from "./task-service";

let database: SQLite.SQLiteDatabase | null = null;
function db() {
  if (!database) {
    const opened = SQLite.openDatabaseSync("myyaya-hermes-v1.db");
    opened.execSync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS hermes_tasks (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);`);
    database = opened;
  }
  return database;
}

/** Deliberately separate from conversation backups; never stores connection tokens. */
export const hermesTaskRepository: TaskRepository = {
  list: () => db().getAllSync<{ data: string }>("SELECT data FROM hermes_tasks ORDER BY created_at DESC").map((row) => JSON.parse(row.data)),
  save: (task: HermesTask) => { db().runSync(
    "INSERT INTO hermes_tasks(id,created_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    task.id, task.createdAt, JSON.stringify(task)); },
};

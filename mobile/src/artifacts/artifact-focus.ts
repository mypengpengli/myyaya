import * as SQLite from "expo-sqlite";

export type ArtifactFocus = { artifactId?: string; imageId?: string; taskId?: string };
let database: SQLite.SQLiteDatabase | undefined;
function db() {
  if (!database) {
    database = SQLite.openDatabaseSync("myyaya-artifact-focus-v1.db");
    database.execSync("CREATE TABLE IF NOT EXISTS focus(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)");
  }
  return database;
}
export function readArtifactFocus(): ArtifactFocus {
  const row = db().getFirstSync<{ data: string }>("SELECT data FROM focus WHERE id=1");
  return row ? JSON.parse(row.data) : {};
}
export function updateArtifactFocus(patch: Partial<ArtifactFocus>): ArtifactFocus {
  const next = { ...readArtifactFocus(), ...patch };
  db().runSync("INSERT INTO focus(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", JSON.stringify(next));
  return next;
}

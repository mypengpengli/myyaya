import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, mkdtempSync, copyFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const MODEL_SHA256 = "3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba";
const name = "vosk-model-small-cn-0.22";
const url = `https://alphacephei.com/vosk/models/${name}.zip`;
const stage = join(root, ".build-assets", "vosk", "vosk-command-cn-0.22");
const cache = join(root, ".build-assets", "downloads");
mkdirSync(cache, { recursive: true });
const supplied = process.argv.indexOf("--archive");
const copyTree = (source, target) => {
  // Node 24 native recursive cp silently omitted files in our Chinese Windows path.
  // Explicit traversal uses the ordinary Unicode-aware file APIs on both platforms.
  if (statSync(source).isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name));
  } else copyFileSync(source, target);
};
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const archive = supplied >= 0 ? resolve(process.argv[supplied + 1]) : join(cache, name + ".zip");
if (!existsSync(archive)) {
  if (supplied >= 0) throw new Error("Requested model archive does not exist");
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: "error" });
  if (!response.ok) throw new Error(`Vosk model download failed: HTTP ${response.status}`);
  writeFileSync(archive + ".part", new Uint8Array(await response.arrayBuffer()));
  renameSync(archive + ".part", archive);
}
const actual = digest(archive);
if (actual !== MODEL_SHA256) throw new Error("Chinese model archive SHA256 mismatch");
const temporary = mkdtempSync(join(tmpdir(), "myyaya-cn-"));
try {
  const command = process.platform === "win32" ? "tar.exe" : "unzip";
  const args = process.platform === "win32" ? ["-xf", archive, "-C", temporary] : ["-q", archive, "-d", temporary];
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Cannot extract Chinese model; tar (Windows) or unzip (Linux) is required");
  const source = join(temporary, name);
  for (const required of ["am/final.mdl", "conf/model.conf", "graph/HCLr.fst", "graph/Gr.fst"]) {
    if (!existsSync(join(source, required))) throw new Error("Incomplete Chinese model archive");
  }
  mkdirSync(stage, { recursive: true });
  copyTree(source, stage);
  copyFileSync(join(root, "licenses", "APACHE-2.0.txt"), join(stage, "LICENSE"));
  const files = [];
  const verify = (directory, prefix = "") => {
    for (const name of readdirSync(directory)) {
      const path = prefix + name;
      if (statSync(join(directory, name)).isDirectory()) verify(join(directory, name), path + "/");
      else {
        const sha256 = digest(join(directory, name));
        if (digest(join(stage, path)) !== sha256) throw new Error("Chinese model copy verification failed: " + path);
        files.push({ path, bytes: statSync(join(directory, name)).size, sha256 });
      }
    }
  };
  verify(source);
  files.push({ path: "LICENSE", bytes: statSync(join(stage, "LICENSE")).size, sha256: digest(join(stage, "LICENSE")) });
  writeFileSync(join(stage, "myyaya-model-source.json"), JSON.stringify({ name, url, sha256: actual, license: "Apache-2.0", files }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Chinese Vosk model verified and staged (offline Android recognition)");

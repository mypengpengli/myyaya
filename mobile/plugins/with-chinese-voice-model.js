const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const expected = "3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba";

module.exports = function withChineseVoiceModel(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const name = "vosk-command-cn-0.22";
    const source = path.join(mod.modRequest.projectRoot, ".build-assets", "vosk", name);
    const manifest = path.join(source, "myyaya-model-source.json");
    if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, "utf8")).sha256 !== expected) {
      throw new Error("Run node scripts/prepare-chinese-voice-model.mjs before prebuild");
    }
    const files = JSON.parse(fs.readFileSync(manifest, "utf8")).files;
    for (const required of ["am/final.mdl", "conf/model.conf", "graph/HCLr.fst", "graph/Gr.fst", "LICENSE"]) {
      if (!Array.isArray(files) || !files.some((entry) => entry.path === required && entry.bytes > 0)) throw new Error("Incomplete Chinese model manifest: " + required);
    }
    const verify = (directory) => {
      for (const file of files) {
        if (typeof file.path !== "string" || file.path.includes("..") || path.isAbsolute(file.path)) throw new Error("Invalid model file path");
        const data = fs.readFileSync(path.join(directory, file.path));
        if (data.length !== file.bytes || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("Chinese model file missing or altered: " + file.path);
      }
    };
    verify(source);
    const target = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "assets", name);
    fs.mkdirSync(target, { recursive: true });
    for (const file of [...files, { path: "myyaya-model-source.json" }]) {
      const destination = path.join(target, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(source, file.path), destination);
    }
    verify(target);
    return mod;
  }]);
};

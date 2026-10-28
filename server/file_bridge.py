#!/usr/bin/env python3
"""Small, loopback-only Hermes result-file bridge. No remote shell or arbitrary file paths."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_FILE = 25 * 1024 * 1024
MAX_TOTAL = 60 * 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
TYPES = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".doc": "application/msword",
         ".ppt": "application/vnd.ms-powerpoint", ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
         ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4"}

def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError("Invalid identifier")
    return value

def publish(task_id, sources, source_root, store):
    task_id = identifier(task_id)
    if len(sources) > 10:
        raise ValueError("At most ten files per task")
    task_root = (Path(source_root) / task_id).resolve()
    # A task directory must not be a symlink pointing outside the configured source root.
    if not task_root.is_relative_to(Path(source_root).resolve()) or task_root == Path(source_root).resolve():
        raise ValueError("Task output is outside the source directory")
    store = Path(store); store.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination = store / task_id
    manifest_path = destination / "manifest.json"
    if manifest_path.exists():
        raise ValueError("This task already published a result; do not replace its receipt")
    staged = Path(tempfile.mkdtemp(prefix="staged-", dir=store))
    files, total = [], 0
    try:
        for name in sources:
            path = Path(name).resolve(strict=True)
            mime = TYPES.get(path.suffix.lower())
            if not path.is_relative_to(task_root) or not path.is_file() or not mime:
                raise ValueError("Only supported files in this task's output directory may be published")
            file_id = uuid.uuid4().hex
            target = staged / file_id
            count = 0; digest = hashlib.sha256()
            with path.open("rb") as source, target.open("xb") as output:
                os.chmod(target, 0o600)
                while block := source.read(65536):
                    count += len(block)
                    if count > MAX_FILE or total + count > MAX_TOTAL:
                        raise ValueError("Result exceeds file/total limit")
                    digest.update(block); output.write(block)
            if count == 0:
                raise ValueError("Empty file")
            total += count
            files.append({"id": file_id, "name": path.name[:180], "mimeType": mime, "bytes": count, "sha256": digest.hexdigest()})
        manifest = {"version": 1, "task_id": task_id, "files": files}
        (staged / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        os.chmod(staged / "manifest.json", 0o600)
        # Concurrent publishers cannot replace an existing non-empty result directory.
        staged.rename(destination)
        return manifest
    finally:
        if staged.exists(): shutil.rmtree(staged)

def make_handler(store, token):
    root = Path(store).resolve()
    class Handler(BaseHTTPRequestHandler):
        server_version = "myyaya-files/1"
        def log_message(self, *_args): pass
        def send_json(self, status, data):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "no-store")
            self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                return self.send_json(401, {"error": "unauthorized"})
            if self.path == "/myyaya/v1/capabilities":
                return self.send_json(200, {"protocol": "myyaya-files-v1", "max_file_bytes": MAX_FILE, "max_files": 10})
            match = re.fullmatch(r"/myyaya/v1/tasks/([A-Za-z0-9_-]{1,100})/files(?:/([A-Za-z0-9_-]{1,100}))?", self.path)
            if not match: return self.send_json(404, {"error": "not_found"})
            task_id, file_id = match.groups()
            directory = root / task_id
            try:
                data = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
                if not file_id: return self.send_json(200, data)
                receipt = next((item for item in data["files"] if item["id"] == file_id), None)
                if receipt is None: return self.send_json(404, {"error": "not_found"})
                with (directory / file_id).open("rb") as stream:
                    if os.fstat(stream.fileno()).st_size != receipt["bytes"]: return self.send_json(409, {"error": "file_changed"})
                    self.send_response(200); self.send_header("Content-Type", receipt["mimeType"])
                    self.send_header("Content-Length", str(receipt["bytes"])); self.send_header("X-Content-Sha256", receipt["sha256"])
                    self.send_header("Cache-Control", "no-store"); self.end_headers(); shutil.copyfileobj(stream, self.wfile)
            except (FileNotFoundError, ValueError, KeyError): self.send_json(404, {"error": "not_found"})
            except (BrokenPipeError, ConnectionResetError): pass
    return Handler

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", default=str(Path.home() / ".local/share/myyaya-files"))
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve"); serve.add_argument("--port", type=int, default=8651)
    export = commands.add_parser("publish"); export.add_argument("--task-id", required=True)
    export.add_argument("--source-root", default=str(Path.home() / "myyaya-output")); export.add_argument("files", nargs="*")
    args = parser.parse_args()
    if args.command == "publish":
        print(json.dumps(publish(args.task_id, args.files, args.source_root, args.store), ensure_ascii=False))
    else:
        token = os.environ.get("API_SERVER_KEY", "")
        if not token or len(token) < 16: parser.error("API_SERVER_KEY must be set in the service environment")
        ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.store, token)).serve_forever()

if __name__ == "__main__": main()

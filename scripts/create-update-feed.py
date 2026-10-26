"""Create a static HTTPS update manifest and checksum for a signed myyaya APK."""

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--version", required=True, help="Version from mobile/app.json, e.g. 2.1.151")
    parser.add_argument("--base-url", required=True, help="HTTPS directory where the APK will be hosted")
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/updates"))
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        parser.error("version must contain three numeric components")
    url = urlsplit(args.base_url)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.query or url.fragment:
        parser.error("base-url must be an HTTPS directory without credentials, query or fragment")
    if not args.apk.is_file() or args.apk.suffix.lower() != ".apk":
        parser.error("apk must be an existing signed .apk file")
    # This produces metadata only. The build and Android installer verify signing.
    with args.apk.open("rb") as apk_file:
        digest = hashlib.file_digest(apk_file, "sha256").hexdigest()
    name = f"myyaya-v{args.version}.apk"
    base = args.base_url.rstrip("/")
    manifest = {
        "tag_name": f"v{args.version}",
        "name": f"myyaya {args.version}",
        "draft": False,
        "prerelease": False,
        "assets": [{
            "name": name,
            "browser_download_url": f"{base}/{name}",
            "size": args.apk.stat().st_size,
            "digest": f"sha256:{digest}",
            "state": "uploaded",
        }],
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    destination = args.output_dir / name
    if args.apk.resolve() != destination.resolve():
        shutil.copyfile(args.apk, destination)
    (args.output_dir / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / f"{name}.sha256").write_text(f"{digest}  {name}\n", encoding="utf-8")
    print(f"Manifest: {args.output_dir / 'latest.json'}")
    print(f"Host the signed APK as: {base}/{name}")
    print("Upload the APK first, then publish latest.json.")


if __name__ == "__main__":
    main()

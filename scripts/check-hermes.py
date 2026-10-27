#!/usr/bin/env python3
"""Read-only Hermes probe; load the debug token from Windows Credential Manager."""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys
from urllib import error, parse, request


DEFAULT_ORIGIN = "https://hermes.jiazhuangai.com"


def normalize_origin(value: str) -> str:
    parsed = parse.urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Use an HTTPS service origin without a path or credentials")
    return f"https://{parsed.netloc.lower()}"


def credential_target(origin: str) -> str:
    return f"myyaya/hermes/{origin}"


def load_token(origin: str) -> str:
    if sys.platform != "win32":
        raise RuntimeError("This debug helper reads the current user's Windows Credential Manager")

    class Credential(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    advapi = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                               ctypes.POINTER(ctypes.POINTER(Credential))]
    advapi.CredReadW.restype = wintypes.BOOL
    advapi.CredFree.argtypes = [ctypes.c_void_p]
    advapi.CredFree.restype = None
    pointer = ctypes.POINTER(Credential)()
    if not advapi.CredReadW(credential_target(origin), 1, 0, ctypes.byref(pointer)):
        raise RuntimeError(f"Credential unavailable (Windows error {ctypes.get_last_error()})")
    try:
        raw = ctypes.string_at(pointer.contents.CredentialBlob, pointer.contents.CredentialBlobSize)
        token = raw.decode("utf-8")
        if not token or any(character.isspace() for character in token):
            raise RuntimeError("Stored credential has an invalid format")
        return token
    finally:
        advapi.CredFree(pointer)


class SameOriginRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        original = parse.urlsplit(req.full_url)
        destination = parse.urlsplit(newurl)
        if (original.scheme, original.netloc) != (destination.scheme, destination.netloc):
            raise RuntimeError("Refusing to forward the request to another origin")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def probe(origin: str, token: str, timeout: float) -> dict:
    opener = request.build_opener(SameOriginRedirect())

    def get(path: str, authenticated: bool = False) -> tuple[int, dict]:
        headers = {"Accept": "application/json", "User-Agent": "myyaya-debug/1.0"}
        if authenticated:
            headers["Authorization"] = f"Bearer {token}"
        req = request.Request(origin + path, headers=headers, method="GET")
        try:
            with opener.open(req, timeout=timeout) as response:
                body = response.read(1024 * 1024)
                try:
                    data = json.loads(body)
                except (ValueError, UnicodeDecodeError):
                    data = {}
                return response.status, data if isinstance(data, dict) else {}
        except error.HTTPError as exc:
            # Never log response bodies, request headers, or credentials.
            status = exc.code
            exc.close()
            return status, {}

    health, _ = get("/health")
    unauthenticated, _ = get("/v1/models")
    authenticated, models = get("/v1/models", True)
    capabilities_status, capabilities = get("/v1/capabilities", True)
    required = ("run_submission", "run_status", "run_events_sse", "run_stop")
    features = capabilities.get("features", {})
    if not isinstance(features, dict):
        features = {}
    model_items = models.get("data", [])
    alias_available = isinstance(model_items, list) and any(
        isinstance(item, dict) and item.get("id") == "hermes-agent" for item in model_items
    )
    supported = {name: features.get(name) is True for name in required}
    passed = (
        health == 200 and unauthenticated == 401 and authenticated == 200
        and capabilities_status == 200 and alias_available and all(supported.values())
    )
    return {
        "baseUrl": origin,
        "checks": {"health": health, "modelsWithoutToken": unauthenticated,
                   "modelsWithToken": authenticated, "capabilities": capabilities_status},
        "modelAliasAvailable": alias_available,
        "features": supported,
        "passed": passed,
        "taskSubmitted": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_ORIGIN)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--run-smoke", action="store_true", help="Submit one read-only pwd run through the APK's real TypeScript client")
    args = parser.parse_args()
    try:
        if not 0 < args.timeout <= 30:
            raise ValueError("Timeout must be between 0 and 30 seconds")
        origin = normalize_origin(args.base_url)
        token = load_token(origin)
        if args.run_smoke:
            mobile = Path(__file__).resolve().parent.parent / "mobile"
            completed = subprocess.run(["node", "scripts/hermes-runs-live.mjs"], cwd=mobile,
                input=json.dumps({"baseUrl": origin, "token": token}), text=True, capture_output=True, timeout=170)
            # The child reports allowlisted metadata only. Never forward exception text/stderr.
            result = json.loads(completed.stdout)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if completed.returncode == 0 and result.get("passed") is True else 1
        result = probe(origin, token, args.timeout)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["passed"] else 1
    except Exception as exc:
        # Output the error type only; upstream exceptions may contain sensitive data.
        print(json.dumps({"passed": False, "errorType": type(exc).__name__}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

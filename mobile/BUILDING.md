# Building My LOOI

## myyaya Hermes integration APK on Windows

The first implementation scope and device checks are in [APK iteration 1](../docs/APK-ITERATION-1.md).
Use JDK 17, Android platform/build-tools 36, NDK `27.1.12297006`, CMake `3.22.1`, Node 22+ and pnpm 10.34.5.
Install the SDK from [Google's official tools](https://developer.android.com/studio) and JDK from [Microsoft OpenJDK](https://learn.microsoft.com/java/openjdk/download).

Set `JAVA_HOME`, `ANDROID_HOME` and the four `MY_LOOI_RELEASE_*` signing variables described below in the build process environment. They are read by Gradle only; no API Token is needed to build. Do not put credentials in `app.config.js` or `EXPO_PUBLIC_*` variables.

Run `powershell -File scripts/build-hermes-apk.ps1` from the mobile directory. The helper copies Git-visible source into a fresh short ASCII-only build path, installs with `--node-linker=hoisted`, pins the Expo SDK 56 template (`56.0.38`), validates code, and builds a signed ARM64 release APK at `output/android/myyaya-hermes-arm64.apk` with its SHA256 file. A custom `-BuildDirectory` must be new and at most 48 characters long. Windows CMake/Ninja failed with pnpm's long isolated peer paths in the initial build. Build/cache paths must also use ASCII; direct prebuild in the original Chinese workspace failed before native compilation.

The `with-shared-android-toolchain` config plugin makes native libraries inherit build-tools 36 and makes Sherpa inherit the host NDK, avoiding extra AGP-default SDK/NDK installations. If React Native's AAR download redirects to `repo.reactnative.dev` and times out, an alternate download must match Maven Central's published SHA256 before entering the local Gradle cache. The current `react-android-0.85.3-release.aar` checksum is `435467261a5ea8a8203eb07fb0c024cc928c17fa3fe06b2fec8b094d842af52f`.

The `hermes-integration` profile excludes unused RU/UK/EN Vosk assets and prevents legacy Realtime startup. It now bundles the Chinese Vosk model for local commands/dictation, alongside the expression UI, BLE controls and Hermes task panel. Before a manual prebuild, run `node scripts/prepare-chinese-voice-model.mjs`; the helper runs it automatically. The archive SHA256 is pinned; an existing archive can be supplied with `--archive <path>`. Linux needs unzip and Windows uses its built-in tar. The normal full build retains the other offline language models as well. Neither build embeds the user's Hermes Token: enter it once in settings after installation. System TTS needs an installed offline Chinese voice; Azure is not required for local commands.

## Toolchain

- Node.js 22
- pnpm 10 via Corepack
- JDK 17
- Android SDK 36
- Android build-tools 36.0.0

The upstream Android application ID is `io.github.razor79.mylooi`. This fork's `app.config.js` overrides the final ID to `io.github.mypengpengli.myyaya`; verify the resolved Expo configuration before building. Fork-specific scope and acceptance criteria are in [the APK development plan](../docs/APK-DEVELOPMENT-PLAN.md).

## Install and validate

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm exec tsc --noEmit
corepack pnpm test
corepack pnpm run motion:safety-test
corepack pnpm run ble:lifecycle-test
corepack pnpm run vosk:emergency-stop-test
corepack pnpm run motion:cliff-test
corepack pnpm run realtime:pcm-types-test
```

## Permanent Android release signing

Public/update-compatible My LOOI APKs must use one permanent private release key. The build intentionally refuses to produce a release artifact when the release-signing environment is missing, and it rejects an APK that is still signed with `CN=Android Debug`.

Create the key once on a trusted build machine:

```bash
bash scripts/create-release-keystore.sh
```

The default location is outside the repository:

```text
~/.config/my-looi/signing/my-looi-release.keystore
```

Back up this keystore and its passwords securely. **Never commit the keystore or passwords.** Losing or replacing the key prevents normal Android updates of installations signed with the original key.

For convenient local builds, save the signing configuration once outside the repository:

```bash
bash scripts/configure-release-signing.sh
```

The helper prompts for the keystore password without echoing it and writes:

```text
~/.config/my-looi/signing/release.env
```

with mode `0600`. The generated keystore normally uses the same password for the store and key, so pressing Enter at the separate key-password prompt reuses the store password. The build automatically loads this private file when the signing variables are not already exported. Explicit environment variables still work and are useful for CI or ephemeral build shells.

The values are injected into the generated Android project only after Expo prebuild. They are never source configuration and the private signing environment must never be committed.

To print the certificate fingerprints:

```bash
keytool -list -v \
  -keystore "$MY_LOOI_RELEASE_KEYSTORE" \
  -alias "$MY_LOOI_RELEASE_KEY_ALIAS"
```

Record both SHA-1 and SHA-256. These fingerprints identify the permanent release signing certificate and must remain stable for normal Android upgrades.

## Android release build

### Recommended archive helper

For repeated local builds, use `scripts/build-my-looi.sh` as the generic helper. Copy it once beside the versioned source archives (or invoke it from the source tree):

```bash
cp scripts/build-my-looi.sh ../build-my-looi.sh
cd ..
./build-my-looi.sh
```

Normal mode selects the newest source archive, verifies its checksum, carries forward safe generated state from the previous worktree, refreshes authoritative source from the archive, loads the private signing configuration, performs an incremental Expo prebuild, and reuses Gradle build outputs/cache where safe. Root `/android/` is generated state; nested `modules/*/android/` remains authoritative source and is always refreshed.

Use the clean control path when validating a release from regenerated native state:

```bash
./build-my-looi.sh --fresh
```

The helper keeps the worktree after success, copies the versioned APK and SHA-256 beside the source archives, and saves a full build log.

### Direct project build

`build-android-apk.sh` remains available directly. Direct invocation is conservative and uses clean Expo prebuild unless `MY_LOOI_INCREMENTAL_BUILD=1` is deliberately supplied:

```bash
bash scripts/build-android-apk.sh
```

Expected outputs include:

```text
output/android/my-looi-arm64.apk
output/android/my-looi-v<version>.apk
output/android/my-looi-v<version>.apk.sha256
```

The script verifies the final APK with Android `apksigner` and prints the signer DN, SHA-256, and SHA-1 fingerprints. A release is not considered Android-build verified until Gradle exits with code 0 and prints `BUILD SUCCESSFUL`.

## Generated native projects

Do not commit generated `/android` or `/ios` trees. Native configuration belongs in `app.json`, local native modules, or Expo config plugins.

## API key

The OpenAI API key is configured inside the running app and stored with Android SecureStore. `.env` is only for optional development overrides and must never contain a production API key.

### Incremental source deletion safety (v2.1.120)

Incremental builds preserve generated native caches only for modules that still
exist in the selected authoritative source archive. If a native module was
removed by a newer release, the helper removes that stale module directory
before the rsync refresh so excluded `android/build` or `.cxx` caches cannot
keep retired source visible in the next worktree.

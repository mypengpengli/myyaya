param(
  [string]$BuildDirectory = (Join-Path ([IO.Path]::GetPathRoot($PSScriptRoot)) ("myyaya-build\" + (Get-Date -Format 'yyyyMMdd-HHmmss')))
)
$ErrorActionPreference = 'Stop'
$sourceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath($BuildDirectory)
if ($buildRoot -match '[^\x00-\x7F]') { throw 'Use an ASCII-only absolute build path on Windows.' }
if ($buildRoot.Length -gt 48) { throw 'Use a build path of 48 characters or fewer for the Windows native toolchain.' }
if (Test-Path -LiteralPath $buildRoot) { throw 'Use a fresh build directory to avoid stale native source.' }
foreach ($name in @('JAVA_HOME','ANDROID_HOME','MY_LOOI_RELEASE_KEYSTORE','MY_LOOI_RELEASE_STORE_PASSWORD','MY_LOOI_RELEASE_KEY_ALIAS','MY_LOOI_RELEASE_KEY_PASSWORD')) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing build environment: $name" }
}
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'JAVA_HOME must contain JDK 17.' }
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'))) { throw 'Android SDK platform 36 is required.' }

# Only Git-visible source enters the fresh snapshot; local credentials/build output are excluded.
Push-Location $sourceDirectory
try {
  $files = @(& git ls-files --cached --others --exclude-standard -- .)
  if ($LASTEXITCODE -ne 0 -or $files.Count -eq 0) { throw 'Cannot enumerate source from Git.' }
  New-Item -ItemType Directory -Path $buildRoot | Out-Null
  foreach ($relativePath in $files) {
    $sourceFile = [IO.Path]::GetFullPath((Join-Path $sourceDirectory $relativePath))
    if (-not $sourceFile.StartsWith($sourceDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escapes the project.' }
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
    $destination = Join-Path $buildRoot $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $destination
  }
} finally { Pop-Location }

function Invoke-Checked([scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "Build command failed with exit code $LASTEXITCODE" }
}
$previousProfile = $env:MYYAYA_BUILD_PROFILE
$env:MYYAYA_BUILD_PROFILE = 'hermes-integration'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Push-Location $buildRoot
try {
  # Flat native module paths avoid CMake/Ninja limits with pnpm's isolated peer directories.
  Invoke-Checked { corepack.cmd pnpm install --frozen-lockfile --node-linker=hoisted }
  Invoke-Checked { corepack.cmd pnpm exec tsc --noEmit }
  Invoke-Checked { node scripts/companion-experience.test.mjs }
  Invoke-Checked { node scripts/hermes-connection-behavior.test.mjs }
  Invoke-Checked { node scripts/hermes-runs-behavior.test.mjs }
  Invoke-Checked { node scripts/chinese-voice-behavior.test.mjs }
  Invoke-Checked { node scripts/local-setup-behavior.test.mjs }
  Invoke-Checked { node scripts/public-repository-audit.mjs }
  Invoke-Checked { node scripts/prepare-chinese-voice-model.mjs }
  Invoke-Checked { corepack.cmd pnpm exec expo prebuild --platform android --no-install --template expo-template-bare-minimum@56.0.38 }
  Invoke-Checked { node scripts/apply-android-release-signing.mjs android/app/build.gradle }
  Push-Location android
  try { Invoke-Checked { .\gradlew.bat assembleRelease --no-daemon --max-workers=2 --console=plain } }
  finally { Pop-Location }
  $apk = Join-Path $buildRoot 'android\app\build\outputs\apk\release\app-release.apk'
  Invoke-Checked { & (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat') verify --print-certs $apk }
  $output = Join-Path $sourceDirectory 'output\android'
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  $destination = Join-Path $output 'myyaya-hermes-arm64.apk'
  Copy-Item -LiteralPath $apk -Destination $destination
  $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($destination + '.sha256', $hash + "  myyaya-hermes-arm64.apk`n")
  Write-Output "Signed APK: $destination"
  Write-Output "SHA256: $hash"
} finally {
  Pop-Location
  $env:MYYAYA_BUILD_PROFILE = $previousProfile
}

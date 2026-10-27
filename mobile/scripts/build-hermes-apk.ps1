param(
  [string]$BuildDirectory = (Join-Path ([IO.Path]::GetPathRoot($PSScriptRoot)) ("myyaya-build\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))),
  [switch]$Development,
  [string]$ChineseModelArchive,
  [string]$SherpaArchive
)
$ErrorActionPreference = 'Stop'
$sourceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath($BuildDirectory)
if ($buildRoot -match '[^\x00-\x7F]') { throw 'Use an ASCII-only absolute build path on Windows.' }
if ($buildRoot.Length -gt 48) { throw 'Use a build path of 48 characters or fewer for the Windows native toolchain.' }
if (Test-Path -LiteralPath $buildRoot) { throw 'Use a fresh build directory to avoid stale native source.' }
$requiredEnvironment = @('JAVA_HOME','ANDROID_HOME')
if (-not $Development) { $requiredEnvironment += @('MY_LOOI_RELEASE_KEYSTORE','MY_LOOI_RELEASE_STORE_PASSWORD','MY_LOOI_RELEASE_KEY_ALIAS','MY_LOOI_RELEASE_KEY_PASSWORD') }
foreach ($name in $requiredEnvironment) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing build environment: $name" }
}
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'JAVA_HOME must contain JDK 17.' }
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'))) { throw 'Android SDK platform 36 is required.' }
if ($ChineseModelArchive) { $ChineseModelArchive = (Resolve-Path -LiteralPath $ChineseModelArchive).Path }
if ($SherpaArchive) { $SherpaArchive = (Resolve-Path -LiteralPath $SherpaArchive).Path }

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

if ($Development) {
  # Change only this disposable source snapshot. A test build must coexist with
  # the production app and cannot replace its signing identity or user data.
  $configPath = Join-Path $buildRoot 'app.config.js'
  $configText = [IO.File]::ReadAllText($configPath)
  if (-not $configText.Contains("package: 'io.github.mypengpengli.myyaya'")) { throw 'Unexpected Android identity; review development snapshot mapping.' }
  $configText = $configText.Replace("name: 'myyaya'", "name: 'myyaya dev'").Replace("scheme: 'myyaya'", "scheme: 'myyaya-dev'").Replace("package: 'io.github.mypengpengli.myyaya'", "package: 'io.github.mypengpengli.myyaya.dev'")
  [IO.File]::WriteAllText($configPath, $configText)
}

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
  if ($SherpaArchive) {
    $archivePath = (Resolve-Path -LiteralPath $SherpaArchive).Path
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '338538dc1d7f49f23fc82e3c11df379f48e58d2ca212c9d8cba37f67f1684b01') { throw 'Sherpa 1.13.0 archive SHA256 mismatch.' }
    Invoke-Checked { corepack.cmd pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $nativeRoot = [IO.Path]::GetFullPath((Join-Path $buildRoot 'node_modules\@siteed\sherpa-onnx.rn'))
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      foreach ($entry in $archive.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $nativeRoot $entry.FullName))
        if (-not $target.StartsWith($nativeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes native package.' }
        if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
        else { New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true) }
      }
    } finally { $archive.Dispose() }
    Invoke-Checked { node -e "const c=require('./node_modules/@siteed/sherpa-onnx.rn/scripts/sherpa-prebuilt-contract');if(!c.validatePrebuiltTree('./node_modules/@siteed/sherpa-onnx.rn').ok)process.exit(1)" }
  } else { Invoke-Checked { corepack.cmd pnpm install --frozen-lockfile --node-linker=hoisted } }
  Invoke-Checked { corepack.cmd pnpm exec tsc --noEmit }
  Invoke-Checked { node scripts/companion-experience.test.mjs }
  Invoke-Checked { node scripts/pi-companion-behavior.test.mjs }
  Invoke-Checked { node scripts/companion-dialogue-behavior.test.mjs }
  Invoke-Checked { node scripts/companion-artifacts-behavior.test.mjs }
  Invoke-Checked { node scripts/media-jobs-behavior.test.mjs }
  Invoke-Checked { node scripts/agnes-protocol-behavior.test.mjs }
  Invoke-Checked { node scripts/hermes-connection-behavior.test.mjs }
  Invoke-Checked { node scripts/hermes-runs-behavior.test.mjs }
  Invoke-Checked { node scripts/chinese-voice-behavior.test.mjs }
  Invoke-Checked { node scripts/local-setup-behavior.test.mjs }
  Invoke-Checked { node scripts/public-repository-audit.mjs }
  if ($ChineseModelArchive) { Invoke-Checked { node scripts/prepare-chinese-voice-model.mjs --archive $ChineseModelArchive } }
  else { Invoke-Checked { node scripts/prepare-chinese-voice-model.mjs } }
  Invoke-Checked { corepack.cmd pnpm exec expo prebuild --platform android --no-install --template expo-template-bare-minimum@56.0.38 }
  if (-not $Development) { Invoke-Checked { node scripts/apply-android-release-signing.mjs android/app/build.gradle } }
  Push-Location android
  try { Invoke-Checked { .\gradlew.bat assembleRelease --no-daemon --max-workers=2 --console=plain } }
  finally { Pop-Location }
  $apk = Join-Path $buildRoot 'android\app\build\outputs\apk\release\app-release.apk'
  Invoke-Checked { & (Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat') verify --print-certs $apk }
  $output = Join-Path $sourceDirectory 'output\android'
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  $apkName = if ($Development) { 'myyaya-companion-dev-arm64.apk' } else { 'myyaya-hermes-arm64.apk' }
  $destination = Join-Path $output $apkName
  Copy-Item -LiteralPath $apk -Destination $destination
  $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($destination + '.sha256', $hash + '  ' + $apkName + "`n")
  Write-Output "Signed APK: $destination"
  Write-Output "SHA256: $hash"
} finally {
  Pop-Location
  $env:MYYAYA_BUILD_PROFILE = $previousProfile
}

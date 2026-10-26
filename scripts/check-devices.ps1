[CmdletBinding()]
param([switch]$AsJson)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$adbPath = Join-Path $projectRoot '.tools\platform-tools\adb.exe'

if (-not (Test-Path -LiteralPath $adbPath)) {
    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
    if ($adbCommand) { $adbPath = $adbCommand.Source }
}

$usbDevices = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Class -eq 'Ports' -or
        $_.FriendlyName -match 'Android|ADB|K50|Redmi|Xiaomi|MTP|ESP32|CH340|CH343|CP210' -or
        $_.InstanceId -match '^USB\\VID_(2717|303A|1A86|10C4)'
    } |
    Select-Object Status, Class, FriendlyName, InstanceId)

$androidDevices = @()
$adbAvailable = Test-Path -LiteralPath $adbPath
if ($adbAvailable) {
    $adbOutput = @(& $adbPath devices -l)
    if ($LASTEXITCODE -ne 0) { throw 'adb devices failed.' }
    foreach ($deviceLine in $adbOutput) {
        if ($deviceLine -notmatch '^(\S+)\s+(device|unauthorized|offline)(?:\s|$)') { continue }
        $deviceSerial = $Matches[1]
        $deviceState = $Matches[2]
        $deviceInfo = [ordered]@{ State = $deviceState }
        if ($deviceState -eq 'device') {
            $properties = [ordered]@{
                Manufacturer = 'ro.product.manufacturer'
                Model = 'ro.product.model'
                Device = 'ro.product.device'
                Android = 'ro.build.version.release'
                Sdk = 'ro.build.version.sdk'
                Abi = 'ro.product.cpu.abi'
            }
            foreach ($propertyName in $properties.Keys) {
                $propertyValue = & $adbPath -s $deviceSerial shell getprop $properties[$propertyName]
                if ($LASTEXITCODE -ne 0) { throw "Could not read Android property: $propertyName" }
                $deviceInfo[$propertyName] = ($propertyValue -join '').Trim()
            }
        }
        $androidDevices += [pscustomobject]$deviceInfo
    }
}

$report = [pscustomobject]@{
    CheckedAt = (Get-Date -Format o)
    AdbAvailable = $adbAvailable
    AndroidDevices = $androidDevices
    UsbDevices = $usbDevices
}

if ($AsJson) {
    $report | ConvertTo-Json -Depth 6
} else {
    Write-Output "ADB available: $adbAvailable"
    if ($androidDevices.Count -gt 0) {
        $androidDevices | Format-List | Out-String | Write-Output
    } else {
        Write-Output 'No Android device detected by ADB. Connect the phone and enable USB debugging.'
    }
    Write-Output 'Present serial ports and candidate USB devices:'
    $usbDevices | Format-Table -AutoSize | Out-String -Width 220 | Write-Output
    Write-Output 'unauthorized: unlock the phone and accept the USB debugging prompt.'
}

import { Linking, PermissionsAndroid, Platform, type Permission } from "react-native";
import { withExternalActivityLease } from "../core/background-process-exit";

export type DevicePermissions = { bluetooth: boolean; microphone: boolean; camera: boolean };

export function bluetoothPermissions(androidVersion = Number(Platform.Version)): Permission[] {
  return androidVersion >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
}

export async function readDevicePermissions(): Promise<DevicePermissions> {
  if (Platform.OS !== "android") return { bluetooth: false, microphone: false, camera: false };
  const [bluetooth, microphone, camera] = await Promise.all([
    Promise.all(bluetoothPermissions().map((permission) => PermissionsAndroid.check(permission))).then((values) => values.every(Boolean)),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
  ]);
  return { bluetooth, microphone, camera };
}

export async function requestBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const permissions = bluetoothPermissions();
  const pending: Permission[] = [];
  for (const permission of permissions) {
    if (!await PermissionsAndroid.check(permission)) pending.push(permission);
  }
  if (!pending.length) return;
  const result = await withExternalActivityLease("bluetooth-permission", () => PermissionsAndroid.requestMultiple(pending));
  if (pending.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error(Number(Platform.Version) >= 31
      ? "尚未允许附近设备权限，请在系统设置中允许发现和连接蓝牙设备。"
      : "此 Android 版本扫描蓝牙需要位置权限，请允许位置权限并打开系统定位开关。"
    );
  }
}

export async function requestDevicePermissions(): Promise<DevicePermissions> {
  if (Platform.OS !== "android") return readDevicePermissions();
  return withExternalActivityLease("companion-first-run-permissions", async () => {
    // Each OS dialog explains one capability. Denial leaves a visible recovery path.
    await requestBluetoothPermissions().catch(() => undefined);
    for (const permission of [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]) {
      if (!await PermissionsAndroid.check(permission)) await PermissionsAndroid.request(permission);
    }
    return readDevicePermissions();
  });
}

export function openDevicePermissionSettings(): Promise<void> {
  return withExternalActivityLease("companion-permission-settings", async () => { await Linking.openSettings(); });
}

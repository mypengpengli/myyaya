const SERVICE_UUID = "000000ff-0000-1000-8000-00805f9b34fb";

export type LooiAdvertisement = {
  name?: string | null; localName?: string | null; serviceUUIDs?: string[] | null;
};

export function isLooiAdvertisement(device: LooiAdvertisement, preferredName = "LOOI Robot"): boolean {
  // Android's cached name can be empty or stale while the scan response has localName.
  if ([device.name, device.localName].some((name) => name?.trim() &&
    (name.trim().toLowerCase() === preferredName.trim().toLowerCase() || /looi/i.test(name)))) return true;
  return Boolean(device.serviceUUIDs?.some((uuid) =>
    ["ff", "00ff", "000000ff", SERVICE_UUID].includes(uuid.toLowerCase())));
}

export function looiAdvertisementName(device: LooiAdvertisement): string {
  return [device.localName, device.name].find((name) => name?.trim() && /looi/i.test(name))?.trim()
    || device.localName?.trim() || device.name?.trim() || "LOOI";
}

const { withAndroidManifest } = require('expo/config-plugins');

// Match the runtime permission flow on fresh AND incremental prebuilds.
module.exports = (config) => withAndroidManifest(config, (mod) => {
  const manifest = mod.modResults.manifest;
  const declarations = {
    BLUETOOTH: { 'android:maxSdkVersion': '30' },
    BLUETOOTH_ADMIN: { 'android:maxSdkVersion': '30' },
    BLUETOOTH_SCAN: { 'android:usesPermissionFlags': 'neverForLocation' },
    BLUETOOTH_CONNECT: {},
    ACCESS_FINE_LOCATION: { 'android:maxSdkVersion': '30' },
    ACCESS_COARSE_LOCATION: { 'android:maxSdkVersion': '30' },
    RECORD_AUDIO: {},
    CAMERA: {},
  };
  let permissions = manifest['uses-permission'] || [];
  for (const [name, attributes] of Object.entries(declarations)) {
    const fullName = 'android.permission.' + name;
    permissions = permissions.filter((item) => item.$?.['android:name'] !== fullName);
    permissions.push({ $: { 'android:name': fullName, ...attributes } });
  }
  manifest['uses-permission'] = permissions;
  return mod;
});

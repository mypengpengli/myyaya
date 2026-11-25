const { withAndroidManifest,withFinalizedMod,XML } = require('expo/config-plugins');
const path=require('node:path');

// Match the runtime permission flow on fresh AND incremental prebuilds.
module.exports = (config) => withFinalizedMod(withAndroidManifest(config, (mod) => {
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
    POST_NOTIFICATIONS: {},
  };
  let permissions = manifest['uses-permission'] || [];
  for (const [name, attributes] of Object.entries(declarations)) {
    const fullName = 'android.permission.' + name;
    permissions = permissions.filter((item) => item.$?.['android:name'] !== fullName);
    permissions.push({ $: { 'android:name': fullName, ...attributes } });
  }
  manifest['uses-permission'] = permissions;
  const features=manifest['uses-feature'] || [];
  if(!features.some(item=>item.$?.['android:name']==='android.hardware.camera'))
    features.push({$: {'android:name':'android.hardware.camera','android:required':'false'}});
  manifest['uses-feature']=features;
  return mod;
}), ['android',async (mod)=>{
  // Run after Expo writes its splash theme. Keep API-33 framework attributes out of older resources.
  const root=path.join(mod.modRequest.platformProjectRoot,'app/src/main/res');
  const basePath=path.join(root,'values/styles.xml');
  const xml=await XML.readXMLAsync({path:basePath});
  const splash=xml.resources.style?.find(style=>style.$?.name==='Theme.App.SplashScreen');
  if(splash?.item?.some(item=>item.$?.name==='android:windowSplashScreenBehavior')){
    const versioned=JSON.parse(JSON.stringify(splash));
    splash.item=splash.item.filter(item=>item.$?.name!=='android:windowSplashScreenBehavior');
    await XML.writeXMLAsync({path:basePath,xml});
    await XML.writeXMLAsync({path:path.join(root,'values-v33/myyaya-splash.xml'),xml:{resources:{style:[versioned]}}});
  }
  return mod;
}]);

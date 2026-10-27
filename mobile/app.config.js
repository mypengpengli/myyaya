const base = require('./app.json').expo;

// The integration build bundles the Chinese model, omitting unused RU/UK/EN models.
// The standard build retains those community language models as well.
const integrationBuild = process.env.MYYAYA_BUILD_PROFILE === 'hermes-integration';
// Keep upstream app.json as a reference; Expo uses this fork's final identity.
module.exports = () => ({
  ...base,
  name: 'myyaya',
  slug: 'myyaya',
  scheme: 'myyaya',
  plugins: [...(integrationBuild ? base.plugins.filter((plugin) => plugin !== './plugins/with-vosk-command-models') : base.plugins), './plugins/with-shared-android-toolchain', './plugins/with-chinese-voice-model', './plugins/with-companion-permissions'],
  android: { ...base.android, package: 'io.github.mypengpengli.myyaya',
    permissions: [...(base.android.permissions || []), 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.ACCESS_COARSE_LOCATION'],
  },
  ios: { ...base.ios, bundleIdentifier: 'io.github.mypengpengli.myyaya' },
  extra: {
    ...base.extra,
    myyaya: {
      buildProfile: integrationBuild ? 'hermes-integration' : 'full',
      updateRepository: 'mypengpengli/myyaya',
      updateFeedUrl: process.env.MYYAYA_UPDATE_FEED_URL?.trim() || '',
    },
  },
});

const base = require('./app.json').expo;

// The first Hermes integration build does not use upstream RU/UK/EN offline voice models.
// Native voice modules remain present; the standard build still stages all models.
const integrationBuild = process.env.MYYAYA_BUILD_PROFILE === 'hermes-integration';
// Keep upstream app.json as a reference; Expo uses this fork's final identity.
module.exports = () => ({
  ...base,
  name: 'myyaya',
  slug: 'myyaya',
  scheme: 'myyaya',
  plugins: [...(integrationBuild ? base.plugins.filter((plugin) => plugin !== './plugins/with-vosk-command-models') : base.plugins), './plugins/with-shared-android-toolchain'],
  android: { ...base.android, package: 'io.github.mypengpengli.myyaya' },
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

const base = require('./app.json').expo;

// Keep upstream app.json as a reference; Expo uses this fork's final identity.
module.exports = () => ({
  ...base,
  name: 'myyaya',
  slug: 'myyaya',
  scheme: 'myyaya',
  android: { ...base.android, package: 'io.github.mypengpengli.myyaya' },
  ios: { ...base.ios, bundleIdentifier: 'io.github.mypengpengli.myyaya' },
  extra: {
    ...base.extra,
    myyaya: {
      updateRepository: 'mypengpengli/myyaya',
      updateFeedUrl: process.env.MYYAYA_UPDATE_FEED_URL?.trim() || '',
    },
  },
});

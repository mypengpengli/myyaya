const { withProjectBuildGradle } = require('expo/config-plugins');

const marker = '// MYYAYA_SHARED_ANDROID_TOOLCHAIN_V1';
const block = `
${marker}
// Libraries which omit buildToolsVersion use AGP's separate default (35).
// Sherpa also omits ndkVersion. Reuse the host app's installed toolchain.
subprojects { child ->
    child.plugins.withId('com.android.library') {
        child.android.buildToolsVersion = rootProject.ext.buildToolsVersion
        if (child.name == 'siteed_sherpa-onnx.rn') {
            child.android.ndkVersion = rootProject.ext.ndkVersion
        }
    }
}
`;

module.exports = function withSharedAndroidToolchain(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Expected a Groovy Android root build file');
    if (!mod.modResults.contents.includes(marker)) mod.modResults.contents += block;
    return mod;
  });
};

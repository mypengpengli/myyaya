# Third-party notices

My LOOI uses third-party open-source software and model assets. Their original licenses remain applicable.

## Upstream project

Portions of My LOOI originated from the MIT-licensed `GrinZero/super-looi` project. The historical MIT notice that accompanied the upstream source is preserved in `licenses/UPSTREAM_EXPO_MIT_NOTICE.txt`.

## Vosk command models

Android release builds download and bundle selected Vosk command models from the official Vosk model catalog. The selected models used by the build script are listed by Vosk as Apache License 2.0 models. A copy of Apache License 2.0 is included in `licenses/APACHE-2.0.txt`.

Source: https://alphacephei.com/vosk/models

The myyaya Chinese build also bundles `vosk-model-small-cn-0.22` (Apache-2.0), obtained from that catalog. The archive SHA256 is pinned in `scripts/prepare-chinese-voice-model.mjs`; model files are staged during builds and are not committed to Git. Chinese capture, dictation and commands run locally. The optional system TTS path requires an installed offline Chinese voice; it does not use an OpenAI voice.

## Silero VAD

The repository includes a Silero VAD ONNX model under `assets/models/sherpa-onnx/vad/`. Silero VAD is distributed under the MIT License; its notice is preserved in `licenses/SILERO-VAD-MIT.txt`.

Source: https://github.com/snakers4/silero-vad

## sherpa-onnx

The project uses sherpa-onnx-based runtime components. The sherpa-onnx source project is licensed under Apache License 2.0; a copy is included in `licenses/APACHE-2.0.txt`.

Source: https://github.com/k2-fsa/sherpa-onnx

Some optional speech/speaker model files are downloaded from upstream model releases rather than committed to this repository. Model weights can have license terms distinct from the inference runtime; verify the license of any additional model before redistributing it.

## OpenAI

OpenAI model weights are not distributed with My LOOI. Realtime models and voices are accessed through the OpenAI API using the user's own API key and are subject to OpenAI's applicable terms and pricing.

## JavaScript and Android dependencies

The optional Android room-vision probe uses `com.google.ar:core:1.48.0`. The SDK is provided under the [ARCore Additional Terms of Service](https://developers.google.com/ar/develop/terms), as identified by its Maven POM; it is not covered by this application's MIT license. ARCore functionality is provided by Google and its use is subject to the current [Google Terms of Service](https://policies.google.com/terms) and [Google Privacy Policy](https://policies.google.com/privacy). The probe displays this notice. Google Play Services for AR is installed separately and is not redistributed inside this APK. RTAB-Map, OpenBot and AprilTag are research candidates, not bundled navigation dependencies in this iteration.

The application also includes packages resolved through pnpm, Expo/React Native autolinking, and Gradle. Each dependency remains subject to its own license. A final public APK should receive a binary/license inventory audit before release.

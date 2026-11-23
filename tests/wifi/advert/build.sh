#!/usr/bin/env bash
set -euo pipefail
files=$(cd "$(dirname "$0")" && pwd)
stage="$RUNNER_TEMP/pm-advert"
mkdir -p "$stage/classes" "$stage/dex"
platform="$ANDROID_HOME/platforms/android-35/android.jar"
bt=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
javac --release 8 -classpath "$platform" -d "$stage/classes" "$files/Advert.java"
"$bt/d8" --min-api 28 --lib "$platform" --output "$stage/dex" "$stage"/classes/org/pocketmind/testadvert/*.class
"$bt/aapt2" link -o "$stage/raw.apk" --manifest "$files/AndroidManifest.xml" -I "$platform"
(cd "$stage/dex" && zip -q "$stage/raw.apk" classes.dex)
"$bt/zipalign" -f 4 "$stage/raw.apk" "$stage/aligned.apk"
keytool -genkeypair -noprompt -keystore "$stage/test.p12" -storepass android -alias fixture -keyalg RSA -dname CN=PocketMindTest
"$bt/apksigner" sign --ks "$stage/test.p12" --ks-pass pass:android --out "$RUNNER_TEMP/pm-advert.apk" "$stage/aligned.apk"

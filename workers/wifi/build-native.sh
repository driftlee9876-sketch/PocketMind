#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root/workers/wifi"
case "${1:?platform required}" in
 android)
  out="$root/android/app/build/wifi/jniLibs/arm64-v8a"
  mkdir -p "$out"
  CC="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android28-clang" \
   CGO_ENABLED=1 GOOS=android GOARCH=arm64 go build -trimpath -buildmode=c-shared -ldflags="-s -w -extldflags=-Wl,-z,max-page-size=16384" -o "$out/libpmwifi.so" ./cmd/native
  rm -f "$out/libpmwifi.h"
  ;;
 ios)
  out="$root/build/pocketmind-wifi-ios"
  for sdk in iphoneos iphonesimulator; do
    mkdir -p "$out/$sdk"
    target=arm64-apple-ios15.1
    if [[ "$sdk" == iphonesimulator ]]; then target+=-simulator; fi
    printf '#!/bin/sh\nexec xcrun --sdk %s clang -isysroot "%s" -target %s "$@"\n' "$sdk" "$(xcrun --sdk "$sdk" --show-sdk-path)" "$target" > "$out/$sdk/cc"
    chmod +x "$out/$sdk/cc"
    CC="$out/$sdk/cc" CGO_ENABLED=1 GOOS=ios GOARCH=arm64 go build -trimpath -buildmode=c-archive -o "$out/$sdk/libpmwifi.a" ./cmd/native
  done
  xcodebuild -create-xcframework -library "$out/iphoneos/libpmwifi.a" -library "$out/iphonesimulator/libpmwifi.a" -output "$root/ios/WiredGPU/PocketMindWifi.xcframework"
  ;;
 *) exit 2;;
esac

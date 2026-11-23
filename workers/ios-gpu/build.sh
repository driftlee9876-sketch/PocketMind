#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
vendor="$root/build/pocketmind-llama-ios"
stage="$root/build/pocketmind-apple"
python3 "$root/workers/ios-gpu/prepare.py" "$vendor"
for sdk in iphoneos iphonesimulator; do
  cmake -S "$root/workers/ios-gpu" -B "$stage/$sdk" -G Xcode \
    -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$sdk" -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=15.1 -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO \
    -DLLAMA_DIR="$vendor"
  cmake --build "$stage/$sdk" --config Release --target PocketMindMetalPeer --parallel 3
done
xcodebuild -create-xcframework \
  -framework "$stage/iphoneos/Release-iphoneos/PocketMindMetalPeer.framework" \
  -framework "$stage/iphonesimulator/Release-iphonesimulator/PocketMindMetalPeer.framework" \
  -output "$root/ios/WiredGPU/PocketMindMetalPeer.xcframework"
cp "$vendor/LICENSE" "$root/ios/WiredGPU/LLAMA-LICENSE.txt"

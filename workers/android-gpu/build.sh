#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
vendor="$root/build/pocketmind-llama"
stage="$root/build/pocketmind-gpu-arm64"
ndk="${ANDROID_NDK_HOME:?Android NDK required}"
cmake -S "$root/build/pocketmind-spirv" -B "$stage-spirv" -G Ninja -DCMAKE_INSTALL_PREFIX="$stage-headers"
cmake --install "$stage-spirv"
spirv_config=$(find "$stage-headers" -iname 'SPIRV-HeadersConfig.cmake' -print -quit)
test -n "$spirv_config"
python3 "$root/workers/android-gpu/prepare.py" "$vendor"
cmake -S "$vendor" -B "$stage" -G Ninja \
  "-DCMAKE_TOOLCHAIN_FILE=$ndk/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 -DANDROID_STL=c++_static \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_BACKEND_DL=OFF \
  -DGGML_OPENMP=OFF -DGGML_RPC=ON -DGGML_RPC_RDMA=OFF -DGGML_VULKAN=ON -DGGML_NATIVE=OFF \
  "-DVulkan_GLSLC_EXECUTABLE=$(command -v glslc)" \
  "-DVulkan_INCLUDE_DIR=$root/build/pocketmind-vulkan/include" \
  "-DSPIRV-Headers_DIR=$(dirname "$spirv_config")" "-DGGML_VULKAN_SPIRV_INCLUDE_DIR=$stage-headers/include" \
  -DLLAMA_BUILD_SERVER=ON -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TOOLS=ON -DLLAMA_CURL=OFF \
  -DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,max-page-size=16384
cmake --build "$stage" --target ggml-rpc-server llama-server --parallel 3
out="$root/android/app/build/wired/jniLibs/arm64-v8a"
mkdir -p "$out"
cp "$stage/bin/ggml-rpc-server" "$out/libpocketmind_usb_gpu.so"
cp "$stage/bin/llama-server" "$out/libpocketmind_tablet_host.so"
"$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip" "$out/libpocketmind_usb_gpu.so" "$out/libpocketmind_tablet_host.so"
mkdir -p "$root/android/app/build/wired/assets/licenses"
cp "$vendor/LICENSE" "$root/android/app/build/wired/assets/licenses/llama.cpp.txt"

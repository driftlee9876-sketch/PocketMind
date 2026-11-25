// Adapt the pinned native bindings to the project's React Native 0.88 and AGP 9 APIs.
const fs = require('node:fs');
const path = require('node:path');

function update(file, changes) {
  const dest = path.join(__dirname, '../node_modules', file);
  let source = fs.readFileSync(dest, 'utf8');
  for (const [before, after] of changes) {
    if (source.includes(after) && (!source.includes(before) || after.includes(before))) continue;
    if (!source.includes(before)) {
      throw Error('Unexpected binding version in ' + file);
    }
    source = source.replaceAll(before, after);
  }
  fs.writeFileSync(dest, source);
}

update('onnxruntime-react-native/android/build.gradle', [
  ['VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")', 'REACT_NATIVE_MINOR_VERSION < 71'],
  ['onnxruntime-android:latest.integration', 'onnxruntime-android:1.24.3'],
]);
update('onnxruntime-react-native/android/CMakeLists.txt', [
  ['CXX_STANDARD 17', 'CXX_STANDARD 20'],
]);
const invoker = ['.getCatalystInstance().getJSCallInvokerHolder()', '.getJSCallInvokerHolder()'];
update('onnxruntime-react-native/android/src/main/java/ai/onnxruntime/reactnative/OnnxruntimeModule.java', [invoker]);
update('whisper.rn/android/src/newarch/java/com/rnwhisper/RNWhisperModule.java', [invoker]);
update('whisper.rn/android/build.gradle', [
  ['prefab = true', 'buildConfig = true\n    prefab = true'],
  ['JavaVersion.VERSION_1_8', 'JavaVersion.VERSION_17'],
]);
// The bridge proxy supplies runtime and jsCallInvoker on the JS thread.
update('onnxruntime-react-native/ios/OnnxruntimeModule.mm', [
  ['@implementation OnnxruntimeModule', `@protocol PMOrtRuntimeAccess <NSObject>
@property (nonatomic, readonly) void *runtime;
@property (nonatomic, readonly) std::shared_ptr<facebook::react::CallInvoker> jsCallInvoker;
@end

@implementation OnnxruntimeModule`],
  ['RCTCxxBridge* cxxBridge = (RCTCxxBridge*)_bridge;', 'id<PMOrtRuntimeAccess> cxxBridge = (id<PMOrtRuntimeAccess>)_bridge;'],
  ['auto jsiInvoker = _bridge.jsCallInvoker;', 'auto jsiInvoker = cxxBridge.jsCallInvoker;'],
]);

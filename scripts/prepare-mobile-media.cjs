// The upstream 1.24.3 Android binding still uses Gradle 8 version helpers and C++17.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../node_modules/onnxruntime-react-native/android');
for(const [file,changes] of [
  ['build.gradle',[
    ['VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")','REACT_NATIVE_MINOR_VERSION < 71'],
    ['onnxruntime-android:latest.integration','onnxruntime-android:1.24.3'],
  ]],
  ['CMakeLists.txt',[['CMAKE_CXX_STANDARD 17','CMAKE_CXX_STANDARD 20'],['CXX_STANDARD 17','CXX_STANDARD 20']]],
]){
  const dest=path.join(root,file);let s=fs.readFileSync(dest,'utf8');
  for(const [before,after] of changes)s=s.replaceAll(before,after);
  fs.writeFileSync(dest,s);
}

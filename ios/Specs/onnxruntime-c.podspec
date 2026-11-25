# The upstream pod URL is unavailable. Microsoft's matching NuGet release contains
# the iOS XCFramework and its headers for both the device and simulator.
Pod::Spec.new do |s|
  s.name = 'onnxruntime-c'
  s.version = '1.24.3'
  s.authors = { 'Microsoft' => 'onnxruntime@microsoft.com' }
  s.summary = 'ONNX Runtime C/C++ for iOS'
  s.homepage = 'https://github.com/microsoft/onnxruntime'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.platform = :ios, '15.1'
  s.source = {
    :http => 'https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.24.3/microsoft.ml.onnxruntime.1.24.3.nupkg',
    :type => 'zip', :sha256 => 'e4ab3b236c1b803e1e7167fe9a75caa1b82a2fd4ae82abbd130937c07517bcdb'
  }
  s.prepare_command = <<-CMD
    set -eu
    unzip -qo runtimes/ios/native/onnxruntime.xcframework.zip
    mkdir -p Headers
    cp onnxruntime.xcframework/ios-arm64/onnxruntime.framework/Headers/*.h Headers/
  CMD
  s.static_framework = true
  s.vendored_frameworks = 'onnxruntime.xcframework'
  s.weak_frameworks = 'CoreML'
  s.source_files = 'Headers/*.h'
  s.preserve_paths = 'LICENSE'
  s.libraries = 'c++'
end

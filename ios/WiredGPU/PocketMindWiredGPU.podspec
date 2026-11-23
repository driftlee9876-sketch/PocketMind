Pod::Spec.new do |s|
  s.name = 'PocketMindWiredGPU'
  s.version = '1.0.0'
  s.summary = 'Foreground USB GPU participation for PocketMind'
  s.homepage = 'https://github.com/driftlee9876-sketch/PocketMind'
  s.source = { :git => s.homepage + '.git', :branch => 'feat/pocketmind-foundation' }
  s.author = 'PocketMind'
  s.license = { :type => 'MIT', :file => 'LLAMA-LICENSE.txt' }
  s.ios.deployment_target = '15.1'
  s.source_files = 'PocketMindGpu.mm'
  s.vendored_frameworks = 'PocketMindMetalPeer.xcframework'
  s.resources = 'LLAMA-LICENSE.txt'
  s.frameworks = 'UIKit', 'Security'
  s.dependency 'React-Core'
end

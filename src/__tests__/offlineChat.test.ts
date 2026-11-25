import {NativeModules, Platform} from 'react-native';
import {AI_MODEL_CATALOG} from '../aiModelsAndPlugins';
import {multiModelOrchestrator} from '../multiModelOrchestrator';

jest.mock('react-native-fs', () => ({DocumentDirectoryPath:'/installed', exists:jest.fn(async()=>true)}));
jest.mock('llama.rn', () => ({initLlama:jest.fn(async()=>({
  completion:jest.fn(async()=>({text:'기기에서 생성한 답변'})), release:jest.fn(),
}))}));

test('a downloaded model answers without an HTTP request when both radios are off', async () => {
  const moduleName = Platform.OS==='ios'?'PocketMindMetalPeer':'PocketMindWorker';
  const before=NativeModules[moduleName];
  NativeModules[moduleName]={hasNetworkRoute:async()=>false};
  const original=globalThis.fetch;
  globalThis.fetch=jest.fn(async()=>{throw Error('offline');});
  try {
    const result=await multiModelOrchestrator.executeAutonomousPipeline({
      userPrompt:'/web-wiki-ko 한국어', installedModelIds:[AI_MODEL_CATALOG[0].id],
      primaryModelId:'missing', autoMultiModelEnabled:false, enabledPluginIds:['web-wiki-ko'],
      remotePC:{enabled:false,serverUrl:'https://example.org',apiKey:''},
    });
    expect(result.steps[0].location).toBe('on-device');
    expect(result.finalText).toBe('기기에서 생성한 답변');
    expect(result.pluginOutputs).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    await multiModelOrchestrator.releaseAll();
    NativeModules[moduleName]=before;
    globalThis.fetch=original;
  }
});

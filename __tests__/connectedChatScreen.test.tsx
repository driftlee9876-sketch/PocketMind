import React from 'react';
import { NativeModules, Platform, Text, TextInput } from 'react-native';
import Renderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import * as actions from '../src/integrationActions';

jest.useFakeTimers();
test('sending a mail request renders the connected result in chat without a model', async () => {
  const originalOS = Platform.OS;
  const originalWorker = NativeModules.PocketMindWorker;
  Platform.OS = 'android';
  NativeModules.PocketMindWorker = {getSecret: jest.fn(async () => 'a'.repeat(32))};
  await AsyncStorage.setItem('pocketmind.coordinator-url.v1', 'https://coordinator.example');
  const connections = [{id:'google-gmail', mode:'oauth' as const, connected:true, configured:true, connectable:true}];
  jest.spyOn(actions,'getIntegrationCatalog').mockResolvedValue({integrations:connections, hubUnavailable:false});
  const submit = jest.spyOn(actions,'submitIntegrationAction').mockResolvedValue({
    actionId:'result', integrationId:'google-gmail', action:'search_messages', status:'completed', risk:'read',
    result:JSON.stringify([{id:'hidden-id',subject:'회의',from:'담당자',snippet:'회의가 내일 열려요.'}]),
  });
  let tree!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {tree = Renderer.create(<App/>);});
    const field = tree.root.findAllByType(TextInput).find(n => n.props.nativeID === 'pocketmind-composer')!;
    await act(async () => {field.props.onChangeText('최근 메일 보여줘');});
    const button = tree.root.findAll(n => n.props.accessibilityLabel === '메시지 보내기' && typeof n.props.onPress === 'function')[0];
    await act(async () => {await button.props.onPress();});
    expect(submit).toHaveBeenCalledWith('https://coordinator.example', 'a'.repeat(32), 'google-gmail','search_messages',{query:'in:inbox'});
    const labels = tree.root.findAllByType(Text).map(n => n.props.children);
    expect(labels).toContain('1. 회의');
    expect(labels).toContain('담당자\n회의가 내일 열려요.');
    const saved = JSON.parse((await AsyncStorage.getItem('pocketmind.chat-history.v1'))!);
    expect(saved.sessions[0].messages.at(-1)).toMatchObject({integrationResult:true, source:'Gmail'});
  } finally {
    await act(async () => {tree?.unmount(); jest.clearAllTimers();});
    jest.restoreAllMocks(); Platform.OS = originalOS; NativeModules.PocketMindWorker = originalWorker;
  }
});

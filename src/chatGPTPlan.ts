import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export interface ChatGPTPlanStatus {
  connected: boolean;
  pending: boolean;
  email: string;
  error: string;
}
export interface ChatGPTPlanModel { id: string; name: string }
export interface PlanMessage { role: 'user' | 'assistant'; content: string }
export interface PlanReply { text: string; issue?: string; code?: string }
let nextRequest = 0;

function client(): any {
  const module = NativeModules.PocketMindWorker;
  if (Platform.OS !== 'android' || typeof module?.getChatGPTStatus !== 'function') {
    throw new Error('이 APK에서는 ChatGPT 계정 연결을 지원하지 않습니다. 최신 APK를 설치해 주세요.');
  }
  return module;
}

export async function getChatGPTPlanStatus(): Promise<ChatGPTPlanStatus> {
  return JSON.parse(await client().getChatGPTStatus());
}
export async function beginChatGPTPlanLogin(): Promise<string> {
  return client().beginChatGPTLogin();
}
export async function disconnectChatGPTPlan(): Promise<void> {
  await client().disconnectChatGPT();
}
export async function getChatGPTPlanModels(): Promise<ChatGPTPlanModel[]> {
  const models = JSON.parse(await client().listChatGPTModels());
  return Array.isArray(models) ? models : [];
}
export async function chatWithChatGPTPlan(model: string, history: PlanMessage[], prompt: string, onText: (text: string) => void): Promise<PlanReply> {
  const requestId = `chat-${++nextRequest}`;
  const subscription = DeviceEventEmitter.addListener('PocketMindChatGPTText', event => {
    if (event?.requestId === requestId && typeof event.text === 'string') onText(event.text);
  });
  try {
    const raw = await client().runChatGPT(requestId, model, JSON.stringify([
      ...history.slice(-20).map(message => ({ role: message.role, content: message.content.slice(0, 20_000) })),
      { role: 'user', content: prompt },
    ]));
    return JSON.parse(raw);
  } finally {
    subscription.remove();
  }
}
export async function stopChatGPTPlan(): Promise<void> {
  await client().stopChatGPT();
}

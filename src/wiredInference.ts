import { NativeModules } from 'react-native';
import type { PlanMessage } from './chatGPTPlan';

let sequence = 0;
async function request(action: 'pair' | 'models' | 'chat', token: string, body: unknown, signal: AbortSignal) {
  if (signal.aborted) throw new Error('요청을 취소했어요.');
  const native = NativeModules.PocketMindWorker;
  const id = String(++sequence);
  const cancel = () => native.cancelWiredRequest(id);
  signal.addEventListener('abort', cancel);
  try { return JSON.parse(await native.wiredRequest(id, action, token, JSON.stringify(body))); }
  catch (error: any) {
    if (error?.code === 'WIRED_403' && action === 'pair') throw new Error('연결 코드가 틀렸거나 만료됐어요. PC에서 새 코드를 확인하세요.');
    if (error?.code === 'WIRED_401') throw new Error('PC에서 새 연결 코드를 발급받아 주세요.');
    throw error;
  } finally { signal.removeEventListener('abort', cancel); }
}
export interface WiredSession { token: string; model: string; device: string; tablet?: boolean; wifi?: boolean }

export async function pairWiredHost(code: string, signal: AbortSignal): Promise<WiredSession> {
  if (!/^\d{8}$/.test(code)) throw new Error('Windows에 표시된 8자리 코드를 입력해 주세요.');
  const session = await request('pair', '', { code }, signal);
  if (session.service !== 'pocketmind-wired' || !/^[A-Za-z0-9_-]{43}$/.test(session.token || '') ||
    typeof session.model !== 'string' || !session.model || typeof session.device !== 'string' || !session.device) {
    throw new Error('PocketMind 유선 실행기를 확인할 수 없어요.');
  }
  const models = await request('models', session.token, null, signal);
  if (!models.data?.some((item: {id?: string}) => item.id === 'pocketmind-wired')) {
    throw new Error('PC에서 준비된 모델을 확인할 수 없어요. 유선 실행기를 다시 연결해 주세요.');
  }
  return { token: session.token, model: session.model, device: session.device };
}

export async function runWiredInference(session: WiredSession, history: PlanMessage[], prompt: string, signal: AbortSignal): Promise<string> {
  const response = await request('chat', session.token, { model: 'pocketmind-wired', stream: false, messages: [
    { role: 'system', content: '사용자의 언어로 명확하게 답하세요. 외부 작업은 실제 실행 결과가 있을 때만 완료했다고 말하세요.' },
    ...history.slice(-20).map(item => ({ ...item, content: item.content.slice(0, 20000) })), { role: 'user', content: prompt },
  ] }, signal);
  const output = response.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('유선 모델에서 답변을 받지 못했어요.');
  return output.trim();
}

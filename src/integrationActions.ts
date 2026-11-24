import { CONNECTED_APP_CATALOG, IntegrationRisk } from './connectedAppsCatalog';

export interface IntegrationActionResult {
  actionId: string;
  integrationId: string;
  action: string;
  risk: IntegrationRisk;
  status: 'awaiting_approval' | 'queued' | 'completed' | 'failed' | 'rejected' | 'not_configured';
  result?: string | null;
  lastError?: string | null;
}

export interface IntegrationConnection {
  id: string;
  configured: boolean;
  connectable: boolean;
  connected: boolean;
  mode: 'oauth' | 'webhook';
  accountLabel?: string | null;
  statusError?: string | null;
  actions?: string[];
}

export function isIntegrationUsable(connection: Pick<IntegrationConnection, 'mode' | 'connected' | 'configured'>): boolean {
  return connection.mode === 'webhook' ? connection.configured === true : connection.connected === true;
}

export function chatIntegrationRequest(text: string) {
  const command = text.trim();
  const name = command.match(/^(?:\/connect\s+(.+)|(.+?)\s*(?:플러그인\s*)?연결(?:해\s?줘|하기)?)[.!]?$/i);
  const aliases: Record<string, string> = { 지메일: 'google-gmail', 유튜브: 'youtube', 노션: 'notion', 깃허브: 'github', 슬랙: 'slack', 드라이브: 'google-drive', 구글드라이브: 'google-drive', 구글캘린더: 'google-calendar' };
  if (command.startsWith('@')) {
    const invocation = command.slice(1).trim().toLowerCase();
    for (const app of CONNECTED_APP_CATALOG) {
      const names = [app.name.toLowerCase(), app.id, ...Object.keys(aliases).filter(alias => aliases[alias] === app.id)];
      const name = names.find(value => invocation === value || invocation.startsWith(value + ' '));
      if (!name) continue;
      const remaining = command.slice(1).trim().slice(name.length).trim();
      const selected = app.actions.find(action => [action.label, action.id].some(label => remaining === label || remaining.startsWith(label + ' ')));
      if (!selected) return {id: app.id, action: 'menu' as const};
      const label = remaining.startsWith(selected.label) ? selected.label : selected.id;
      return {id: app.id, action: 'form' as const, operation: selected.id, prompt: remaining.slice(label.length).trim()};
    }
  }
  const normalized = (name?.[1] || name?.[2] || '').toLowerCase().replace(/\s/g, '');
  if (normalized) {
    const app = CONNECTED_APP_CATALOG.find(item => item.id === (aliases[normalized] || normalized) || item.name.toLowerCase().replace(/\s/g, '') === normalized);
    return app ? { id: app.id, action: 'connect' as const } : null;
  }
  if (/메일.{0,15}(?:보내\s?줘|보내\s?주세요|발송해\s?줘)[.!]?\s*$/i.test(command) && /(?:지메일|gmail|[^\s@]+@[^\s@]+\.[a-z]{2,})/i.test(command)) {
    return { id: 'google-gmail', action: 'compose' as const };
  }
  // Route explicit read commands without passing private tool results to a model.
  const read = command.match(/^(?:(?:내|새|최근|안\s*읽은|읽지\s*않은)\s*)*(지메일|gmail|메일|이메일|(?:구글\s*)?드라이브|google\s*drive|(?:구글\s*)?캘린더|일정)(?:에서|의|을|를)?\s*(.*?)\s*(?:보여\s*줘|보여\s*주세요|불러\s*와\s*줘|불러\s*와|알려\s*줘|확인해\s*줘|찾아\s*줘|검색해\s*줘|목록)[.!?]?$/i);
  if (read && !/(?:삭제|전송|보내|수정|예약|생성|작성|취소|이동)/.test(read[2])) {
    const term = read[2].replace(/^(?:최근|새|받은|내)\s*/g, '').replace(/(?:메일|파일|목록|일정|리스트)(?:을|를)?\s*$/g, '').replace(/[을를]\s*$/, '').trim().replace(/^["'“]|["'”]$/g, '');
    if (/드라이브|drive/i.test(read[1])) return { id: 'google-drive', action: 'read' as const, operation: 'search_files', input: {query: term} };
    if (/일정|캘린더/.test(read[1])) {
      if (term) return null;
      return { id: 'google-calendar', action: 'read' as const, operation: 'list_events', input: {} };
    }
    const query = [/(?:안\s*읽은|읽지\s*않은)/.test(command) ? 'is:unread' : '', term].filter(Boolean).join(' ');
    return { id: 'google-gmail', action: 'read' as const, operation: 'search_messages', input: {query: query || 'in:inbox'} };
  }
  return null;
}

function baseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function call<T>(
  endpoint: string,
  apiToken: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  payload?: unknown,
): Promise<T> {
  const response = await fetch(endpoint + path, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error('Integration coordinator returned invalid JSON.'); }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error || 'Integration request failed'}`);
  return data as T;
}

export async function getConfiguredIntegrations(
  endpoint: string,
  apiToken: string,
): Promise<string[]> {
  return (await getIntegrationConnections(endpoint, apiToken)).filter(isIntegrationUsable).map(item => item.id);
}

export async function getIntegrationConnections(
  endpoint: string,
  apiToken: string,
): Promise<IntegrationConnection[]> {
  return (await getIntegrationCatalog(endpoint, apiToken)).integrations;
}

export async function getIntegrationCatalog(endpoint: string, apiToken: string) {
  const response = await call<{ integrations: IntegrationConnection[]; hubUnavailable?: boolean }>(
    baseUrl(endpoint), apiToken, '/v1/integrations',
  );
  return { integrations: Array.isArray(response.integrations) ? response.integrations : [], hubUnavailable: response.hubUnavailable === true };
}

export async function beginIntegrationConnection(
  endpoint: string,
  apiToken: string,
  integrationId: string,
): Promise<string> {
  const response = await call<{ authorizationUrl: string }>(
    baseUrl(endpoint), apiToken,
    `/v1/integrations/${encodeURIComponent(integrationId)}/connect`,
    'POST', {},
  );
  let secure = false;
  try {
    const url = new URL(response.authorizationUrl);
    secure = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {}
  if (!secure) {
    throw new Error('Connector returned an invalid authorization URL.');
  }
  return response.authorizationUrl;
}

export async function disconnectIntegration(
  endpoint: string,
  apiToken: string,
  integrationId: string,
): Promise<IntegrationConnection> {
  return call<IntegrationConnection>(
    baseUrl(endpoint), apiToken,
    `/v1/integrations/${encodeURIComponent(integrationId)}/disconnect`,
    'POST', {},
  );
}

export async function submitIntegrationAction(
  endpoint: string,
  apiToken: string,
  integrationId: string,
  actionId: string,
  input: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  const provider = CONNECTED_APP_CATALOG.find((item) => item.id === integrationId);
  const action = provider?.actions.find((item) => item.id === actionId);
  if (!provider || !action) throw new Error('Unknown app integration or action.');
  return call<IntegrationActionResult>(
    baseUrl(endpoint),
    apiToken,
    '/v1/integrations/actions',
    'POST',
    { integrationId, action: actionId, risk: action.risk, input },
  );
}

export async function approveIntegrationAction(
  endpoint: string,
  apiToken: string,
  actionId: string,
): Promise<IntegrationActionResult> {
  return call<IntegrationActionResult>(
    baseUrl(endpoint), apiToken,
    `/v1/integrations/actions/${encodeURIComponent(actionId)}/approve`,
    'POST', {},
  );
}

export async function rejectIntegrationAction(
  endpoint: string,
  apiToken: string,
  actionId: string,
): Promise<IntegrationActionResult> {
  return call<IntegrationActionResult>(
    baseUrl(endpoint), apiToken,
    `/v1/integrations/actions/${encodeURIComponent(actionId)}/reject`,
    'POST', {},
  );
}

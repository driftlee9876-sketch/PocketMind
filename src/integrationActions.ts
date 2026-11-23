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
  const aliases: Record<string, string> = { 지메일: 'google-gmail', 유튜브: 'youtube', 노션: 'notion', 깃허브: 'github', 슬랙: 'slack', 구글드라이브: 'google-drive', 구글캘린더: 'google-calendar' };
  const normalized = (name?.[1] || name?.[2] || '').toLowerCase().replace(/\s/g, '');
  if (normalized) {
    const app = CONNECTED_APP_CATALOG.find(item => item.id === (aliases[normalized] || normalized) || item.name.toLowerCase().replace(/\s/g, '') === normalized);
    return app ? { id: app.id, action: 'connect' as const } : null;
  }
  if (/메일.{0,15}(?:보내\s?줘|보내\s?주세요|발송해\s?줘)[.!]?\s*$/i.test(command) && /(?:지메일|gmail|[^\s@]+@[^\s@]+\.[a-z]{2,})/i.test(command)) {
    return { id: 'google-gmail', action: 'compose' as const };
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

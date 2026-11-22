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
  const response = await call<{ integrations: Array<{
    id: string;
    configured: boolean;
    connectable?: boolean;
    connected?: boolean;
  }> }>(
    baseUrl(endpoint), apiToken, '/v1/integrations',
  );
  return (response.integrations || [])
    .filter((item) => item.connectable ? item.connected === true : item.configured)
    .map((item) => item.id);
}

export async function getIntegrationConnections(
  endpoint: string,
  apiToken: string,
): Promise<IntegrationConnection[]> {
  const response = await call<{ integrations: IntegrationConnection[] }>(
    baseUrl(endpoint), apiToken, '/v1/integrations',
  );
  return Array.isArray(response.integrations) ? response.integrations : [];
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
  if (!response.authorizationUrl?.startsWith('https://')) {
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

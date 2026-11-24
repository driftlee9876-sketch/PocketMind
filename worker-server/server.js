#!/usr/bin/env node
'use strict';

/**
 * PocketMind Worker Coordinator
 *
 * Node.js 22+, single coordinator process. JSON state is persisted atomically.
 * Put this service behind HTTPS in production; never expose it directly over
 * plain HTTP to the public internet.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const {AsyncLocalStorage} = require('node:async_hooks');
const {stateStorage} = require('./state-storage');
const {readDriveContent} = require('./drive-content');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const API_TOKEN = process.env.POCKETMIND_API_TOKEN || '';
const ENROLLMENT_TOKEN = process.env.POCKETMIND_ENROLLMENT_TOKEN || '';
const WEBHOOK_SIGNING_SECRET = process.env.POCKETMIND_WEBHOOK_SIGNING_SECRET || '';
const DATA_FILE = path.resolve(process.env.POCKETMIND_DATA_FILE || './data/pocketmind-state.json');
const LEASE_MS = Math.max(15_000, Number(process.env.POCKETMIND_LEASE_MS || 90_000));
const HEARTBEAT_TIMEOUT_MS = Math.max(30_000, Number(process.env.POCKETMIND_HEARTBEAT_TIMEOUT_MS || 60_000));
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PENDING_TASKS = 500;
const MAX_ACTIVE_WORKERS = 1000;
const MAX_STORED_RECORDS = 10_000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_ORIGINS = new Set((process.env.POCKETMIND_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
const PUBLIC_BASE_URL = (process.env.POCKETMIND_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const TOKEN_ENCRYPTION_SECRET = process.env.POCKETMIND_TOKEN_ENCRYPTION_KEY || '';
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const HUB_URL = process.env.POCKETMIND_INTEGRATION_HUB_URL || '';
const { parseHubCatalog } = require('./integration-hub');
const { directProviders } = require('./direct-providers');
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_INTEGRATIONS = {
  'google-gmail': {
    label: 'Gmail',
    scopes: ['gmail.readonly', 'gmail.compose', 'gmail.send'],
  },
  'google-calendar': {
    label: 'Google Calendar',
    scopes: ['calendar.readonly', 'calendar.events'],
  },
  'google-drive': {
    label: 'Google Drive',
    scopes: ['drive.readonly', 'drive.file'],
  },
  'google-docs': {
    label: 'Google Docs',
    scopes: ['documents.readonly', 'documents', 'drive.metadata.readonly', 'drive.file'],
  },
  'google-sheets': {
    label: 'Google Sheets',
    scopes: ['spreadsheets.readonly', 'spreadsheets', 'drive.file'],
  },
  'google-contacts': {
    label: 'Google Contacts',
    scopes: ['contacts.readonly', 'contacts'],
  },
  'google-tasks': {
    label: 'Google Tasks',
    scopes: ['tasks.readonly', 'tasks'],
  },
  youtube: { label: 'YouTube', scopes: ['youtube.force-ssl'], actions: ['search_videos', 'create_playlist'] },
};
let CONNECTOR_WEBHOOKS = {};
let CONNECTOR_DEFINITIONS = {};

function isSecureConnectorUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

try {
  const configured = JSON.parse(process.env.POCKETMIND_INTEGRATION_WEBHOOKS_JSON || '{}');
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    CONNECTOR_WEBHOOKS = Object.fromEntries(
      Object.entries(configured).filter(([id, url]) =>
        /^[a-z0-9-]{2,80}$/.test(id) && typeof url === 'string' && url.startsWith('https://')
      )
    );
  }
} catch {
  console.error('POCKETMIND_INTEGRATION_WEBHOOKS_JSON is invalid JSON; no integrations will be configured.');
}

try {
  const configured = JSON.parse(process.env.POCKETMIND_INTEGRATION_CONNECTORS_JSON || '{}');
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    CONNECTOR_DEFINITIONS = Object.fromEntries(Object.entries(configured).flatMap(([id, value]) => {
      if (!/^[a-z0-9-]{2,80}$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) return [];
      const definition = {
        actionUrl: isSecureConnectorUrl(value.actionUrl) ? value.actionUrl : null,
        connectUrl: isSecureConnectorUrl(value.connectUrl) ? value.connectUrl : null,
        statusUrl: isSecureConnectorUrl(value.statusUrl) ? value.statusUrl : null,
        disconnectUrl: isSecureConnectorUrl(value.disconnectUrl) ? value.disconnectUrl : null,
      };
      if (!definition.actionUrl && !definition.connectUrl) return [];
      return [[id, definition]];
    }));
  }
} catch {
  console.error('POCKETMIND_INTEGRATION_CONNECTORS_JSON is invalid JSON; one-tap connectors are disabled.');
}

for (const [id, definition] of Object.entries(CONNECTOR_DEFINITIONS)) {
  if (definition.actionUrl) CONNECTOR_WEBHOOKS[id] = definition.actionUrl;
}

if (API_TOKEN.length < 24 || ENROLLMENT_TOKEN.length < 24) {
  console.error('Set POCKETMIND_API_TOKEN and POCKETMIND_ENROLLMENT_TOKEN (each at least 24 characters).');
  process.exit(1);
}

if (HUB_URL && !isSecureConnectorUrl(HUB_URL)) {
  console.error('POCKETMIND_INTEGRATION_HUB_URL must be an HTTPS endpoint.');
  process.exit(1);
}
if ((HUB_URL || Object.keys(CONNECTOR_WEBHOOKS).length > 0 || Object.keys(CONNECTOR_DEFINITIONS).length > 0) && WEBHOOK_SIGNING_SECRET.length < 32) {
  console.error('Configured integration webhooks require POCKETMIND_WEBHOOK_SIGNING_SECRET (at least 32 characters).');
  process.exit(1);
}

function validPublicBaseUrl() {
  try {
    const parsed = new URL(PUBLIC_BASE_URL);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

const BUILTIN_GOOGLE_ENABLED = Boolean(
  GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET &&
  TOKEN_ENCRYPTION_SECRET.length >= 32 && validPublicBaseUrl()
);
if ((GOOGLE_OAUTH_CLIENT_ID || GOOGLE_OAUTH_CLIENT_SECRET) && !BUILTIN_GOOGLE_ENABLED) {
  console.error('Built-in Google OAuth requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, POCKETMIND_TOKEN_ENCRYPTION_KEY (32+ chars), and an HTTPS POCKETMIND_PUBLIC_BASE_URL.');
}

const state = { workers: {}, tasks: {}, actions: {}, oauthConnections: {}, oauthStates: {} };
const storage = stateStorage(DATA_FILE, process.env.DATABASE_URL);
const ownerContext = new AsyncLocalStorage();
const owner = () => ownerContext.getStore() || 'legacy';
const keyOwners = new Map();
const keyDigest = token => crypto.createHash('sha256').update(token).digest('hex');
const userTokens = Object.entries(JSON.parse(process.env.POCKETMIND_USER_TOKENS_JSON || '{}'));
for (const [id, token] of userTokens) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ['legacy','constructor','__proto__','prototype'].includes(id) ||
      typeof token !== 'string' || token.length < 32 || token === API_TOKEN || token === ENROLLMENT_TOKEN ||
      userTokens.filter(entry => entry[1] === token).length !== 1) throw Error('Invalid personal coordinator credential');
}
state.accounts = {};
function personal() {
  if (owner() === 'legacy') return state;
  return state.accounts[owner()] ??= {oauthConnections:{}, oauthStates:{}, actions:{}};
}
function requestOwner(req) {
  const token = bearer(req);
  if (token) return keyOwners.get(keyDigest(token)) || 'legacy';
  const url = new URL(req.url, 'http://localhost');
  if (/^\/v1\/oauth\/(google|github|microsoft)\/callback$/.test(url.pathname)) {
    const nonce = url.searchParams.get('state');
    if (nonce && /^[A-Za-z0-9_-]{43}$/.test(nonce)) {
      return Object.entries(state.accounts).find(([, account]) => Object.hasOwn(account.oauthStates,nonce))?.[0] || 'legacy';
    }
  }
  return 'legacy';
}
const direct = directProviders({
  env: process.env, baseUrl: validPublicBaseUrl() && TOKEN_ENCRYPTION_SECRET.length >= 32 ? PUBLIC_BASE_URL : null,
  connections: () => personal().oauthConnections, pending: () => personal().oauthStates, persist,
  encrypt: encryptSecret, decrypt: decryptSecret, ttl: OAUTH_STATE_TTL_MS,
});
// Prefer explicitly configured adapters over newly available built-in providers.
function builtinDirect(id) {
  return !CONNECTOR_WEBHOOKS[id] && !CONNECTOR_DEFINITIONS[id] && direct.supports(id);
}
let saveChain = Promise.resolve();
const requestCounts = new Map();

function json(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function tokenMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function authenticateApi(req) {
  const token = bearer(req);
  return tokenMatches(token, API_TOKEN) || (owner() !== 'legacy' && keyOwners.get(keyDigest(token)) === owner());
}

function authenticateEnrollment(req) {
  return tokenMatches(String(req.headers['x-enrollment-token'] || ''), ENROLLMENT_TOKEN);
}

function findWorkerByToken(token) {
  if (!token) return null;
  for (const worker of Object.values(state.workers)) {
    if (worker.tokenHash && tokenMatches(crypto.createHash('sha256').update(token).digest('hex'), worker.tokenHash)) {
      return worker;
    }
  }
  return null;
}

const INTEGRATION_ACTION_RISKS = {
  'google-gmail': { search_messages: 'read', get_message: 'read', create_draft: 'write', send_message: 'sensitive' },
  'google-calendar': { list_events: 'read', create_event: 'write', update_event: 'sensitive' },
  'google-drive': { search_files: 'read', get_file: 'read', read_content: 'read', upload_file: 'write', delete_file: 'sensitive' },
  'microsoft-outlook': { search_messages: 'read', create_draft: 'write', send_message: 'sensitive' },
  'microsoft-calendar': { list_events: 'read', create_event: 'write', cancel_event: 'sensitive' },
  dropbox: { list_files: 'read', download_file: 'read', upload_file: 'write', delete_file: 'sensitive' },
  notion: { search_pages: 'read', get_page: 'read', create_page: 'write', archive_page: 'sensitive' },
  slack: { search_messages: 'read', list_channels: 'read', send_message: 'sensitive' },
  github: { list_repositories: 'read', search_issues: 'read', create_issue: 'write', merge_pull_request: 'sensitive' },
  discord: { list_channels: 'read', send_message: 'sensitive' },
  telegram: { get_updates: 'read', send_message: 'sensitive' },
  naver: { search_web: 'read', search_local: 'read' },
  kakao: { search_places: 'read', send_message: 'sensitive' },
  todoist: { list_tasks: 'read', create_task: 'write', complete_task: 'sensitive' },
  trello: { list_boards: 'read', list_cards: 'read', create_card: 'write' },
  linear: { search_issues: 'read', create_issue: 'write' },
  jira: { search_issues: 'read', create_issue: 'write' },
  'google-docs': { search_documents: 'read', get_document: 'read', create_document: 'write', share_document: 'sensitive' },
  'google-sheets': { get_values: 'read', update_values: 'write', share_spreadsheet: 'sensitive' },
  'microsoft-onedrive': { list_files: 'read', download_file: 'read', upload_file: 'write', delete_file: 'sensitive' },
  'microsoft-teams': { search_messages: 'read', create_meeting: 'write', send_message: 'sensitive' },
  airtable: { list_records: 'read', create_record: 'write', update_record: 'sensitive' },
  asana: { list_tasks: 'read', create_task: 'write', update_task: 'sensitive' },
  zoom: { list_meetings: 'read', create_meeting: 'write', delete_meeting: 'sensitive' },
  youtube: { search_videos: 'read', create_playlist: 'write', upload_video: 'sensitive' },
  spotify: { search_tracks: 'read', create_playlist: 'write', add_to_playlist: 'sensitive' },
  wordpress: { list_posts: 'read', create_draft: 'write', publish_post: 'sensitive' },
  'google-contacts': { search_contacts: 'read', create_contact: 'write', update_contact: 'sensitive' },
  'google-tasks': { list_tasks: 'read', create_task: 'write', complete_task: 'sensitive' },
  box: { search_files: 'read', upload_file: 'write', delete_file: 'sensitive' },
  gitlab: { list_projects: 'read', search_issues: 'read', create_issue: 'write', merge_request: 'sensitive' },
  bitbucket: { list_repositories: 'read', list_pull_requests: 'read', create_issue: 'write' },
  figma: { get_file: 'read', list_projects: 'read', create_comment: 'write' },
  clickup: { list_tasks: 'read', create_task: 'write', update_task: 'sensitive' },
  monday: { list_boards: 'read', list_items: 'read', create_item: 'write' },
  salesforce: { search_records: 'read', get_customer: 'read', create_lead: 'write', update_record: 'sensitive' },
  hubspot: { search_contacts: 'read', list_deals: 'read', create_contact: 'write', update_deal: 'sensitive' },
  zendesk: { search_tickets: 'read', create_ticket: 'write', update_ticket: 'sensitive' },
  freshdesk: { list_tickets: 'read', create_ticket: 'write', update_ticket: 'sensitive' },
  calendly: { list_events: 'read', list_event_types: 'read', cancel_event: 'sensitive' },
  reddit: { search_posts: 'read', save_post: 'write', create_comment: 'sensitive' },
  mastodon: { read_timeline: 'read', create_draft: 'write', publish_status: 'sensitive' },
  rss: { read_feed: 'read', summarize_feed: 'read' },
  shopify: { list_products: 'read', list_orders: 'read', create_draft_order: 'write', update_product: 'sensitive' },
  woocommerce: { list_products: 'read', list_orders: 'read', update_order: 'sensitive' },
  stripe: { list_payments: 'read', get_customer: 'read', create_refund: 'sensitive' },
  paypal: { list_transactions: 'read', create_refund: 'sensitive' },
  cloudflare: { list_zones: 'read', list_dns_records: 'read', create_dns_record: 'write', delete_dns_record: 'sensitive' },
  'aws-s3': { list_buckets: 'read', list_objects: 'read', upload_object: 'write', delete_object: 'sensitive' },
  supabase: { list_projects: 'read', query_rows: 'read', mutate_rows: 'sensitive' },
  twilio: { list_messages: 'read', send_sms: 'sensitive' },
  sendgrid: { get_stats: 'read', send_email: 'sensitive' },
  'custom-webhook': { run_readonly: 'read', run_action: 'write', run_sensitive_action: 'sensitive' },
};

function validateConditions(c) {
  return !!c && typeof c.charging === 'boolean' &&
    typeof c.unmeteredNetwork === 'boolean' &&
    typeof c.userOptedIn === 'boolean' &&
    Number.isFinite(c.batteryPercent) && c.batteryPercent >= 0 && c.batteryPercent <= 100 &&
    ['nominal', 'fair', 'serious', 'critical', 'unknown'].includes(c.thermalState);
}

function validateCapabilities(c) {
  return !!c &&
    ['windows', 'android', 'ios', 'linux', 'macos'].includes(c.platform) &&
    ['llama.cpp', 'ollama', 'onnxruntime', 'directml', 'cuda', 'metal', 'unknown'].includes(c.backend) &&
    Array.isArray(c.modelIds) && c.modelIds.length <= 200 &&
    c.modelIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120) &&
    typeof c.gpu === 'boolean' &&
    Number.isInteger(c.maxConcurrentTasks) && c.maxConcurrentTasks >= 1 && c.maxConcurrentTasks <= 8 &&
    (c.ramMb === undefined || (Number.isFinite(c.ramMb) && c.ramMb >= 0));
}

function validateAdvertisement(body) {
  return !!body &&
    typeof body.workerId === 'string' && /^[a-zA-Z0-9._:-]{3,100}$/.test(body.workerId) &&
    typeof body.displayName === 'string' && body.displayName.trim().length > 0 &&
    body.displayName.length <= 80 &&
    validateCapabilities(body.capabilities) &&
    validateConditions(body.conditions);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

function persist() {
  const snapshot = JSON.stringify(state);
  saveChain = saveChain.catch(() => {}).then(() => storage.save(snapshot));
  return saveChain;
}

async function load() {
  try {
    const raw = await storage.load();
    if (raw && typeof raw === 'object') {
      state.accounts = raw.accounts || {};
      state.workers = raw.workers || {};
      state.tasks = raw.tasks || {};
      state.actions = raw.actions || {};
      state.oauthConnections = raw.oauthConnections || {};
      state.oauthStates = raw.oauthStates || {};
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function encryptionKey() {
  return crypto.createHash('sha256').update(TOKEN_ENCRYPTION_SECRET).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error('Stored OAuth token is invalid.');
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error('Stored OAuth token is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function googleRedirectUri() {
  return `${PUBLIC_BASE_URL}/v1/oauth/google/callback`;
}

function googleAuthorizationUrl(integrationId) {
  const integration = GOOGLE_INTEGRATIONS[integrationId];
  if (!integration) throw Object.assign(new Error('Built-in Google integration is not supported.'), { status: 404 });
  const nonce = crypto.randomBytes(32).toString('base64url');
  personal().oauthStates[nonce] = { integrationId, expiresAt: Date.now() + OAUTH_STATE_TTL_MS };
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: ['openid', 'email', ...integration.scopes.map(scope => `https://www.googleapis.com/auth/${scope}`)].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    // A previous YouTube grant cannot be combined with Drive's drive.file scope.
    include_granted_scopes: 'false',
    state: nonce,
  }).toString();
  return url.toString();
}

async function googleTokenRequest(parameters) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string') {
    throw Object.assign(new Error(typeof data.error_description === 'string' ? data.error_description : 'Google token exchange failed.'), { status: 502 });
  }
  return data;
}

async function googleAccessToken(integrationId) {
  const connection = personal().oauthConnections[integrationId];
  const label = GOOGLE_INTEGRATIONS[integrationId]?.label || 'Google account';
  if (!connection?.refreshToken) throw Object.assign(new Error(`${label} is not connected.`), { status: 409 });
  if (connection.accessToken && Number(connection.accessTokenExpiresAt || 0) > Date.now() + 60_000) {
    return decryptSecret(connection.accessToken);
  }
  const data = await googleTokenRequest({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: decryptSecret(connection.refreshToken),
    grant_type: 'refresh_token',
  });
  connection.accessToken = encryptSecret(data.access_token);
  connection.accessTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000;
  connection.updatedAt = Date.now();
  await persist();
  return data.access_token;
}

async function googleApi(integrationId, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${await googleAccessToken(integrationId)}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Google API returned HTTP ${response.status}.`;
    throw Object.assign(new Error(message), { status: response.status === 401 ? 409 : 502 });
  }
  return data;
}

function gmailApi(pathname, options = {}) {
  return googleApi('google-gmail', `https://gmail.googleapis.com/gmail/v1/users/me${pathname}`, options);
}

function html(res, status, title, message, redirectUrl) {
  const escaped = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const body = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaped(title)}</title><body style="font-family:sans-serif;background:#111;color:#fff;padding:32px"><h1>${escaped(title)}</h1><p>${escaped(message)}</p>${redirectUrl ? `<p><a style="color:#67d5bd" href="${escaped(redirectUrl)}">PocketMind로 돌아가기</a></p><script>location.href=${JSON.stringify(redirectUrl)}</script>` : ''}</body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

async function handleGoogleCallback(url, res) {
  const nonce = url.searchParams.get('state') || '';
  const pending = personal().oauthStates[nonce];
  delete personal().oauthStates[nonce];
  await persist();
  const integration = pending && GOOGLE_INTEGRATIONS[pending.integrationId];
  if (!pending || !integration || pending.expiresAt < Date.now()) {
    return html(res, 400, 'Google 연결 실패', '로그인 요청이 만료되었거나 유효하지 않습니다. PocketMind에서 다시 연결해 주세요.');
  }
  if (url.searchParams.get('error')) return html(res, 400, `${integration.label} 연결 취소`, 'Google 로그인이 완료되지 않았습니다.');
  const code = url.searchParams.get('code');
  if (!code) return html(res, 400, `${integration.label} 연결 실패`, 'Google 인증 코드가 없습니다.');
  const token = await googleTokenRequest({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
  });
  if (typeof token.refresh_token !== 'string') {
    return html(res, 409, `${integration.label} 연결 실패`, 'Google이 새로고침 토큰을 보내지 않았습니다. 계정 접근 권한을 해제한 뒤 다시 연결해 주세요.');
  }
  personal().oauthConnections[pending.integrationId] = {
    generation: crypto.randomUUID(),
    refreshToken: encryptSecret(token.refresh_token),
    accessToken: encryptSecret(token.access_token),
    accessTokenExpiresAt: Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000,
    accountLabel: null,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    const profile = await googleApi(pending.integrationId, 'https://openidconnect.googleapis.com/v1/userinfo');
    personal().oauthConnections[pending.integrationId].accountLabel = typeof profile.email === 'string' ? profile.email.slice(0, 120) : null;
  } catch {}
  await persist();
  const returnUrl = `pocketmind://integrations/callback?integrationId=${encodeURIComponent(pending.integrationId)}&status=connected`;
  return html(res, 200, `${integration.label} 연결 완료`, `PocketMind에서 ${integration.label}을 사용할 수 있습니다.`, returnUrl);
}

function connectorHeaders(payload) {
  return {
    'Content-Type': 'application/json',
    'X-PocketMind-Event': payload.event,
    'X-PocketMind-Signature':
      'sha256=' + crypto.createHmac('sha256', WEBHOOK_SIGNING_SECRET).update(JSON.stringify(payload)).digest('hex'),
  };
}

async function callConnector(url, payload, timeoutMs = 15_000) {
  if (!isSecureConnectorUrl(url)) throw Object.assign(new Error('Connector endpoint is not configured.'), { status: 409 });
  const body = JSON.stringify(payload);
  const response = await fetch(url, {
    method: 'POST',
    headers: connectorHeaders(payload),
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('Connector returned invalid JSON.'), { status: 502 }); }
  if (!response.ok) {
    throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `Connector returned HTTP ${response.status}.`), { status: 502 });
  }
  return data;
}

function builtinGoogle(id) {
  return Boolean(BUILTIN_GOOGLE_ENABLED && Object.hasOwn(GOOGLE_INTEGRATIONS, id) &&
    (id !== 'youtube' || (!CONNECTOR_DEFINITIONS[id] && !CONNECTOR_WEBHOOKS[id])));
}

function canUseHub(id) {
  return owner() === 'legacy' && HUB_URL && Object.hasOwn(INTEGRATION_ACTION_RISKS, id) && !builtinGoogle(id) && !builtinDirect(id) &&
    !CONNECTOR_WEBHOOKS[id] && !CONNECTOR_DEFINITIONS[id];
}

async function hubCatalog() {
  if (!HUB_URL) return new Map();
  const result = await callConnector(HUB_URL, { event: 'pocketmind.integration.catalog', requestedAt: Date.now() }, 5000);
  return parseHubCatalog(result, INTEGRATION_ACTION_RISKS);
}

async function connectorStatus(id) {
  if (builtinDirect(id)) return direct.status(id);
  if (canUseHub(id)) {
    const status = (await hubCatalog()).get(id);
    if (status) return status;
  }
  if (builtinGoogle(id)) {
    const actions = GOOGLE_INTEGRATIONS[id].actions;
    const connection = personal().oauthConnections[id];
    if (!connection?.refreshToken) return { id, configured: true, connectable: true, connected: false, mode: 'oauth', actions };
    try {
      await googleAccessToken(id);
      return { id, configured: true, connectable: true, connected: true, mode: 'oauth', accountLabel: connection.accountLabel || null, actions };
    } catch (error) {
      return { id, configured: true, connectable: true, connected: false, mode: 'oauth', statusError: String(error.message || 'Could not verify Google connection.').slice(0, 300) };
    }
  }
  const definition = CONNECTOR_DEFINITIONS[id];
  if (!definition?.connectUrl) {
    return {
      id,
      configured: Boolean(CONNECTOR_WEBHOOKS[id]),
      connectable: false,
      connected: Boolean(CONNECTOR_WEBHOOKS[id]),
      mode: 'webhook',
    };
  }
  if (!definition.statusUrl || !definition.actionUrl) {
    return { id, configured: true, connectable: false, connected: false, mode: 'oauth', statusError: '연결 상태 또는 실행 어댑터 설정이 필요합니다.' };
  }
  try {
    const result = await callConnector(definition.statusUrl, {
      event: 'pocketmind.integration.status',
      integrationId: id,
      requestedAt: Date.now(),
    }, 8_000);
    return {
      id,
      configured: true,
      connectable: true,
      connected: result.connected === true,
      mode: 'oauth',
      accountLabel: typeof result.accountLabel === 'string' ? result.accountLabel.slice(0, 120) : null,
    };
  } catch (error) {
    return {
      id,
      configured: true,
      connectable: true,
      connected: false,
      mode: 'oauth',
      statusError: String(error.message || 'Could not check connector status.').slice(0, 300),
    };
  }
}

function promptValue(input) {
  return typeof input?.prompt === 'string' ? input.prompt.trim() : '';
}

function fieldFromPrompt(prompt, names) {
  for (const name of names) {
    const match = prompt.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]\\s*(.+)`, 'i'));
    if (match) return match[1].trim();
  }
  return '';
}

function gmailRawMessage(input) {
  const prompt = promptValue(input);
  const to = typeof input.to === 'string' ? input.to.trim() : fieldFromPrompt(prompt, ['수신자', '받는 사람', 'to']);
  const subject = typeof input.subject === 'string' ? input.subject.trim() : fieldFromPrompt(prompt, ['제목', 'subject']);
  const body = typeof input.body === 'string' ? input.body.trim() : fieldFromPrompt(prompt, ['본문', '내용', 'body']);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !body) {
    throw Object.assign(new Error('수신자·제목·본문이 필요합니다. 예: 수신자: user@example.com / 제목: 안녕하세요 / 본문: ...'), { status: 400 });
  }
  const message = [`To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
  return Buffer.from(message).toString('base64url');
}

async function dispatchBuiltinGmailAction(action) {
  const prompt = promptValue(action.input);
  if (action.action === 'search_messages') {
    const query = typeof action.input.query === 'string' ? action.input.query.trim() : (prompt || 'newer_than:7d');
    const list = await gmailApi(`/messages?maxResults=10&q=${encodeURIComponent(query)}`);
    const items = await Promise.all((list.messages || []).slice(0, 10).map(item => gmailApi(`/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
    return items.map(item => {
      const headers = Object.fromEntries((item.payload?.headers || []).map(header => [String(header.name).toLowerCase(), header.value]));
      return { id: item.id, threadId: item.threadId, from: headers.from || '', subject: headers.subject || '(제목 없음)', date: headers.date || '', snippet: item.snippet || '' };
    });
  }
  if (action.action === 'get_message') {
    const messageId = typeof action.input.messageId === 'string' ? action.input.messageId.trim() : fieldFromPrompt(prompt, ['메시지 ID', 'message id']);
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(messageId)) throw Object.assign(new Error('읽을 Gmail 메시지 ID가 필요합니다.'), { status: 400 });
    return gmailApi(`/messages/${encodeURIComponent(messageId)}?format=full`);
  }
  if (action.action === 'create_draft') return gmailApi('/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: gmailRawMessage(action.input) } }) });
  if (action.action === 'send_message') return gmailApi('/messages/send', { method: 'POST', body: JSON.stringify({ raw: gmailRawMessage(action.input) }) });
  throw Object.assign(new Error('Unsupported Gmail action.'), { status: 400 });
}

function inputField(input, prompt, key, labels = []) {
  const direct = input?.[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return fieldFromPrompt(prompt, labels);
}

function requiredField(input, prompt, key, labels, message) {
  const value = inputField(input, prompt, key, labels);
  if (!value) throw Object.assign(new Error(message), { status: 400 });
  return value;
}

function googleDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('날짜와 시간은 ISO 형식으로 입력해 주세요. 예: 2026-11-24T14:00:00+09:00'), { status: 400 });
  return parsed.toISOString();
}

function shareGoogleFile(action, idKey, idLabels) {
  const input = action.input || {};
  const prompt = promptValue(input);
  const fileId = requiredField(input, prompt, idKey, idLabels, '공유할 파일 ID가 필요합니다.');
  const emailAddress = requiredField(input, prompt, 'email', ['이메일', 'email'], '공유받을 이메일 주소가 필요합니다.');
  return googleApi(action.integrationId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=true`, { method: 'POST', body: JSON.stringify({ type: 'user', role: input.role === 'writer' ? 'writer' : 'reader', emailAddress }) });
}

async function dispatchBuiltinGoogleAction(action) {
  if (action.integrationId === 'google-gmail') return dispatchBuiltinGmailAction(action);
  const input = action.input || {};
  const prompt = promptValue(input);

  if (action.integrationId === 'youtube') {
    if (action.action === 'search_videos') {
      const query = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '10', q: input.query || prompt });
      return googleApi('youtube', 'https://www.googleapis.com/youtube/v3/search?' + query);
    }
    if (action.action === 'create_playlist') {
      const title = inputField(input, prompt, 'title', ['제목', 'title']) || prompt;
      if (!title.trim()) throw new Error('재생목록 제목을 입력하세요.');
      return googleApi('youtube', 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
        method: 'POST', body: JSON.stringify({ snippet: { title }, status: { privacyStatus: 'private' } }),
      });
    }
  }

  if (action.integrationId === 'google-calendar') {
    if (action.action === 'list_events') {
      const timeMin = inputField(input, prompt, 'timeMin', ['시작 시각', '시작 시간', 'timeMin']) || new Date().toISOString();
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      url.search = new URLSearchParams({ maxResults: '20', singleEvents: 'true', orderBy: 'startTime', timeMin: googleDateTime(timeMin) }).toString();
      return googleApi(action.integrationId, url.toString());
    }
    if (action.action === 'create_event') {
      const summary = requiredField(input, prompt, 'summary', ['제목', '일정 제목', 'summary'], '일정 제목이 필요합니다.');
      const start = googleDateTime(requiredField(input, prompt, 'start', ['시작', '시작 시간', 'start'], '일정 시작 시간이 필요합니다.'));
      const end = googleDateTime(requiredField(input, prompt, 'end', ['종료', '종료 시간', 'end'], '일정 종료 시간이 필요합니다.'));
      return googleApi(action.integrationId, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify({ summary, description: input.description || '', start: { dateTime: start }, end: { dateTime: end } }) });
    }
    if (action.action === 'update_event') {
      const eventId = requiredField(input, prompt, 'eventId', ['일정 ID', 'event id'], '수정할 일정 ID가 필요합니다.');
      const body = {};
      if (input.summary) body.summary = String(input.summary);
      if (input.description) body.description = String(input.description);
      if (input.start) body.start = { dateTime: googleDateTime(input.start) };
      if (input.end) body.end = { dateTime: googleDateTime(input.end) };
      if (!Object.keys(body).length) throw Object.assign(new Error('수정할 제목, 설명, 시작 또는 종료 시간이 필요합니다.'), { status: 400 });
      return googleApi(action.integrationId, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    }
  }

  if (action.integrationId === 'google-drive') {
    if (action.action === 'search_files') {
      const query = inputField(input, prompt, 'query', ['검색어', 'query']) || prompt;
      const q = query ? `name contains '${query.replaceAll("'", "\\'")}' and trashed = false` : 'trashed = false';
      return googleApi(action.integrationId, `https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&q=${encodeURIComponent(q)}`);
    }
    if (action.action === 'read_content') {
      const id = requiredField(input, prompt, 'fileId', ['파일 ID'], '파일을 선택하세요.');
      const meta = await googleApi(action.integrationId, 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,name,mimeType');
      return readDriveContent(meta, await googleAccessToken(action.integrationId));
    }
    if (action.action === 'get_file') {
      const fileId = requiredField(input, prompt, 'fileId', ['파일 ID', 'file id'], '읽을 파일 ID가 필요합니다.');
      return googleApi(action.integrationId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,webViewLink,size,description`);
    }
    if (action.action === 'upload_file') {
      const name = requiredField(input, prompt, 'name', ['파일 이름', 'name'], '파일 이름이 필요합니다.');
      const content = requiredField(input, prompt, 'content', ['내용', '본문', 'content'], '업로드할 텍스트 내용이 필요합니다.');
      const boundary = `pocketmind_${crypto.randomBytes(12).toString('hex')}`;
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'text/plain' })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
      return googleApi(action.integrationId, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    }
    if (action.action === 'delete_file') {
      const fileId = requiredField(input, prompt, 'fileId', ['파일 ID', 'file id'], '삭제할 파일 ID가 필요합니다.');
      return googleApi(action.integrationId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    }
  }

  if (action.integrationId === 'google-docs') {
    if (action.action === 'search_documents') {
      const query = inputField(input, prompt, 'query', ['검색어', 'query']) || prompt;
      const suffix = query ? ` and name contains '${query.replaceAll("'", "\\'")}'` : '';
      const q = `mimeType = 'application/vnd.google-apps.document' and trashed = false${suffix}`;
      return googleApi(action.integrationId, `https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,modifiedTime,webViewLink)&q=${encodeURIComponent(q)}`);
    }
    if (action.action === 'get_document') {
      const documentId = requiredField(input, prompt, 'documentId', ['문서 ID', 'document id'], '문서 ID가 필요합니다.');
      return googleApi(action.integrationId, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
    }
    if (action.action === 'create_document') {
      const title = requiredField(input, prompt, 'title', ['문서 제목', '제목', 'title'], '문서 제목이 필요합니다.');
      const created = await googleApi(action.integrationId, 'https://docs.googleapis.com/v1/documents', { method: 'POST', body: JSON.stringify({ title }) });
      const content = inputField(input, prompt, 'content', ['본문', '내용', 'content']);
      if (content) await googleApi(action.integrationId, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(created.documentId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }) });
      return created;
    }
    if (action.action === 'share_document') return shareGoogleFile(action, 'documentId', ['문서 ID', 'document id']);
  }

  if (action.integrationId === 'google-sheets') {
    const spreadsheetId = requiredField(input, prompt, 'spreadsheetId', ['스프레드시트 ID', '시트 ID', 'spreadsheet id'], '스프레드시트 ID가 필요합니다.');
    if (action.action === 'get_values') {
      const range = inputField(input, prompt, 'range', ['범위', 'range']) || 'A1:Z100';
      return googleApi(action.integrationId, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
    }
    if (action.action === 'update_values') {
      const range = requiredField(input, prompt, 'range', ['범위', 'range'], '수정할 셀 범위가 필요합니다.');
      const values = Array.isArray(input.values) ? input.values : null;
      if (!values) throw Object.assign(new Error('values는 2차원 배열이어야 합니다.'), { status: 400 });
      return googleApi(action.integrationId, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ range, majorDimension: 'ROWS', values }) });
    }
    if (action.action === 'share_spreadsheet') return shareGoogleFile(action, 'spreadsheetId', ['스프레드시트 ID', '시트 ID', 'spreadsheet id']);
  }

  if (action.integrationId === 'google-contacts') {
    if (action.action === 'search_contacts') {
      const query = inputField(input, prompt, 'query', ['검색어', 'query']) || prompt;
      const data = await googleApi(action.integrationId, 'https://people.googleapis.com/v1/people/me/connections?pageSize=100&personFields=names,emailAddresses,phoneNumbers');
      const needle = query.toLowerCase();
      return { connections: (data.connections || []).filter(person => !needle || JSON.stringify(person).toLowerCase().includes(needle)).slice(0, 20) };
    }
    if (action.action === 'create_contact') {
      const name = requiredField(input, prompt, 'name', ['이름', 'name'], '연락처 이름이 필요합니다.');
      const email = inputField(input, prompt, 'email', ['이메일', 'email']);
      const phone = inputField(input, prompt, 'phone', ['전화번호', 'phone']);
      return googleApi(action.integrationId, 'https://people.googleapis.com/v1/people:createContact', { method: 'POST', body: JSON.stringify({ names: [{ givenName: name }], ...(email ? { emailAddresses: [{ value: email }] } : {}), ...(phone ? { phoneNumbers: [{ value: phone }] } : {}) }) });
    }
    if (action.action === 'update_contact') {
      const resourceName = requiredField(input, prompt, 'resourceName', ['연락처 ID', 'resource name'], '연락처 resourceName이 필요합니다.');
      const etag = requiredField(input, prompt, 'etag', ['etag'], '연락처 etag가 필요합니다.');
      const name = requiredField(input, prompt, 'name', ['이름', 'name'], '새 연락처 이름이 필요합니다.');
      return googleApi(action.integrationId, `https://people.googleapis.com/v1/${resourceName}:updateContact?updatePersonFields=names`, { method: 'PATCH', body: JSON.stringify({ etag, names: [{ givenName: name }] }) });
    }
  }

  if (action.integrationId === 'google-tasks') {
    const taskListId = inputField(input, prompt, 'taskListId', ['작업 목록 ID', 'task list id']) || '@default';
    if (action.action === 'list_tasks') return googleApi(action.integrationId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks?maxResults=50&showCompleted=true`);
    if (action.action === 'create_task') {
      const title = requiredField(input, prompt, 'title', ['작업 제목', '제목', 'title'], '작업 제목이 필요합니다.');
      return googleApi(action.integrationId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`, { method: 'POST', body: JSON.stringify({ title, notes: input.notes || '' }) });
    }
    if (action.action === 'complete_task') {
      const taskId = requiredField(input, prompt, 'taskId', ['작업 ID', 'task id'], '완료할 작업 ID가 필요합니다.');
      return googleApi(action.integrationId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed', completed: new Date().toISOString() }) });
    }
  }
  throw Object.assign(new Error('지원하지 않는 Google 앱 동작입니다.'), { status: 400 });
}

async function dispatchIntegrationAction(action) {
  if (builtinGoogle(action.integrationId) || builtinDirect(action.integrationId)) {
    try {
      if (builtinGoogle(action.integrationId) && action.accountGeneration !== personal().oauthConnections[action.integrationId]?.generation)
        throw Error('연결한 계정이 바뀌었어요. 새 작업을 요청하세요.');
      const result = builtinDirect(action.integrationId) ? await direct.run(action) : await dispatchBuiltinGoogleAction(action);
      action.status = 'completed';
      action.result = action.action === 'read_content' ? JSON.stringify(result) : JSON.stringify(result).slice(0, 20_000);
      action.lastError = null;
      action.updatedAt = Date.now();
    } catch (error) {
      action.status = 'failed';
      action.lastError = String(error.message || 'Provider request failed').slice(0, 500);
      action.updatedAt = Date.now();
    }
    await persist();
    return;
  }
  const target = action.viaHub ? HUB_URL : CONNECTOR_WEBHOOKS[action.integrationId];
  if (!target) {
    action.status = 'not_configured';
    action.lastError = 'Integration webhook is not configured on the coordinator.';
    action.updatedAt = Date.now();
    await persist();
    return;
  }
  try {
    if (action.viaHub) {
      const available = (await hubCatalog()).get(action.integrationId);
      if (!available?.connected || !available.actions.includes(action.action)) throw new Error('앱 연결 또는 작업 권한이 변경되었습니다.');
    }
    const webhookPayload = JSON.stringify({
      event: 'pocketmind.integration.action',
      actionId: action.actionId,
      integrationId: action.integrationId,
      action: action.action,
      risk: action.risk,
      input: action.input,
      approvedAt: action.approvedAt || null,
      createdAt: action.createdAt,
    });
    const webhookHeaders = {
      'Content-Type': 'application/json',
      'X-PocketMind-Event': 'integration-action',
    };
    if (WEBHOOK_SIGNING_SECRET.length >= 32) {
      webhookHeaders['X-PocketMind-Signature'] =
        'sha256=' + crypto.createHmac('sha256', WEBHOOK_SIGNING_SECRET).update(webhookPayload).digest('hex');
    }
    const response = await fetch(target, {
      method: 'POST',
      headers: webhookHeaders,
      body: webhookPayload,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    action.status = response.ok ? 'completed' : 'failed';
    action.result = body.slice(0, 20_000);
    if (!response.ok) action.lastError = 'Integration webhook returned HTTP ' + response.status;
    action.updatedAt = Date.now();
  } catch (error) {
    action.status = 'failed';
    action.lastError = String(error.message || 'Webhook request failed').slice(0, 500);
    action.updatedAt = Date.now();
  }
  await persist();
}

function safeAction(action) {
  return {
    actionId: action.actionId,
    integrationId: action.integrationId,
    action: action.action,
    risk: action.risk,
    input: action.input,
    status: action.status,
    result: action.result,
    lastError: action.lastError,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    approvedAt: action.approvedAt,
  };
}

function safeWorker(worker) {
  const { tokenHash, ...publicWorker } = worker;
  return publicWorker;
}

function eligible(worker, task) {
  const conditions = worker.conditions || {};
  const requirements = task.requirements || {};
  if (worker.state !== 'idle' || !conditions.userOptedIn) return false;
  if (Date.now() - worker.lastSeenAt > HEARTBEAT_TIMEOUT_MS) return false;
  if (['serious', 'critical'].includes(conditions.thermalState)) return false;
  if (requirements.modelId && !worker.capabilities.modelIds.includes(requirements.modelId)) return false;
  if (requirements.requireGpu && !worker.capabilities.gpu) return false;
  if (requirements.requireCharging && !conditions.charging) return false;
  if (requirements.requireUnmeteredNetwork && !conditions.unmeteredNetwork) return false;
  if (requirements.minimumBatteryPercent !== undefined && conditions.batteryPercent < requirements.minimumBatteryPercent) return false;
  if (requirements.minimumRamMb !== undefined && Number(worker.capabilities.ramMb || 0) < requirements.minimumRamMb) return false;
  if (requirements.minimumGpuMemoryMb !== undefined &&
      (!worker.capabilities.gpu || Number(worker.capabilities.gpuMemoryMb || 0) < requirements.minimumGpuMemoryMb)) return false;
  const active = Object.values(state.tasks).filter(t => t.workerId === worker.workerId && t.status === 'leased').length;
  return active < worker.capabilities.maxConcurrentTasks;
}

function pruneStoredRecords() {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (['completed', 'failed', 'cancelled'].includes(task.status) && task.updatedAt < cutoff) {
      delete state.tasks[taskId];
    }
  }
  for (const [actionId, action] of Object.entries(personal().actions)) {
    if (['completed', 'failed', 'rejected', 'not_configured'].includes(action.status) && action.updatedAt < cutoff) {
      delete personal().actions[actionId];
    }
    if (action.status === 'awaiting_approval' && action.createdAt < cutoff) {
      action.status = 'rejected';
      action.lastError = 'Approval expired after seven days.';
      action.updatedAt = Date.now();
    }
  }

  const taskEntries = Object.entries(state.tasks);
  if (taskEntries.length > MAX_STORED_RECORDS) {
    const removable = taskEntries
      .filter(([, task]) => ['completed', 'failed', 'cancelled'].includes(task.status))
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    while (Object.keys(state.tasks).length > MAX_STORED_RECORDS && removable.length) {
      const [taskId] = removable.shift();
      delete state.tasks[taskId];
    }
  }
  const actionEntries = Object.entries(personal().actions);
  if (actionEntries.length > MAX_STORED_RECORDS) {
    const removable = actionEntries
      .filter(([, action]) => ['completed', 'failed', 'rejected', 'not_configured'].includes(action.status))
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    while (Object.keys(personal().actions).length > MAX_STORED_RECORDS && removable.length) {
      const [actionId] = removable.shift();
      delete personal().actions[actionId];
    }
  }
}

function recoverExpiredLeases() {
  let changed = false;
  const now = Date.now();
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'leased' && task.leaseExpiresAt <= now) {
      task.status = task.attempts < 3 ? 'pending' : 'failed';
      task.workerId = null;
      task.leaseId = null;
      task.leaseExpiresAt = null;
      task.lastError = 'Worker lease expired';
      task.updatedAt = now;
      changed = true;
    }
  }
  for (const worker of Object.values(state.workers)) {
    if (worker.state !== 'offline' && now - worker.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
      worker.state = 'offline';
      changed = true;
    }
  }
  return changed;
}



function rateLimit(req, res) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = requestCounts.get(key) || { start: now, count: 0 };
  if (now - entry.start > 60_000) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  requestCounts.set(key, entry);
  if (entry.count > 180) {
    json(res, 429, { error: 'Rate limit exceeded' });
    return false;
  }
  if (requestCounts.size > 5000) requestCounts.clear();
  return true;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin && ALLOWED_ORIGINS.size > 0) {
    json(res, 403, { error: 'Origin not allowed' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Enrollment-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

async function handle(req, res) {
  if (!rateLimit(req, res)) return;
  if (!applyCors(req, res)) return;
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/v1/health') {
    return json(res, 200, { status: 'ok', service: 'pocketmind-worker-coordinator', version: 1, now: Date.now() });
  }

  if (req.method === 'POST' && url.pathname === '/v1/accounts') {
    if (!tokenMatches(bearer(req), API_TOKEN)) return json(res,403,{error:'관리자 키가 필요합니다.'});
    if (Object.keys(state.accounts).length >= 1000) return json(res,409,{error:'계정 한도에 도달했어요.'});
    const id = crypto.randomUUID();
    const token = 'pm_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = keyDigest(token);
    state.accounts[id] = {keyHash, oauthConnections:{}, oauthStates:{}, actions:{}};
    await persist();
    keyOwners.set(keyHash,id);
    return json(res,201,{id,token});
  }
  if (req.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'oauth' &&
      ['microsoft', 'github'].includes(parts[2]) && parts[3] === 'callback') {
    try {
      const id = await direct.callback(parts[2], url);
      return html(res, 200, '계정 연결 완료', 'PocketMind에서 연결한 앱을 사용할 수 있어요.',
        'pocketmind://integrations/callback?integrationId=' + encodeURIComponent(id) + '&status=connected');
    } catch (error) {
      return html(res, error.status || 502, '계정 연결 실패', error.message || '잠시 후 다시 시도해 주세요.');
    }
  }
  if (req.method === 'GET' && url.pathname === '/v1/oauth/google/callback') {
    if (!BUILTIN_GOOGLE_ENABLED) return html(res, 503, 'Google 연결 불가', '서버의 Google OAuth 설정이 완료되지 않았습니다.');
    return handleGoogleCallback(url, res);
  }

  const recoveryChanged = recoverExpiredLeases();
  if (recoveryChanged) await persist();

  if (req.method === 'POST' && url.pathname === '/v1/workers/enroll') {
    if (!authenticateEnrollment(req)) return json(res, 401, { error: 'Invalid enrollment token' });
    const body = await readBody(req);
    if (!validateAdvertisement(body)) return json(res, 400, { error: 'Invalid worker advertisement' });
    if (Object.keys(state.workers).length >= MAX_ACTIVE_WORKERS && !state.workers[body.workerId]) {
      return json(res, 429, { error: 'Worker capacity reached' });
    }
    const workerToken = crypto.randomBytes(32).toString('hex');
    state.workers[body.workerId] = {
      workerId: body.workerId,
      displayName: body.displayName,
      capabilities: body.capabilities,
      conditions: body.conditions,
      state: 'idle',
      tokenHash: crypto.createHash('sha256').update(workerToken).digest('hex'),
      lastSeenAt: Date.now(),
      enrolledAt: Date.now(),
    };
    await persist();
    return json(res, 201, { workerId: body.workerId, workerToken, heartbeatIntervalMs: 15_000 });
  }

  if (req.method === 'POST' && url.pathname === '/v1/workers/heartbeat') {
    const worker = findWorkerByToken(bearer(req));
    if (!worker) return json(res, 401, { error: 'Invalid worker token' });
    const body = await readBody(req);
    if (!validateConditions(body.conditions) || !['idle', 'busy', 'paused', 'offline'].includes(body.state)) {
      return json(res, 400, { error: 'Invalid heartbeat' });
    }
    worker.conditions = body.conditions;
    worker.state = body.state;
    worker.lastSeenAt = Date.now();
    if (body.state === 'busy') {
      for (const task of Object.values(state.tasks)) {
        if (task.status === 'leased' && task.workerId === worker.workerId) {
          task.leaseExpiresAt = worker.lastSeenAt + LEASE_MS;
          task.updatedAt = worker.lastSeenAt;
        }
      }
    }
    await persist();
    return json(res, 200, { ok: true, serverTime: worker.lastSeenAt });
  }

  if (req.method === 'POST' && url.pathname === '/v1/workers/gpu-capability') {
    const worker = findWorkerByToken(bearer(req));
    if (!worker) return json(res, 401, { error: 'Invalid worker token' });
    const body = await readBody(req);
    // Workers may downgrade an unverified GPU capability, never self-upgrade it.
    if (!body || body.gpuAvailable !== false) {
      return json(res, 400, { error: 'Only a GPU capability downgrade is accepted' });
    }
    worker.capabilities.gpu = false;
    worker.capabilities.gpuMemoryMb = 0;
    worker.capabilities.backend = 'llama.cpp';
    worker.state = 'idle';
    worker.lastSeenAt = Date.now();
    await persist();
    return json(res, 200, { ok: true, gpuAvailable: false });
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks/claim') {
    const worker = findWorkerByToken(bearer(req));
    if (!worker) return json(res, 401, { error: 'Invalid worker token' });
    const body = await readBody(req);
    worker.lastSeenAt = Date.now();
    worker.state = 'idle';
    const task = Object.values(state.tasks)
      .filter(t => t.status === 'pending' && (!body.modelIds || body.modelIds.includes(t.modelId)) && eligible(worker, t))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!task) {
      await persist();
      return json(res, 200, { task: null, serverTime: Date.now() });
    }
    task.status = 'leased';
    task.workerId = worker.workerId;
    task.leaseId = crypto.randomBytes(24).toString('hex');
    task.leaseExpiresAt = Date.now() + LEASE_MS;
    task.attempts += 1;
    task.updatedAt = Date.now();
    worker.state = 'busy';
    await persist();
    return json(res, 200, {
      task: {
        taskId: task.taskId,
        modelId: task.modelId,
        payload: task.payload,
        requirements: task.requirements,
        leaseId: task.leaseId,
        leaseExpiresAt: task.leaseExpiresAt,
      },
    });
  }

  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tasks' && ['result', 'fail'].includes(parts[3])) {
    const worker = findWorkerByToken(bearer(req));
    if (!worker) return json(res, 401, { error: 'Invalid worker token' });
    const taskId = parts[2];
    const task = state.tasks[taskId];
    if (!task || task.status !== 'leased' || task.workerId !== worker.workerId) return json(res, 404, { error: 'Active task lease not found' });
    const body = await readBody(req);
    if (body.leaseId !== task.leaseId || task.leaseExpiresAt <= Date.now()) return json(res, 409, { error: 'Lease invalid or expired' });
    if (parts[3] === 'result') {
      if (typeof body.output !== 'string' || !body.output.trim() || body.output.length > 100_000) {
        return json(res, 400, { error: 'Output must be a non-empty string of at most 100000 characters' });
      }
      if (body.modelId !== task.modelId) return json(res, 409, { error: 'Model ID mismatch' });
      task.output = body.output;
      task.status = 'completed';
    } else {
      task.lastError = typeof body.error === 'string' ? body.error.slice(0, 1000) : 'Worker failed';
      task.status = task.attempts < 3 ? 'pending' : 'failed';
      task.workerId = null;
      task.leaseId = null;
      task.leaseExpiresAt = null;
    }
    task.updatedAt = Date.now();
    worker.state = 'idle';
    await persist();
    return json(res, 200, { ok: true, status: task.status });
  }

  if (req.method === 'GET' && url.pathname === '/v1/integrations') {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const ids = [...new Set([
      ...(owner() === 'legacy' ? Object.keys(CONNECTOR_WEBHOOKS) : []),
      ...(owner() === 'legacy' ? Object.keys(CONNECTOR_DEFINITIONS) : []),
      ...(BUILTIN_GOOGLE_ENABLED ? Object.keys(GOOGLE_INTEGRATIONS) : []),
      ...direct.ids().filter(builtinDirect),
    ])];
    const integrations = await Promise.all(ids.map(connectorStatus));
    let hubUnavailable = false;
    if (HUB_URL && owner() === 'legacy') {
      try {
        for (const [id, status] of await hubCatalog()) {
          if (canUseHub(id)) integrations.push(status);
        }
      } catch { hubUnavailable = true; }
    }
    return json(res, 200, { integrations, hubUnavailable });
  }

  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'v1' &&
      parts[1] === 'integrations' && ['connect', 'status', 'disconnect'].includes(parts[3])) {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const integrationId = parts[2];
    const shared = canUseHub(integrationId) && (await hubCatalog()).get(integrationId);
    const definition = shared ? { connectUrl: HUB_URL, statusUrl: HUB_URL, actionUrl: HUB_URL, disconnectUrl: HUB_URL } : CONNECTOR_DEFINITIONS[integrationId];
    const google = builtinGoogle(integrationId);
    const provider = builtinDirect(integrationId);
    if (owner() !== 'legacy' && !google && !provider) return json(res,404,{error:'Personal connector unavailable'});
    if (!definition && !google && !provider) return json(res, 404, { error: 'One-tap connector is not configured' });
    await readBody(req);

    if (parts[3] === 'status') return json(res, 200, await connectorStatus(integrationId));

    if (provider) {
      if (parts[3] === 'connect') return json(res, 200, {integrationId, authorizationUrl: await direct.start(integrationId)});
      await direct.disconnect(integrationId);
      return json(res, 200, await direct.status(integrationId));
    }
    if (google) {
      if (parts[3] === 'connect') {
        const authorizationUrl = googleAuthorizationUrl(integrationId);
        await persist();
        return json(res, 200, { integrationId, authorizationUrl });
      }
      const connection = personal().oauthConnections[integrationId];
      if (connection?.refreshToken) {
        const token = decryptSecret(connection.refreshToken);
        fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          redirect: 'error',
          signal: AbortSignal.timeout(8_000),
        }).catch(() => {});
      }
      delete personal().oauthConnections[integrationId];
      await persist();
      return json(res, 200, await connectorStatus(integrationId));
    }

    if (parts[3] === 'connect') {
      if (!definition.connectUrl || !definition.statusUrl || !definition.actionUrl) {
        return json(res, 409, { error: 'Connector connect/status endpoints are incomplete' });
      }
      const result = await callConnector(definition.connectUrl, {
        event: 'pocketmind.integration.connect',
        integrationId,
        returnUrl: `pocketmind://integrations/callback?integrationId=${encodeURIComponent(integrationId)}`,
        stateNonce: crypto.randomBytes(24).toString('hex'),
        requestedAt: Date.now(),
      });
      if (!isSecureConnectorUrl(result.authorizationUrl)) {
        return json(res, 502, { error: 'Connector did not return a secure authorization URL' });
      }
      return json(res, 200, { integrationId, authorizationUrl: result.authorizationUrl });
    }

    if (!definition.disconnectUrl) return json(res, 409, { error: 'Connector disconnect endpoint is not configured' });
    await callConnector(definition.disconnectUrl, {
      event: 'pocketmind.integration.disconnect',
      integrationId,
      requestedAt: Date.now(),
    });
    return json(res, 200, await connectorStatus(integrationId));
  }

  if (req.method === 'POST' && url.pathname === '/v1/integrations/actions') {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const body = await readBody(req);
    if (!body || typeof body.integrationId !== 'string' || !/^[a-z0-9-]{2,80}$/.test(body.integrationId) ||
      typeof body.action !== 'string' || !/^[a-z0-9_-]{2,80}$/.test(body.action) ||
      !['read', 'write', 'sensitive'].includes(body.risk) ||
      !body.input || typeof body.input !== 'object' || Array.isArray(body.input) ||
      JSON.stringify(body.input).length > 32_000) {
      return json(res, 400, { error: 'Invalid integration action payload' });
    }
    const allowedRisk = INTEGRATION_ACTION_RISKS[body.integrationId]?.[body.action];
    if (!allowedRisk || allowedRisk !== body.risk) {
      return json(res, 400, { error: 'Unknown integration action or incorrect risk level' });
    }
    const google = builtinGoogle(body.integrationId);
    const viaHub = Boolean(canUseHub(body.integrationId));
    const provider = builtinDirect(body.integrationId);
    if (owner() !== 'legacy' && !google && !provider) return json(res,404,{error:'Personal connector unavailable'});
    if (!viaHub && !CONNECTOR_WEBHOOKS[body.integrationId] && !google && !provider) {
      return json(res, 409, { error: 'Integration is not configured on the coordinator' });
    }
    if (google || provider || viaHub || CONNECTOR_DEFINITIONS[body.integrationId]?.connectUrl) {
      const connection = await connectorStatus(body.integrationId);
      if (!connection.connected) return json(res, 409, { error: 'Integration account is not connected' });
      if (connection.actions && !connection.actions.includes(body.action)) return json(res, 409, { error: 'Action unavailable on this adapter' });
    }
    const action = {
      actionId: crypto.randomUUID(),
      viaHub,
      accountGeneration: provider || google ? personal().oauthConnections[body.integrationId]?.generation : undefined,
      integrationId: body.integrationId,
      action: body.action,
      risk: body.risk,
      input: body.input,
      status: body.risk === 'read' ? 'queued' : 'awaiting_approval',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      approvedAt: null,
      result: null,
      lastError: null,
    };
    personal().actions[action.actionId] = action;
    await persist();
    if (action.risk === 'read') await dispatchIntegrationAction(action);
    return json(res, 201, safeAction(action));
  }

  if (req.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'integrations' && parts[2] === 'actions') {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const action = personal().actions[parts[3]];
    if (!action) return json(res, 404, { error: 'Integration action not found' });
    return json(res, 200, safeAction(action));
  }

  if (req.method === 'POST' && parts.length === 5 && parts[0] === 'v1' &&
      parts[1] === 'integrations' && parts[2] === 'actions' &&
      ['approve', 'reject'].includes(parts[4])) {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const action = personal().actions[parts[3]];
    if (!action) return json(res, 404, { error: 'Integration action not found' });
    if (action.status !== 'awaiting_approval') return json(res, 409, { error: 'Action is not awaiting approval' });
    await readBody(req);
    if (parts[4] === 'reject') {
      action.status = 'rejected';
      action.updatedAt = Date.now();
      await persist();
      return json(res, 200, safeAction(action));
    }
    action.approvedAt = Date.now();
    action.status = 'queued';
    action.updatedAt = Date.now();
    await persist();
    await dispatchIntegrationAction(action);
    return json(res, 200, safeAction(action));
  }

  if (req.method === 'GET' && url.pathname === '/v1/workers') {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const workers = Object.values(state.workers).map(safeWorker);
    return json(res, 200, { workers, serverTime: Date.now() });
  }

  if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });

  if (req.method === 'POST' && url.pathname === '/v1/tasks') {
    const body = await readBody(req);
    pruneStoredRecords();
    if (Object.keys(state.tasks).filter(id => ['pending', 'leased'].includes(state.tasks[id].status)).length >= MAX_PENDING_TASKS) {
      return json(res, 429, { error: 'Task queue is full' });
    }
    if (!body || typeof body.modelId !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(body.modelId) ||
      !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload) ||
      !Array.isArray(body.payload.messages) || body.payload.messages.length < 1 ||
      body.payload.messages.length > 20 ||
      body.payload.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' || m.content.length > 50_000)) {
      return json(res, 400, { error: 'Invalid task payload' });
    }
    const requested = body.requirements && typeof body.requirements === 'object' && !Array.isArray(body.requirements)
      ? body.requirements : {};
    if ((requested.minimumBatteryPercent !== undefined &&
         (!Number.isFinite(requested.minimumBatteryPercent) || requested.minimumBatteryPercent < 0 || requested.minimumBatteryPercent > 100)) ||
        (requested.minimumRamMb !== undefined &&
         (!Number.isFinite(requested.minimumRamMb) || requested.minimumRamMb < 0 || requested.minimumRamMb > 2_000_000)) ||
        (requested.minimumGpuMemoryMb !== undefined &&
         (!Number.isFinite(requested.minimumGpuMemoryMb) || requested.minimumGpuMemoryMb < 0 || requested.minimumGpuMemoryMb > 2_000_000))) {
      return json(res, 400, { error: 'Invalid worker requirements' });
    }
    const requirements = {
      modelId: body.modelId,
      requireGpu: requested.requireGpu === true,
      requireCharging: requested.requireCharging === true,
      requireUnmeteredNetwork: requested.requireUnmeteredNetwork === true,
      ...(requested.minimumBatteryPercent !== undefined
        ? { minimumBatteryPercent: requested.minimumBatteryPercent } : {}),
      ...(requested.minimumRamMb !== undefined
        ? { minimumRamMb: requested.minimumRamMb } : {}),
      ...(requested.minimumGpuMemoryMb !== undefined
        ? { minimumGpuMemoryMb: requested.minimumGpuMemoryMb } : {}),
    };
    const taskId = crypto.randomUUID();
    state.tasks[taskId] = {
      taskId, owner: owner(), modelId: body.modelId, payload: body.payload,
      requirements,
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
      attempts: 0, workerId: null, leaseId: null, leaseExpiresAt: null,
    };
    await persist();
    return json(res, 201, { taskId, status: 'pending' });
  }

  if (req.method === 'GET' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'tasks') {
    const task = state.tasks[parts[2]];
    if (!task || (task.owner || 'legacy') !== owner()) return json(res, 404, { error: 'Task not found' });
    const { leaseId, payload, ...publicTask } = task;
    return json(res, 200, publicTask);
  }

  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tasks' && parts[3] === 'cancel') {
    const task = state.tasks[parts[2]];
    if (!task || (task.owner || 'legacy') !== owner()) return json(res, 404, { error: 'Task not found' });
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return json(res, 409, { error: 'Task already finished' });
    task.status = 'cancelled';
    task.updatedAt = Date.now();
    await persist();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Not found' });
}

async function main() {
  await load();
  for (const [id,token] of userTokens) keyOwners.set(keyDigest(token),id);
  for (const [id,record] of Object.entries(state.accounts)) {
    if (record.keyHash) keyOwners.set(record.keyHash,id);
  }
  const server = http.createServer((req, res) => {
    Promise.resolve().then(() => ownerContext.run(requestOwner(req), () => handle(req, res))).catch(error => {
      console.error('Request failed:', error.message);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
      else res.destroy();
    });
  });
  server.listen(PORT, HOST, () => console.log(`PocketMind coordinator listening on ${HOST}:${server.address().port}`));
  const shutdown = async () => {
    server.close();
    await saveChain;
    await storage.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => { console.error(error); process.exit(1); });

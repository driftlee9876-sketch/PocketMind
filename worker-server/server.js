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
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const API_TOKEN = process.env.POCKETMIND_API_TOKEN || '';
const ENROLLMENT_TOKEN = process.env.POCKETMIND_ENROLLMENT_TOKEN || '';
const DATA_FILE = path.resolve(process.env.POCKETMIND_DATA_FILE || './data/pocketmind-state.json');
const LEASE_MS = Math.max(15_000, Number(process.env.POCKETMIND_LEASE_MS || 90_000));
const HEARTBEAT_TIMEOUT_MS = Math.max(30_000, Number(process.env.POCKETMIND_HEARTBEAT_TIMEOUT_MS || 60_000));
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PENDING_TASKS = 500;
const MAX_ACTIVE_WORKERS = 1000;
const ALLOWED_ORIGINS = new Set((process.env.POCKETMIND_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
let CONNECTOR_WEBHOOKS = {};
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

if (API_TOKEN.length < 24 || ENROLLMENT_TOKEN.length < 24) {
  console.error('Set POCKETMIND_API_TOKEN and POCKETMIND_ENROLLMENT_TOKEN (each at least 24 characters).');
  process.exit(1);
}

const state = { workers: {}, tasks: {}, actions: {} };
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
  return tokenMatches(bearer(req), API_TOKEN);
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
  saveChain = saveChain.then(async () => {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const temp = DATA_FILE + '.tmp';
    await fs.writeFile(temp, snapshot, { mode: 0o600 });
    await fs.rename(temp, DATA_FILE);
  });
  return saveChain;
}

async function load() {
  try {
    const raw = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      state.workers = raw.workers || {};
      state.tasks = raw.tasks || {};\n      state.actions = raw.actions || {};
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function dispatchIntegrationAction(action) {
  const target = CONNECTOR_WEBHOOKS[action.integrationId];
  if (!target) {
    action.status = 'not_configured';
    action.lastError = 'Integration webhook is not configured on the coordinator.';
    action.updatedAt = Date.now();
    await persist();
    return;
  }
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PocketMind-Event': 'integration-action' },
      body: JSON.stringify({
        event: 'pocketmind.integration.action',
        actionId: action.actionId,
        integrationId: action.integrationId,
        action: action.action,
        risk: action.risk,
        input: action.input,
        approvedAt: action.approvedAt || null,
        createdAt: action.createdAt,
      }),
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
  const active = Object.values(state.tasks).filter(t => t.workerId === worker.workerId && t.status === 'leased').length;
  return active < worker.capabilities.maxConcurrentTasks;
}

function recoverExpiredLeases() {
  const now = Date.now();
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'leased' && task.leaseExpiresAt <= now) {
      task.status = task.attempts < 3 ? 'pending' : 'failed';
      task.workerId = null;
      task.leaseId = null;
      task.leaseExpiresAt = null;
      task.lastError = 'Worker lease expired';
      task.updatedAt = now;
    }
  }
  for (const worker of Object.values(state.workers)) {
    if (now - worker.lastSeenAt > HEARTBEAT_TIMEOUT_MS) worker.state = 'offline';
  }
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

  recoverExpiredLeases();

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
      task: { taskId: task.taskId, modelId: task.modelId, payload: task.payload, leaseId: task.leaseId, leaseExpiresAt: task.leaseExpiresAt },
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
    return json(res, 200, {
      integrations: Object.keys(CONNECTOR_WEBHOOKS).map(id => ({ id, configured: true })),
    });
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
    if (!CONNECTOR_WEBHOOKS[body.integrationId]) {
      return json(res, 409, { error: 'Integration is not configured on the coordinator' });
    }
    const action = {
      actionId: crypto.randomUUID(),
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
    state.actions[action.actionId] = action;
    await persist();
    if (action.risk === 'read') await dispatchIntegrationAction(action);
    return json(res, 201, safeAction(action));
  }

  if (req.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'integrations' && parts[2] === 'actions') {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const action = state.actions[parts[3]];
    if (!action) return json(res, 404, { error: 'Integration action not found' });
    return json(res, 200, safeAction(action));
  }

  if (req.method === 'POST' && parts.length === 5 && parts[0] === 'v1' &&
      parts[1] === 'integrations' && parts[2] === 'actions' &&
      ['approve', 'reject'].includes(parts[4])) {
    if (!authenticateApi(req)) return json(res, 401, { error: 'Invalid API token' });
    const action = state.actions[parts[3]];
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
    if (Object.keys(state.tasks).filter(id => ['pending', 'leased'].includes(state.tasks[id].status)).length >= MAX_PENDING_TASKS) {
      return json(res, 429, { error: 'Task queue is full' });
    }
    if (!body || typeof body.modelId !== 'string' || body.modelId.length > 120 ||
      !body.payload || typeof body.payload !== 'object' ||
      !Array.isArray(body.payload.messages) || body.payload.messages.length < 1 ||
      body.payload.messages.length > 20 ||
      body.payload.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 50_000)) {
      return json(res, 400, { error: 'Invalid task payload' });
    }
    const taskId = crypto.randomUUID();
    state.tasks[taskId] = {
      taskId, modelId: body.modelId, payload: body.payload,
      requirements: body.requirements || { modelId: body.modelId },
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
      attempts: 0, workerId: null, leaseId: null, leaseExpiresAt: null,
    };
    await persist();
    return json(res, 201, { taskId, status: 'pending' });
  }

  if (req.method === 'GET' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'tasks') {
    const task = state.tasks[parts[2]];
    if (!task) return json(res, 404, { error: 'Task not found' });
    const { leaseId, payload, ...publicTask } = task;
    return json(res, 200, publicTask);
  }

  if (req.method === 'POST' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tasks' && parts[3] === 'cancel') {
    const task = state.tasks[parts[2]];
    if (!task) return json(res, 404, { error: 'Task not found' });
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
  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(error => {
      console.error('Request failed:', error.message);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
      else res.destroy();
    });
  });
  server.listen(PORT, HOST, () => console.log(`PocketMind coordinator listening on ${HOST}:${PORT}`));
  const shutdown = async () => {
    server.close();
    await saveChain;
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => { console.error(error); process.exit(1); });

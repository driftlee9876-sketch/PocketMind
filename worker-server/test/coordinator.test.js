const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url, child, getOutput) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Coordinator exited before becoming healthy. ' + getOutput());
    try {
      const response = await fetch(url + '/v1/health');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Coordinator health check timed out.');
}

test('coordinator authenticates, enrolls workers, leases tasks and validates results', { timeout: 20_000 }, async (t) => {
  const port = await freePort();
  const apiToken = 'test-api-token-' + 'a'.repeat(40);
  const enrollmentToken = 'test-enrollment-token-' + 'b'.repeat(40);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketmind-worker-test-'));
  const dataFile = path.join(directory, 'state.json');
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      POCKETMIND_API_TOKEN: apiToken,
      POCKETMIND_ENROLLMENT_TOKEN: enrollmentToken,
      POCKETMIND_DATA_FILE: dataFile,
      POCKETMIND_INTEGRATION_WEBHOOKS_JSON: '{}',
      POCKETMIND_INTEGRATION_CONNECTORS_JSON: JSON.stringify({
        'google-gmail': {
          actionUrl: 'https://connector.example/actions',
          connectUrl: 'https://connector.example/connect',
        },
      }),
      POCKETMIND_WEBHOOK_SIGNING_SECRET: 'test-signing-secret-' + 'c'.repeat(40),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });
  const getOutput = () => childOutput.slice(-4000);

  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const baseUrl = 'http://127.0.0.1:' + port;
  await waitForHealth(baseUrl, child, getOutput);
  const request = (method, endpoint, payload, token, extraHeaders = {}) => fetch(baseUrl + endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...extraHeaders,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const unauthenticated = await request('GET', '/v1/workers');
  assert.equal(unauthenticated.status, 401);

  const integrationsResponse = await request('GET', '/v1/integrations', undefined, apiToken);
  assert.equal(integrationsResponse.status, 200);
  const integrations = (await integrationsResponse.json()).integrations;
  assert.deepEqual(integrations, [{
    id: 'google-gmail',
    configured: true,
    connectable: false,
    connected: false,
    mode: 'oauth',
    statusError: '연결 상태 또는 실행 어댑터 설정이 필요합니다.',
  }]);

  const incompleteConnect = await request('POST', '/v1/integrations/google-gmail/connect', {}, apiToken);
  assert.equal(incompleteConnect.status, 409, 'one-tap OAuth requires both connect and status endpoints');

  const enrollment = await request('POST', '/v1/workers/enroll', {
    workerId: 'windows-test-01',
    displayName: 'Test Worker',
    capabilities: {
      platform: 'windows',
      backend: 'cuda',
      modelIds: ['qwen3-4b'],
      gpu: true,
      gpuMemoryMb: 8192,
      maxConcurrentTasks: 1,
      ramMb: 16384,
    },
    conditions: {
      charging: true,
      batteryPercent: 100,
      thermalState: 'nominal',
      unmeteredNetwork: true,
      userOptedIn: true,
    },
  }, null, { 'X-Enrollment-Token': enrollmentToken });
  assert.equal(enrollment.status, 201);
  const enrolled = await enrollment.json();
  assert.equal(typeof enrolled.workerToken, 'string');

  const createdResponse = await request('POST', '/v1/tasks', {
    modelId: 'qwen3-4b',
    payload: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 64 },
    requirements: { modelId: 'qwen3-4b', requireGpu: true, minimumGpuMemoryMb: 4096 },
  }, apiToken);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const claimResponse = await request('POST', '/v1/tasks/claim', { modelIds: ['qwen3-4b'] }, enrolled.workerToken);
  assert.equal(claimResponse.status, 200);
  const claimed = (await claimResponse.json()).task;
  assert.equal(claimed.taskId, created.taskId);

  const resultResponse = await request('POST', '/v1/tasks/' + created.taskId + '/result', {
    leaseId: claimed.leaseId,
    modelId: 'qwen3-4b',
    output: 'hello from worker',
  }, enrolled.workerToken);
  assert.equal(resultResponse.status, 200);

  const finalResponse = await request('GET', '/v1/tasks/' + created.taskId, undefined, apiToken);
  const finalTask = await finalResponse.json();
  assert.equal(finalTask.status, 'completed');
  assert.equal(finalTask.workerId, 'windows-test-01');
  assert.equal(finalTask.output, 'hello from worker');

  const unsafeAction = await request('POST', '/v1/integrations/actions', {
    integrationId: 'google-gmail',
    action: 'send_message',
    risk: 'read',
    input: { to: 'example@example.com', body: 'test' },
  }, apiToken);
  assert.equal(unsafeAction.status, 400, 'server must not allow side effects to downgrade their risk level');

  const unconfiguredAction = await request('POST', '/v1/integrations/actions', {
    integrationId: 'google-gmail',
    action: 'search_messages',
    risk: 'read',
    input: { query: 'test' },
  }, apiToken);
  assert.equal(unconfiguredAction.status, 409, 'unconfigured connectors must not execute');
});

test('built-in Google OAuth exposes secure one-tap authorization flows', { timeout: 10_000 }, async (t) => {
  const port = await freePort();
  const apiToken = 'gmail-api-token-' + 'd'.repeat(40);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketmind-gmail-test-'));
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      POCKETMIND_API_TOKEN: apiToken,
      POCKETMIND_ENROLLMENT_TOKEN: 'gmail-enrollment-token-' + 'e'.repeat(40),
      POCKETMIND_DATA_FILE: path.join(directory, 'state.json'),
      POCKETMIND_INTEGRATION_WEBHOOKS_JSON: '{}',
      POCKETMIND_INTEGRATION_CONNECTORS_JSON: '{}',
      POCKETMIND_PUBLIC_BASE_URL: 'https://pocketmind.example',
      POCKETMIND_TOKEN_ENCRYPTION_KEY: 'gmail-token-encryption-' + 'f'.repeat(40),
      GOOGLE_OAUTH_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const baseUrl = 'http://127.0.0.1:' + port;
  await waitForHealth(baseUrl, child, () => childOutput.slice(-4000));
  const authenticated = (pathName, method = 'GET') => fetch(baseUrl + pathName, {
    method,
    headers: { Authorization: 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
  });

  const listResponse = await authenticated('/v1/integrations');
  assert.equal(listResponse.status, 200);
  const integrations = (await listResponse.json()).integrations;
  assert.deepEqual(integrations.map(item => item.id), [
    'google-gmail', 'google-calendar', 'google-drive', 'google-docs',
    'google-sheets', 'google-contacts', 'google-tasks', 'youtube',
  ]);
  assert.ok(integrations.every(item => item.configured && item.connectable && !item.connected && item.mode === 'oauth'));

  const connectResponse = await authenticated('/v1/integrations/google-gmail/connect', 'POST');
  assert.equal(connectResponse.status, 200);
  const connect = await connectResponse.json();
  const authorizationUrl = new URL(connect.authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'https://pocketmind.example/v1/oauth/google/callback');
  assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline');
  assert.ok(authorizationUrl.searchParams.get('state'));
  assert.match(authorizationUrl.searchParams.get('scope'), /gmail\.send/);

  const sheetsResponse = await authenticated('/v1/integrations/google-sheets/connect', 'POST');
  assert.equal(sheetsResponse.status, 200);
  const sheetsUrl = new URL((await sheetsResponse.json()).authorizationUrl);
  assert.equal(sheetsUrl.searchParams.get('redirect_uri'), 'https://pocketmind.example/v1/oauth/google/callback');
  assert.match(sheetsUrl.searchParams.get('scope'), /spreadsheets/);

  for (const [id, own, other] of [['google-drive', 'drive.file', 'youtube.force-ssl'], ['youtube', 'youtube.force-ssl', 'drive.file']]) {
    const response = await authenticated('/v1/integrations/' + id + '/connect', 'POST');
    const url = new URL((await response.json()).authorizationUrl);
    const scopes = url.searchParams.get('scope').split(' ');
    assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
    assert.ok(scopes.includes('https://www.googleapis.com/auth/' + own));
    assert.ok(!scopes.includes('https://www.googleapis.com/auth/' + other));
  }

  const invalidCallback = await fetch(baseUrl + '/v1/oauth/google/callback?state=invalid&code=unused');
  assert.equal(invalidCallback.status, 400);
  assert.match(await invalidCallback.text(), /Google 연결 실패/);
});

test('one hub connects a provider and executes only supported, approved actions', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketmind-hub-'));
  const preload = path.join(directory, 'hub.cjs');
  fs.writeFileSync(preload, `
    const {createHmac} = require('node:crypto');
    const original = fetch;
    let connected = false;
    global.fetch = async (url, init) => {
      if (url !== 'https://hub.example/api') return original(url, init);
      const signature = 'sha256=' + createHmac('sha256', process.env.POCKETMIND_WEBHOOK_SIGNING_SECRET).update(init.body).digest('hex');
      if (signature !== init.headers['X-PocketMind-Signature']) return Response.json({}, {status: 403});
      const event = JSON.parse(init.body);
      if (event.event.endsWith('.catalog')) return Response.json({integrations: [
        {id:'slack', connectable:true, connected, actions:['list_channels','send_message','unknown']},
        {id:'not-in-catalog', connectable:true, connected:true, actions:['delete']},
      ]});
      if (event.event.endsWith('.connect')) { connected = true; return Response.json({authorizationUrl:'https://provider.example/consent'}); }
      if (event.event.endsWith('.disconnect')) { connected = false; return Response.json({}); }
      return Response.json({approved:Boolean(event.approvedAt), action:event.action});
    };`);
  const port = await freePort();
  const token = 'test-hub-control-' + 'x'.repeat(30);
  const child = spawn(process.execPath, ['--require', preload, path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), POCKETMIND_API_TOKEN: token,
      POCKETMIND_ENROLLMENT_TOKEN: 'enroll-' + 'y'.repeat(32), POCKETMIND_WEBHOOK_SIGNING_SECRET: 'z'.repeat(40),
      POCKETMIND_INTEGRATION_HUB_URL: 'https://hub.example/api', POCKETMIND_DATA_FILE: path.join(directory, 'state.json') },
    stdio: 'ignore',
  });
  t.after(() => { child.kill(); fs.rmSync(directory, {recursive:true, force:true}); });
  const base = 'http://127.0.0.1:' + port;
  await waitForHealth(base, child, () => '');
  const call = async (path, body) => {
    const res = await fetch(base + '/v1/integrations' + path, { method: body ? 'POST' : 'GET',
      headers: {Authorization:'Bearer ' + token, 'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined });
    return [res.status, await res.json()];
  };
  const [, catalog] = await call('');
  assert.deepEqual(catalog.integrations.map(item => item.id), ['slack']);
  assert.deepEqual(catalog.integrations[0].actions, ['list_channels', 'send_message']);
  const write = {integrationId:'slack', action:'send_message', risk:'sensitive', input:{text:'consent test'}};
  assert.equal((await call('/actions', write))[0], 409);
  assert.equal((await call('/slack/connect', {}))[1].authorizationUrl, 'https://provider.example/consent');
  assert.equal((await call('/actions', {...write, action:'search_messages', risk:'read'}))[0], 409);
  const [, pending] = await call('/actions', write);
  assert.equal(pending.status, 'awaiting_approval');
  const [, approved] = await call('/actions/' + pending.actionId + '/approve', {});
  assert.equal(approved.status, 'completed');
  assert.equal(JSON.parse(approved.result).approved, true);
  assert.equal((await call('/slack/disconnect', {}))[1].connected, false);
});

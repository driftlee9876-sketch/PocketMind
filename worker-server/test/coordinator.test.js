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

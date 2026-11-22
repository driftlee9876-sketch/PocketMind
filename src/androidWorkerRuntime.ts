import { NativeModules } from 'react-native';
import { AI_MODEL_CATALOG } from './aiModelsAndPlugins';

const WORKER_TOKEN_KEY = 'pocketmind.android.worker-token';
const MAX_OUTPUT_CHARS = 100_000;

type WorkerConfig = {
  enabled: boolean;
  coordinatorUrl: string;
  enrollmentToken: string;
  workerId: string;
  displayName?: string;
  modelIds: string[];
  useGpu?: boolean;
  minimumBatteryPercent?: number;
  requireCharging?: boolean;
  requireUnmeteredNetwork?: boolean;
};

async function requestJson(
  baseUrl: string,
  path: string,
  token: string | null,
  body?: unknown,
  headerName?: string,
): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token && headerName === 'X-Enrollment-Token') headers[headerName] = token;
  else if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error('Worker coordinator returned invalid JSON.'); }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data?.error || 'Request failed'}`);
  return data;
}

async function getWorkerToken(config: WorkerConfig): Promise<string> {
  const baseUrl = config.coordinatorUrl.trim().replace(/\/+$/, '');
  let token = await NativeModules.PocketMindWorker.getSecret(WORKER_TOKEN_KEY);
  if (token) {
    try {
      await requestJson(baseUrl, '/v1/workers/heartbeat', token, {
        state: 'idle',
        conditions: await NativeModules.PocketMindWorker.getDeviceConditions().then((c: any) => ({
          ...c,
          userOptedIn: true,
        })),
      });
      return token;
    } catch (error: any) {
      if (!String(error?.message || '').includes('401')) throw error;
      await NativeModules.PocketMindWorker.removeSecret(WORKER_TOKEN_KEY);
      token = null;
    }
  }

  const conditions = await NativeModules.PocketMindWorker.getDeviceConditions();
  const enrolled = await requestJson(
    baseUrl,
    '/v1/workers/enroll',
    config.enrollmentToken,
    {
      workerId: config.workerId,
      displayName: config.displayName || 'PocketMind Android Worker',
      capabilities: {
        platform: 'android',
        backend: 'llama.cpp',
        modelIds: config.modelIds,
        gpu: config.useGpu === true,
        maxConcurrentTasks: 1,
      },
      conditions: { ...conditions, userOptedIn: true },
    },
    'X-Enrollment-Token',
  );
  if (typeof enrolled.workerToken !== 'string' || enrolled.workerToken.length < 32) {
    throw new Error('Coordinator did not issue a worker token.');
  }
  await NativeModules.PocketMindWorker.setSecret(WORKER_TOKEN_KEY, enrolled.workerToken);
  return enrolled.workerToken;
}

/** One Headless JS iteration. The native foreground service schedules the next iteration. */
export async function runAndroidWorkerTask(): Promise<void> {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let context: any = null;
  try {
    const native = NativeModules.PocketMindWorker;
    const config = (await native.getConfig()) as WorkerConfig;
    if (!config?.enabled) return;

    const baseUrl = config.coordinatorUrl.trim().replace(/\/+$/, '');
    if (!/^https:\\/\\//i.test(baseUrl) && !/^http:\\/\\/(localhost|127\\.0\\.1|10\\.|192\\.168\\.)/i.test(baseUrl)) {
      throw new Error('Worker coordinator must use HTTPS unless it is on a trusted local network.');
    }
    if (!Array.isArray(config.modelIds) || config.modelIds.length === 0) {
      throw new Error('Select at least one installed model before enabling this Worker.');
    }

    const token = await getWorkerToken(config);
    const conditions = await native.getDeviceConditions();
    const batteryFloor = config.minimumBatteryPercent ?? 50;
    if (conditions.batteryPercent < batteryFloor && !conditions.charging) return;
    if (config.requireCharging && !conditions.charging) return;
    if (config.requireUnmeteredNetwork && !conditions.unmeteredNetwork) return;
    if (['serious', 'critical'].includes(conditions.thermalState)) return;

    await requestJson(baseUrl, '/v1/workers/heartbeat', token, {
      state: 'idle',
      conditions: { ...conditions, userOptedIn: true },
    });
    const claimed = await requestJson(baseUrl, '/v1/tasks/claim', token, {
      modelIds: config.modelIds,
    });
    const task = claimed?.task;
    if (!task) return;

    const model = AI_MODEL_CATALOG.find((item) => item.id === task.modelId);
    if (!model || !config.modelIds.includes(task.modelId)) {
      await requestJson(baseUrl, `/v1/tasks/${encodeURIComponent(task.taskId)}/fail`, token, {
        leaseId: task.leaseId,
        error: 'Requested model is not available on this Android Worker.',
      });
      return;
    }

    heartbeat = setInterval(() => {
      native.getDeviceConditions()
        .then((current: any) => requestJson(baseUrl, '/v1/workers/heartbeat', token, {
          state: 'busy',
          conditions: { ...current, userOptedIn: true },
        }))
        .catch(() => undefined);
    }, 20_000);

    const RNFS = require('react-native-fs');
    const llama = require('llama.rn');
    const modelPath = `${RNFS.DocumentDirectoryPath}/${model.filename}`;
    if (!(await RNFS.exists(modelPath))) throw new Error(`Model file not found: ${model.filename}`);

    const initOptions = {
      model: modelPath,
      use_mlock: false,
      n_ctx: Math.min(model.nCtx || 2048, 4096),
      n_gpu_layers: config.useGpu === true ? 99 : 0,
    };
    try {
      context = await llama.initLlama(initOptions);
    } catch (error) {
      if (config.useGpu !== true) throw error;
      context = await llama.initLlama({ ...initOptions, n_gpu_layers: 0 });
    }

    const messages = task.payload?.messages;
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('Task has no messages.');
    let accumulated = '';
    const result = await context.completion(
      {
        messages,
        n_predict: Math.min(2048, Math.max(64, Number(task.payload?.max_tokens || 1024))),
        temperature: Number(task.payload?.temperature ?? 0.6),
        top_p: 0.9,
        stop: ['</s>', '<|im_end|>', '<|eot_id|>', '<|end_of_text|>'],
      },
      (event: { token?: string }) => {
        if (event?.token) accumulated += event.token;
      },
    );

    const output = String(result?.text || accumulated).trim();
    if (!output || output.length > MAX_OUTPUT_CHARS) throw new Error('Invalid or oversized model output.');
    await requestJson(baseUrl, `/v1/tasks/${encodeURIComponent(task.taskId)}/result`, token, {
      leaseId: task.leaseId,
      modelId: task.modelId,
      output,
    });
  } catch (error: any) {
    // Headless tasks have no UI. Failures are logged and the next iteration retries.
    console.warn('[PocketMind Worker]', error?.message || error);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (context?.release) {
      try { await context.release(); } catch {}
    }
    try { NativeModules.PocketMindWorker?.finishIteration?.(); } catch {}
  }
}

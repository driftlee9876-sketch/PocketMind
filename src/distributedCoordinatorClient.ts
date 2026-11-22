export interface CoordinatorWorker {
  workerId: string;
  displayName: string;
  capabilities: {
    platform: 'windows' | 'android' | 'ios' | 'linux' | 'macos';
    backend: string;
    modelIds: string[];
    gpu: boolean;
    gpuMemoryMb?: number;
    ramMb?: number;
    maxConcurrentTasks: number;
  };
  conditions: {
    charging: boolean;
    batteryPercent: number;
    thermalState: string;
    unmeteredNetwork: boolean;
    userOptedIn: boolean;
  };
  state: 'idle' | 'busy' | 'paused' | 'offline';
  lastSeenAt: number;
}

export interface CoordinatorTaskResult {
  taskId: string;
  modelId: string;
  status: 'pending' | 'leased' | 'completed' | 'failed' | 'cancelled';
  output?: string;
  workerId?: string | null;
  attempts?: number;
  lastError?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface DistributedInferenceRequest {
  coordinatorUrl: string;
  apiToken: string;
  modelId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  requireGpu?: boolean;
  minimumRamMb?: number;
  timeoutMs?: number;
  onStatus?: (message: string) => void;
}

export class CoordinatorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinatorUnavailableError';
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function coordinatorFetch<T>(
  baseUrl: string,
  apiToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error('Coordinator returned invalid JSON.'); }
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(`Coordinator ${response.status}: ${message}`);
  }
  return body as T;
}

export async function isCoordinatorEndpoint(baseUrlValue: string): Promise<boolean> {
  const baseUrl = normalizeBaseUrl(baseUrlValue);
  if (!/^https?:\\/\\//i.test(baseUrl)) return false;
  try {
    const response = await fetch(`${baseUrl}/v1/health`);
    if (!response.ok) return false;
    const data = await response.json();
    return data?.service === 'pocketmind-worker-coordinator' && data?.status === 'ok';
  } catch {
    return false;
  }
}

export async function discoverCoordinatorWorkers(
  baseUrlValue: string,
  apiToken: string,
): Promise<CoordinatorWorker[]> {
  const baseUrl = normalizeBaseUrl(baseUrlValue);
  const data = await coordinatorFetch<{ workers: CoordinatorWorker[] }>(
    baseUrl, apiToken, '/v1/workers',
  );
  return Array.isArray(data.workers) ? data.workers : [];
}

export function validateCoordinatorTaskResult(
  task: CoordinatorTaskResult,
  expectedModelId: string,
): string {
  if (task.status !== 'completed') throw new Error(`Task is not complete: ${task.status}`);
  if (task.modelId !== expectedModelId) throw new Error('Worker result model ID does not match the requested model.');
  if (typeof task.workerId !== 'string' || !task.workerId) throw new Error('Worker identity is missing from the result.');
  if (typeof task.output !== 'string' || !task.output.trim() || task.output.length > 100_000) {
    throw new Error('Worker returned an empty or oversized result.');
  }
  return task.output.trim();
}

export async function runDistributedInference(
  request: DistributedInferenceRequest,
): Promise<{ output: string; taskId: string; workerId: string }> {
  const baseUrl = normalizeBaseUrl(request.coordinatorUrl);
  if (!request.apiToken || request.apiToken.length < 24) {
    throw new Error('Coordinator API token is missing or invalid.');
  }
  if (!(await isCoordinatorEndpoint(baseUrl))) {
    throw new CoordinatorUnavailableError('PocketMind coordinator endpoint is not available.');
  }

  const created = await coordinatorFetch<{ taskId: string; status: string }>(
    baseUrl,
    request.apiToken,
    '/v1/tasks',
    {
      method: 'POST',
      body: JSON.stringify({
        modelId: request.modelId,
        payload: {
          messages: request.messages,
          temperature: request.temperature ?? 0.6,
          max_tokens: request.maxTokens ?? 1536,
        },
        requirements: {
          modelId: request.modelId,
          requireGpu: request.requireGpu ?? false,
          minimumRamMb: request.minimumRamMb,
        },
      }),
    },
  );
  if (!created.taskId) throw new Error('Coordinator did not return a task ID.');

  const timeoutMs = Math.max(30_000, request.timeoutMs ?? 10 * 60_000);
  const started = Date.now();
  let lastState = '';
  try {
    while (Date.now() - started < timeoutMs) {
      const task = await coordinatorFetch<CoordinatorTaskResult>(
        baseUrl, request.apiToken, `/v1/tasks/${encodeURIComponent(created.taskId)}`,
      );
      if (task.status !== lastState) {
        lastState = task.status;
        request.onStatus?.(
          task.status === 'pending' ? '분산 작업 대기열에서 Worker를 기다리는 중...' :
          task.status === 'leased' ? '원격 Worker에서 GPU 추론 중...' :
          task.status === 'completed' ? 'Worker 결과 검증 중...' :
          `분산 작업 상태: ${task.status}`,
        );
      }
      if (task.status === 'completed') {
        const output = validateCoordinatorTaskResult(task, request.modelId);
        return { output, taskId: created.taskId, workerId: task.workerId! };
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        throw new Error(task.lastError || `Distributed task ${task.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Distributed task timed out after 10 minutes.');
  } catch (error) {
    try {
      await coordinatorFetch(baseUrl, request.apiToken, `/v1/tasks/${encodeURIComponent(created.taskId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {}
    throw error;
  }
}

import {
  WorkerRegistry,
  WorkerAdvertisement,
  createWorkerLease,
  isWorkerLeaseExpired,
  validateWorkerAdvertisement,
} from '../distributedWorkers';
import {
  validateCoordinatorTaskResult,
} from '../distributedCoordinatorClient';

describe('WorkerRegistry', () => {
  let now: number;
  let registry: WorkerRegistry;
  const ad: WorkerAdvertisement = {
    workerId: 'windows-test',
    displayName: 'Windows Test GPU',
    capabilities: {
      platform: 'windows',
      backend: 'cuda',
      modelIds: ['qwen3-4b'],
      gpu: true,
      gpuMemoryMb: 8192,
      ramMb: 32768,
      maxConcurrentTasks: 1,
    },
    conditions: {
      charging: true,
      batteryPercent: 100,
      thermalState: 'nominal',
      unmeteredNetwork: true,
      userOptedIn: true,
    },
    state: 'idle',
    lastSeenAt: 1,
  };

  beforeEach(() => {
    now = 1000;
    registry = new WorkerRegistry({ now: () => now, heartbeatTimeoutMs: 500 });
  });

  it('validates and registers worker advertisements', () => {
    expect(validateWorkerAdvertisement(ad)).toBe(true);
    registry.register(ad);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].lastSeenAt).toBe(now);
  });

  it('selects only opted-in workers that meet model and safety constraints', () => {
    registry.register(ad);
    expect(registry.select({ modelId: 'qwen3-4b', requireGpu: true })?.workerId).toBe('windows-test');
    expect(registry.select({ modelId: 'unknown-model' })).toBeNull();
    expect(registry.select({ requireCharging: true })?.workerId).toBe('windows-test');
    expect(registry.select({ requireGpu: true, minimumGpuMemoryMb: 4096 })?.workerId).toBe('windows-test');
    expect(registry.select({ requireGpu: true, minimumGpuMemoryMb: 16384 })).toBeNull();
    registry.heartbeat('windows-test', {
      state: 'idle',
      conditions: { ...ad.conditions, thermalState: 'critical' },
    });
    expect(registry.select()).toBeNull();
  });

  it('expires stale workers and rejects unconsented worker registration', () => {
    registry.register(ad);
    now += 501;
    expect(registry.list()).toHaveLength(0);
    expect(registry.pruneStale()).toHaveLength(0);

    const invalid = { ...ad, conditions: { ...ad.conditions, userOptedIn: false } };
    registry.register(invalid);
    expect(registry.select()).toBeNull();
  });

  it('creates and checks task lease expiry', () => {
    const lease = createWorkerLease('task-1', 'windows-test', 'lease-1', 1000, 30000);
    expect(isWorkerLeaseExpired(lease, 29999)).toBe(false);
    expect(isWorkerLeaseExpired(lease, 31000)).toBe(true);
    expect(() => createWorkerLease('', 'worker', 'lease')).toThrow();
  });
});

describe('distributed result validation', () => {
  it('accepts a complete result from the requested model and worker', () => {
    expect(validateCoordinatorTaskResult({
      taskId: 'task-1',
      modelId: 'qwen3-4b',
      status: 'completed',
      workerId: 'worker-1',
      output: '완료',
    }, 'qwen3-4b')).toBe('완료');
  });

  it('rejects a mismatched model, missing worker, or empty result', () => {
    const valid = {
      taskId: 'task-1',
      modelId: 'qwen3-4b',
      status: 'completed' as const,
      workerId: 'worker-1',
      output: 'done',
    };
    expect(() => validateCoordinatorTaskResult({ ...valid, modelId: 'wrong' }, 'qwen3-4b')).toThrow();
    expect(() => validateCoordinatorTaskResult({ ...valid, workerId: null }, 'qwen3-4b')).toThrow();
    expect(() => validateCoordinatorTaskResult({ ...valid, output: '  ' }, 'qwen3-4b')).toThrow();
  });
});

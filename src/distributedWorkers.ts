/**
 * PocketMind distributed-worker foundation.
 *
 * Transport-neutral worker registration and scheduling primitives. This does
 * not keep mobile GPUs alive in the background. A trusted coordinator must
 * authenticate requests and persist leases before using this across processes.
 */

export type WorkerPlatform = 'windows' | 'android' | 'ios' | 'linux' | 'macos';
export type WorkerState = 'idle' | 'busy' | 'paused' | 'offline';
export type WorkerBackend = 'llama.cpp' | 'ollama' | 'onnxruntime' | 'directml' | 'cuda' | 'metal' | 'unknown';

export interface WorkerCapabilities {
  platform: WorkerPlatform;
  backend: WorkerBackend;
  modelIds: string[];
  gpu: boolean;
  gpuMemoryMb?: number;
  ramMb?: number;
  maxConcurrentTasks: number;
}

export interface WorkerConditions {
  charging: boolean;
  batteryPercent: number;
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  unmeteredNetwork: boolean;
  userOptedIn: boolean;
}

export interface WorkerAdvertisement {
  workerId: string;
  displayName: string;
  capabilities: WorkerCapabilities;
  conditions: WorkerConditions;
  state: WorkerState;
  lastSeenAt: number;
}

export interface WorkerRequirements {
  modelId?: string;
  requireGpu?: boolean;
  requireCharging?: boolean;
  requireUnmeteredNetwork?: boolean;
  minimumBatteryPercent?: number;
  minimumRamMb?: number;
}

export interface WorkerTask<TPayload = unknown> {
  taskId: string;
  modelId: string;
  payload: TPayload;
  requirements?: WorkerRequirements;
  createdAt: number;
  deadlineAt?: number;
}

export interface WorkerLease {
  taskId: string;
  workerId: string;
  leaseId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WorkerRegistryOptions {
  heartbeatTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Reject malformed advertisements before they enter a registry. */
export function validateWorkerAdvertisement(value: unknown): value is WorkerAdvertisement {
  if (!value || typeof value !== 'object') return false;
  const worker = value as Partial<WorkerAdvertisement>;
  const caps = worker.capabilities;
  const conditions = worker.conditions;

  if (
    !isNonEmptyString(worker.workerId) ||
    !isNonEmptyString(worker.displayName) ||
    !caps ||
    !conditions ||
    !['windows', 'android', 'ios', 'linux', 'macos'].includes(String(caps.platform)) ||
    !['llama.cpp', 'onnxruntime', 'directml', 'cuda', 'metal', 'unknown'].includes(String(caps.backend)) ||
    !Array.isArray(caps.modelIds) ||
    !caps.modelIds.every(isNonEmptyString) ||
    typeof caps.gpu !== 'boolean' ||
    typeof caps.maxConcurrentTasks !== 'number' ||
    !Number.isInteger(caps.maxConcurrentTasks) ||
    caps.maxConcurrentTasks < 1 ||
    caps.maxConcurrentTasks > 16 ||
    typeof conditions.charging !== 'boolean' ||
    typeof conditions.unmeteredNetwork !== 'boolean' ||
    typeof conditions.userOptedIn !== 'boolean' ||
    typeof conditions.batteryPercent !== 'number' ||
    !Number.isFinite(conditions.batteryPercent) ||
    conditions.batteryPercent < 0 ||
    conditions.batteryPercent > 100 ||
    !['nominal', 'fair', 'serious', 'critical', 'unknown'].includes(String(conditions.thermalState)) ||
    !['idle', 'busy', 'paused', 'offline'].includes(String(worker.state)) ||
    !isFiniteNonNegative(worker.lastSeenAt)
  ) return false;

  if (caps.gpuMemoryMb !== undefined && !isFiniteNonNegative(caps.gpuMemoryMb)) return false;
  if (caps.ramMb !== undefined && !isFiniteNonNegative(caps.ramMb)) return false;
  return true;
}

function meetsRequirements(worker: WorkerAdvertisement, requirements: WorkerRequirements = {}): boolean {
  const { capabilities, conditions } = worker;
  if (!conditions.userOptedIn || worker.state !== 'idle') return false;
  if (conditions.thermalState === 'serious' || conditions.thermalState === 'critical') return false;
  if (requirements.modelId && !capabilities.modelIds.includes(requirements.modelId)) return false;
  if (requirements.requireGpu && !capabilities.gpu) return false;
  if (requirements.requireCharging && !conditions.charging) return false;
  if (requirements.requireUnmeteredNetwork && !conditions.unmeteredNetwork) return false;
  if (requirements.minimumBatteryPercent !== undefined &&
      conditions.batteryPercent < requirements.minimumBatteryPercent) return false;
  if (requirements.minimumRamMb !== undefined &&
      (capabilities.ramMb === undefined || capabilities.ramMb < requirements.minimumRamMb)) return false;
  return true;
}

/**
 * In-memory registry for one coordinator process. Production deployments need
 * authenticated storage and atomic reservation/lease operations.
 */
export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerAdvertisement>();
  private readonly heartbeatTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: WorkerRegistryOptions = {}) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  register(advertisement: WorkerAdvertisement): void {
    if (!validateWorkerAdvertisement(advertisement)) throw new Error('Invalid worker advertisement');
    this.workers.set(advertisement.workerId, {
      ...advertisement,
      capabilities: { ...advertisement.capabilities, modelIds: [...advertisement.capabilities.modelIds] },
      conditions: { ...advertisement.conditions },
      lastSeenAt: this.now(),
    });
  }

  heartbeat(workerId: string, update: Pick<WorkerAdvertisement, 'state' | 'conditions'>): boolean {
    const current = this.workers.get(workerId);
    if (!current) return false;
    const next: WorkerAdvertisement = {
      ...current,
      state: update.state,
      conditions: { ...update.conditions },
      lastSeenAt: this.now(),
    };
    if (!validateWorkerAdvertisement(next)) return false;
    this.workers.set(workerId, next);
    return true;
  }

  unregister(workerId: string): boolean {
    return this.workers.delete(workerId);
  }

  pruneStale(): string[] {
    const cutoff = this.now() - this.heartbeatTimeoutMs;
    const removed: string[] = [];
    for (const [workerId, worker] of this.workers) {
      if (worker.lastSeenAt < cutoff) {
        this.workers.delete(workerId);
        removed.push(workerId);
      }
    }
    return removed;
  }

  list(requirements?: WorkerRequirements): WorkerAdvertisement[] {
    this.pruneStale();
    return Array.from(this.workers.values())
      .filter((worker) => !requirements || meetsRequirements(worker, requirements))
      .map((worker) => ({
        ...worker,
        capabilities: { ...worker.capabilities, modelIds: [...worker.capabilities.modelIds] },
        conditions: { ...worker.conditions },
      }));
  }

  /** Prefer eligible GPUs, then higher battery and task capacity. */
  select(requirements: WorkerRequirements = {}): WorkerAdvertisement | null {
    const candidates = this.list(requirements);
    candidates.sort((a, b) =>
      Number(b.capabilities.gpu) - Number(a.capabilities.gpu) ||
      b.conditions.batteryPercent - a.conditions.batteryPercent ||
      b.capabilities.maxConcurrentTasks - a.capabilities.maxConcurrentTasks
    );
    return candidates[0] ?? null;
  }
}

/** Call only after the coordinator has atomically reserved the worker. */
export function createWorkerLease(
  taskId: string,
  workerId: string,
  leaseId: string,
  now: number = Date.now(),
  ttlMs: number = 30_000,
): WorkerLease {
  if (!isNonEmptyString(taskId) || !isNonEmptyString(workerId) || !isNonEmptyString(leaseId)) {
    throw new Error('Task, worker, and lease IDs are required');
  }
  if (!isFiniteNonNegative(now) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('Invalid lease time-to-live');
  }
  return { taskId, workerId, leaseId, issuedAt: now, expiresAt: now + ttlMs };
}

export function isWorkerLeaseExpired(lease: WorkerLease, now: number = Date.now()): boolean {
  return !Number.isFinite(lease.expiresAt) || now >= lease.expiresAt;
}

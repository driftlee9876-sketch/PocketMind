// src/multiModelOrchestrator.ts
// 자율형 다중 모델 오케스트레이션 파이프라인 + 초경량 무검열 모델 라우팅 + 60종 플러그인 연동

import { runDistributedInference, isCoordinatorEndpoint } from './distributedCoordinatorClient';

import {
  AI_MODEL_CATALOG,
  AIModelSpec,
  ModelSpecialty,
  PluginExecutionOutput,
  runAutonomousPlugins,
} from './aiModelsAndPlugins';

export interface PipelineStepResult {
  stepIndex: number;
  roleTitle: string;
  modelId: string;
  modelName: string;
  location: 'on-device' | 'pc-worker';
  durationMs: number;
  output: string;
}

export interface OrchestratorResponse {
  finalText: string;
  steps: PipelineStepResult[];
  pluginOutputs: PluginExecutionOutput[];
  isMultiModelChain: boolean;
}

export interface RemotePCConfig {
  enabled: boolean;
  serverUrl: string;
  apiKey?: string;
}

export interface InferenceCallbacks {
  onStatusUpdate?: (statusText: string) => void;
  onTokenStream?: (partialText: string) => void;
  onStepComplete?: (step: PipelineStepResult) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('사용자가 생성을 중지했습니다.');
}

const SAFE_DEFAULT_MODELS: AIModelSpec[] = [
  {
    id: 'qwen2.5-0.5b-abliterated',
    name: 'Qwen 2.5 0.5B Abliterated v3 (초경량 무검열)',
    shortName: 'Qwen2.5 0.5B 무검열',
    family: 'Qwen Abliterated',
    params: '0.5B',
    quant: 'Q4_K_M',
    sizeGB: 0.49,
    minRamGB: 3,
    tier: 'ultra-light',
    specialtyRoles: ['uncensored', 'fast', 'creative'],
    uncensored: true,
    tags: ['초경량무검열'],
    description: '490MB 초경량 무검열 모델',
    filename: 'qwen2.5-0.5b-abliterated-v3-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/tinyopsec/Qwen2.5-0.5B-Instruct-abliterated-v3-GGUF/resolve/main/model-Q4_K_M.gguf',
    nCtx: 2048,
  },
  {
    id: 'dolphin-3.0-1b',
    name: 'Dolphin 3.0 Llama 3.2 1B (초경량 무검열)',
    shortName: 'Dolphin 3.0 1B',
    family: 'Dolphin Uncensored',
    params: '1.2B',
    quant: 'Q4_K_M',
    sizeGB: 0.81,
    minRamGB: 3,
    tier: 'ultra-light',
    specialtyRoles: ['uncensored', 'fast', 'creative'],
    uncensored: true,
    tags: ['초경량무검열'],
    description: '810MB 초경량 무검열 모델',
    filename: 'Dolphin3.0-Llama3.2-1B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Dolphin3.0-Llama3.2-1B-GGUF/resolve/main/Dolphin3.0-Llama3.2-1B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen 3 4B Instruct/Thinking',
    shortName: 'Qwen 3 4B',
    family: 'Qwen 3',
    params: '4.0B',
    quant: 'Q4_K_M',
    sizeGB: 2.5,
    minRamGB: 6,
    tier: 'light',
    specialtyRoles: ['reasoning', 'korean', 'general'],
    uncensored: false,
    tags: ['스마트폰추천'],
    description: '스마트폰 주력 추론/한국어 모델',
    filename: 'Qwen3-4B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    nCtx: 4096,
  },
];

function getSafeCatalog(): AIModelSpec[] {
  return Array.isArray(AI_MODEL_CATALOG) && AI_MODEL_CATALOG.length > 0
    ? AI_MODEL_CATALOG
    : SAFE_DEFAULT_MODELS;
}

function getLlamaModule(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('llama.rn');
  } catch {
    return null;
  }
}

function getRNFSModule(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-fs');
  } catch {
    return null;
  }
}

const DIRECTIVE_ALIASES: Record<string, string[]> = {
  '@uncensored': [
    'qwen2.5-0.5b-abliterated',
    'dolphin-3.0-1b',
    'qwen2.5-1.5b-abliterated',
    'dolphin-3.0-3b',
    'dolphin-3.0-8b',
    'dolphin-3.0-mistral-24b',
  ],
  '@무검열': [
    'qwen2.5-0.5b-abliterated',
    'dolphin-3.0-1b',
    'qwen2.5-1.5b-abliterated',
    'dolphin-3.0-3b',
    'dolphin-3.0-8b',
    'dolphin-3.0-mistral-24b',
  ],
  '@dolphin': [
    'dolphin-3.0-1b',
    'dolphin-3.0-3b',
    'dolphin-3.0-8b',
    'dolphin-3.0-mistral-24b',
  ],
  '@abliterated': ['qwen2.5-0.5b-abliterated', 'qwen2.5-1.5b-abliterated'],
  '@qwen3': ['qwen3-14b', 'qwen3-8b', 'qwen3-4b', 'qwen3-1.7b'],
  '@qwen': ['qwen3-14b', 'qwen3-8b', 'qwen3-4b', 'qwen3-1.7b', 'qwen2.5-0.5b'],
  '@deepseek': ['deepseek-r1-14b', 'deepseek-r1-8b', 'deepseek-r1-7b'],
  '@r1': ['deepseek-r1-14b', 'deepseek-r1-8b', 'deepseek-r1-7b'],
  '@coder': ['qwen2.5-coder-14b', 'qwen2.5-coder-7b', 'qwen2.5-coder-3b'],
  '@exaone': ['exaone-3.5-7.8b'],
  '@gemma': ['gemma-3-12b', 'gemma-3-4b'],
  '@phi': ['phi-4-mini-3.8b'],
  '@llama': ['llama-3.2-1b'],
};

class MultiModelOrchestratorEngine {
  private activeContext: any | null = null;
  private loadedModelId: string | null = null;

  public parseExplicitDirectives(prompt: string): {
    cleanPrompt: string;
    requestedModelIds: string[];
  } {
    const tokens = prompt.match(/@[a-zA-Z0-9가-힣._-]+/g) || [];
    const requestedModelIds: string[] = [];
    let cleanPrompt = prompt;
    const catalog = getSafeCatalog();

    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (DIRECTIVE_ALIASES[lower]) {
        requestedModelIds.push(...DIRECTIVE_ALIASES[lower]);
        cleanPrompt = cleanPrompt.replace(token, '').trim();
        continue;
      }
      const rawName = lower.slice(1);
      const exact = catalog.find(
        (m) =>
          m.id.toLowerCase() === rawName ||
          m.shortName.toLowerCase().replace(/\s+/g, '') === rawName,
      );
      if (exact) {
        requestedModelIds.push(exact.id);
        cleanPrompt = cleanPrompt.replace(token, '').trim();
      }
    }

    return { cleanPrompt: cleanPrompt || prompt, requestedModelIds };
  }

  public analyzeIntent(prompt: string): {
    needsCoding: boolean;
    needsReasoning: boolean;
    needsKoreanPolish: boolean;
    needsUncensored: boolean;
    isComplexMultiStep: boolean;
  } {
    const lower = prompt.toLowerCase();
    const needsCoding =
      /(코드|파이썬|python|javascript|typescript|react|sql|함수|버그|에러|알고리즘|구현|api|스크립트|앱\s*만들|개발)/.test(
        lower,
      );
    const needsReasoning =
      /(왜|분석|비교|설계|아키텍처|수학|증명|추론|전략|원인|장단점|최적화|심층)/.test(lower);
    const needsKoreanPolish = /[가-힣]/.test(prompt) && prompt.length > 10;
    const needsUncensored =
      /(무검열|검열\s*없|제약\s*없|uncensored|dolphin|abliterated|자유\s*창작|다크\s*판타지|소설|시나리오|롤플레잉)/.test(
        lower,
      );
    const isComplexMultiStep =
      (needsCoding && needsReasoning) ||
      prompt.length > 75 ||
      /(그리고|또한|동시에|단계별로|전체\s*코드|보고서)/.test(lower);

    return {
      needsCoding,
      needsReasoning,
      needsKoreanPolish,
      needsUncensored,
      isComplexMultiStep,
    };
  }

  public selectBestModelForRole(
    role: ModelSpecialty,
    installedModelIds: string[],
    fallbackModelId: string,
  ): AIModelSpec {
    const catalog = getSafeCatalog();
    const installedSpecs = catalog.filter((m) => installedModelIds.includes(m.id));
    if (installedSpecs.length === 0) {
      return catalog.find((m) => m.id === fallbackModelId) || catalog[0];
    }

    const candidates = installedSpecs.filter((m) => m.specialtyRoles.includes(role));
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.sizeGB - a.sizeGB)[0];
    }

    return (
      installedSpecs.find((m) => m.id === fallbackModelId) ||
      installedSpecs.sort((a, b) => b.sizeGB - a.sizeGB)[0]
    );
  }

  private async ensureModelLoaded(
    model: AIModelSpec,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    if (this.activeContext && this.loadedModelId === model.id) return;

    const llamaModule = getLlamaModule();
    const RNFS = getRNFSModule();
    if (!llamaModule || typeof llamaModule.initLlama !== 'function') {
      throw new Error('네이티브 llama.rn 엔진을 사용할 수 없습니다.');
    }
    if (!RNFS || !RNFS.DocumentDirectoryPath) {
      throw new Error('네이티브 파일 시스템을 사용할 수 없습니다.');
    }

    if (this.activeContext) {
      onStatus?.(`이전 모델 메모리 해제 중...`);
      try {
        await this.activeContext.release();
      } catch {}
      this.activeContext = null;
      this.loadedModelId = null;
    }

    const modelPath = `${RNFS.DocumentDirectoryPath}/${model.filename}`;
    const exists = await RNFS.exists(modelPath);
    if (!exists) {
      throw new Error(`모델 파일이 설치되어 있지 않습니다: ${model.name}`);
    }

    onStatus?.(`[${model.shortName}] 온디바이스 로딩 중...`);
    try {
      this.activeContext = await llamaModule.initLlama({
        model: modelPath,
        use_mlock: false,
        n_ctx: model.nCtx || 2048,
        n_gpu_layers: 99,
      });
    } catch {
      this.activeContext = await llamaModule.initLlama({
        model: modelPath,
        use_mlock: false,
        n_ctx: Math.min(model.nCtx || 2048, 2048),
        n_gpu_layers: 0,
      });
    }
    this.loadedModelId = model.id;
  }

  private async runRemotePCInference(
    remoteConfig: RemotePCConfig,
    model: AIModelSpec,
    systemPrompt: string,
    userPrompt: string,
    onToken?: (partial: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const endpoint = `${remoteConfig.serverUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (remoteConfig.apiKey) headers.Authorization = `Bearer ${remoteConfig.apiKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: model.filename,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: model.uncensored ? 0.8 : 0.6,
        max_tokens: 1536,
        stream: false,
      }),
    });

    if (!res.ok) throw new Error(`PC GPU 서버 오류 (HTTP ${res.status})`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    onToken?.(content);
    return content.trim();
  }

  private async runSingleStage(
    model: AIModelSpec,
    systemPrompt: string,
    userPrompt: string,
    remoteConfig: RemotePCConfig,
    callbacks?: InferenceCallbacks,
    signal?: AbortSignal,
  ): Promise<{ output: string; location: 'on-device' | 'pc-worker'; durationMs: number }> {
    throwIfAborted(signal);
    const startTime = Date.now();
    // Explicit remote enablement opts any model tier into the shared Worker queue.
    // Higher tiers additionally require a GPU-capable Worker below.
    const preferPC = remoteConfig.enabled && remoteConfig.serverUrl.trim().length > 0;

    if (preferPC) {
      let coordinatorAvailable = false;
      try {
        coordinatorAvailable = await isCoordinatorEndpoint(remoteConfig.serverUrl, signal);
        if (coordinatorAvailable) {
          callbacks?.onStatusUpdate?.(`🌐 Worker 네트워크에서 [${model.shortName}] 지원 기기를 찾는 중...`);
          const distributed = await runDistributedInference({
            coordinatorUrl: remoteConfig.serverUrl,
            apiToken: remoteConfig.apiKey || '',
            modelId: model.id,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: model.uncensored ? 0.8 : 0.6,
            maxTokens: 1536,
            requireGpu: model.tier === 'high' || model.tier === 'mid',
            minimumRamMb: model.minRamGB * 1024,
            minimumGpuMemoryMb:
              model.tier === 'high' || model.tier === 'mid'
                ? Math.ceil(model.sizeGB * 1024 + 1024)
                : undefined,
            timeoutMs: 10 * 60 * 1000,
            onStatus: callbacks?.onStatusUpdate,
            signal,
          });
          callbacks?.onTokenStream?.(distributed.output);
          return { output: distributed.output, location: 'pc-worker', durationMs: Date.now() - startTime };
        }

        callbacks?.onStatusUpdate?.(`🖥️ 기존 OpenAI 호환 PC 서버로 [${model.shortName}] 연결 중...`);
        const pcOut = await this.runRemotePCInference(
          remoteConfig,
          model,
          systemPrompt,
          userPrompt,
          callbacks?.onTokenStream,
          signal,
        );
        return { output: pcOut, location: 'pc-worker', durationMs: Date.now() - startTime };
      } catch (error) {
        // A configured coordinator that has accepted a task must report its failure;
        // do not silently claim the work was completed locally.
        if (coordinatorAvailable) throw error;
        callbacks?.onStatusUpdate?.(`⚠️ 원격 서버 응답 없음 → 스마트폰 로컬 엔진으로 전환`);
      }
    }

    throwIfAborted(signal);
    await this.ensureModelLoaded(model, callbacks?.onStatusUpdate);
    throwIfAborted(signal);
    let accumulated = '';
    const result = await this.activeContext.completion(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        n_predict: 1024,
        temperature: model.uncensored ? 0.8 : 0.6,
        top_p: 0.9,
        stop: ['</s>', '<|im_end|>', '<|eot_id|>', '<|end_of_text|>'],
      },
      (data: { token?: string }) => {
        if (data?.token && !signal?.aborted) {
          accumulated += data.token;
          callbacks?.onTokenStream?.(accumulated);
        }
      },
    );

    throwIfAborted(signal);
    const finalStr = (result?.text || accumulated || '').trim();
    return { output: finalStr, location: 'on-device', durationMs: Date.now() - startTime };
  }

  public async executeAutonomousPipeline(params: {
    userPrompt: string;
    installedModelIds: string[];
    primaryModelId: string;
    autoMultiModelEnabled: boolean;
    enabledPluginIds?: string[];
    remotePC: RemotePCConfig;
    callbacks?: InferenceCallbacks;
    signal?: AbortSignal;
  }): Promise<OrchestratorResponse> {
    const {
      userPrompt,
      installedModelIds,
      primaryModelId,
      autoMultiModelEnabled,
      enabledPluginIds,
      remotePC,
      callbacks,
      signal,
    } = params;

    throwIfAborted(signal);

    const catalog = getSafeCatalog();
    const { cleanPrompt, requestedModelIds } = this.parseExplicitDirectives(userPrompt);
    const intent = this.analyzeIntent(cleanPrompt);

    callbacks?.onStatusUpdate?.('🧩 활성화된 전체 플러그인 검사 및 자동 실행 중...');
    const pluginOutputs = await runAutonomousPlugins(cleanPrompt, enabledPluginIds);
    const pluginContext =
      pluginOutputs.length > 0
        ? `\n\n[실시간 플러그인 실행 데이터]\n${pluginOutputs
            .map((p) => `- ${p.title}: ${p.result}`)
            .join('\n')}`
        : '';

    const steps: PipelineStepResult[] = [];
    const pipelinePlan: { roleTitle: string; model: AIModelSpec; sysPrompt: string }[] = [];

    if (requestedModelIds.length > 0) {
      const uniqueIds = Array.from(new Set(requestedModelIds));
      for (let i = 0; i < uniqueIds.length; i++) {
        const spec = catalog.find((m) => m.id === uniqueIds[i]);
        if (!spec) continue;
        if (
          !installedModelIds.includes(spec.id) &&
          !(remotePC.enabled && remotePC.serverUrl.trim())
        ) {
          continue;
        }
        pipelinePlan.push({
          roleTitle:
            uniqueIds.length > 1
              ? `${i + 1}단계 지정 모델 (${spec.shortName})`
              : `지정 모델 (${spec.shortName})`,
          model: spec,
          sysPrompt: '선택된 모델로 사용자의 언어와 요청 형식에 맞춰 직접 답하세요. 실제 실행 결과가 있을 때만 외부 작업의 완료를 알리세요.',
        });
      }
    }

    if (pipelinePlan.length === 0) {
      if (intent.needsUncensored) {
        const uncensoredModel = this.selectBestModelForRole(
          'uncensored',
          installedModelIds,
          primaryModelId,
        );
        pipelinePlan.push({
          roleTitle: '창작',
          model: uncensoredModel,
          sysPrompt:
            '사용자가 요청한 창작물의 형식과 언어에 맞춰 바로 본문을 작성하세요.',
        });
      } else if (autoMultiModelEnabled && intent.isComplexMultiStep && installedModelIds.length >= 2) {
        const reasoner = this.selectBestModelForRole('reasoning', installedModelIds, primaryModelId);
        const coder = this.selectBestModelForRole('coding', installedModelIds, primaryModelId);
        const koreanExpert = this.selectBestModelForRole(
          'korean',
          installedModelIds,
          primaryModelId,
        );

        pipelinePlan.push({
          roleTitle: '1단계: 핵심 구조 설계 및 논리 추론',
          model: reasoner,
          sysPrompt:
            '복잡한 요청의 핵심 원인과 해결 구조를 단계별 청사진으로 간결하고 논리적으로 설계하세요.',
        });

        if (intent.needsCoding && coder.id !== reasoner.id) {
          pipelinePlan.push({
            roleTitle: '2단계: 코드 및 기술 구현',
            model: coder,
            sysPrompt:
              '앞선 설계 청사진을 바탕으로 생략 없는 완전한 실행 코드와 기술 세부사항을 작성하세요.',
          });
        }

        if (koreanExpert.id !== pipelinePlan[pipelinePlan.length - 1].model.id) {
          pipelinePlan.push({
            roleTitle: `${pipelinePlan.length + 1}단계: 한국어 최종 통합 및 정제`,
            model: koreanExpert,
            sysPrompt:
              '이전 모델들의 분석과 코드를 통합하여 사용자가 읽기 쉬운 깔끔한 한국어 최종 답변으로 완성하세요.',
          });
        }
      } else {
        const selected =
          catalog.find((m) => m.id === primaryModelId) ||
          catalog.find((m) => installedModelIds.includes(m.id)) ||
          catalog[0];
        pipelinePlan.push({
          roleTitle: '단일 추론',
          model: selected,
          sysPrompt: '사용자의 언어로 질문에 직접 답하세요. 외부 작업은 실제 실행 결과가 있을 때만 완료했다고 말하세요.',
        });
      }
    }

    let previousStageOutput = '';
    for (let i = 0; i < pipelinePlan.length; i++) {
      throwIfAborted(signal);
      const stage = pipelinePlan[i];
      const isLast = i === pipelinePlan.length - 1;
      callbacks?.onStatusUpdate?.(
        `🤖 [${i + 1}/${pipelinePlan.length}] ${stage.roleTitle} (${stage.model.shortName}) 실행 중...`,
      );

      const stageInput =
        i === 0
          ? `${cleanPrompt}${pluginContext}`
          : `[사용자 원래 질문]\n${cleanPrompt}${pluginContext}\n\n[이전 모델 분석 결과]\n${previousStageOutput}\n\n위 결과를 바탕으로 당신의 역할(${stage.roleTitle})을 수행하세요.`;

      const res = await this.runSingleStage(stage.model, stage.sysPrompt, stageInput, remotePC, {
        onStatusUpdate: callbacks?.onStatusUpdate,
        onTokenStream: isLast ? callbacks?.onTokenStream : undefined,
      }, signal);

      const stepRecord: PipelineStepResult = {
        stepIndex: i + 1,
        roleTitle: stage.roleTitle,
        modelId: stage.model.id,
        modelName: stage.model.shortName,
        location: res.location,
        durationMs: res.durationMs,
        output: res.output,
      };
      steps.push(stepRecord);
      callbacks?.onStepComplete?.(stepRecord);
      previousStageOutput = res.output;
    }

    return {
      finalText: previousStageOutput,
      steps,
      pluginOutputs,
      isMultiModelChain: steps.length > 1,
    };
  }

  public async releaseAll(): Promise<void> {
    if (this.activeContext) {
      try {
        await this.activeContext.release();
      } catch {}
      this.activeContext = null;
      this.loadedModelId = null;
    }
  }

  public async cancelActive(): Promise<void> {
    if (this.activeContext && typeof this.activeContext.stopCompletion === 'function') {
      try {
        await this.activeContext.stopCompletion();
      } catch {}
    }
  }
}

export const multiModelOrchestrator = new MultiModelOrchestratorEngine();

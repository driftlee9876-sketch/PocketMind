// src/multiModelOrchestrator.ts
// 크래시 방지 안전 가드 + RAM LRU 즉시 핫스왑 + 단일 명령 멀티 모델 파이프라인

export type ModelSpecialty =
  | 'general'
  | 'coding'
  | 'reasoning'
  | 'korean'
  | 'creative'
  | 'uncensored'
  | 'fast';

export interface AIModelSpec {
  id: string;
  name: string;
  shortName: string;
  family: string;
  params: string;
  quant: string;
  sizeGB: number;
  minRamGB: number;
  tier: 'ultra-light' | 'light' | 'mid' | 'high';
  specialtyRoles: ModelSpecialty[];
  uncensored: boolean;
  tags: string[];
  description: string;
  filename: string;
  downloadUrl: string;
  nCtx: number;
}

export interface PipelineStage {
  stageIndex: number;
  roleTitle: string;
  specialty: ModelSpecialty;
  model: AIModelSpec;
  instruction: string;
}

export interface StageExecutionTrace {
  stageIndex: number;
  roleTitle: string;
  modelId: string;
  modelShortName: string;
  viaWorker: boolean;
  elapsedMs: number;
  outputPreview: string;
}

export interface MultiModelRunResult {
  finalResponse: string;
  traces: StageExecutionTrace[];
  isMultiModel: boolean;
}

// 외부 aiModelsAndPlugins.ts import 실패 시에도 앱이 절대 죽지 않도록 내장 기본 카탈로그 보장
export const SAFE_DEFAULT_MODELS: AIModelSpec[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen 2.5 0.5B Instruct',
    shortName: 'Qwen 2.5 0.5B',
    family: 'Qwen',
    params: '0.5B',
    quant: 'Q4_K_M',
    sizeGB: 0.49,
    minRamGB: 3,
    tier: 'ultra-light',
    specialtyRoles: ['fast', 'general'],
    uncensored: false,
    tags: ['초경량', '초고속'],
    description: '490MB 초소형 모델. 즉각적인 요약 및 분류에 최적화.',
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    nCtx: 2048,
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
    tags: ['최신Qwen3', '스마트폰추천'],
    description: '2.5GB 용량으로 고성능 추론·한국어 성능을 내는 Qwen 3 주력 모델.',
    filename: 'Qwen3-4B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen 2.5 Coder 7B Instruct',
    shortName: 'Qwen 2.5 Coder 7B',
    family: 'Qwen Coder',
    params: '7.6B',
    quant: 'Q4_K_M',
    sizeGB: 4.68,
    minRamGB: 10,
    tier: 'mid',
    specialtyRoles: ['coding'],
    uncensored: false,
    tags: ['코딩특화'],
    description: '코드 생성과 디버깅에 최적화된 전문가 모델.',
    filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    nCtx: 4096,
  },
  {
    id: 'exaone-3.5-7.8b',
    name: 'LG EXAONE 3.5 7.8B Instruct',
    shortName: 'EXAONE 3.5 7.8B',
    family: 'EXAONE',
    params: '7.8B',
    quant: 'Q4_K_M',
    sizeGB: 4.78,
    minRamGB: 10,
    tier: 'mid',
    specialtyRoles: ['korean', 'general'],
    uncensored: false,
    tags: ['한국어특화'],
    description: 'LG AI Research 한국어 특화 모델.',
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
  },
];

function getCatalogSafe(): AIModelSpec[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./aiModelsAndPlugins');
    if (mod && Array.isArray(mod.AI_MODEL_CATALOG) && mod.AI_MODEL_CATALOG.length > 0) {
      return mod.AI_MODEL_CATALOG;
    }
  } catch {}
  return SAFE_DEFAULT_MODELS;
}

interface CachedContextEntry {
  modelId: string;
  context: any;
  lastUsedAt: number;
}

const CONTEXT_LRU_POOL = new Map<string, CachedContextEntry>();
const MAX_CACHED_MODELS = 2;

export async function getOrHotSwapLocalContext(
  model: AIModelSpec,
  onStatus?: (msg: string) => void,
): Promise<any> {
  const existing = CONTEXT_LRU_POOL.get(model.id);
  if (existing) {
    existing.lastUsedAt = Date.now();
    onStatus?.(`⚡ 즉시 모델 전환 완료: ${model.shortName} (RAM 캐시 적중)`);
    return existing.context;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RNFS = require('react-native-fs');
  if (!RNFS || !RNFS.DocumentDirectoryPath) {
    throw new Error('파일 시스템 모듈(RNFS)을 초기화할 수 없습니다.');
  }

  const modelPath = `${RNFS.DocumentDirectoryPath}/${model.filename}`;
  const exists = await RNFS.exists(modelPath);
  if (!exists) {
    throw new Error(`모델 파일이 설치되지 않았습니다: ${model.name}`);
  }

  if (CONTEXT_LRU_POOL.size >= MAX_CACHED_MODELS) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of CONTEXT_LRU_POOL.entries()) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const evicted = CONTEXT_LRU_POOL.get(oldestKey);
      CONTEXT_LRU_POOL.delete(oldestKey);
      try {
        await evicted?.context?.release?.();
      } catch {}
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const llamaPkg = require('llama.rn');
  const initLlama = llamaPkg?.initLlama;
  if (typeof initLlama !== 'function') {
    throw new Error('llama.rn 네이티브 엔진이 로드되지 않았습니다.');
  }

  onStatus?.(`🔄 모델 핫스왑 로딩 중: ${model.shortName}...`);

  let context: any = null;
  try {
    context = await initLlama({
      model: modelPath,
      use_mlock: false,
      n_ctx: model.nCtx || 4096,
      n_gpu_layers: 99,
    });
  } catch {
    onStatus?.(`🛡️ CPU 안전 모드로 재시도: ${model.shortName}...`);
    context = await initLlama({
      model: modelPath,
      use_mlock: false,
      n_ctx: Math.min(model.nCtx || 2048, 2048),
      n_gpu_layers: 0,
    });
  }

  CONTEXT_LRU_POOL.set(model.id, {
    modelId: model.id,
    context,
    lastUsedAt: Date.now(),
  });

  onStatus?.(`✅ 활성 모델 전환됨: ${model.shortName}`);
  return context;
}

export async function releaseAllCachedContexts(): Promise<void> {
  for (const [, entry] of CONTEXT_LRU_POOL.entries()) {
    try {
      await entry.context?.release?.();
    } catch {}
  }
  CONTEXT_LRU_POOL.clear();
}

export function pickBestAvailableModel(
  specialty: ModelSpecialty,
  installedModelIds: string[],
  fallbackModelId: string,
  remoteWorkerConnected: boolean,
  excludeModelIds: string[] = [],
): AIModelSpec {
  const catalog = getCatalogSafe();
  const available = catalog.filter(
    (m) => installedModelIds.includes(m.id) || (remoteWorkerConnected && m.tier !== 'ultra-light'),
  );
  const pool = available.length > 0 ? available : catalog;

  const diverseMatch = pool.find(
    (m) => Array.isArray(m.specialtyRoles) && m.specialtyRoles.includes(specialty) && !excludeModelIds.includes(m.id),
  );
  if (diverseMatch) return diverseMatch;

  const exactMatch = pool.find(
    (m) => Array.isArray(m.specialtyRoles) && m.specialtyRoles.includes(specialty),
  );
  if (exactMatch) return exactMatch;

  return (
    pool.find((m) => m.id === fallbackModelId) ||
    catalog.find((m) => m.id === fallbackModelId) ||
    pool[0]
  );
}

export function extractInlineModelDirectives(prompt: string): {
  forcedModels: AIModelSpec[];
  cleanedPrompt: string;
} {
  const catalog = getCatalogSafe();
  const aliasMap: Record<string, string[]> = {
    '@coder': ['qwen2.5-coder-14b', 'qwen2.5-coder-7b'],
    '@r1': ['deepseek-r1-14b', 'deepseek-r1-8b', 'deepseek-r1-7b'],
    '@reason': ['deepseek-r1-14b', 'deepseek-r1-8b', 'deepseek-r1-7b'],
    '@exaone': ['exaone-3.5-7.8b'],
    '@korean': ['exaone-3.5-7.8b', 'gemma-3-12b', 'qwen3-8b'],
    '@dolphin': ['dolphin-3.0-mistral-24b-uncensored', 'dolphin-3.0-8b-uncensored', 'dolphin-3.0-3b-uncensored'],
    '@uncensored': ['dolphin-3.0-mistral-24b-uncensored', 'dolphin-3.0-8b-uncensored', 'dolphin-3.0-3b-uncensored'],
    '@qwen3': ['qwen3-14b', 'qwen3-8b', 'qwen3-4b', 'qwen3-1.7b'],
    '@gemma3': ['gemma-3-12b', 'gemma-3-4b'],
    '@phi4': ['phi-4-mini-3.8b'],
    '@fast': ['qwen3-1.7b', 'qwen2.5-1.5b', 'llama-3.2-1b', 'qwen2.5-0.5b'],
  };

  const forcedModels: AIModelSpec[] = [];
  let cleaned = prompt;

  const tokens = prompt.match(/@[a-zA-Z0-9._-]+/g) || [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (aliasMap[key]) {
      const candidateIds = aliasMap[key];
      const found = catalog.find((m) => candidateIds.includes(m.id));
      if (found && !forcedModels.some((x) => x.id === found.id)) {
        forcedModels.push(found);
        cleaned = cleaned.replace(token, '').trim();
      }
    } else {
      const direct = catalog.find(
        (m) => m.id.toLowerCase() === key.slice(1) || m.shortName.toLowerCase().includes(key.slice(1)),
      );
      if (direct && !forcedModels.some((x) => x.id === direct.id)) {
        forcedModels.push(direct);
        cleaned = cleaned.replace(token, '').trim();
      }
    }
  }

  return { forcedModels, cleanedPrompt: cleaned || prompt };
}

export function planMultiModelExecution(
  rawPrompt: string,
  installedModelIds: string[],
  currentModelId: string,
  remoteWorkerConnected: boolean,
  autoMultiModelEnabled: boolean,
): PipelineStage[] {
  const { forcedModels, cleanedPrompt } = extractInlineModelDirectives(rawPrompt);

  if (forcedModels.length >= 2) {
    return forcedModels.map((model, idx) => ({
      stageIndex: idx + 1,
      roleTitle:
        idx === 0
          ? '1단계 초안·분석'
          : idx === forcedModels.length - 1
          ? `${idx + 1}단계 최종 통합·검증`
          : `${idx + 1}단계 심화 보완`,
      specialty: model.specialtyRoles?.[0] || 'general',
      model,
      instruction:
        idx === 0
          ? `다음 사용자 요청의 핵심 분석과 1차 결과물을 작성하세요:\n${cleanedPrompt}`
          : `이전 단계 모델의 분석 결과를 검토·보완하여 더 완성도 높은 결과물을 작성하세요.\n원래 요청: ${cleanedPrompt}`,
    }));
  }

  if (forcedModels.length === 1) {
    const m = forcedModels[0];
    return [
      {
        stageIndex: 1,
        roleTitle: '지정 모델 즉시 실행',
        specialty: m.specialtyRoles?.[0] || 'general',
        model: m,
        instruction: cleanedPrompt,
      },
    ];
  }

  const needsReasoning = /(수학|증명|논리|추론|알고리즘|원인|분석|전략|아키텍처|비교|계산)/.test(cleanedPrompt);
  const needsCoding = /(코드|구현|함수|버그|디버깅|리팩토링|typescript|python|react|sql|api|스크립트|앱\s*만들)/i.test(cleanedPrompt);
  const needsCreative = /(소설|시나리오|창작|롤플|검열\s*없이|자유롭게|대본|세계관|브레인스토밍)/.test(cleanedPrompt);
  const needsKoreanPolish = /(보고서|요약|정리|한국어|기획서|제안서|설명해|번역)/.test(cleanedPrompt);

  if (!autoMultiModelEnabled) {
    const singleSpecialty: ModelSpecialty = needsCoding
      ? 'coding'
      : needsReasoning
      ? 'reasoning'
      : needsCreative
      ? 'uncensored'
      : needsKoreanPolish
      ? 'korean'
      : 'general';
    const chosen = pickBestAvailableModel(
      singleSpecialty,
      installedModelIds,
      currentModelId,
      remoteWorkerConnected,
    );
    return [
      {
        stageIndex: 1,
        roleTitle: '능동 최적 모델 실행',
        specialty: singleSpecialty,
        model: chosen,
        instruction: cleanedPrompt,
      },
    ];
  }

  const stages: PipelineStage[] = [];
  const usedIds: string[] = [];

  if (needsReasoning && needsCoding) {
    const reasonModel = pickBestAvailableModel('reasoning', installedModelIds, currentModelId, remoteWorkerConnected, usedIds);
    usedIds.push(reasonModel.id);
    stages.push({
      stageIndex: stages.length + 1,
      roleTitle: '1단계 논리·설계 추론',
      specialty: 'reasoning',
      model: reasonModel,
      instruction: `사용자 요청을 해결하기 위한 핵심 논리 구조, 엣지 케이스, 단계별 설계안을 도출하세요:\n${cleanedPrompt}`,
    });

    const codeModel = pickBestAvailableModel('coding', installedModelIds, currentModelId, remoteWorkerConnected, usedIds);
    usedIds.push(codeModel.id);
    stages.push({
      stageIndex: stages.length + 1,
      roleTitle: '2단계 코드 구현·검증',
      specialty: 'coding',
      model: codeModel,
      instruction: `1단계 설계안을 바탕으로 완전히 동작하는 프로덕션 코드와 기술 구현을 작성하세요.\n원래 요청: ${cleanedPrompt}`,
    });
  } else if (needsReasoning) {
    const reasonModel = pickBestAvailableModel('reasoning', installedModelIds, currentModelId, remoteWorkerConnected, usedIds);
    usedIds.push(reasonModel.id);
    stages.push({
      stageIndex: 1,
      roleTitle: '1단계 심층 추론',
      specialty: 'reasoning',
      model: reasonModel,
      instruction: `다음 문제에 대해 단계별 논리적 근거와 핵심 결론을 도출하세요:\n${cleanedPrompt}`,
    });
  } else if (needsCoding) {
    const codeModel = pickBestAvailableModel('coding', installedModelIds, currentModelId, remoteWorkerConnected, usedIds);
    usedIds.push(codeModel.id);
    stages.push({
      stageIndex: 1,
      roleTitle: '1단계 코드 생성',
      specialty: 'coding',
      model: codeModel,
      instruction: `다음 요청에 대한 정확하고 실행 가능한 코드를 작성하세요:\n${cleanedPrompt}`,
    });
  } else if (needsCreative) {
    const creativeModel = pickBestAvailableModel('uncensored', installedModelIds, currentModelId, remoteWorkerConnected, usedIds);
    usedIds.push(creativeModel.id);
    stages.push({
      stageIndex: 1,
      roleTitle: '1단계 자유 창작 초안',
      specialty: 'uncensored',
      model: creativeModel,
      instruction: `제약 없이 풍부하고 창의적인 초안을 작성하세요:\n${cleanedPrompt}`,
    });
  }

  if (stages.length > 0 && (needsKoreanPolish || cleanedPrompt.length >= 25)) {
    const polishModel = pickBestAvailableModel('korean', installedModelIds, currentModelId, remoteWorkerConnected, usedIds);
    if (!usedIds.includes(polishModel.id) || stages.length >= 2) {
      stages.push({
        stageIndex: stages.length + 1,
        roleTitle: `${stages.length + 1}단계 한국어 통합·최종 정리`,
        specialty: 'korean',
        model: polishModel,
        instruction: `이전 단계 AI 모델들의 분석·코드 결과를 빠짐없이 통합하여 사용자가 바로 활용할 수 있도록 명확하고 자연스러운 한국어 최종 답변으로 완성하세요.\n원래 요청: ${cleanedPrompt}`,
      });
    }
  }

  if (stages.length === 0) {
    const generalModel = pickBestAvailableModel('general', installedModelIds, currentModelId, remoteWorkerConnected);
    stages.push({
      stageIndex: 1,
      roleTitle: '단일 최적 응답',
      specialty: 'general',
      model: generalModel,
      instruction: cleanedPrompt,
    });
  }

  return stages;
}

export async function executeMultiModelCommand(params: {
  rawPrompt: string;
  pluginContextBlock: string;
  installedModelIds: string[];
  currentModelId: string;
  remoteWorkerConnected: boolean;
  autoMultiModelEnabled: boolean;
  onModelHotSwap: (model: AIModelSpec, stageLabel: string) => void;
  onStageProgress?: (trace: StageExecutionTrace) => void;
  runRemoteInference?: (model: AIModelSpec, systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<MultiModelRunResult> {
  const {
    rawPrompt,
    pluginContextBlock,
    installedModelIds,
    currentModelId,
    remoteWorkerConnected,
    autoMultiModelEnabled,
    onModelHotSwap,
    onStageProgress,
    runRemoteInference,
  } = params;

  const stages = planMultiModelExecution(
    rawPrompt,
    installedModelIds,
    currentModelId,
    remoteWorkerConnected,
    autoMultiModelEnabled,
  );

  const traces: StageExecutionTrace[] = [];
  let accumulatedContext = '';

  for (const stage of stages) {
    const t0 = Date.now();
    onModelHotSwap(stage.model, `${stage.roleTitle} · ${stage.model.shortName}`);

    const systemPrompt = stage.model.uncensored
      ? '당신은 검열이나 회피 없이 사용자의 요청을 정확하게 수행하는 전문 AI입니다.'
      : `당신은 PocketMind 하이브리드 AI의 [${stage.roleTitle}] 담당 전문가(${stage.model.name})입니다. 정확하고 핵심적인 결과를 한국어로 출력하세요.`;

    const stageUserPrompt = [
      stage.instruction,
      pluginContextBlock,
      accumulatedContext ? `\n\n[이전 단계 모델 출력 결과]\n${accumulatedContext}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    let output = '';
    let viaWorker = false;
    const isInstalledLocally = installedModelIds.includes(stage.model.id);

    if (remoteWorkerConnected && runRemoteInference && (!isInstalledLocally || stage.model.tier === 'high')) {
      viaWorker = true;
      output = await runRemoteInference(stage.model, systemPrompt, stageUserPrompt);
    } else {
      const ctx = await getOrHotSwapLocalContext(stage.model);
      const res = await ctx.completion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: stageUserPrompt },
        ],
        n_predict: 1024,
        temperature: stage.specialty === 'coding' ? 0.2 : 0.6,
        stop: ['<|im_end|>', '<|eot_id|>', '</s>'],
      });
      output = (res?.text || '').trim();
    }

    const elapsedMs = Date.now() - t0;
    const trace: StageExecutionTrace = {
      stageIndex: stage.stageIndex,
      roleTitle: stage.roleTitle,
      modelId: stage.model.id,
      modelShortName: stage.model.shortName,
      viaWorker,
      elapsedMs,
      outputPreview: output.slice(0, 140),
    };
    traces.push(trace);
    onStageProgress?.(trace);

    accumulatedContext += `\n### [${stage.roleTitle} - ${stage.model.shortName}]\n${output}\n`;
  }

  const lastStage = stages[stages.length - 1];
  const finalOutput =
    traces.length > 0 && lastStage
      ? accumulatedContext
          .split(`### [${lastStage.roleTitle} - ${lastStage.model.shortName}]\n`)
          .pop()
          ?.trim() || ''
      : '';

  return {
    finalResponse: finalOutput,
    traces,
    isMultiModel: stages.length > 1,
  };
}

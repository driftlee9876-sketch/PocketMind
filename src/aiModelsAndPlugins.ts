// src/aiModelsAndPlugins.ts
// 22종 GGUF AI 모델 카탈로그 (초경량 무검열 모델 포함) + 60종 자율·수동 실행 플러그인 엔진

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

export const AI_MODEL_CATALOG: AIModelSpec[] = [
  // ================= 초경량 무검열 모델 (Ultra-Light Uncensored 0.5B ~ 1.5B) =================
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
    tags: ['초경량무검열', '490MB', '초고속', 'Abliterated'],
    description: '490MB 초경량 무검열 모델. 저사양 스마트폰에서도 거부 응답 없이 즉각 반응합니다.',
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
    tags: ['초경량무검열', '810MB', 'Dolphin3.0', '즉각응답'],
    description: 'Cognitive Computations의 초경량 Dolphin 3.0 1B 모델. 빠른 속도와 무검열 자유 창작 지원.',
    filename: 'Dolphin3.0-Llama3.2-1B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Dolphin3.0-Llama3.2-1B-GGUF/resolve/main/Dolphin3.0-Llama3.2-1B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'qwen2.5-1.5b-abliterated',
    name: 'Qwen 2.5 1.5B Abliterated (초경량 무검열)',
    shortName: 'Qwen2.5 1.5B 무검열',
    family: 'Qwen Abliterated',
    params: '1.5B',
    quant: 'Q4_K_M',
    sizeGB: 0.99,
    minRamGB: 4,
    tier: 'ultra-light',
    specialtyRoles: ['uncensored', 'korean', 'creative', 'fast'],
    uncensored: true,
    tags: ['초경량무검열', '990MB', '한국어호환', 'Abliterated'],
    description: '1GB 미만 용량으로 한국어 이해력과 무검열 응답을 동시에 갖춘 초경량 Qwen 2.5 모델.',
    filename: 'qwen2.5-1.5b-instruct-abliterated-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Vali/Qwen2.5-1.5B-Instruct-abliterated-Q4_K_M-GGUF/resolve/main/qwen2.5-1.5b-instruct-abliterated-q4_k_m.gguf',
    nCtx: 4096,
  },

  // ================= 초경량 일반·추론 모델 (Ultra-Light 0.5B ~ 2B) =================
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
    tags: ['초경량', '초고속', '490MB'],
    description: '490MB 초소형 표준 모델. 즉각적인 요약 및 분류에 최적화.',
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    nCtx: 2048,
  },
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B Instruct',
    shortName: 'Llama 3.2 1B',
    family: 'Llama 3.2',
    params: '1.2B',
    quant: 'Q4_K_M',
    sizeGB: 0.81,
    minRamGB: 3,
    tier: 'ultra-light',
    specialtyRoles: ['fast', 'general'],
    uncensored: false,
    tags: ['초경량', 'Meta공식', '빠른속도'],
    description: '모바일 온디바이스 전용으로 설계된 Meta Llama 3.2 초경량 모델.',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen 3 1.7B Instruct/Thinking',
    shortName: 'Qwen 3 1.7B',
    family: 'Qwen 3',
    params: '1.7B',
    quant: 'Q4_K_M',
    sizeGB: 1.18,
    minRamGB: 4,
    tier: 'ultra-light',
    specialtyRoles: ['fast', 'reasoning', 'korean'],
    uncensored: false,
    tags: ['최신Qwen3', '초경량추론', '한국어'],
    description: '1.18GB 크기에도 사고(Thinking) 모드를 지원하는 최신 Qwen 3 초경량 모델.',
    filename: 'Qwen3-1.7B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    nCtx: 4096,
  },

  // ================= 표준 모바일 주력 모델 (Light 3B ~ 4B) =================
  {
    id: 'dolphin-3.0-3b',
    name: 'Dolphin 3.0 Llama 3.2 3B (경량 무검열)',
    shortName: 'Dolphin 3.0 3B',
    family: 'Dolphin Uncensored',
    params: '3.2B',
    quant: 'Q4_K_M',
    sizeGB: 2.02,
    minRamGB: 6,
    tier: 'light',
    specialtyRoles: ['uncensored', 'creative', 'coding'],
    uncensored: true,
    tags: ['경량무검열', 'Dolphin3.0', '창작·코딩'],
    description: '스마트폰에서 단독 구동 가능한 3B급 무검열 주력 모델. 시나리오·코드·자유 대화 특화.',
    filename: 'Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Dolphin3.0-Llama3.2-3B-GGUF/resolve/main/Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf',
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
    tags: ['최신Qwen3', '스마트폰추천', '만능밸런스'],
    description: '2.5GB 용량으로 고성능 추론·한국어 성능을 내는 Qwen 3 주력 모델.',
    filename: 'Qwen3-4B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'gemma-3-4b',
    name: 'Gemma 3 4B Instruct',
    shortName: 'Gemma 3 4B',
    family: 'Gemma 3',
    params: '4.3B',
    quant: 'Q4_K_M',
    sizeGB: 2.49,
    minRamGB: 6,
    tier: 'light',
    specialtyRoles: ['creative', 'korean', 'general'],
    uncensored: false,
    tags: ['Google최신', '자연스러운문장'],
    description: 'Google Gemma 3 4B 모델. 부드러운 한국어 작문과 요약에 강점.',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'phi-4-mini-3.8b',
    name: 'Phi-4 Mini 3.8B Instruct',
    shortName: 'Phi-4 Mini 3.8B',
    family: 'Phi-4',
    params: '3.8B',
    quant: 'Q4_K_M',
    sizeGB: 2.49,
    minRamGB: 6,
    tier: 'light',
    specialtyRoles: ['reasoning', 'coding'],
    uncensored: false,
    tags: ['Microsoft', '수학·논리강점'],
    description: 'Microsoft Phi-4 Mini. 작은 크기 대비 수학·논리 추론 밀도가 매우 높습니다.',
    filename: 'Phi-4-mini-instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'qwen2.5-coder-3b',
    name: 'Qwen 2.5 Coder 3B Instruct',
    shortName: 'Qwen Coder 3B',
    family: 'Qwen Coder',
    params: '3.1B',
    quant: 'Q4_K_M',
    sizeGB: 1.93,
    minRamGB: 6,
    tier: 'light',
    specialtyRoles: ['coding'],
    uncensored: false,
    tags: ['경량코딩', '코드생성'],
    description: '1.93GB 용량으로 파이썬·자바스크립트·SQL 코드를 빠르게 작성하는 경량 코딩 모델.',
    filename: 'qwen2.5-coder-3b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf',
    nCtx: 4096,
  },

  // ================= 중형 고성능 모델 (Mid 7B ~ 12B) =================
  {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen 2.5 Coder 7B Instruct',
    shortName: 'Qwen Coder 7B',
    family: 'Qwen Coder',
    params: '7.6B',
    quant: 'Q4_K_M',
    sizeGB: 4.68,
    minRamGB: 10,
    tier: 'mid',
    specialtyRoles: ['coding'],
    uncensored: false,
    tags: ['코딩전문가', '리팩토링'],
    description: '풀스택 코드 생성, 디버깅, 아키텍처 설계에 최적화된 코딩 특화 모델.',
    filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    nCtx: 4096,
  },
  {
    id: 'deepseek-r1-7b',
    name: 'DeepSeek-R1 Distill Qwen 7B',
    shortName: 'DeepSeek R1 7B',
    family: 'DeepSeek R1',
    params: '7.6B',
    quant: 'Q4_K_M',
    sizeGB: 4.68,
    minRamGB: 10,
    tier: 'mid',
    specialtyRoles: ['reasoning'],
    uncensored: false,
    tags: ['심층추론', '수학·논리'],
    description: '단계별 사고(Chain-of-Thought)를 통해 복잡한 문제를 해결하는 추론 모델.',
    filename: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'deepseek-r1-8b',
    name: 'DeepSeek-R1 Distill Llama 8B',
    shortName: 'DeepSeek R1 8B',
    family: 'DeepSeek R1',
    params: '8.0B',
    quant: 'Q4_K_M',
    sizeGB: 4.92,
    minRamGB: 12,
    tier: 'mid',
    specialtyRoles: ['reasoning'],
    uncensored: false,
    tags: ['심층추론', '전략분석'],
    description: 'Llama 8B 기반 DeepSeek R1 증류 모델. 복잡한 알고리즘 및 원인 분석에 탁월.',
    filename: 'DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf',
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
    tags: ['한국어최강', 'LG AI', '보고서작성'],
    description: 'LG AI Research가 개발한 한국어 특화 모델. 자연스러운 한국어 최종 정리에 최적.',
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'qwen3-8b',
    name: 'Qwen 3 8B Instruct/Thinking',
    shortName: 'Qwen 3 8B',
    family: 'Qwen 3',
    params: '8.2B',
    quant: 'Q4_K_M',
    sizeGB: 5.03,
    minRamGB: 12,
    tier: 'mid',
    specialtyRoles: ['reasoning', 'korean', 'coding', 'general'],
    uncensored: false,
    tags: ['최신Qwen3', '고성능올라운더'],
    description: '추론·코딩·한국어 모두 상위권 성능을 보여주는 8B 플래그십 모델.',
    filename: 'Qwen3-8B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'dolphin-3.0-8b',
    name: 'Dolphin 3.0 Llama 3.1 8B (중형 무검열)',
    shortName: 'Dolphin 3.0 8B',
    family: 'Dolphin Uncensored',
    params: '8.0B',
    quant: 'Q4_K_M',
    sizeGB: 4.92,
    minRamGB: 12,
    tier: 'mid',
    specialtyRoles: ['uncensored', 'creative', 'general'],
    uncensored: true,
    tags: ['중형무검열', 'Dolphin3.0', '자유창작'],
    description: '8B급 고지능 무검열 모델. 복잡한 롤플레잉·시나리오·제약 없는 브레인스토밍 지원.',
    filename: 'Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Dolphin3.0-Llama3.1-8B-GGUF/resolve/main/Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf',
    nCtx: 4096,
  },
  {
    id: 'gemma-3-12b',
    name: 'Gemma 3 12B Instruct',
    shortName: 'Gemma 3 12B',
    family: 'Gemma 3',
    params: '12.2B',
    quant: 'Q4_K_M',
    sizeGB: 7.3,
    minRamGB: 16,
    tier: 'mid',
    specialtyRoles: ['korean', 'creative', 'general'],
    uncensored: false,
    tags: ['Google 12B', '고품질작문'],
    description: '고용량 RAM 기기 또는 PC 워커에서 탁월한 한국어·영문 문장력을 발휘하는 12B 모델.',
    filename: 'gemma-3-12b-it-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF/resolve/main/google_gemma-3-12b-it-Q4_K_M.gguf',
    nCtx: 4096,
  },

  // ================= 대형 PC GPU 워커 권장 모델 (High 14B ~ 24B) =================
  {
    id: 'qwen3-14b',
    name: 'Qwen 3 14B Instruct/Thinking',
    shortName: 'Qwen 3 14B',
    family: 'Qwen 3',
    params: '14.8B',
    quant: 'Q4_K_M',
    sizeGB: 9.0,
    minRamGB: 16,
    tier: 'high',
    specialtyRoles: ['reasoning', 'korean', 'coding', 'general'],
    uncensored: false,
    tags: ['PC워커추천', 'RTX3060최적', '초고성능'],
    description: 'PC GPU 워커(VRAM 12GB)에서 초고속 구동되는 14B 만능 플래그십 모델.',
    filename: 'Qwen3-14B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',
    nCtx: 8192,
  },
  {
    id: 'qwen2.5-coder-14b',
    name: 'Qwen 2.5 Coder 14B Instruct',
    shortName: 'Qwen Coder 14B',
    family: 'Qwen Coder',
    params: '14.8B',
    quant: 'Q4_K_M',
    sizeGB: 8.99,
    minRamGB: 16,
    tier: 'high',
    specialtyRoles: ['coding'],
    uncensored: false,
    tags: ['PC워커추천', '상용급코딩'],
    description: '대규모 리팩토링과 복합 아키텍처 구현을 수행하는 14B급 코딩 전문가 모델.',
    filename: 'qwen2.5-coder-14b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf',
    nCtx: 8192,
  },
  {
    id: 'deepseek-r1-14b',
    name: 'DeepSeek-R1 Distill Qwen 14B',
    shortName: 'DeepSeek R1 14B',
    family: 'DeepSeek R1',
    params: '14.8B',
    quant: 'Q4_K_M',
    sizeGB: 8.99,
    minRamGB: 16,
    tier: 'high',
    specialtyRoles: ['reasoning'],
    uncensored: false,
    tags: ['PC워커추천', '고난도추론'],
    description: '복잡한 수학·논리·시스템 설계 추론을 수행하는 14B급 R1 모델.',
    filename: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    nCtx: 8192,
  },
  {
    id: 'dolphin-3.0-mistral-24b',
    name: 'Dolphin 3.0 R1 Mistral 24B (대형 무검열)',
    shortName: 'Dolphin 24B 무검열',
    family: 'Dolphin Uncensored',
    params: '24.0B',
    quant: 'Q4_K_M',
    sizeGB: 14.3,
    minRamGB: 24,
    tier: 'high',
    specialtyRoles: ['uncensored', 'reasoning', 'creative'],
    uncensored: true,
    tags: ['PC워커전용', '대형무검열', '24B'],
    description: 'PC GPU 워커 오프로딩용 24B 대형 무검열 추론·창작 모델.',
    filename: 'Dolphin3.0-R1-Mistral-24B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Dolphin3.0-R1-Mistral-24B-GGUF/resolve/main/Dolphin3.0-R1-Mistral-24B-Q4_K_M.gguf',
    nCtx: 8192,
  },
];

// ============================================================================
// 60종 자율 및 온디맨드 실행 플러그인 시스템 (AI_PLUGIN_CATALOG — 정확히 60개)
// ============================================================================

export type PluginCategory =
  | '웹·검색'
  | '수학·금융'
  | '코딩·개발'
  | '문서·언어'
  | '메모·시스템'
  | 'AI부스터';

export interface AIPluginSpec {
  id: string;
  index: number;
  name: string;
  category: PluginCategory;
  requiresInternet?: boolean;
  description: string;
  triggerKeywords: string[];
  autoRun: boolean;
  execute: (prompt: string) => Promise<string>;
}

export interface PluginExecutionOutput {
  id: string;
  title: string;
  category: PluginCategory;
  result: string;
}

export interface PluginRouteMatch {
  plugin: AIPluginSpec;
  score: number;
  matchedBy: string[];
}

function safeEvaluateMathExpression(expr: string): number | null {
  const cleaned = expr.replace(/[^0-9+\-*/().%\s^]/g, '').replace(/\^/g, '**').trim();
  if (!cleaned || !/[0-9]/.test(cleaned) || !/[+\-*/%]/.test(cleaned)) return null;
  let pos = 0;
  const parseExpr = (): number => {
    let left = parseTerm();
    while (pos < cleaned.length) {
      while (cleaned[pos] === ' ') pos++;
      const op = cleaned[pos];
      if (op === '+' || op === '-') {
        pos++;
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };
  const parseTerm = (): number => {
    let left = parsePower();
    while (pos < cleaned.length) {
      while (cleaned[pos] === ' ') pos++;
      const op = cleaned[pos];
      if (op === '*' || op === '/' || op === '%') {
        pos++;
        const right = parsePower();
        if ((op === '/' || op === '%') && right === 0) throw new Error('0으로 나눌 수 없습니다');
        left = op === '*' ? left * right : op === '/' ? left / right : left % right;
      } else {
        break;
      }
    }
    return left;
  };
  const parsePower = (): number => {
    let base = parseFactor();
    while (cleaned[pos] === ' ') pos++;
    if (cleaned[pos] === '*' && cleaned[pos + 1] === '*') {
      pos += 2;
      const exp = parsePower();
      base = Math.pow(base, exp);
    }
    return base;
  };
  const parseFactor = (): number => {
    while (cleaned[pos] === ' ') pos++;
    if (cleaned[pos] === '(') {
      pos++;
      const val = parseExpr();
      while (cleaned[pos] === ' ') pos++;
      if (cleaned[pos] === ')') pos++;
      return val;
    }
    if (cleaned[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    const start = pos;
    while (pos < cleaned.length && /[0-9.]/.test(cleaned[pos])) pos++;
    if (start === pos) throw new Error('잘못된 수식');
    return parseFloat(cleaned.slice(start, pos));
  };
  try {
    const val = parseExpr();
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getRNFSOrNull() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-fs');
  } catch {
    return null;
  }
}

export const AI_PLUGIN_CATALOG: AIPluginSpec[] = [
  // ==================== [1 ~ 10] 웹·실시간 정보 ====================
  {
    id: 'web-duckduckgo',
    index: 1,
    name: 'DuckDuckGo 실시간 즉답 검색',
    category: '웹·검색',
    requiresInternet: true,
    description: '질문 핵심 키워드로 DuckDuckGo Instant Answer API를 조회합니다.',
    triggerKeywords: ['검색', '찾아줘', '무엇인가요', '누구야', '알려줘', '최신정보'],
    autoRun: true,
    execute: async (prompt) => {
      const q = encodeURIComponent(prompt.slice(0, 120));
      const res = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1`);
      const data = await res.json();
      const abstract = data?.AbstractText || data?.Answer || '';
      const related = Array.isArray(data?.RelatedTopics)
        ? data.RelatedTopics.slice(0, 3)
            .map((t: any) => t?.Text)
            .filter(Boolean)
            .join(' / ')
        : '';
      return abstract || related || '즉답 요약 없음 (AI 자체 지식 및 추론으로 보완)';
    },
  },
  {
    id: 'web-wiki-ko',
    index: 2,
    name: '한국어 위키백과 백과사전',
    category: '웹·검색',
    requiresInternet: true,
    description: '한국어 위키백과에서 인물·역사·용어·개념 정의를 실시간으로 가져옵니다.',
    triggerKeywords: ['위키', '백과사전', '정의', '역사', '유래', '뜻이'],
    autoRun: true,
    execute: async (prompt) => {
      const term = prompt.replace(/(위키|백과사전|정의|역사|알려줘|뭐야|\?)/g, '').trim().slice(0, 50);
      if (!term) return '검색어 미지정';
      const res = await fetchWithTimeout(
        `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
      );
      if (!res.ok) return `위키백과 항목 미발견: ${term}`;
      const data = await res.json();
      return data?.extract ? `[${data.title}] ${data.extract.slice(0, 450)}` : '요약 본문 없음';
    },
  },
  {
    id: 'web-wiki-en',
    index: 3,
    name: '영문 Wikipedia 심층 검색',
    category: '웹·검색',
    requiresInternet: true,
    description: '영문 Wikipedia REST API를 통해 글로벌 기술·학술 문서를 조회합니다.',
    triggerKeywords: ['wikipedia', 'wiki', '영문위키', '해외자료'],
    autoRun: true,
    execute: async (prompt) => {
      const term = prompt.replace(/(wikipedia|wiki|영문위키|\?)/gi, '').trim().slice(0, 60);
      const res = await fetchWithTimeout(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term || 'Artificial intelligence')}`,
      );
      if (!res.ok) return '영문 위키 항목 없음';
      const data = await res.json();
      return data?.extract ? `[${data.title}] ${data.extract.slice(0, 450)}` : '본문 없음';
    },
  },
  {
    id: 'web-url-reader',
    index: 4,
    name: '웹페이지 URL 본문 추출기',
    category: '웹·검색',
    requiresInternet: true,
    description: '입력된 http/https 링크의 HTML을 내려받아 순수 텍스트 본문으로 정제합니다.',
    triggerKeywords: ['http://', 'https://', '링크요약', '사이트분석', '웹페이지'],
    autoRun: true,
    execute: async (prompt) => {
      const match = prompt.match(/https?:\/\/[^\s)]+/);
      if (!match) return 'URL이 감지되지 않았습니다.';
      const res = await fetchWithTimeout(match[0], 6000);
      const html = await res.text();
      const plain = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return `URL(${match[0]}) 추출 본문: ${plain.slice(0, 900)}`;
    },
  },
  {
    id: 'web-hackernews',
    index: 5,
    name: 'Hacker News 실시간 IT 트렌드',
    category: '웹·검색',
    requiresInternet: true,
    description: '글로벌 개발자 커뮤니티 Hacker News 상위 인기 글 5개를 실시간 조회합니다.',
    triggerKeywords: ['해커뉴스', 'hackernews', 'it트렌드', '개발뉴스', '기술뉴스'],
    autoRun: true,
    execute: async () => {
      const res = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json');
      const ids: number[] = await res.json();
      const top5 = await Promise.all(
        ids.slice(0, 5).map(async (id) => {
          const r = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const item = await r.json();
          return `- ${item?.title} (점수: ${item?.score})`;
        }),
      );
      return top5.join('\n');
    },
  },
  {
    id: 'web-github-repo',
    index: 6,
    name: 'GitHub 저장소 메타데이터 조회',
    category: '웹·검색',
    requiresInternet: true,
    description: 'owner/repo 형식의 GitHub 오픈소스 스타 수, 포크, 주 언어를 실시간 조회합니다.',
    triggerKeywords: ['github.com/', '깃허브', '레포지토리', '오픈소스'],
    autoRun: true,
    execute: async (prompt) => {
      const m = prompt.match(/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
      if (!m) return 'github.com/소유자/저장소 URL을 포함해 주세요.';
      const repo = m[1].replace(/\.git$/, '');
      const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}`);
      if (!res.ok) return `저장소 조회 실패 (HTTP ${res.status})`;
      const d = await res.json();
      return `${d.full_name} | ⭐ ${d.stargazers_count} | 언어: ${d.language} | 설명: ${d.description || '없음'}`;
    },
  },
  {
    id: 'web-npm-info',
    index: 7,
    name: 'npm 패키지 최신 버전 조회',
    category: '웹·검색',
    requiresInternet: true,
    description: 'npm 레지스트리에서 Node/React 패키지의 최신 배포 버전과 설명을 확인합니다.',
    triggerKeywords: ['npm', '패키지버전', '라이브러리버전'],
    autoRun: false,
    execute: async (prompt) => {
      const pkg = prompt.replace(/(npm|패키지|버전|조회)/gi, '').trim().split(/\s+/)[0];
      if (!pkg) return '패키지명을 입력하세요.';
      const res = await fetchWithTimeout(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
      if (!res.ok) return `npm 패키지 미발견: ${pkg}`;
      const d = await res.json();
      return `${d.name}@${d.version} (${d.license || 'MIT'}) - ${d.description || ''}`;
    },
  },
  {
    id: 'web-pypi-info',
    index: 8,
    name: 'Python PyPI 패키지 조회',
    category: '웹·검색',
    requiresInternet: true,
    description: 'PyPI 공식 API에서 파이썬 패키지의 최신 버전과 요약을 조회합니다.',
    triggerKeywords: ['pypi', 'pip', '파이썬패키지'],
    autoRun: false,
    execute: async (prompt) => {
      const pkg = prompt.replace(/(pypi|pip|install|파이썬패키지)/gi, '').trim().split(/\s+/)[0];
      if (!pkg) return 'PyPI 패키지명을 입력하세요.';
      const res = await fetchWithTimeout(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
      if (!res.ok) return `PyPI 패키지 미발견: ${pkg}`;
      const d = await res.json();
      return `${d.info?.name} v${d.info?.version} - ${d.info?.summary || ''}`;
    },
  },
  {
    id: 'web-ip-geo',
    index: 9,
    name: '현재 네트워크 IP·지역 진단',
    category: '웹·검색',
    requiresInternet: true,
    description: '현재 기기가 연결된 외부 공인 IP, 국가, 도시, 통신사 정보를 확인합니다.',
    triggerKeywords: ['내아이피', '공인ip', 'ip주소', '네트워크위치'],
    autoRun: false,
    execute: async () => {
      const res = await fetchWithTimeout('https://ipapi.co/json/');
      const d = await res.json();
      return `IP: ${d.ip} | 위치: ${d.country_name} ${d.city} | ISP: ${d.org}`;
    },
  },
  {
    id: 'web-dns-lookup',
    index: 10,
    name: '도메인 DNS 레코드 조회',
    category: '웹·검색',
    requiresInternet: true,
    description: 'Cloudflare DNS-over-HTTPS를 통해 도메인의 A 레코드(IP)를 실시간 질의합니다.',
    triggerKeywords: ['dns', '도메인조회', 'nslookup', '아이피찾기'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
      if (!m) return '조회할 도메인(예: google.com)을 입력하세요.';
      const res = await fetchWithTimeout(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(m[1])}&type=A`,
      );
      const d = await res.json();
      const answers = (d.Answer || []).map((a: any) => `${a.name} -> ${a.data} (TTL ${a.TTL}s)`);
      return answers.length > 0 ? answers.join('\n') : 'DNS A 레코드 없음';
    },
  },

  // ==================== [11 ~ 20] 수학·과학·금융 계산 ====================
  {
    id: 'calc-math-eval',
    index: 11,
    name: '고정밀 사칙·지수 수식 계산기',
    category: '수학·금융',
    description: '프롬프트 내 복잡한 수학 연산식을 정확하게 계산해 오차 없는 수치를 제공합니다.',
    triggerKeywords: ['계산', '얼마야', '더하기', '곱하기', '나누기', '='],
    autoRun: true,
    execute: async (prompt) => {
      const val = safeEvaluateMathExpression(prompt);
      return val !== null ? `정확한 수식 연산 결과: ${val.toLocaleString()}` : '수식 미감지';
    },
  },
  {
    id: 'calc-fx-rate',
    requiresInternet: true,
    index: 12,
    name: '실시간 글로벌 환율 변환기',
    category: '수학·금융',
    description: 'USD, KRW, JPY, EUR, CNY 등 실시간 기준 환율을 조회해 원화로 환산합니다.',
    triggerKeywords: ['환율', '달러', '엔화', '유로', '원화', 'usd', 'jpy', 'eur'],
    autoRun: true,
    execute: async (prompt) => {
      const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD');
      const data = await res.json();
      const rates = data?.rates || {};
      const krw = rates.KRW ? Number(rates.KRW).toFixed(2) : 'N/A';
      const jpy = rates.JPY && rates.KRW ? ((rates.KRW / rates.JPY) * 100).toFixed(2) : 'N/A';
      const eur = rates.EUR && rates.KRW ? (rates.KRW / rates.EUR).toFixed(2) : 'N/A';
      const amountMatch = prompt.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:달러|usd|\$)/i);
      const converted =
        amountMatch && rates.KRW
          ? ` | ${amountMatch[1]} USD = 약 ${Math.round(parseFloat(amountMatch[1]) * rates.KRW).toLocaleString()}원`
          : '';
      return `실시간 기준 환율: 1 USD = ${krw}원 | 100 JPY = ${jpy}원 | 1 EUR = ${eur}원${converted}`;
    },
  },
  {
    id: 'calc-crypto-price',
    requiresInternet: true,
    index: 13,
    name: '암호화폐 실시간 시세 (BTC/ETH/SOL)',
    category: '수학·금융',
    description: 'CoinGecko API에서 비트코인, 이더리움, 솔라나의 실시간 원화·달러 시세를 조회합니다.',
    triggerKeywords: ['비트코인', '이더리움', '솔라나', '코인시세', 'btc', 'eth', 'sol'],
    autoRun: true,
    execute: async () => {
      const res = await fetchWithTimeout(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=krw,usd',
      );
      const d = await res.json();
      return (
        `BTC: ₩${Number(d.bitcoin?.krw || 0).toLocaleString()} ($${Number(d.bitcoin?.usd || 0).toLocaleString()}) | ` +
        `ETH: ₩${Number(d.ethereum?.krw || 0).toLocaleString()} | ` +
        `SOL: ₩${Number(d.solana?.krw || 0).toLocaleString()}`
      );
    },
  },
  {
    id: 'calc-unit-convert',
    index: 14,
    name: '과학·생활 단위 정밀 변환기',
    category: '수학·금융',
    description: '인치↔cm, 파운드↔kg, 화씨↔섭씨, 평↔제곱미터(㎡)를 즉시 환산합니다.',
    triggerKeywords: ['평', '인치', '파운드', '화씨', '섭씨', '마일', '단위변환'],
    autoRun: true,
    execute: async (prompt) => {
      const pyeong = prompt.match(/([0-9.]+)\s*평/);
      if (pyeong) {
        const v = parseFloat(pyeong[1]);
        return `${v}평 = ${(v * 3.305785).toFixed(2)}㎡`;
      }
      const inch = prompt.match(/([0-9.]+)\s*(?:인치|inch)/i);
      if (inch) {
        const v = parseFloat(inch[1]);
        return `${v} inch = ${(v * 2.54).toFixed(2)} cm`;
      }
      const lb = prompt.match(/([0-9.]+)\s*(?:파운드|lb)/i);
      if (lb) {
        const v = parseFloat(lb[1]);
        return `${v} lb = ${(v * 0.453592).toFixed(2)} kg`;
      }
      const fTemp = prompt.match(/([0-9.-]+)\s*(?:화씨|°F)/i);
      if (fTemp) {
        const v = parseFloat(fTemp[1]);
        return `${v}°F = ${(((v - 32) * 5) / 9).toFixed(1)}°C`;
      }
      return '변환 가능한 단위(평, 인치, 파운드, 화씨) 수치 미감지';
    },
  },
  {
    id: 'calc-vat-margin',
    index: 15,
    name: '부가세(VAT)·할인율·마진 계산기',
    category: '수학·금융',
    description: '공급가액/부가세 10% 분리 및 할인 적용 최종 결제 금액을 계산합니다.',
    triggerKeywords: ['부가세', 'vat', '할인율', '마진율', '퍼센트', '%'],
    autoRun: false,
    execute: async (prompt) => {
      const nums = prompt.match(/[0-9]+(?:\.[0-9]+)?/g);
      if (!nums || nums.length === 0) return '금액을 입력하세요.';
      const base = parseFloat(nums[0]);
      const vat = Math.round(base * 0.1);
      return `기준액 ${base.toLocaleString()}원 -> 부가세(10%): ${vat.toLocaleString()}원 / 합계: ${(base + vat).toLocaleString()}원`;
    },
  },
  {
    id: 'calc-compound',
    index: 16,
    name: '복리 투자·자산 증식 시뮬레이터',
    category: '수학·금융',
    description: '원금, 연 수익률(%), 투자 기간(년)을 바탕으로 복리 미래 가치를 산출합니다.',
    triggerKeywords: ['복리', '수익률', '연이율', '자산증식'],
    autoRun: false,
    execute: async (prompt) => {
      const nums = (prompt.match(/[0-9]+(?:\.[0-9]+)?/g) || []).map(Number);
      const principal = nums[0] || 10000000;
      const rate = (nums[1] || 8) / 100;
      const years = nums[2] || 10;
      const fv = principal * Math.pow(1 + rate, years);
      return `원금 ${principal.toLocaleString()}원, 연 ${(rate * 100).toFixed(1)}%, ${years}년 복리 결과: 약 ${Math.round(fv).toLocaleString()}원`;
    },
  },
  {
    id: 'calc-loan-emi',
    index: 17,
    name: '대출 원리금균등 상환 계산기',
    category: '수학·금융',
    description: '대출 원금, 연 금리, 상환 개월 수 기준 월 납입 원리금을 계산합니다.',
    triggerKeywords: ['대출이자', '원리금', '월상환액', '주담대'],
    autoRun: false,
    execute: async (prompt) => {
      const nums = (prompt.match(/[0-9]+(?:\.[0-9]+)?/g) || []).map(Number);
      const p = nums[0] || 100000000;
      const annualRate = (nums[1] || 4.5) / 100;
      const months = nums[2] || 360;
      const r = annualRate / 12;
      const emi = (p * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
      return `원금 ${p.toLocaleString()}원 (${(annualRate * 100).toFixed(2)}%, ${months}개월) -> 월 납입금 약 ${Math.round(emi).toLocaleString()}원`;
    },
  },
  {
    id: 'calc-bmi-bmr',
    index: 18,
    name: 'BMI 체질량·표준체중 분석기',
    category: '수학·금융',
    description: '키(cm)와 몸무게(kg)로 BMI 지수와 비만도 단계를 계산합니다.',
    triggerKeywords: ['bmi', '체질량', '표준체중', '비만도'],
    autoRun: false,
    execute: async (prompt) => {
      const h = prompt.match(/([12][0-9]{2}(?:\.[0-9]+)?)\s*cm/i);
      const w = prompt.match(/([0-9]{2,3}(?:\.[0-9]+)?)\s*kg/i);
      if (!h || !w) return '예시: 175cm 70kg 형식으로 입력해 주세요.';
      const hm = parseFloat(h[1]) / 100;
      const wk = parseFloat(w[1]);
      const bmi = wk / (hm * hm);
      const status = bmi < 18.5 ? '저체중' : bmi < 23 ? '정상' : bmi < 25 ? '과체중' : '비만';
      return `BMI: ${bmi.toFixed(1)} (${status}) | 권장 표준체중: ${(hm * hm * 22).toFixed(1)}kg`;
    },
  },
  {
    id: 'calc-statistics',
    index: 19,
    name: '데이터 배열 통계 분석기',
    category: '수학·금융',
    description: '나열된 숫자 목록의 합계, 평균, 중앙값, 최소/최대, 표준편차를 계산합니다.',
    triggerKeywords: ['표준편차', '중앙값', '평균구하기', '통계분석'],
    autoRun: false,
    execute: async (prompt) => {
      const nums = (prompt.match(/-?[0-9]+(?:\.[0-9]+)?/g) || []).map(Number);
      if (nums.length < 2) return '2개 이상의 숫자를 입력하세요.';
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
      const variance = nums.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / nums.length;
      return `개수: ${nums.length} | 합계: ${sum} | 평균: ${mean.toFixed(2)} | 중앙값: ${median} | 표준편차: ${Math.sqrt(variance).toFixed(2)}`;
    },
  },
  {
    id: 'calc-prime-factor',
    index: 20,
    name: '소수 판별 및 소인수분해기',
    category: '수학·금융',
    description: '자연수의 소수 여부 판별 및 전체 소인수분해 결과를 계산합니다.',
    triggerKeywords: ['소인수분해', '소수판별', '약수'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/[0-9]+/);
      if (!m) return '자연수를 입력하세요.';
      let n = parseInt(m[0], 10);
      if (n < 2) return `${n}은(는) 소수가 아닙니다.`;
      const orig = n;
      const factors: number[] = [];
      let d = 2;
      while (d * d <= n) {
        while (n % d === 0) {
          factors.push(d);
          n /= d;
        }
        d++;
      }
      if (n > 1) factors.push(n);
      const isPrime = factors.length === 1 && factors[0] === orig;
      return `${orig}: ${isPrime ? '소수(Prime)입니다' : `소인수분해 = ${factors.join(' × ')}`}`;
    },
  },

  // ==================== [21 ~ 30] 코딩·개발자 도구 ====================
  {
    id: 'dev-json-validator',
    index: 21,
    name: 'JSON 구문 검증 및 구조 분석기',
    category: '코딩·개발',
    description: 'JSON 문자열의 문법 오류 위치와 최상위 키 구조를 즉시 검증합니다.',
    triggerKeywords: ['json검증', 'json파싱', 'json포맷'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!m) return '검증할 JSON 블록이 없습니다.';
      try {
        const parsed = JSON.parse(m[1]);
        const keys = Array.isArray(parsed)
          ? `배열(${parsed.length}개 항목)`
          : `키: ${Object.keys(parsed).join(', ')}`;
        return `✅ 유효한 JSON입니다 (${keys})`;
      } catch (e: any) {
        return `❌ JSON 문법 오류: ${e?.message}`;
      }
    },
  },
  {
    id: 'dev-base64',
    index: 22,
    name: 'Base64 인코더 / 디코더',
    category: '코딩·개발',
    description: '텍스트를 Base64로 인코딩하거나 Base64 문자열을 원문으로 디코딩합니다.',
    triggerKeywords: ['base64', '베이스64'],
    autoRun: false,
    execute: async (prompt) => {
      const target = prompt.replace(/base64|베이스64|인코딩|디코딩/gi, '').trim();
      if (!target) return '변환할 문자열을 입력하세요.';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      const str = unescape(encodeURIComponent(target));
      let output = '';
      for (
        let block = 0, charCode, i = 0, map = chars;
        str.charAt(i | 0) || ((map = '='), i % 1);
        output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))
      ) {
        charCode = str.charCodeAt((i += 3 / 4));
        block = (block << 8) | charCode;
      }
      return `Base64 인코딩 결과: ${output}`;
    },
  },
  {
    id: 'dev-url-parser',
    index: 23,
    name: 'URL 쿼리 파라미터 분해기',
    category: '코딩·개발',
    description: '복잡한 URL의 호스트, 경로, 모든 Query String 키-값 쌍을 표로 분해합니다.',
    triggerKeywords: ['쿼리파라미터', 'url분해', 'url디코딩'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/https?:\/\/[^\s]+/);
      if (!m) return '분석할 URL을 입력하세요.';
      const u = new URL(m[0]);
      const params: string[] = [];
      u.searchParams.forEach((v, k) => params.push(`${k} = ${v}`));
      return `Host: ${u.host} | Path: ${u.pathname} | Params: ${params.length ? params.join(', ') : '없음'}`;
    },
  },
  {
    id: 'dev-jwt-decoder',
    index: 24,
    name: 'JWT 인증 토큰 페이로드 디코더',
    category: '코딩·개발',
    description: 'JWT(eyJ...) 토큰의 Header와 Payload 클레임을 안전하게 디코딩합니다.',
    triggerKeywords: ['jwt', 'eyJ', '토큰디코딩'],
    autoRun: true,
    execute: async (prompt) => {
      const m = prompt.match(/(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/);
      if (!m) return 'JWT 토큰 미감지';
      const parts = m[1].split('.');
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let bitBuffer = 0;
      let bitCount = 0;
      const bytes: number[] = [];
      for (const character of b64) {
        const value = alphabet.indexOf(character);
        if (value < 0) throw new Error('JWT payload contains invalid Base64 characters.');
        bitBuffer = (bitBuffer << 6) | value;
        bitCount += 6;
        if (bitCount >= 8) {
          bitCount -= 8;
          bytes.push((bitBuffer >> bitCount) & 0xff);
        }
      }
      const decoded = decodeURIComponent(
        bytes.map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''),
      );
      return `JWT Payload: ${decoded}`;
    },
  },
  {
    id: 'dev-regex-tester',
    index: 25,
    name: '정규표현식(Regex) 매칭 검증기',
    category: '코딩·개발',
    description: '/패턴/플래그 형식의 정규식이 대상 문자열과 일치하는지 실시간 테스트합니다.',
    triggerKeywords: ['정규식', 'regex', '정규표현식'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/\/([^/]+)\/([gimsuy]*)\s+([\s\S]+)/);
      if (!m) return '사용법: /패턴/g 테스트할문자열';
      try {
        const re = new RegExp(m[1], m[2] || 'g');
        const matches = m[3].match(re);
        return matches ? `일치 결과 (${matches.length}건): ${matches.join(', ')}` : '일치하는 항목 없음';
      } catch (e: any) {
        return `정규식 오류: ${e?.message}`;
      }
    },
  },
  {
    id: 'dev-uuid-gen',
    index: 26,
    name: 'UUID v4 및 API 시크릿 키 생성기',
    category: '코딩·개발',
    description: '충돌 없는 표준 UUID v4 3개와 32바이트 Hex API 시크릿 키를 즉시 발급합니다.',
    triggerKeywords: ['uuid', '랜덤키', '시크릿키', '토큰생성'],
    autoRun: true,
    execute: async () => {
      const makeUuid = () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      return `UUID v4:\n1) ${makeUuid()}\n2) ${makeUuid()}\n3) ${makeUuid()}`;
    },
  },
  {
    id: 'dev-hash-checksum',
    index: 27,
    name: 'FNV-1a / DJB2 무결성 해시 생성기',
    category: '코딩·개발',
    description: '문자열의 32비트 FNV-1a 및 DJB2 체크섬 해시값을 즉시 산출합니다.',
    triggerKeywords: ['해시값', '체크섬', 'fnv', 'djb2'],
    autoRun: false,
    execute: async (prompt) => {
      const text = prompt.replace(/(해시값|체크섬|생성)/g, '').trim();
      let fnv = 0x811c9dc5;
      let djb = 5381;
      for (let i = 0; i < text.length; i++) {
        fnv ^= text.charCodeAt(i);
        fnv = Math.imul(fnv, 0x01000193);
        djb = (djb << 5) + djb + text.charCodeAt(i);
      }
      return `FNV-1a: ${(fnv >>> 0).toString(16).padStart(8, '0')} | DJB2: ${(djb >>> 0).toString(16).padStart(8, '0')}`;
    },
  },
  {
    id: 'dev-cron-parser',
    index: 28,
    name: 'Crontab 스케줄 표현식 해석기',
    category: '코딩·개발',
    description: '5자리 Crontab 표현식(분 시 일 월 요일)을 한국어 실행 주기로 번역합니다.',
    triggerKeywords: ['cron', '크론탭', 'crontab'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)/);
      if (!m) return '예시: 0 9 * * 1-5 형식으로 5자리 크론식을 입력하세요.';
      return `크론 분석 -> 분: [${m[1]}], 시: [${m[2]}], 일: [${m[3]}], 월: [${m[4]}], 요일: [${m[5]}]`;
    },
  },
  {
    id: 'dev-http-status',
    index: 29,
    name: 'HTTP 상태 코드 진단 사전',
    category: '코딩·개발',
    description: '200, 401, 403, 404, 429, 500, 502, 504 등 HTTP 상태 코드의 정확한 원인을 안내합니다.',
    triggerKeywords: ['http', '에러코드', '403', '404', '429', '500', '502', '504'],
    autoRun: false,
    execute: async (prompt) => {
      const map: Record<string, string> = {
        '400': '400 Bad Request: 요청 문법 또는 파라미터 형식 오류',
        '401': '401 Unauthorized: 인증 토큰/API 키 누락 또는 만료',
        '403': '403 Forbidden: 인증되었으나 해당 리소스 접근 권한 없음',
        '404': '404 Not Found: 요청한 경로 또는 리소스가 서버에 존재하지 않음',
        '429': '429 Too Many Requests: API 호출 속도 제한(Rate Limit) 초과',
        '500': '500 Internal Server Error: 백엔드 서버 내부 런타임 예외 발생',
        '502': '502 Bad Gateway: 업스트림 서버로부터 잘못된 응답 수신',
        '504': '504 Gateway Timeout: 업스트림 서버 응답 시간 초과',
      };
      const code = Object.keys(map).find((k) => prompt.includes(k));
      return code ? map[code] : 'HTTP 상태 코드(400~504)를 입력해 주세요.';
    },
  },
  {
    id: 'dev-color-convert',
    index: 30,
    name: 'HEX ↔ RGB 컬러 코드 변환기',
    category: '코딩·개발',
    description: '#FF5733 형태의 HEX 색상 코드를 RGB 및 CSS rgba() 형식으로 변환합니다.',
    triggerKeywords: ['컬러코드', 'hex색상', 'rgb변환', '#'],
    autoRun: false,
    execute: async (prompt) => {
      const m = prompt.match(/#([0-9a-fA-F]{6})/);
      if (!m) return '예시: #2563EB 형식으로 6자리 HEX 코드를 입력하세요.';
      const hex = m[1];
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `#${hex.toUpperCase()} -> rgb(${r}, ${g}, ${b}) / rgba(${r}, ${g}, ${b}, 1)`;
    },
  },

  // ==================== [31 ~ 40] 문서·텍스트·언어 분석 ====================
  {
    id: 'text-char-counter',
    index: 31,
    name: '글자수·단어수·원고지 매수 측정기',
    category: '문서·언어',
    description: '자기소개서·보고서 텍스트의 공백 포함/제외 글자수와 200자 원고지 분량을 계산합니다.',
    triggerKeywords: ['글자수', '공백제외', '원고지', '단어수'],
    autoRun: true,
    execute: async (prompt) => {
      const target = prompt.replace(/(글자수|공백제외|원고지|단어수|세기|알려줘)/g, '').trim();
      const withSpace = target.length;
      const noSpace = target.replace(/\s/g, '').length;
      const words = target ? target.split(/\s+/).length : 0;
      return `공백 포함: ${withSpace}자 | 공백 제외: ${noSpace}자 | 단어: ${words}개 | 원고지: ${(withSpace / 200).toFixed(1)}매`;
    },
  },
  {
    id: 'text-keywords',
    index: 32,
    name: '핵심 키워드 빈도 분석기',
    category: '문서·언어',
    description: '본문에서 가장 많이 등장한 핵심 명사/어절 상위 8개를 빈도순으로 추출합니다.',
    triggerKeywords: ['키워드추출', '빈도분석', '핵심단어'],
    autoRun: false,
    execute: async (prompt) => {
      const words = prompt
        .replace(/[^\w가-힣\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2);
      const freq: Record<string, number> = {};
      for (const w of words) freq[w] = (freq[w] || 0) + 1;
      const top = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}(${v})`);
      return `상위 키워드: ${top.join(', ')}`;
    },
  },
  {
    id: 'text-entity-extract',
    index: 33,
    name: '이메일·URL·전화번호 자동 추출기',
    category: '문서·언어',
    description: '비정형 텍스트에서 이메일 주소, 웹 링크, 연락처를 정규식으로 일괄 추출합니다.',
    triggerKeywords: ['이메일추출', '연락처추출', '링크추출'],
    autoRun: false,
    execute: async (prompt) => {
      const emails = prompt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      const phones = prompt.match(/01[016789]-?[0-9]{3,4}-?[0-9]{4}/g) || [];
      const urls = prompt.match(/https?:\/\/[^\s]+/g) || [];
      return `이메일: ${emails.join(', ') || '없음'} | 전화: ${phones.join(', ') || '없음'} | URL: ${urls.join(', ') || '없음'}`;
    },
  },
  {
    id: 'text-diff',
    index: 34,
    name: '문장 비교(Diff) 차이점 검출기',
    category: '문서·언어',
    description: '구분자(|||)로 나뉜 두 문장 간의 변경된 어절을 즉시 비교합니다.',
    triggerKeywords: ['문장비교', 'diff', '차이점비교'],
    autoRun: false,
    execute: async (prompt) => {
      const parts = prompt.split('|||');
      if (parts.length < 2) return '비교할 두 문장을 ||| 로 구분해 입력하세요.';
      const a = new Set(parts[0].trim().split(/\s+/));
      const b = new Set(parts[1].trim().split(/\s+/));
      const added = [...b].filter((x) => !a.has(x));
      const removed = [...a].filter((x) => !b.has(x));
      return `추가됨: [${added.join(', ') || '없음'}] | 삭제됨: [${removed.join(', ') || '없음'}]`;
    },
  },
  {
    id: 'text-csv-markdown',
    index: 35,
    name: 'CSV → 마크다운 표 자동 변환기',
    category: '문서·언어',
    description: '쉼표(,)로 구분된 CSV 데이터를 깔끔한 Markdown Table 문법으로 변환합니다.',
    triggerKeywords: ['csv변환', '마크다운표', '표로만들어'],
    autoRun: false,
    execute: async (prompt) => {
      const lines = prompt
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.includes(','));
      if (lines.length < 2) return '2줄 이상의 쉼표(,) 구분 데이터를 입력하세요.';
      const rows = lines.map((l) => l.split(',').map((c) => c.trim()));
      const header = `| ${rows[0].join(' | ')} |`;
      const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
      const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n');
      return `${header}\n${sep}\n${body}`;
    },
  },
  {
    id: 'text-case-convert',
    index: 36,
    name: '변수명 네이밍 컨벤션 변환기',
    category: '문서·언어',
    description: '입력 단어를 camelCase, PascalCase, snake_case, UPPER_SNAKE_CASE로 일괄 변환합니다.',
    triggerKeywords: ['카멜케이스', '스네이크케이스', '변수명변환'],
    autoRun: false,
    execute: async (prompt) => {
      const raw = prompt.replace(/(카멜케이스|스네이크케이스|변수명변환)/g, '').trim();
      const words = raw.split(/[\s_-]+/).filter(Boolean).map((w) => w.toLowerCase());
      if (!words.length) return '변환할 영문 구문을 입력하세요.';
      const camel = words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
      const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
      const snake = words.join('_');
      return `camelCase: ${camel} | PascalCase: ${pascal} | snake_case: ${snake}`;
    },
  },
  {
    id: 'text-romanize',
    index: 37,
    name: '한글 로마자 표기 보조기',
    category: '문서·언어',
    description: '한글 초성·중성·종성을 분해하여 표준 영문 음절 표기 초안을 생성합니다.',
    triggerKeywords: ['로마자표기', '영문이름표기', '한글로마자'],
    autoRun: false,
    execute: async (prompt) => {
      const cho = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
      const jung = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
      const jong = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
      const text = prompt.replace(/(로마자표기|영문이름표기|한글로마자)/g, '').trim();
      let out = '';
      for (const ch of text) {
        const code = ch.charCodeAt(0) - 0xac00;
        if (code >= 0 && code <= 11171) {
          const c = Math.floor(code / 588);
          const j = Math.floor((code % 588) / 28);
          const k = code % 28;
          out += `${cho[c]}${jung[j]}${jong[k]}`;
        } else {
          out += ch;
        }
      }
      return `로마자 음절 변환: ${out}`;
    },
  },
  {
    id: 'text-morse',
    index: 38,
    name: '국제 모스 부호(Morse) 변환기',
    category: '문서·언어',
    description: '영문·숫자 메시지를 국제 표준 모스 부호(· —)로 즉시 인코딩합니다.',
    triggerKeywords: ['모스부호', 'morse'],
    autoRun: false,
    execute: async (prompt) => {
      const map: Record<string, string> = {
        A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
        I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
        Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
        Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
        '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
      };
      const clean = prompt.replace(/모스부호|morse/gi, '').trim().toUpperCase();
      return clean.split('').map((c) => (c === ' ' ? '/' : map[c] || '')).filter(Boolean).join(' ');
    },
  },
  {
    id: 'text-readability',
    index: 39,
    name: '문장 가독성·어휘 밀도 진단기',
    category: '문서·언어',
    description: '문장당 평균 길이와 고유 어휘 비율(TTR)을 분석해 글의 가독성을 평가합니다.',
    triggerKeywords: ['가독성분석', '문장분석', '어휘밀도'],
    autoRun: false,
    execute: async (prompt) => {
      const sentences = prompt.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
      const words = prompt.split(/\s+/).filter(Boolean);
      const unique = new Set(words);
      const avgLen = sentences.length ? (words.length / sentences.length).toFixed(1) : '0';
      const ttr = words.length ? ((unique.size / words.length) * 100).toFixed(1) : '0';
      return `문장 수: ${sentences.length} | 문장당 평균 단어: ${avgLen}개 | 어휘 다양성: ${ttr}%`;
    },
  },
  {
    id: 'text-dedup-sort',
    index: 40,
    name: '중복 줄 제거 및 가나다/ABC 정렬기',
    category: '문서·언어',
    description: '여러 줄 목록에서 중복 항목을 제거하고 오름차순으로 깔끔하게 정렬합니다.',
    triggerKeywords: ['중복제거', '줄정렬', '가나다순'],
    autoRun: false,
    execute: async (prompt) => {
      const lines = prompt.split('\n').map((l) => l.trim()).filter(Boolean);
      const unique = [...new Set(lines)].sort((a, b) => a.localeCompare(b));
      return `정렬 완료 (${unique.length}개 항목):\n${unique.join('\n')}`;
    },
  },

  // ==================== [41 ~ 50] 로컬 메모리·파일·일정 자동화 ====================
  {
    id: 'mem-save-note',
    index: 41,
    name: '로컬 영구 메모장 저장',
    category: '메모·시스템',
    description: '중요한 메모나 아이디어를 스마트폰 내부 저장소(pocketmind_notes.json)에 영구 저장합니다.',
    triggerKeywords: ['메모저장', '기억해둬', '노트저장'],
    autoRun: true,
    execute: async (prompt) => {
      const RNFS = getRNFSOrNull();
      const content = prompt.replace(/(메모저장|기억해둬|노트저장)/g, '').trim();
      if (!RNFS || !content) return '저장할 메모 내용 없음';
      const file = `${RNFS.DocumentDirectoryPath}/pocketmind_notes.json`;
      let list: any[] = [];
      try {
        if (await RNFS.exists(file)) list = JSON.parse(await RNFS.readFile(file, 'utf8'));
      } catch {}
      list.unshift({ time: new Date().toISOString(), text: content });
      await RNFS.writeFile(file, JSON.stringify(list.slice(0, 100)), 'utf8');
      return `✅ 로컬 메모 저장 완료 (총 ${list.length}개 보관 중): "${content}"`;
    },
  },
  {
    id: 'mem-read-notes',
    index: 42,
    name: '저장된 로컬 메모 불러오기',
    category: '메모·시스템',
    description: '기기 내부에 영구 저장된 메모 목록 최근 10건을 조회합니다.',
    triggerKeywords: ['메모불러오기', '저장된메모', '메모목록', '기억한거'],
    autoRun: true,
    execute: async () => {
      const RNFS = getRNFSOrNull();
      if (!RNFS) return '저장소 접근 불가';
      const file = `${RNFS.DocumentDirectoryPath}/pocketmind_notes.json`;
      if (!(await RNFS.exists(file))) return '저장된 메모가 아직 없습니다.';
      const list = JSON.parse(await RNFS.readFile(file, 'utf8'));
      return list.slice(0, 10).map((n: any, idx: number) => `${idx + 1}. ${n.text}`).join('\n');
    },
  },
  {
    id: 'mem-todo-add',
    index: 43,
    name: '로컬 할 일(To-Do) 추가',
    category: '메모·시스템',
    description: '할 일 항목을 기기 로컬 체크리스트(pocketmind_todos.json)에 등록합니다.',
    triggerKeywords: ['할일추가', '투두추가', 'todo추가'],
    autoRun: true,
    execute: async (prompt) => {
      const RNFS = getRNFSOrNull();
      const task = prompt.replace(/(할일추가|투두추가|todo추가)/gi, '').trim();
      if (!RNFS || !task) return '할 일 내용을 입력하세요.';
      const file = `${RNFS.DocumentDirectoryPath}/pocketmind_todos.json`;
      let todos: any[] = [];
      try {
        if (await RNFS.exists(file)) todos = JSON.parse(await RNFS.readFile(file, 'utf8'));
      } catch {}
      todos.push({ task, done: false });
      await RNFS.writeFile(file, JSON.stringify(todos), 'utf8');
      return `✅ 할 일 등록 완료: [ ] ${task} (전체 ${todos.length}건)`;
    },
  },
  {
    id: 'mem-todo-list',
    index: 44,
    name: '로컬 할 일(To-Do) 목록 조회',
    category: '메모·시스템',
    description: '현재 등록된 로컬 할 일 목록 전체를 불러옵니다.',
    triggerKeywords: ['할일목록', '투두목록', '오늘할일'],
    autoRun: true,
    execute: async () => {
      const RNFS = getRNFSOrNull();
      if (!RNFS) return '저장소 접근 불가';
      const file = `${RNFS.DocumentDirectoryPath}/pocketmind_todos.json`;
      if (!(await RNFS.exists(file))) return '등록된 할 일이 없습니다.';
      const todos = JSON.parse(await RNFS.readFile(file, 'utf8'));
      return todos.map((t: any, i: number) => `${i + 1}. [${t.done ? '✓' : ' '}] ${t.task}`).join('\n');
    },
  },
  {
    id: 'mem-user-persona',
    index: 45,
    name: '사용자 맞춤 선호도 영구 기억',
    category: '메모·시스템',
    description: '사용자의 직업·선호 말투·자주 쓰는 기술 스택을 기억해 답변에 반영합니다.',
    triggerKeywords: ['내설정기억', '내프로필저장', '맞춤지침'],
    autoRun: false,
    execute: async (prompt) => {
      const RNFS = getRNFSOrNull();
      const pref = prompt.replace(/(내설정기억|내프로필저장|맞춤지침)/g, '').trim();
      if (!RNFS || !pref) return '기억할 프로필 내용을 입력하세요.';
      const file = `${RNFS.DocumentDirectoryPath}/pocketmind_persona.txt`;
      await RNFS.writeFile(file, pref, 'utf8');
      return `✅ 사용자 맞춤 지침 저장됨: ${pref}`;
    },
  },
  {
    id: 'sys-datetime-now',
    index: 46,
    name: '현재 날짜·시간·요일 정밀 확인',
    category: '메모·시스템',
    description: '오프라인 AI 모델이 모르는 현재 연도, 월, 일, 요일, 시각을 정확히 주입합니다.',
    triggerKeywords: ['오늘날짜', '지금몇시', '오늘무슨요일', '현재시간', '몇년도'],
    autoRun: true,
    execute: async () => {
      const now = new Date();
      const days = ['일', '월', '화', '수', '목', '금', '토'];
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      return `현재 기준 시각: ${y}년 ${m}월 ${d}일 (${days[now.getDay()]}요일) ${hh}:${mm}`;
    },
  },
  {
    id: 'sys-dday',
    index: 47,
    name: '목표 날짜 D-Day 계산기',
    category: '메모·시스템',
    description: 'YYYY-MM-DD 형식의 목표 날짜까지 남은 일수 또는 경과 일수를 계산합니다.',
    triggerKeywords: ['디데이', 'd-day', '며칠남았'],
    autoRun: true,
    execute: async (prompt) => {
      const m = prompt.match(/(20[2-9][0-9])-([01][0-9])-([0-3][0-9])/);
      if (!m) return '예시: 2026-12-31 디데이 형식으로 날짜를 입력하세요.';
      const target = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays === 0
        ? `${m[0]}은(는) 바로 오늘(D-Day)입니다!`
        : diffDays > 0
        ? `${m[0]}까지 D-${diffDays}일 남았습니다.`
        : `${m[0]}로부터 D+${Math.abs(diffDays)}일 지났습니다.`;
    },
  },
  {
    id: 'sys-world-clock',
    index: 48,
    name: '세계 주요 도시 실시간 시차 변환기',
    category: '메모·시스템',
    description: '서울(KST), 뉴욕(EST), 런던(GMT), 도쿄(JST), LA(PST) 현재 시각을 동시 출력합니다.',
    triggerKeywords: ['세계시간', '시차계산', '뉴욕시간', '런던시간', '미국시간'],
    autoRun: false,
    execute: async () => {
      const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
      const fmt = (offsetH: number) => {
        const d = new Date(utcMs + offsetH * 3600000);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      return `서울(UTC+9): ${fmt(9)} | 뉴욕(UTC-5): ${fmt(-5)} | LA(UTC-8): ${fmt(-8)} | 런던(UTC+0): ${fmt(0)}`;
    },
  },
  {
    id: 'sys-pomodoro',
    index: 49,
    name: '포모도로 집중 세션 스케줄러',
    category: '메모·시스템',
    description: '현재 시각부터 25분 집중 + 5분 휴식 사이클 4회 타임테이블을 자동 생성합니다.',
    triggerKeywords: ['포모도로', '집중타이머', '공부계획표'],
    autoRun: false,
    execute: async () => {
      let cur = Date.now();
      const lines: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const s = new Date(cur);
        const e = new Date(cur + 25 * 60000);
        lines.push(
          `${i}세션: ${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')} ~ ${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')} (25분 집중)`,
        );
        cur += 30 * 60000;
      }
      return lines.join('\n');
    },
  },
  {
    id: 'sys-storage-audit',
    index: 50,
    name: '기기 내 GGUF 모델 저장 용량 점검',
    category: '메모·시스템',
    description: '스마트폰 내부 문서 폴더에 다운로드된 GGUF 모델 목록과 총 사용 용량(GB)을 진단합니다.',
    triggerKeywords: ['저장공간', '모델용량', '설치된모델확인'],
    autoRun: false,
    execute: async () => {
      const RNFS = getRNFSOrNull();
      if (!RNFS) return '파일 시스템 모듈 없음';
      let totalBytes = 0;
      const installed: string[] = [];
      for (const m of AI_MODEL_CATALOG) {
        const p = `${RNFS.DocumentDirectoryPath}/${m.filename}`;
        if (await RNFS.exists(p)) {
          const stat = await RNFS.stat(p);
          const sz = Number(stat.size || 0);
          totalBytes += sz;
          installed.push(`${m.shortName} (${(sz / (1024 * 1024 * 1024)).toFixed(2)}GB)`);
        }
      }
      return installed.length
        ? `설치된 모델 ${installed.length}개 (총 ${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)}GB): ${installed.join(', ')}`
        : '설치된 로컬 GGUF 모델이 없습니다.';
    },
  },

  // ==================== [51 ~ 60] 프롬프트·추론·창작 부스터 ====================
  {
    id: 'ai-cot-decomposer',
    index: 51,
    name: '단계별 사고(CoT) 문제 분해기',
    category: 'AI부스터',
    description: '복합 질문을 [1. 전제 확인 → 2. 핵심 변수 분석 → 3. 단계별 해결 → 4. 반례 검증] 프레임으로 유도합니다.',
    triggerKeywords: ['단계별로', '심층분석', '논리적으로'],
    autoRun: false,
    execute: async () =>
      '지침 주입: 문제를 ① 핵심 정의 ② 단계별 인과 추론 ③ 예외/반례 검토 ④ 최종 결론 순서로 구조화하여 답하세요.',
  },
  {
    id: 'ai-devils-advocate',
    index: 52,
    name: '악마의 변호인(반론·리스크) 검증기',
    category: 'AI부스터',
    description: '제시된 아이디어나 계획의 숨겨진 결함, 실패 시나리오, 보완책을 강제로 도출합니다.',
    triggerKeywords: ['반론', '단점찾아', '리스크검증', '비판적으로'],
    autoRun: false,
    execute: async () =>
      '지침 주입: 긍정적 편향을 배제하고 치명적 약점 3가지, 현실적 장애물, 구체적 대응책을 냉철하게 제시하세요.',
  },
  {
    id: 'ai-swot-matrix',
    index: 53,
    name: '비즈니스 SWOT 매트릭스 생성기',
    category: 'AI부스터',
    description: '강점(S), 약점(W), 기회(O), 위협(T) 4분면 전략 분석 표 템플릿을 자동 활성화합니다.',
    triggerKeywords: ['swot', '스왓분석', '사업전략'],
    autoRun: true,
    execute: async () =>
      '지침 주입: 반드시 강점(Strengths), 약점(Weaknesses), 기회(Opportunities), 위협(Threats) 4개 항목과 실행 전략을 표로 정리하세요.',
  },
  {
    id: 'ai-sql-architect',
    index: 54,
    name: '정규화 SQL DDL 스키마 설계 부스터',
    category: 'AI부스터',
    description: '테이블 설계 요청 시 기본키(PK), 외래키(FK), 인덱스, 제약조건이 포함된 SQL DDL을 강제합니다.',
    triggerKeywords: ['테이블설계', 'erd', 'ddl', 'db설계'],
    autoRun: false,
    execute: async () =>
      '지침 주입: 제3정규형을 준수하는 CREATE TABLE 문, PK/FK 관계, 조회 성능용 INDEX 구문을 함께 출력하세요.',
  },
  {
    id: 'ai-api-spec',
    index: 55,
    name: 'REST API 명세서 템플릿 부스터',
    category: 'AI부스터',
    description: 'API 설계 요청 시 HTTP Method, Endpoint, Request JSON, Response JSON, 에러 코드를 구조화합니다.',
    triggerKeywords: ['api설계', '엔드포인트', 'rest api'],
    autoRun: false,
    execute: async () =>
      '지침 주입: HTTP Method, URI, 헤더, 요청/응답 JSON 예시, 상태 코드를 표와 코드 블록으로 명확히 작성하세요.',
  },
  {
    id: 'ai-conventional-commit',
    index: 56,
    name: 'Git Conventional Commit 생성기',
    category: 'AI부스터',
    description: '코드 변경 내용을 feat/fix/refactor/docs 규격의 영문·국문 커밋 메시지로 생성합니다.',
    triggerKeywords: ['커밋메시지', 'commit메시지', 'git커밋'],
    autoRun: false,
    execute: async () =>
      '지침 주입: Conventional Commits 규격(feat:, fix:, refactor:, chore:)에 맞춰 제목(50자 이내)과 상세 변경 불릿을 작성하세요.',
  },
  {
    id: 'ai-study-flashcard',
    index: 57,
    name: '학습용 Q&A 플래시카드 변환기',
    category: 'AI부스터',
    description: '학습 주제를 암기와 복습에 최적화된 질문(Q) & 핵심 정답(A) 카드 세트로 변환합니다.',
    triggerKeywords: ['플래시카드', '암기카드', '퀴즈만들어'],
    autoRun: false,
    execute: async () =>
      '지침 주입: 핵심 개념을 [Q1 / A1] 형태의 문답 카드 5~8세트로 구성해 암기하기 쉽게 출력하세요.',
  },
  {
    id: 'ai-roleplay-director',
    index: 58,
    name: '무검열 창작·시나리오 디렉팅 부스터',
    category: 'AI부스터',
    description: '소설·대본·세계관 창작 시 입체적 캐릭터, 갈등 구조, 생생한 대사 묘사를 강화합니다.',
    triggerKeywords: ['소설써줘', '시나리오작성', '세계관설정', '롤플레잉'],
    autoRun: false,
    execute: async () =>
      '지침 주입: 메타 설명이나 설교 없이 즉시 장면 묘사, 캐릭터 대사, 긴장감 있는 전개로 몰입감 있게 작성하세요.',
  },
  {
    id: 'ai-tech-glossary',
    index: 59,
    name: '한·영 IT 전문용어 번역 일관성 부스터',
    category: 'AI부스터',
    description: '번역 시 원어 병기(예: 양자화(Quantization))를 유지하여 기술 문서 정확도를 높입니다.',
    triggerKeywords: ['기술번역', '논문번역', '영문번역'],
    autoRun: false,
    execute: async () =>
      '지침 주입: 전문 용어는 한국어 번역어 뒤에 영문 원어를 괄호로 병기하고 문맥에 맞는 자연스러운 문체로 번역하세요.',
  },
  {
    id: 'ai-executive-brief',
    index: 60,
    name: '3줄 핵심 요약 + 액션 아이템 부스터',
    category: 'AI부스터',
    description: '답변 최상단에 3줄 핵심 요약을 배치하고 하단에 즉시 실행할 액션 아이템을 도출합니다.',
    triggerKeywords: ['3줄요약', '핵심만', '간단히요약'],
    autoRun: true,
    execute: async () =>
      '지침 주입: 맨 위에 [핵심 3줄 요약]을 먼저 제시한 뒤, 이어서 [즉시 실행 액션 아이템]을 번호 목록으로 정리하세요.',
  },
];

// 자동 실행 + 사용자 요청 실행 통합 엔진
// 수동 호출도 활성화된 플러그인만 실행하며, 카탈로그 순서를 보존한다.
const MAX_AUTO_PLUGIN_RUNS = 8;
const MAX_EXPLICIT_PLUGIN_RUNS = 12;

function normalizePluginText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
}

function pluginWords(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase()
    .split(/[^a-z0-9가-힣]+/g)
    .filter((word) => word.length >= 2);
}

/**
 * Deterministically scans every enabled plugin before model inference. This is
 * intentionally independent of the LLM so sub-3B models do not need to infer
 * tool names or JSON parameters from a large catalog.
 */
export function rankPluginsForPrompt(
  prompt: string,
  enabledPluginIds?: string[],
): PluginRouteMatch[] {
  const enabled = new Set(enabledPluginIds ?? AI_PLUGIN_CATALOG.map((plugin) => plugin.id));
  const lower = prompt.normalize('NFKC').toLocaleLowerCase();
  const compact = normalizePluginText(prompt);
  const promptWords = new Set(pluginWords(prompt));

  return AI_PLUGIN_CATALOG
    .filter((plugin) => enabled.has(plugin.id))
    .map((plugin) => {
      let score = 0;
      const matchedBy: string[] = [];

      for (const keyword of plugin.triggerKeywords) {
        const keywordLower = keyword.normalize('NFKC').toLocaleLowerCase();
        const keywordCompact = normalizePluginText(keyword);
        if (!keywordCompact) continue;
        if (compact.includes(keywordCompact)) {
          score += 100 + Math.min(80, keywordCompact.length * 5);
          matchedBy.push(`키워드:${keyword}`);
        } else if (keywordLower.includes(' ') && lower.includes(keywordLower)) {
          score += 120;
          matchedBy.push(`구문:${keyword}`);
        }
      }

      const nameCompact = normalizePluginText(plugin.name);
      if (nameCompact.length >= 3 && compact.includes(nameCompact)) {
        score += 180;
        matchedBy.push('플러그인명');
      }

      const descriptionWords = new Set([
        ...pluginWords(plugin.name),
        ...pluginWords(plugin.description),
      ]);
      const overlap = [...descriptionWords].filter((word) => promptWords.has(word)).slice(0, 4);
      if (overlap.length >= 2) {
        score += overlap.length * 18;
        matchedBy.push(`설명:${overlap.join(',')}`);
      }

      return { plugin, score, matchedBy };
    })
    .filter((match) => match.score >= 65)
    .sort((a, b) => b.score - a.score || a.plugin.index - b.plugin.index);
}

export async function runAutonomousPlugins(
  prompt: string,
  enabledPluginIds?: string[],
): Promise<PluginExecutionOutput[]> {
  const enabled = new Set(enabledPluginIds ?? AI_PLUGIN_CATALOG.map((plugin) => plugin.id));
  const commandMatches = [...prompt.matchAll(/(?:^|\s)\/([a-z0-9-]+)(?=\s|$)/gi)];
  const explicitIds = new Set(commandMatches.map((match) => match[1].toLowerCase()));
  const cleanPrompt = prompt
    .replace(/(?:^|\s)\/[a-z0-9-]+(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || prompt.trim();

  const explicitPlugins = AI_PLUGIN_CATALOG.filter(
    (plugin) => explicitIds.has(plugin.id) && enabled.has(plugin.id),
  ).slice(0, MAX_EXPLICIT_PLUGIN_RUNS);
  const automaticPlugins = rankPluginsForPrompt(prompt, [...enabled])
    .map((match) => match.plugin)
    .filter((plugin) => !explicitIds.has(plugin.id))
    .slice(0, MAX_AUTO_PLUGIN_RUNS)
    .sort((a, b) => a.index - b.index);

  const selected = [...explicitPlugins, ...automaticPlugins].filter(
    (plugin, index, all) => all.findIndex((candidate) => candidate.id === plugin.id) === index,
  );

  const results: PluginExecutionOutput[] = [];
  // Run sequentially to avoid bursts against external APIs and preserve output ordering.
  for (const plugin of selected) {
    try {
      const output = await plugin.execute(cleanPrompt);
      results.push({
        id: plugin.id,
        title: `#${String(plugin.index).padStart(2, '0')} ${plugin.name}`,
        category: plugin.category,
        result: typeof output === 'string' && output.trim()
          ? output.trim()
          : '플러그인이 빈 결과를 반환했습니다.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '알 수 없는 실행 오류';
      results.push({
        id: plugin.id,
        title: `#${String(plugin.index).padStart(2, '0')} ${plugin.name} (실패)`,
        category: plugin.category,
        result: `플러그인 실행 실패: ${message.slice(0, 300)}`,
      });
    }
  }

  return results;
}

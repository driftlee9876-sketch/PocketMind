import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { initLlama, LlamaContext } from 'llama.rn';

let NetInfoModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NetInfoModule = require('@react-native-community/netinfo').default;
} catch {
  NetInfoModule = null;
}

type ModelKey = 'allrounder' | 'math' | 'korean';
type SelectionMode = 'auto' | ModelKey;
type PromptFormat = 'chatml' | 'exaone';
type PluginKey = 'calculator' | 'url_reader' | 'datetime_tool' | 'clipboard_reader';

interface WebSearchSource {
  title: string;
  snippet: string;
  url: string;
}

interface PluginSpec {
  key: PluginKey;
  icon: string;
  title: string;
  desc: string;
  requiresInternet: boolean;
}

interface SuggestionItem {
  badge: string;
  title: string;
  desc: string;
  prompt: string;
}

interface ModelSpec {
  key: ModelKey;
  badge: string;
  badgeColor: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  sizeLabel: string;
  expectedBytes: number;
  minBytes: number;
  filename: string;
  url: string;
  promptFormat: PromptFormat;
  systemPrompt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  orchestrationLabel?: string;
  pluginBadges?: string[];
  webSources?: WebSearchSource[];
  stage1Title?: string;
  stage1Content?: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ExecutionStep {
  modelKey: ModelKey;
  roleTitle: string;
  instructionHint: string;
}

interface ExecutionPlan {
  summaryLabel: string;
  steps: ExecutionStep[];
}

const MODELS: Record<ModelKey, ModelSpec> = {
  allrounder: {
    key: 'allrounder',
    badge: '올라운더 8B',
    badgeColor: '#10A37F',
    title: 'Qwen3 8B (올라운더)',
    shortTitle: 'Qwen3 8B',
    subtitle: '아이폰 16 Pro 최적 · 코딩·추론·요약 플래그십 균형 모델',
    sizeLabel: '5.03 GB',
    expectedBytes: 5027783488,
    minBytes: 2500 * 1024 * 1024,
    filename: 'Qwen3-8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    promptFormat: 'chatml',
    systemPrompt:
      '당신은 아이폰 16 Pro 온디바이스 환경에서 동작하는 플래그십 AI 어시스턴트 PocketMind입니다. 한국어로 명확하고 깊이 있게 답변하며, 코드는 마크다운 코드 블록으로 감싸서 제공하세요.',
  },
  math: {
    key: 'math',
    badge: '수학·논리 7B',
    badgeColor: '#3B82F6',
    title: 'Qwen2.5-Math 7B',
    shortTitle: 'Math 7B',
    subtitle: '고난도 방정식·미적분·확률·단계별 수리 증명 특화 모델',
    sizeLabel: '4.68 GB',
    expectedBytes: 4680000000,
    minBytes: 2300 * 1024 * 1024,
    filename: 'Qwen2.5-Math-7B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen2.5-Math-7B-Instruct-GGUF/resolve/main/Qwen2.5-Math-7B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
    systemPrompt:
      '당신은 수학 및 수리 논리 추론 전문 AI입니다. 모든 수리 문제는 풀이 과정을 단계별(Step-by-step)로 엄밀하게 전개하고 검산한 뒤 최종 정답을 명확히 도출하세요.',
  },
  korean: {
    key: 'korean',
    badge: '한국어 7.8B',
    badgeColor: '#A855F7',
    title: 'LG EXAONE 3.5 7.8B',
    shortTitle: 'EXAONE 7.8B',
    subtitle: 'LG AI 연구원 7.8B · 최상급 한국어 작문·윤문·문맥 이해',
    sizeLabel: '4.77 GB',
    expectedBytes: 4770000000,
    minBytes: 2300 * 1024 * 1024,
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    promptFormat: 'exaone',
    systemPrompt:
      '당신은 LG AI Research에서 개발한 한국어 특화 언어모델 EXAONE입니다. 유려하고 정확한 한국어 문장과 어휘를 구사하며, 사용자의 의도를 깊이 파악해 품격 있고 논리적으로 답변합니다.',
  },
};

const MODEL_ORDER: ModelKey[] = ['allrounder', 'math', 'korean'];

const PLUGINS: PluginSpec[] = [
  {
    key: 'calculator',
    icon: '🧮',
    title: '정밀 수식 계산기',
    desc: '사칙연산·거듭제곱·삼각함수·로그를 오차 없이 선계산해 AI 추론 정확도 보강',
    requiresInternet: false,
  },
  {
    key: 'url_reader',
    icon: '🔗',
    title: '웹페이지 URL 요약기',
    desc: '메시지에 포함된 https:// 링크의 본문을 직접 읽어 요약·분석 (온라인 전용)',
    requiresInternet: true,
  },
  {
    key: 'datetime_tool',
    icon: '📅',
    title: '현재 시각 · D-Day 엔진',
    desc: '정확한 한국 표준시(KST) 날짜·요일 및 D-Day 일수 계산 제공',
    requiresInternet: false,
  },
  {
    key: 'clipboard_reader',
    icon: '📋',
    title: '클립보드 스마트 분석',
    desc: '복사해 둔 텍스트를 입력창에 원탭으로 불러와 요약·번역·교정',
    requiresInternet: false,
  },
];

const AUTO_SUGGESTIONS: SuggestionItem[] = [
  {
    badge: '🌐 웹 검색 + EXAONE 7.8B',
    title: '실시간 최신 이슈 검색 및 요약',
    desc: '인터넷 연결 시 최신 웹 정보를 검색해 한국어로 깔끔하게 정리',
    prompt: '오늘 대한민국 주요 IT 및 경제 뉴스 핵심 이슈 3가지를 검색해서 요약해 줘.',
  },
  {
    badge: '복합 협업 · Math + EXAONE',
    title: '수리 분석 + 한국어 결과 보고서',
    desc: 'Math 7B가 확률·기댓값을 계산하고 EXAONE 7.8B가 보고서로 정리',
    prompt:
      '연이율 4.5% 월복리로 매월 50만 원씩 5년간 적립할 때 만기 원리금 합계를 단계별로 계산하고, 이 결과를 바탕으로 재테크 초보자를 위한 친절한 한국어 안내 보고서를 작성해 줘.',
  },
  {
    badge: '복합 협업 · Qwen3 + EXAONE',
    title: '알고리즘 코드 설계 + 한국어 기획서',
    desc: 'Qwen3 8B가 파이썬 코드를 작성하고 EXAONE이 도입 제안서로 윤문',
    prompt:
      '대용량 CSV 로그에서 이상 징후를 탐지하는 파이썬 코드 구조를 설계하고, 팀장에게 제출할 한국어 도입 제안서 형식으로 깔끔하게 정리해 줘.',
  },
  {
    badge: '플러그인 · 정밀 계산 + Math 7B',
    title: '복합 수식 계산 및 미적분 풀이',
    desc: '정밀 계산기 플러그인과 Math 7B가 결합해 오차 없는 수리 풀이 제공',
    prompt:
      '함수 f(x) = x^4 - 4x^3 + 4x^2 + 3의 극댓값과 극솟값을 미분을 이용해 단계별로 구하고 그래프의 개형을 설명해 줘.',
  },
];

const STORAGE_SESSIONS_KEY = '@pocketmind_sessions_v4';
const STORAGE_MODE_KEY = '@pocketmind_selection_mode_v4';
const STORAGE_SETTINGS_KEY = '@pocketmind_settings_v4';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(295, SCREEN_WIDTH * 0.8);

interface ContentBlock {
  type: 'text' | 'code';
  language?: string;
  content: string;
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function cleanModelOutput(raw: string): string {
  return raw.replace(/<think>\s*<\/think>/g, '').trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '));
}

function safeEvaluateMath(promptText: string): string | null {
  const candidates = promptText.match(/[0-9().+\-*/%^ ]{3,}/g);
  if (!candidates) return null;

  const validExpr = candidates
    .map((c) => c.trim())
    .find((c) => /\d+\s*[+\-*/%^]\s*\d+/.test(c));
  if (!validExpr) return null;

  const sanitized = validExpr.replace(/\^/g, '**').replace(/%/g, '/100');
  if (!/^[0-9().+\-*/\s]+$/.test(sanitized)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();
    if (typeof result === 'number' && Number.isFinite(result)) {
      const rounded = Number.isInteger(result)
        ? String(result)
        : Number(result.toFixed(6)).toString();
      return `${validExpr} = ${rounded}`;
    }
  } catch {
    return null;
  }
  return null;
}

function getKoreanDateTimeContext(): string {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const dayName = days[kst.getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${dayName}요일) ${hh}:${mm} KST`;
}

async function performLiveWebSearch(query: string): Promise<WebSearchSource[]> {
  const results: WebSearchSource[] = [];
  const cleanedQuery = query
    .replace(/(검색해서|검색해\s*줘|검색해|알려줘|알려\s*줘|요약해\s*줘|찾아줘)/g, '')
    .trim();
  const searchQuery = cleanedQuery.length >= 2 ? cleanedQuery : query;

  // 1. DuckDuckGo HTML 검색
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const res = await fetch(ddgUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const html = await res.text();
      const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const titles: Array<{ url: string; title: string }> = [];
      const snippets: string[] = [];

      let tMatch: RegExpExecArray | null;
      while ((tMatch = titleRegex.exec(html)) !== null && titles.length < 4) {
        titles.push({
          url: decodeHtmlEntities(tMatch[1]),
          title: stripHtmlTags(tMatch[2]),
        });
      }

      let sMatch: RegExpExecArray | null;
      while ((sMatch = snippetRegex.exec(html)) !== null && snippets.length < 4) {
        snippets.push(stripHtmlTags(sMatch[1]));
      }

      for (let i = 0; i < titles.length; i++) {
        if (titles[i].title && snippets[i]) {
          results.push({
            title: titles[i].title,
            snippet: snippets[i],
            url: titles[i].url,
          });
        }
      }
    }
  } catch {
    // DuckDuckGo 실패 시 위키백과 API 폴백으로 이어짐
  }

  // 2. 한국어 위키백과 검색 API (보강 및 폴백)
  if (results.length < 2) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const wikiUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchQuery,
      )}&srlimit=3&utf8=&format=json`;
      const res = await fetch(wikiUrl, { signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        const json = await res.json();
        const items = json?.query?.search ?? [];
        for (const item of items) {
          if (results.length >= 4) break;
          const cleanSnippet = stripHtmlTags(item.snippet || '');
          if (item.title && cleanSnippet) {
            results.push({
              title: `${item.title} (위키백과)`,
              snippet: cleanSnippet,
              url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
            });
          }
        }
      }
    } catch {
      // 무시
    }
  }

  return results.slice(0, 4);
}

async function fetchUrlReadableText(url: string): Promise<{ url: string; text: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const rawHtml = await res.text();
    const noScript = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const plain = stripHtmlTags(noScript).slice(0, 3200);
    if (plain.length < 40) return null;
    return { url, text: plain };
  } catch {
    return null;
  }
}

function shouldTriggerWebSearch(promptText: string): boolean {
  return /(검색|최신|오늘|현재|지금|요즘|뉴스|날씨|주가|환율|실시간|순위|결과|발표|출시|근황|2025|2026|누구|어디|가격|시세)/i.test(
    promptText,
  );
}

function parseMessageBlocks(raw: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const fence = '\x60\x60\x60';
  const regex = new RegExp(fence + '([a-zA-Z0-9_-]*)\\n?([\\s\\S]*?)' + fence, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const textPart = raw.slice(lastIndex, match.index).trim();
      if (textPart) {
        blocks.push({ type: 'text', content: textPart });
      }
    }
    blocks.push({
      type: 'code',
      language: match[1] || 'code',
      content: match[2].replace(/\n$/, ''),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    const remaining = raw.slice(lastIndex).trim();
    if (remaining) {
      blocks.push({ type: 'text', content: remaining });
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', content: raw });
  }
  return blocks;
}

function analyzeAutonomousPlan(
  promptText: string,
  installed: Record<ModelKey, boolean>,
): ExecutionPlan {
  const lower = promptText.toLowerCase();

  const mathRegex =
    /(수학|방정식|미분|적분|극댓값|극솟값|확률|통계|기댓값|복리|단리|연리|이율|원리금|행렬|벡터|기하|삼각함수|로그|지수|수열|점화식|극한|순열|조합|경우의\s*수|증명|연립방정식|계산해|풀어\s*줘|풀이|sin|cos|tan|log|sqrt|\^2|\^3|\d+\s*[+\-*/=]\s*\d+)/i;
  const koreanWritingRegex =
    /(이메일|메일|초안|자기소개서|자소서|에세이|윤문|교정|맞춤법|띄어쓰기|보고서|제안서|기획서|안내문|공지문|사과문|편지|작문|문장|다듬어|사자성어|어휘|뉘앙스|소설|시\s*써|기사|번역|요약해)/i;
  const codeTechRegex =
    /(코드|파이썬|python|javascript|typescript|react|sql|html|css|알고리즘|함수|클래스|버그|에러|디버깅|api|아키텍처|스크립트|자동화|프로그램)/i;

  const hasMath = mathRegex.test(lower);
  const hasKoreanWriting = koreanWritingRegex.test(lower);
  const hasCodeTech = codeTechRegex.test(lower);

  const pickAvailable = (preferred: ModelKey[]): ModelKey => {
    for (const k of preferred) {
      if (installed[k]) return k;
    }
    return 'allrounder';
  };

  if (hasMath && hasKoreanWriting && installed.math && (installed.korean || installed.allrounder)) {
    const writerKey: ModelKey = installed.korean ? 'korean' : 'allrounder';
    return {
      summaryLabel: `복합 협업 · ${MODELS.math.shortTitle} 수리 검증 → ${MODELS[writerKey].shortTitle} 한국어 작성`,
      steps: [
        {
          modelKey: 'math',
          roleTitle: `1단계 · ${MODELS.math.shortTitle} 수리·논리 정밀 계산`,
          instructionHint:
            '다음 요청의 수학적 계산과 논리적 근거만을 단계별로 정확히 도출하고 검산하세요. 불필요한 인사말 없이 핵심 풀이과정과 수치 결과만 명확히 제시하세요:\n\n',
        },
        {
          modelKey: writerKey,
          roleTitle: `2단계 · ${MODELS[writerKey].shortTitle} 한국어 최종 완성`,
          instructionHint: '',
        },
      ],
    };
  }

  if (hasCodeTech && hasKoreanWriting && installed.allrounder && installed.korean) {
    return {
      summaryLabel: `복합 협업 · ${MODELS.allrounder.shortTitle} 기술 설계 → ${MODELS.korean.shortTitle} 한국어 문서화`,
      steps: [
        {
          modelKey: 'allrounder',
          roleTitle: `1단계 · ${MODELS.allrounder.shortTitle} 기술 설계 및 코드 구현`,
          instructionHint:
            '다음 요청에서 필요한 핵심 기술 구조와 실행 가능한 코드만 정확하게 설계해 출력하세요:\n\n',
        },
        {
          modelKey: 'korean',
          roleTitle: `2단계 · ${MODELS.korean.shortTitle} 한국어 문서 통합 완성`,
          instructionHint: '',
        },
      ],
    };
  }

  if (hasMath) {
    const primary = pickAvailable(['math', 'allrounder', 'korean']);
    return {
      summaryLabel: `능동 선택 · ${MODELS[primary].shortTitle} (${MODELS[primary].badge})`,
      steps: [
        {
          modelKey: primary,
          roleTitle: MODELS[primary].title,
          instructionHint: '',
        },
      ],
    };
  }

  if (hasKoreanWriting) {
    const primary = pickAvailable(['korean', 'allrounder', 'math']);
    return {
      summaryLabel: `능동 선택 · ${MODELS[primary].shortTitle} (${MODELS[primary].badge})`,
      steps: [
        {
          modelKey: primary,
          roleTitle: MODELS[primary].title,
          instructionHint: '',
        },
      ],
    };
  }

  const primary = pickAvailable(['allrounder', 'korean', 'math']);
  return {
    summaryLabel: `능동 선택 · ${MODELS[primary].shortTitle} (${MODELS[primary].badge})`,
    steps: [
      {
        modelKey: primary,
        roleTitle: MODELS[primary].title,
        instructionHint: '',
      },
    ],
  };
}

function RichTextRenderer({
  text,
  showCursor,
}: {
  text: string;
  showCursor?: boolean;
}): React.JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={styles.assistantText}>
      {parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <Text key={idx} style={styles.boldText}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={idx}>{part}</Text>;
      })}
      {showCursor ? <Text style={styles.cursorDot}> ●</Text> : null}
    </Text>
  );
}

function BreathingLogo({ accentColor }: { accentColor: string }): React.JSX.Element {
  const pulse = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.07,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 0.65,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0.25,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [glow, pulse]);

  return (
    <View style={styles.logoOuterWrap}>
      <Animated.View
        style={[
          styles.logoGlowRing,
          {
            backgroundColor: accentColor,
            opacity: glow,
            transform: [{ scale: pulse }],
          },
        ]}
      />
      <Animated.View
        style={[styles.centerLogoCircle, { transform: [{ scale: pulse }] }]}>
        <Text style={styles.centerLogoIcon}>✦</Text>
      </Animated.View>
    </View>
  );
}

function ThinkingWave({ color }: { color: string }): React.JSX.Element {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const createDotAnim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 380,
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0.3,
            duration: 380,
            useNativeDriver: true,
          }),
          Animated.delay(400 - delay),
        ]),
      );

    const a1 = createDotAnim(dot1, 0);
    const a2 = createDotAnim(dot2, 160);
    const a3 = createDotAnim(dot3, 320);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingRow}>
      {[dot1, dot2, dot3].map((animVal, idx) => (
        <Animated.View
          key={idx}
          style={[
            styles.waveDot,
            {
              backgroundColor: color,
              opacity: animVal,
              transform: [
                {
                  scale: animVal.interpolate({
                    inputRange: [0.3, 1],
                    outputRange: [0.85, 1.2],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function AnimatedSuggestionCard({
  badge,
  title,
  desc,
  index,
  onPress,
}: {
  badge: string;
  title: string;
  desc: string;
  index: number;
  onPress: () => void;
}): React.JSX.Element {
  const enterAnim = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    enterAnim.setValue(0);
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 340,
      delay: index * 65,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enterAnim, index]);

  const handlePressIn = () => {
    Animated.spring(pressScale, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={{
        opacity: enterAnim,
        transform: [
          {
            translateY: enterAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [16, 0],
            }),
          },
          { scale: pressScale },
        ],
      }}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.suggestionCard}>
        <Text style={styles.suggestionBadge}>{badge}</Text>
        <Text style={styles.suggestionTitle}>{title}</Text>
        <Text style={styles.suggestionDesc}>{desc}</Text>
      </Pressable>
    </Animated.View>
  );
}

function AnimatedMessageRow({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(appear, {
      toValue: 1,
      damping: 20,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [appear]);

  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [
          {
            translateY: appear.interpolate({
              inputRange: [0, 1],
              outputRange: [14, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

export default function App(): React.JSX.Element {
  const [downloadedModels, setDownloadedModels] = useState<Record<ModelKey, boolean>>({
    allrounder: false,
    math: false,
    korean: false,
  });
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('auto');
  const [loadedModelKey, setLoadedModelKey] = useState<ModelKey | null>(null);
  const [engineBannerText, setEngineBannerText] = useState<string>('');
  const [qwenThinkingMode, setQwenThinkingMode] = useState<boolean>(false);

  // 네트워크 상태 및 설정 토글 상태
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [networkType, setNetworkType] = useState<'wifi' | 'cellular' | 'none' | 'unknown'>(
    'unknown',
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(true);
  const [allowCellularDownload, setAllowCellularDownload] = useState<boolean>(false);
  const [enabledPlugins, setEnabledPlugins] = useState<Record<PluginKey, boolean>>({
    calculator: true,
    url_reader: true,
    datetime_tool: true,
    clipboard_reader: true,
  });

  const [downloadingKey, setDownloadingKey] = useState<ModelKey | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const progressBarAnim = useRef(new Animated.Value(0)).current;
  const downloadJobIdRef = useRef<number | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const activeSessionIdRef = useRef<string>('');
  activeSessionIdRef.current = activeSessionId;

  const [inputText, setInputText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string>('');

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [modelModalVisible, setModelModalVisible] = useState<boolean>(false);
  const [pluginModalVisible, setPluginModalVisible] = useState<boolean>(false);

  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const llamaContextRef = useRef<LlamaContext | null>(null);
  const loadedModelKeyRef = useRef<ModelKey | null>(null);
  loadedModelKeyRef.current = loadedModelKey;
  const flatListRef = useRef<FlatList<ChatMessage> | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;
  const stopRequestedRef = useRef<boolean>(false);
  const allowCellularRef = useRef<boolean>(false);
  allowCellularRef.current = allowCellularDownload;

  const showToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => {
      setToastText((prev) => (prev === msg ? '' : prev));
    }, 2000);
  };

  const persistSettings = async (nextSettings: {
    webSearchEnabled: boolean;
    allowCellularDownload: boolean;
    enabledPlugins: Record<PluginKey, boolean>;
  }) => {
    try {
      await AsyncStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(nextSettings));
    } catch {
      // 무시
    }
  };

  const toggleWebSearch = async () => {
    if (!isConnected) {
      showToast('인터넷에 연결되어 있지 않아 웹 검색을 켤 수 없습니다');
      return;
    }
    const next = !webSearchEnabled;
    setWebSearchEnabled(next);
    await persistSettings({
      webSearchEnabled: next,
      allowCellularDownload,
      enabledPlugins,
    });
    showToast(next ? '🌐 실시간 웹 검색 활성화됨' : '웹 검색 꺼짐 (순수 로컬 추론)');
  };

  const toggleAllowCellular = async (val: boolean) => {
    setAllowCellularDownload(val);
    await persistSettings({
      webSearchEnabled,
      allowCellularDownload: val,
      enabledPlugins,
    });
    showToast(
      val
        ? '📶 셀룰러 데이터 모델 다운로드 허용됨'
        : 'Wi-Fi 전용 다운로드 보호 활성화됨',
    );
  };

  const togglePlugin = async (key: PluginKey) => {
    const nextPlugins = { ...enabledPlugins, [key]: !enabledPlugins[key] };
    setEnabledPlugins(nextPlugins);
    await persistSettings({
      webSearchEnabled,
      allowCellularDownload,
      enabledPlugins: nextPlugins,
    });
  };

  const handlePasteFromClipboard = async () => {
    if (!enabledPlugins.clipboard_reader) {
      showToast('플러그인 허브에서 클립보드 분석을 먼저 켜주세요');
      return;
    }
    try {
      const clip = await Clipboard.getString();
      if (!clip || !clip.trim()) {
        showToast('클립보드에 복사된 텍스트가 없습니다');
        return;
      }
      const trimmed = clip.trim().slice(0, 1500);
      setInputText((prev) =>
        prev.trim()
          ? `${prev.trim()}\n\n[클립보드 내용]\n${trimmed}`
          : `다음 클립보드 내용을 핵심 요약하고 자연스럽게 정리해 줘:\n\n${trimmed}`,
      );
      showToast('📋 클립보드 내용을 불러왔습니다');
    } catch {
      showToast('클립보드를 읽지 못했습니다');
    }
  };

  // 실시간 네트워크 연결 감지 (NetInfo + Apple Captive Check 폴백)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const probeConnectivity = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('https://www.apple.com/library/test/success.html', {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        setIsConnected(res.ok);
        setNetworkType((prev) => (prev === 'none' || prev === 'unknown' ? 'wifi' : prev));
      } catch {
        setIsConnected(false);
        setNetworkType('none');
      }
    };

    if (NetInfoModule && typeof NetInfoModule.addEventListener === 'function') {
      unsubscribe = NetInfoModule.addEventListener((state: any) => {
        const online = Boolean(state.isConnected && state.isInternetReachable !== false);
        const typeStr = String(state.type || 'unknown').toLowerCase();
        setIsConnected(online);
        if (!online || typeStr === 'none') {
          setNetworkType('none');
        } else if (typeStr === 'cellular') {
          setNetworkType('cellular');
          // Wi-Fi에서 셀룰러로 전환되었는데 허용 토글이 꺼져 있고 다운로드 중이면 자동 중단
          if (!allowCellularRef.current && downloadJobIdRef.current !== null) {
            RNFS.stopDownload(downloadJobIdRef.current);
            downloadJobIdRef.current = null;
            setDownloadingKey(null);
            setDownloadStatusText('');
            Alert.alert(
              '다운로드 자동 일시중지',
              'Wi-Fi 연결이 끊기고 셀룰러 데이터로 전환되어 대용량 모델 다운로드를 안전하게 중단했습니다.',
            );
          }
        } else {
          setNetworkType('wifi');
        }
      });
    } else {
      probeConnectivity();
      pollTimer = setInterval(probeConnectivity, 12000);
    }

    return () => {
      if (unsubscribe) unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  const getModelPath = (key: ModelKey) =>
    `${RNFS.DocumentDirectoryPath}/${MODELS[key].filename}`;

  const scanDownloadedModels = useCallback(async (): Promise<Record<ModelKey, boolean>> => {
    const result: Record<ModelKey, boolean> = {
      allrounder: false,
      math: false,
      korean: false,
    };
    for (const key of MODEL_ORDER) {
      const path = getModelPath(key);
      if (await RNFS.exists(path)) {
        const stat = await RNFS.stat(path);
        if (Number(stat.size) >= MODELS[key].minBytes) {
          result[key] = true;
        } else {
          await RNFS.unlink(path);
        }
      }
    }
    setDownloadedModels(result);
    return result;
  }, []);

  const ensureModelLoaded = useCallback(
    async (key: ModelKey, customBanner?: string): Promise<LlamaContext | null> => {
      if (loadedModelKeyRef.current === key && llamaContextRef.current) {
        return llamaContextRef.current;
      }

      setEngineBannerText(
        customBanner ?? `아이폰 16 Pro GPU에 ${MODELS[key].title} 적재 중...`,
      );
      try {
        if (llamaContextRef.current) {
          await llamaContextRef.current.release();
          llamaContextRef.current = null;
          setLoadedModelKey(null);
        }
        const context = await initLlama({
          model: getModelPath(key),
          use_mlock: false,
          use_mmap: true,
          n_ctx: 2048,
          n_gpu_layers: 99,
        });
        llamaContextRef.current = context;
        setLoadedModelKey(key);
        return context;
      } catch (error) {
        Alert.alert(
          '모델 로딩 실패',
          `메모리 부족 또는 파일 오류로 ${MODELS[key].title} 모델을 불러오지 못했습니다.\n(${String(error)})`,
        );
        return null;
      } finally {
        setEngineBannerText('');
      }
    },
    [],
  );

  const persistSessions = async (updated: ChatSession[]) => {
    setSessions(updated);
    try {
      await AsyncStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(updated));
    } catch {
      // 무시
    }
  };

  const createNewSession = useCallback(async () => {
    const currentList = sessionsRef.current;
    const currentActive = currentList.find((s) => s.id === activeSessionIdRef.current);

    if (currentActive && currentActive.messages.length === 0) {
      Keyboard.dismiss();
      showToast('이미 새 채팅 화면입니다');
      return currentActive;
    }

    const existingEmpty = currentList.find((s) => s.messages.length === 0);
    if (existingEmpty) {
      const reordered = [
        { ...existingEmpty, updatedAt: Date.now() },
        ...currentList.filter((s) => s.id !== existingEmpty.id),
      ];
      await persistSessions(reordered);
      setActiveSessionId(existingEmpty.id);
      Keyboard.dismiss();
      return existingEmpty;
    }

    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: '새 대화',
      updatedAt: Date.now(),
      messages: [],
    };
    const updated = [newSession, ...currentList];
    await persistSessions(updated);
    setActiveSessionId(newSession.id);
    return newSession;
  }, []);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      try {
        const savedSettingsRaw = await AsyncStorage.getItem(STORAGE_SETTINGS_KEY);
        if (savedSettingsRaw && mounted) {
          const parsed = JSON.parse(savedSettingsRaw);
          if (typeof parsed.webSearchEnabled === 'boolean') {
            setWebSearchEnabled(parsed.webSearchEnabled);
          }
          if (typeof parsed.allowCellularDownload === 'boolean') {
            setAllowCellularDownload(parsed.allowCellularDownload);
          }
          if (parsed.enabledPlugins) {
            setEnabledPlugins((prev) => ({ ...prev, ...parsed.enabledPlugins }));
          }
        }

        const savedSessionsRaw = await AsyncStorage.getItem(STORAGE_SESSIONS_KEY);
        let parsedSessions: ChatSession[] = savedSessionsRaw
          ? JSON.parse(savedSessionsRaw)
          : [];

        let seenEmpty = false;
        parsedSessions = parsedSessions.filter((s) => {
          if (s.messages.length === 0) {
            if (seenEmpty) return false;
            seenEmpty = true;
          }
          return true;
        });

        if (parsedSessions.length === 0) {
          const initial: ChatSession = {
            id: `session-${Date.now()}`,
            title: '새 대화',
            updatedAt: Date.now(),
            messages: [],
          };
          parsedSessions = [initial];
        }
        await AsyncStorage.setItem(
          STORAGE_SESSIONS_KEY,
          JSON.stringify(parsedSessions),
        );

        if (mounted) {
          setSessions(parsedSessions);
          setActiveSessionId(parsedSessions[0].id);
        }

        const savedMode = (await AsyncStorage.getItem(
          STORAGE_MODE_KEY,
        )) as SelectionMode | null;
        const resolvedMode: SelectionMode =
          savedMode === 'auto' ||
          (savedMode && MODEL_ORDER.includes(savedMode as ModelKey))
            ? savedMode
            : 'auto';
        if (mounted) {
          setSelectionMode(resolvedMode);
        }

        const available = await scanDownloadedModels();
        if (!mounted) return;

        if (resolvedMode !== 'auto' && available[resolvedMode]) {
          await ensureModelLoaded(resolvedMode);
        } else {
          const firstAvailable = MODEL_ORDER.find((k) => available[k]);
          if (firstAvailable) {
            await ensureModelLoaded(firstAvailable);
          } else {
            setModelModalVisible(true);
          }
        }
      } catch {
        setModelModalVisible(true);
      }
    };

    bootstrap();
    return () => {
      mounted = false;
      if (llamaContextRef.current) {
        llamaContextRef.current.release();
        llamaContextRef.current = null;
      }
    };
  }, [ensureModelLoaded, scanDownloadedModels]);

  const toggleDrawer = (open: boolean) => {
    Keyboard.dismiss();
    if (open) {
      setDrawerOpen(true);
      Animated.parallel([
        Animated.spring(drawerAnim, {
          toValue: 0,
          damping: 24,
          stiffness: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(drawerAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setDrawerOpen(false));
    }
  };

  const handleSelectMode = async (mode: SelectionMode) => {
    setSelectionMode(mode);
    await AsyncStorage.setItem(STORAGE_MODE_KEY, mode);
    if (mode !== 'auto' && downloadedModels[mode]) {
      await ensureModelLoaded(mode);
    }
    setModelModalVisible(false);
  };

  const handleDownloadModel = async (key: ModelKey) => {
    if (downloadingKey) return;

    if (!isConnected) {
      Alert.alert(
        '오프라인 상태',
        '인터넷에 연결되어 있지 않습니다. Wi-Fi 또는 셀룰러 데이터를 켠 뒤 다시 시도해 주세요.',
      );
      return;
    }

    if (networkType === 'cellular' && !allowCellularDownload) {
      Alert.alert(
        '셀룰러 데이터 다운로드 제한됨',
        `현재 셀룰러(LTE/5G) 환경입니다.\n${MODELS[key].title}(${MODELS[key].sizeLabel})을 내려받으려면 상단의 '셀룰러 데이터 다운로드 허용' 스위치를 켜거나 Wi-Fi에 연결해 주세요.`,
      );
      return;
    }

    const spec = MODELS[key];
    const targetPath = getModelPath(key);

    setDownloadingKey(key);
    setDownloadProgress(0);
    setDownloadStatusText('서버 연결 중...');
    progressBarAnim.setValue(0);

    let totalBytes = spec.expectedBytes;

    try {
      if (await RNFS.exists(targetPath)) {
        await RNFS.unlink(targetPath);
      }

      const task = RNFS.downloadFile({
        fromUrl: spec.url,
        toFile: targetPath,
        background: false,
        discretionary: false,
        cacheable: false,
        headers: {
          'User-Agent': 'PocketMind-iOS/3.0',
        },
        progressInterval: 250,
        begin: (res) => {
          if (res.contentLength > 0) {
            totalBytes = res.contentLength;
          }
          setDownloadStatusText(`0 MB / ${formatMB(totalBytes)}`);
        },
        progress: (res) => {
          const denom = res.contentLength > 0 ? res.contentLength : totalBytes;
          const pct = Math.min(100, Math.round((res.bytesWritten / denom) * 100));
          setDownloadProgress(pct);
          setDownloadStatusText(`${formatMB(res.bytesWritten)} / ${formatMB(denom)}`);
          Animated.timing(progressBarAnim, {
            toValue: pct,
            duration: 200,
            useNativeDriver: false,
          }).start();
        },
      });

      downloadJobIdRef.current = task.jobId;
      const response = await task.promise;

      if (response.statusCode >= 200 && response.statusCode < 300) {
        setDownloadingKey(null);
        downloadJobIdRef.current = null;
        setDownloadStatusText('');
        await scanDownloadedModels();
        if (!loadedModelKeyRef.current) {
          await ensureModelLoaded(key);
        }
      } else {
        throw new Error(`서버 응답 오류 (HTTP ${response.statusCode})`);
      }
    } catch (error) {
      setDownloadingKey(null);
      downloadJobIdRef.current = null;
      setDownloadStatusText('');
      if (await RNFS.exists(targetPath)) {
        await RNFS.unlink(targetPath);
      }
      Alert.alert(
        '다운로드 실패',
        `모델을 내려받지 못했습니다. 네트워크 연결 상태와 여유 저장공간을 확인해 주세요.\n(${String(error)})`,
      );
    }
  };

  const handleCancelDownload = async () => {
    if (downloadJobIdRef.current !== null && downloadingKey) {
      RNFS.stopDownload(downloadJobIdRef.current);
      const path = getModelPath(downloadingKey);
      setDownloadingKey(null);
      downloadJobIdRef.current = null;
      setDownloadProgress(0);
      setDownloadStatusText('');
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path);
      }
    }
  };

  const handleDeleteModel = (key: ModelKey) => {
    Alert.alert(
      `${MODELS[key].title} 삭제`,
      `기기에서 모델 파일(${MODELS[key].sizeLabel})을 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            if (loadedModelKey === key && llamaContextRef.current) {
              await llamaContextRef.current.release();
              llamaContextRef.current = null;
              setLoadedModelKey(null);
            }
            const path = getModelPath(key);
            if (await RNFS.exists(path)) {
              await RNFS.unlink(path);
            }
            const updated = await scanDownloadedModels();
            if (loadedModelKey === key) {
              const fallback = MODEL_ORDER.find((k) => updated[k]);
              if (fallback) {
                await ensureModelLoaded(fallback);
              }
            }
          },
        },
      ],
    );
  };

  const buildModelPrompt = (
    spec: ModelSpec,
    history: ChatMessage[],
    userPrompt: string,
    externalContextBlock: string,
    forceThinking?: boolean,
  ): { prompt: string; stop: string[]; penaltyRepeat: number } => {
    const contextSlice = history.slice(-6);
    const enrichedSystem = externalContextBlock
      ? `${spec.systemPrompt}\n\n[실시간 도구 및 검색 참조 데이터]\n${externalContextBlock}\n위 검증된 데이터를 우선 근거로 삼아 정확하게 답변하세요.`
      : spec.systemPrompt;

    if (spec.promptFormat === 'exaone') {
      let prompt = `[|system|]${enrichedSystem}[|endofturn|]\n`;
      for (const msg of contextSlice) {
        if (msg.role === 'user') {
          prompt += `[|user|]${msg.content}\n`;
        } else {
          prompt += `[|assistant|]${msg.content}[|endofturn|]\n`;
        }
      }
      prompt += `[|user|]${userPrompt}\n[|assistant|]`;
      return {
        prompt,
        stop: ['[|endofturn|]', '<|endoftext|>'],
        penaltyRepeat: 1.0,
      };
    }

    const useThinking = forceThinking ?? qwenThinkingMode;
    const effectiveUserPrompt =
      spec.key === 'allrounder' && !useThinking
        ? `${userPrompt} /no_think`
        : userPrompt;

    let prompt = `<|im_start|>system\n${enrichedSystem}<|im_end|>\n`;
    for (const msg of contextSlice) {
      prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
    }
    prompt += `<|im_start|>user\n${effectiveUserPrompt}<|im_end|>\n<|im_start|>assistant\n`;

    return {
      prompt,
      stop: ['<|im_end|>', '<|endoftext|>'],
      penaltyRepeat: 1.05,
    };
  };

  const runCompletion = async (
    sessionId: string,
    historyBeforeUser: ChatMessage[],
    userText: string,
  ) => {
    const hasAnyModel = MODEL_ORDER.some((k) => downloadedModels[k]);
    if (!hasAnyModel) {
      setModelModalVisible(true);
      return;
    }

    stopRequestedRef.current = false;

    const plan: ExecutionPlan =
      selectionMode === 'auto'
        ? analyzeAutonomousPlan(userText, downloadedModels)
        : {
            summaryLabel: `수동 고정 · ${MODELS[selectionMode].title}`,
            steps: [
              {
                modelKey: selectionMode,
                roleTitle: MODELS[selectionMode].title,
                instructionHint: '',
              },
            ],
          };

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    const assistantMsgId = `msg-${Date.now()}-a`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      orchestrationLabel: plan.summaryLabel,
    };

    const nextMessages = [...historyBeforeUser, userMsg, assistantPlaceholder];
    const nextTitle =
      historyBeforeUser.length === 0
        ? userText.slice(0, 24) + (userText.length > 24 ? '...' : '')
        : undefined;

    const initialSessions = sessionsRef.current.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            title: nextTitle ?? s.title,
            updatedAt: Date.now(),
            messages: nextMessages,
          }
        : s,
    );
    await persistSessions(initialSessions);
    setIsGenerating(true);

    // 1. 플러그인 및 실시간 웹 검색 컨텍스트 수집
    const pluginBadges: string[] = [];
    const contextSections: string[] = [];
    let fetchedSources: WebSearchSource[] = [];

    if (enabledPlugins.datetime_tool) {
      const kstStr = getKoreanDateTimeContext();
      contextSections.push(`- 현재 시각: ${kstStr}`);
      if (/(오늘|내일|모레|며칠|날짜|요일|시간|디데이|d-day|몇\s*년)/i.test(userText)) {
        pluginBadges.push(`📅 현재 시각 (${kstStr.split(' ')[0]})`);
      }
    }

    if (enabledPlugins.calculator) {
      const calcResult = safeEvaluateMath(userText);
      if (calcResult) {
        contextSections.push(`- 정밀 계산기 검증값: ${calcResult}`);
        pluginBadges.push(`🧮 계산기 (${calcResult})`);
      }
    }

    if (isConnected && enabledPlugins.url_reader) {
      const urlMatch = userText.match(/https?:\/\/[^\s)]+/i);
      if (urlMatch) {
        setEngineBannerText('🔗 웹페이지 본문을 읽어오는 중...');
        const pageData = await fetchUrlReadableText(urlMatch[0]);
        if (pageData) {
          contextSections.push(
            `- 웹페이지 본문 (${pageData.url}):\n${pageData.text}`,
          );
          pluginBadges.push('🔗 URL 본문 추출');
        }
        setEngineBannerText('');
      }
    }

    if (isConnected && webSearchEnabled && shouldTriggerWebSearch(userText)) {
      setEngineBannerText('🌐 실시간 웹 검색 수행 중...');
      fetchedSources = await performLiveWebSearch(userText);
      if (fetchedSources.length > 0) {
        const formattedSearch = fetchedSources
          .map((src, idx) => `[${idx + 1}] ${src.title}: ${src.snippet}`)
          .join('\n');
        contextSections.push(`- 실시간 웹 검색 결과:\n${formattedSearch}`);
        pluginBadges.push(`🌐 웹 검색 (${fetchedSources.length}건)`);
      }
      setEngineBannerText('');
    }

    const externalContextBlock = contextSections.join('\n');

    if (pluginBadges.length > 0 || fetchedSources.length > 0) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        pluginBadges,
                        webSources: fetchedSources.length > 0 ? fetchedSources : undefined,
                      }
                    : m,
                ),
              }
            : s,
        ),
      );
    }

    let finalAnswer = '';
    let stage1TitleSnapshot = '';
    let stage1OutputSnapshot = '';

    try {
      if (plan.steps.length === 1) {
        const step = plan.steps[0];
        const ctx = await ensureModelLoaded(
          step.modelKey,
          `능동 라우팅: ${MODELS[step.modelKey].title} 활성화 중...`,
        );
        if (!ctx) throw new Error('모델을 메모리에 올리지 못했습니다.');

        const spec = MODELS[step.modelKey];
        const { prompt, stop, penaltyRepeat } = buildModelPrompt(
          spec,
          historyBeforeUser,
          userText,
          externalContextBlock,
        );

        let lastUiUpdate = 0;
        await ctx.completion(
          {
            prompt,
            n_predict: 1400,
            temperature: spec.key === 'math' ? 0.25 : 0.7,
            top_p: 0.9,
            penalty_repeat: penaltyRepeat,
            stop,
          },
          (tokenData) => {
            finalAnswer += tokenData.token;
            const now = Date.now();
            if (now - lastUiUpdate >= 65) {
              lastUiUpdate = now;
              const snapshot = cleanModelOutput(finalAnswer);
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === sessionId
                    ? {
                        ...s,
                        messages: s.messages.map((m) =>
                          m.id === assistantMsgId ? { ...m, content: snapshot } : m,
                        ),
                      }
                    : s,
                ),
              );
            }
          },
        );
      } else {
        const step1 = plan.steps[0];
        const step2 = plan.steps[1];

        stage1TitleSnapshot = step1.roleTitle;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, stage1Title: stage1TitleSnapshot, stage1Content: '' }
                      : m,
                  ),
                }
              : s,
          ),
        );

        const ctx1 = await ensureModelLoaded(
          step1.modelKey,
          `[1/2단계] ${MODELS[step1.modelKey].title}로 핵심 분석 전환 중...`,
        );
        if (!ctx1) throw new Error('1단계 모델 로딩 실패');

        const spec1 = MODELS[step1.modelKey];
        const built1 = buildModelPrompt(
          spec1,
          [],
          `${step1.instructionHint}${userText}`,
          externalContextBlock,
          true,
        );

        let lastUiUpdate1 = 0;
        await ctx1.completion(
          {
            prompt: built1.prompt,
            n_predict: 1024,
            temperature: 0.25,
            top_p: 0.9,
            penalty_repeat: built1.penaltyRepeat,
            stop: built1.stop,
          },
          (tokenData) => {
            stage1OutputSnapshot += tokenData.token;
            const now = Date.now();
            if (now - lastUiUpdate1 >= 65) {
              lastUiUpdate1 = now;
              const cleaned1 = cleanModelOutput(stage1OutputSnapshot);
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === sessionId
                    ? {
                        ...s,
                        messages: s.messages.map((m) =>
                          m.id === assistantMsgId
                            ? { ...m, stage1Content: cleaned1 }
                            : m,
                        ),
                      }
                    : s,
                ),
              );
            }
          },
        );

        stage1OutputSnapshot = cleanModelOutput(stage1OutputSnapshot);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, stage1Content: stage1OutputSnapshot }
                      : m,
                  ),
                }
              : s,
          ),
        );

        if (stopRequestedRef.current) {
          finalAnswer = stage1OutputSnapshot;
        } else {
          const ctx2 = await ensureModelLoaded(
            step2.modelKey,
            `[2/2단계] ${MODELS[step2.modelKey].title}로 한국어 최종 통합 중...`,
          );
          if (!ctx2) throw new Error('2단계 모델 로딩 실패');

          const spec2 = MODELS[step2.modelKey];
          const synthesisPrompt =
            `다음은 사용자의 원래 요청과, 1단계 전문 AI(${MODELS[step1.modelKey].title})가 검증해 도출한 핵심 분석 결과입니다.\n\n` +
            `[사용자 원래 요청]\n${userText}\n\n` +
            `[1단계 전문 AI 검증 결과]\n${stage1OutputSnapshot}\n\n` +
            `위 검증된 수치와 논리를 빠짐없이 정확히 반영하여, 사용자에게 가장 이해하기 쉽고 자연스러운 한국어 최종 답변을 완성해 주세요.`;

          const built2 = buildModelPrompt(
            spec2,
            historyBeforeUser,
            synthesisPrompt,
            externalContextBlock,
          );

          let lastUiUpdate2 = 0;
          await ctx2.completion(
            {
              prompt: built2.prompt,
              n_predict: 1400,
              temperature: 0.65,
              top_p: 0.9,
              penalty_repeat: built2.penaltyRepeat,
              stop: built2.stop,
            },
            (tokenData) => {
              finalAnswer += tokenData.token;
              const now = Date.now();
              if (now - lastUiUpdate2 >= 65) {
                lastUiUpdate2 = now;
                const snapshot2 = cleanModelOutput(finalAnswer);
                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === sessionId
                      ? {
                          ...s,
                          messages: s.messages.map((m) =>
                            m.id === assistantMsgId ? { ...m, content: snapshot2 } : m,
                          ),
                        }
                      : s,
                  ),
                );
              }
            },
          );
        }
      }
    } catch (error) {
      if (!finalAnswer) {
        finalAnswer = `응답 생성 중 오류가 발생했습니다: ${String(error)}`;
      }
    } finally {
      const finalText = cleanModelOutput(finalAnswer) || '(응답이 중지되었습니다)';
      const finalizedSessions = sessionsRef.current.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: finalText,
                      pluginBadges: pluginBadges.length > 0 ? pluginBadges : undefined,
                      webSources:
                        fetchedSources.length > 0 ? fetchedSources : undefined,
                      stage1Title: stage1TitleSnapshot || undefined,
                      stage1Content: stage1OutputSnapshot || undefined,
                    }
                  : m,
              ),
            }
          : s,
      );
      await persistSessions(finalizedSessions);
      setIsGenerating(false);
    }
  };

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const currentMessages = activeSession?.messages ?? [];

  const handleSendMessage = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputText).trim();
    if (!textToSend || isGenerating) return;

    const hasAnyModel = MODEL_ORDER.some((k) => downloadedModels[k]);
    if (!hasAnyModel) {
      setModelModalVisible(true);
      return;
    }

    if (!overrideText) {
      setInputText('');
    }
    Keyboard.dismiss();

    const targetSession = activeSession ?? (await createNewSession());
    await runCompletion(targetSession.id, targetSession.messages, textToSend);
  };

  const handleStopGeneration = async () => {
    if (!isGenerating) return;
    stopRequestedRef.current = true;
    if (llamaContextRef.current) {
      try {
        await llamaContextRef.current.stopCompletion();
      } catch {
        // 무시
      }
    }
  };

  const handleRegenerateLast = async () => {
    if (isGenerating || !activeSession || currentMessages.length < 2) return;
    const lastMsg = currentMessages[currentMessages.length - 1];
    const prevUserMsg = currentMessages[currentMessages.length - 2];
    if (lastMsg.role !== 'assistant' || prevUserMsg.role !== 'user') return;

    const historyBefore = currentMessages.slice(0, -2);
    await runCompletion(activeSession.id, historyBefore, prevUserMsg.content);
  };

  const handleCopyText = (id: string, text: string) => {
    Clipboard.setString(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1500);
  };

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert('대화 삭제', '이 대화 기록을 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          const filtered = sessionsRef.current.filter((s) => s.id !== sessionId);
          if (filtered.length === 0) {
            const fresh: ChatSession = {
              id: `session-${Date.now()}`,
              title: '새 대화',
              updatedAt: Date.now(),
              messages: [],
            };
            await persistSessions([fresh]);
            setActiveSessionId(fresh.id);
          } else {
            await persistSessions(filtered);
            if (activeSessionId === sessionId) {
              setActiveSessionId(filtered[0].id);
            }
          }
        },
      },
    ]);
  };

  const installedCount = MODEL_ORDER.filter((k) => downloadedModels[k]).length;
  const activePluginCount = Object.values(enabledPlugins).filter(Boolean).length;
  const activeAccentColor =
    selectionMode === 'auto' ? '#10A37F' : MODELS[selectionMode].badgeColor;

  const renderMessageItem = ({
    item,
    index,
  }: {
    item: ChatMessage;
    index: number;
  }) => {
    const isUser = item.role === 'user';
    const isLastItem = index === currentMessages.length - 1;
    const isStreamingThis = !isUser && isLastItem && isGenerating;
    const isLastAssistant = !isUser && isLastItem && !isGenerating;

    if (isUser) {
      return (
        <AnimatedMessageRow>
          <View style={styles.userRow}>
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{item.content}</Text>
            </View>
          </View>
        </AnimatedMessageRow>
      );
    }

    const blocks = parseMessageBlocks(item.content);

    return (
      <AnimatedMessageRow>
        <View style={styles.assistantRow}>
          <View style={[styles.avatarBadge, { backgroundColor: activeAccentColor }]}>
            <Text style={styles.avatarGlyph}>✦</Text>
          </View>
          <View style={styles.assistantContentCol}>
            {item.orchestrationLabel ? (
              <View style={styles.orchestrationPill}>
                <Text style={styles.orchestrationPillText}>
                  🧠 {item.orchestrationLabel}
                </Text>
              </View>
            ) : null}

            {item.pluginBadges && item.pluginBadges.length > 0 ? (
              <View style={styles.pluginBadgeRow}>
                {item.pluginBadges.map((b, bIdx) => (
                  <View key={bIdx} style={styles.pluginUsedChip}>
                    <Text style={styles.pluginUsedChipText}>{b}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {item.webSources && item.webSources.length > 0 ? (
              <View style={styles.sourcesCard}>
                <Text style={styles.sourcesHeader}>
                  🌐 실시간 웹 검색 근거 ({item.webSources.length}건)
                </Text>
                {item.webSources.map((src, sIdx) => (
                  <Text key={sIdx} numberOfLines={1} style={styles.sourceItemText}>
                    • {src.title}
                  </Text>
                ))}
              </View>
            ) : null}

            {item.stage1Title ? (
              <View style={styles.stage1Card}>
                <Text style={styles.stage1Header}>{item.stage1Title}</Text>
                <Text style={styles.stage1Body} numberOfLines={8}>
                  {item.stage1Content || '1단계 전문 분석 연산 중...'}
                </Text>
              </View>
            ) : null}

            {item.content.length === 0 ? (
              <ThinkingWave color={activeAccentColor} />
            ) : (
              blocks.map((block, bIdx) => {
                const isLastBlock = bIdx === blocks.length - 1;
                if (block.type === 'code') {
                  const codeCopyKey = `${item.id}-code-${bIdx}`;
                  return (
                    <View key={bIdx} style={styles.codeCard}>
                      <View style={styles.codeHeader}>
                        <Text style={styles.codeLang}>{block.language}</Text>
                        <TouchableOpacity
                          onPress={() => handleCopyText(codeCopyKey, block.content)}>
                          <Text style={styles.codeCopyBtn}>
                            {copiedId === codeCopyKey ? '복사됨 ✓' : '코드 복사'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <Text style={styles.codeBody}>{block.content}</Text>
                      </ScrollView>
                    </View>
                  );
                }
                return (
                  <RichTextRenderer
                    key={bIdx}
                    text={block.content}
                    showCursor={isStreamingThis && isLastBlock}
                  />
                );
              })
            )}

            {item.content.length > 0 && !isGenerating && (
              <View style={styles.actionBar}>
                <TouchableOpacity
                  onPress={() => handleCopyText(item.id, item.content)}
                  style={styles.actionChip}>
                  <Text style={styles.actionChipText}>
                    {copiedId === item.id ? '복사 완료 ✓' : '복사'}
                  </Text>
                </TouchableOpacity>
                {isLastAssistant && (
                  <TouchableOpacity
                    onPress={handleRegenerateLast}
                    style={styles.actionChip}>
                    <Text style={styles.actionChipText}>↻ 다시 생성</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </AnimatedMessageRow>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar backgroundColor="#212121" barStyle="light-content" />

      {/* 상단 능동 AI 스위처 & 메뉴 헤더 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => toggleDrawer(true)}
          style={styles.iconBtn}
          disabled={isGenerating}>
          <Text style={styles.iconBtnText}>☰</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setModelModalVisible(true)}
          style={styles.modelSelectorPill}
          disabled={isGenerating}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: installedCount > 0 ? activeAccentColor : '#F59E0B',
              },
            ]}
          />
          <Text style={styles.modelPillTitle}>
            {selectionMode === 'auto'
              ? `능동형 복합 AI (${installedCount}/3)`
              : `고정 · ${MODELS[selectionMode].shortTitle}`}
          </Text>
          <Text style={styles.modelPillChevron}>▾</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => createNewSession()}
          style={styles.iconBtn}
          disabled={isGenerating}>
          <Text style={styles.iconBtnText}>✎</Text>
        </TouchableOpacity>
      </View>

      {/* 인터넷·웹검색·플러그인 빠른 제어 상태 바 */}
      <View style={styles.quickFeatureBar}>
        <TouchableOpacity
          onPress={toggleWebSearch}
          style={[
            styles.featurePill,
            isConnected && webSearchEnabled
              ? styles.featurePillOnline
              : styles.featurePillOffline,
          ]}>
          <Text
            style={[
              styles.featurePillText,
              isConnected && webSearchEnabled && styles.featurePillTextOnline,
            ]}>
            {!isConnected
              ? '📴 오프라인 모드'
              : webSearchEnabled
                ? `🌐 웹 검색 ON (${networkType === 'cellular' ? '셀룰러' : 'Wi-Fi'})`
                : '🌐 웹 검색 OFF'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setPluginModalVisible(true)}
          style={styles.featurePill}>
          <Text style={styles.featurePillText}>
            🧩 플러그인 ({activePluginCount}/{PLUGINS.length})
          </Text>
        </TouchableOpacity>

        {loadedModelKey === 'allrounder' && (
          <TouchableOpacity
            onPress={() => setQwenThinkingMode((prev) => !prev)}
            style={[
              styles.featurePill,
              qwenThinkingMode && styles.featurePillOnline,
            ]}>
            <Text
              style={[
                styles.featurePillText,
                qwenThinkingMode && styles.featurePillTextOnline,
              ]}>
              {qwenThinkingMode ? '🧠 깊은 사고' : '⚡ 빠른 응답'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 토스트 알림 배지 */}
      {toastText ? (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{toastText}</Text>
        </View>
      ) : null}

      {/* 모델 적재·웹 검색·플러그인 실행 배너 */}
      {engineBannerText ? (
        <View style={styles.loadingBanner}>
          <ActivityIndicator color="#10A37F" size="small" />
          <Text style={styles.loadingBannerText}>{engineBannerText}</Text>
        </View>
      ) : null}

      {/* 메인 대화 영역 또는 복합 협업 추천 뷰 */}
      {currentMessages.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          keyboardShouldPersistTaps="handled">
          <View style={styles.centerLogoWrap}>
            <BreathingLogo accentColor={activeAccentColor} />
            <View
              style={[
                styles.activeSpecialtyBadge,
                { borderColor: activeAccentColor },
              ]}>
              <Text
                style={[
                  styles.activeSpecialtyText,
                  { color: activeAccentColor },
                ]}>
                {isConnected && webSearchEnabled
                  ? 'HYBRID AI · ONLINE WEB SEARCH + 8B ON-DEVICE'
                  : 'AUTONOMOUS MULTI-AI ORCHESTRATOR'}
              </Text>
            </View>
            <Text style={styles.centerTitle}>무엇을 도와드릴까요?</Text>
            <Text style={styles.centerSubtitle}>
              {installedCount > 0
                ? `질문 의도를 분석해 8B급 전문 AI ${installedCount}종과 웹 검색·플러그인이 협업합니다`
                : '상단 버튼을 눌러 아이폰 16 Pro용 7B~8B AI 모델을 다운로드하세요'}
            </Text>
          </View>

          <View style={styles.suggestionsGrid}>
            {AUTO_SUGGESTIONS.map((card, idx) => (
              <AnimatedSuggestionCard
                key={idx}
                index={idx}
                badge={card.badge}
                title={card.title}
                desc={card.desc}
                onPress={() => handleSendMessage(card.prompt)}
              />
            ))}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          ref={flatListRef}
          data={currentMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={styles.messageListContent}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
      )}

      {/* 하단 플로팅 캡슐 입력창 */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={6}>
        <View style={styles.bottomDock}>
          <View style={styles.inputCapsule}>
            <TouchableOpacity
              onPress={() => setPluginModalVisible(true)}
              style={styles.plusToolBtn}
              disabled={isGenerating}>
              <Text style={styles.plusToolText}>+</Text>
            </TouchableOpacity>

            <TextInput
              maxLength={2000}
              multiline
              onChangeText={setInputText}
              placeholder={
                isConnected && webSearchEnabled
                  ? '최신 웹 검색, 수학, 코딩, 한국어 작문 무엇이든 물어보세요'
                  : '오프라인 모드 · 수학, 코딩, 한국어 작문 입력'
              }
              placeholderTextColor="#8E8EA0"
              style={styles.textInput}
              value={inputText}
            />
            {isGenerating ? (
              <TouchableOpacity
                onPress={handleStopGeneration}
                style={styles.stopCircleBtn}>
                <View style={styles.stopSquare} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => handleSendMessage()}
                style={[
                  styles.sendCircleBtn,
                  !inputText.trim() && styles.sendCircleBtnDisabled,
                ]}
                disabled={!inputText.trim()}>
                <Text style={styles.sendArrow}>↑</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.footerDisclaimer}>
            {isConnected
              ? '온라인 연결됨 · 웹 검색 및 URL 플러그인 사용 가능 · AI 연산은 기기 내부 실행'
              : '오프라인 상태 · 모든 AI 모델과 로컬 플러그인이 기기 내부에서 안전하게 작동'}
          </Text>
        </View>
      </KeyboardAvoidingView>

      {/* 좌측 사이드바 (대화 목록) */}
      {drawerOpen && (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[styles.drawerBackdrop, { opacity: backdropAnim }]}>
            <Pressable
              onPress={() => toggleDrawer(false)}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.drawerPanel,
              { transform: [{ translateX: drawerAnim }] },
            ]}>
            <SafeAreaView style={styles.drawerSafe}>
              <TouchableOpacity
                onPress={async () => {
                  await createNewSession();
                  toggleDrawer(false);
                }}
                style={styles.newChatDrawerBtn}>
                <Text style={styles.newChatDrawerIcon}>✦</Text>
                <Text style={styles.newChatDrawerText}>새 채팅 시작</Text>
              </TouchableOpacity>

              <Text style={styles.drawerSectionLabel}>이전 대화</Text>
              <FlatList
                data={sessions}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const selected = item.id === activeSession?.id;
                  return (
                    <View
                      style={[
                        styles.sessionRow,
                        selected && styles.sessionRowActive,
                      ]}>
                      <TouchableOpacity
                        onPress={() => {
                          setActiveSessionId(item.id);
                          toggleDrawer(false);
                        }}
                        style={styles.sessionTitleBtn}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.sessionTitleText,
                            selected && styles.sessionTitleTextActive,
                          ]}>
                          {item.title}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteSession(item.id)}
                        style={styles.sessionDeleteBtn}>
                        <Text style={styles.sessionDeleteText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />

              <View style={styles.drawerFooterGroup}>
                <TouchableOpacity
                  onPress={() => {
                    toggleDrawer(false);
                    setPluginModalVisible(true);
                  }}
                  style={styles.drawerFooterBtn}>
                  <Text style={styles.drawerFooterText}>🧩 플러그인 및 웹 검색 설정</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    toggleDrawer(false);
                    setModelModalVisible(true);
                  }}
                  style={styles.drawerFooterBtn}>
                  <Text style={styles.drawerFooterText}>⚙ 8B 모델 다운로드 · 데이터 설정</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      )}

      {/* 플러그인 & 웹 검색 허브 모달 */}
      <Modal
        animationType="slide"
        onRequestClose={() => setPluginModalVisible(false)}
        transparent
        visible={pluginModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>플러그인 & 실시간 웹 검색</Text>
              <TouchableOpacity onPress={() => setPluginModalVisible(false)}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDesc}>
              인터넷 연결 시 웹 검색과 URL 요약기가 자동 활성화되며, 로컬 플러그인은 오프라인에서도 작동합니다.
            </Text>

            {/* 실시간 웹 검색 마스터 토글 */}
            <View style={styles.toggleSettingCard}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>
                  🌐 실시간 웹 검색 ({isConnected ? '온라인 연결됨' : '오프라인'})
                </Text>
                <Text style={styles.toggleSub}>
                  최신 뉴스·날씨·정보 질문 시 인터넷 검색 결과를 AI에 자동 주입
                </Text>
              </View>
              <Switch
                value={isConnected && webSearchEnabled}
                onValueChange={toggleWebSearch}
                trackColor={{ false: '#3F3F46', true: '#10A37F' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* 클립보드 원탭 불러오기 액션 */}
            <TouchableOpacity
              onPress={() => {
                setPluginModalVisible(false);
                handlePasteFromClipboard();
              }}
              style={styles.clipboardQuickAction}>
              <Text style={styles.clipboardQuickActionText}>
                📋 지금 클립보드 내용 불러와 분석하기
              </Text>
            </TouchableOpacity>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}>
              {PLUGINS.map((plugin) => {
                const active = enabledPlugins[plugin.key];
                return (
                  <View key={plugin.key} style={styles.pluginRowCard}>
                    <View style={styles.pluginInfoCol}>
                      <View style={styles.pluginTitleLine}>
                        <Text style={styles.pluginTitleText}>
                          {plugin.icon} {plugin.title}
                        </Text>
                        {plugin.requiresInternet && (
                          <View style={styles.onlineOnlyTag}>
                            <Text style={styles.onlineOnlyTagText}>온라인</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.pluginDescText}>{plugin.desc}</Text>
                    </View>
                    <Switch
                      value={active}
                      onValueChange={() => togglePlugin(plugin.key)}
                      trackColor={{ false: '#3F3F46', true: '#3B82F6' }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 능동형 모드 & 7B~8B 특화 AI 모델 + 셀룰러 토글 모달 */}
      <Modal
        animationType="slide"
        onRequestClose={() => setModelModalVisible(false)}
        transparent
        visible={modelModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>아이폰 16 Pro · AI 엔진 허브</Text>
              <TouchableOpacity onPress={() => setModelModalVisible(false)}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDesc}>
              8GB RAM 한계에 맞춘 7B~8B 플래그십 모델을 내려받으면 능동형 AI가 작업에 맞춰 모델을 자동 선택·협업합니다.
            </Text>

            {/* 셀룰러 데이터 다운로드 허용 토글 */}
            <View style={styles.toggleSettingCard}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>
                  📶 셀룰러 데이터 다운로드 허용
                </Text>
                <Text style={styles.toggleSub}>
                  {networkType === 'cellular'
                    ? '현재 셀룰러(5G/LTE) 연결 중 · 허용 시 대용량 다운로드 가능'
                    : '꺼두면 Wi-Fi 연결 시에만 대용량(4.7GB+) 다운로드를 허용합니다'}
                </Text>
              </View>
              <Switch
                value={allowCellularDownload}
                onValueChange={toggleAllowCellular}
                trackColor={{ false: '#3F3F46', true: '#F59E0B' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* 능동형 복합 AI 모드 선택 카드 */}
            <TouchableOpacity
              onPress={() => handleSelectMode('auto')}
              style={[
                styles.autoModeCard,
                selectionMode === 'auto' && styles.autoModeCardActive,
              ]}>
              <View style={styles.autoModeTop}>
                <Text style={styles.autoModeTitle}>
                  🧠 능동형 복합 AI 오케스트레이터 (추천)
                </Text>
                {selectionMode === 'auto' && (
                  <Text style={styles.autoModeActiveTag}>활성 ✓</Text>
                )}
              </View>
              <Text style={styles.autoModeDesc}>
                질문 성격을 자동 분석해 최적의 AI를 고르거나, 수리+한국어·코드+기획서 같은 복합 요청 시 두 AI가 순차 협업합니다.
              </Text>
            </TouchableOpacity>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}>
              {MODEL_ORDER.map((key) => {
                const spec = MODELS[key];
                const isInstalled = downloadedModels[key];
                const isManualFixed = selectionMode === key;
                const isThisDownloading = downloadingKey === key;

                return (
                  <View
                    key={key}
                    style={[
                      styles.modelCard,
                      isManualFixed && { borderColor: spec.badgeColor },
                    ]}>
                    <View style={styles.modelCardInfo}>
                      <View style={styles.modelCardTitleRow}>
                        <View style={styles.modelNameBadgeWrap}>
                          <View
                            style={[
                              styles.specialtyBadge,
                              { backgroundColor: spec.badgeColor },
                            ]}>
                            <Text style={styles.specialtyBadgeText}>{spec.badge}</Text>
                          </View>
                          <Text style={styles.modelCardName}>{spec.title}</Text>
                        </View>
                        <Text
                          style={[
                            styles.modelCardSize,
                            { color: spec.badgeColor },
                          ]}>
                          {spec.sizeLabel}
                        </Text>
                      </View>
                      <Text style={styles.modelCardSub}>{spec.subtitle}</Text>
                    </View>

                    {isThisDownloading ? (
                      <View style={styles.downloadingCol}>
                        <View style={styles.progressTrack}>
                          <Animated.View
                            style={[
                              styles.progressFill,
                              {
                                backgroundColor: spec.badgeColor,
                                width: progressBarAnim.interpolate({
                                  inputRange: [0, 100],
                                  outputRange: ['0%', '100%'],
                                }),
                              },
                            ]}
                          />
                        </View>
                        <View style={styles.downloadingRow}>
                          <ActivityIndicator color={spec.badgeColor} size="small" />
                          <Text
                            style={[
                              styles.downloadingPct,
                              { color: spec.badgeColor },
                            ]}>
                            {downloadProgress}% · {downloadStatusText}
                          </Text>
                          <TouchableOpacity
                            onPress={handleCancelDownload}
                            style={styles.cancelDlBtn}>
                            <Text style={styles.cancelDlText}>취소</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : isInstalled ? (
                      <View style={styles.installedActions}>
                        <TouchableOpacity
                          onPress={() => handleSelectMode(key)}
                          style={[
                            styles.useModelBtn,
                            { backgroundColor: spec.badgeColor },
                            isManualFixed && styles.useModelBtnCurrent,
                          ]}>
                          <Text style={styles.useModelBtnText}>
                            {isManualFixed
                              ? '수동 고정 사용 중 ✓'
                              : '이 모델만 수동 고정'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeleteModel(key)}
                          style={styles.deleteModelBtn}>
                          <Text style={styles.deleteModelBtnText}>삭제</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        disabled={downloadingKey !== null}
                        onPress={() => handleDownloadModel(key)}
                        style={[
                          styles.downloadModelBtn,
                          downloadingKey !== null && styles.disabledBtn,
                        ]}>
                        <Text style={styles.downloadModelBtnText}>
                          {networkType === 'cellular' && !allowCellularDownload
                            ? `다운로드 (${spec.sizeLabel} · Wi-Fi 필요)`
                            : `다운로드 (${spec.sizeLabel})`}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#212121',
  },
  topBar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    backgroundColor: '#212121',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    color: '#ECECEC',
    fontSize: 20,
    fontWeight: '500',
  },
  modelSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    gap: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modelPillTitle: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '600',
  },
  modelPillChevron: {
    color: '#9B9B9B',
    fontSize: 13,
  },
  quickFeatureBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 6,
    gap: 6,
  },
  featurePill: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  featurePillOnline: {
    backgroundColor: '#132E26',
    borderColor: '#10A37F',
  },
  featurePillOffline: {
    backgroundColor: '#262626',
    borderColor: '#383838',
  },
  featurePillText: {
    color: '#B4B4B4',
    fontSize: 11,
    fontWeight: '600',
  },
  featurePillTextOnline: {
    color: '#6EE7B7',
  },
  toastWrap: {
    alignSelf: 'center',
    backgroundColor: '#333333',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 4,
  },
  toastText: {
    color: '#ECECEC',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A2E28',
    paddingVertical: 8,
    gap: 8,
  },
  loadingBannerText: {
    color: '#6EE7B7',
    fontSize: 13,
    fontWeight: '500',
  },
  emptyStateContainer: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
  },
  centerLogoWrap: {
    alignItems: 'center',
    marginTop: 6,
  },
  logoOuterWrap: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  logoGlowRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  centerLogoCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLogoIcon: {
    color: '#212121',
    fontSize: 24,
    fontWeight: '700',
  },
  activeSpecialtyBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginBottom: 8,
  },
  activeSpecialtyText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  centerTitle: {
    color: '#ECECEC',
    fontSize: 21,
    fontWeight: '700',
    marginBottom: 5,
  },
  centerSubtitle: {
    color: '#9B9B9B',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  suggestionsGrid: {
    gap: 9,
    marginTop: 18,
  },
  suggestionCard: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#383838',
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  suggestionBadge: {
    color: '#10A37F',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  suggestionTitle: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  suggestionDesc: {
    color: '#9B9B9B',
    fontSize: 12,
  },
  messageListContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 18,
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 20,
  },
  userText: {
    color: '#ECECEC',
    fontSize: 15,
    lineHeight: 22,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  avatarBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarGlyph: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  assistantContentCol: {
    flex: 1,
    gap: 8,
  },
  orchestrationPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  orchestrationPillText: {
    color: '#A7F3D0',
    fontSize: 11,
    fontWeight: '600',
  },
  pluginBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pluginUsedChip: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  pluginUsedChipText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '600',
  },
  sourcesCard: {
    backgroundColor: '#162420',
    borderWidth: 1,
    borderColor: '#244239',
    borderRadius: 10,
    padding: 10,
    gap: 3,
  },
  sourcesHeader: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  sourceItemText: {
    color: '#D1FAE5',
    fontSize: 11,
  },
  stage1Card: {
    backgroundColor: '#19222C',
    borderWidth: 1,
    borderColor: '#2B3E52',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  stage1Header: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  stage1Body: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  waveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  assistantText: {
    color: '#ECECEC',
    fontSize: 15,
    lineHeight: 24,
  },
  boldText: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cursorDot: {
    color: '#10A37F',
    fontSize: 14,
  },
  codeCard: {
    backgroundColor: '#141414',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333333',
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  codeLang: {
    color: '#B4B4B4',
    fontSize: 12,
    fontWeight: '600',
  },
  codeCopyBtn: {
    color: '#ECECEC',
    fontSize: 12,
    fontWeight: '600',
  },
  codeBody: {
    color: '#E5E7EB',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
  },
  actionBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
  },
  actionChipText: {
    color: '#B4B4B4',
    fontSize: 12,
    fontWeight: '500',
  },
  bottomDock: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 10,
    backgroundColor: '#212121',
  },
  inputCapsule: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#2F2F2F',
    borderRadius: 24,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 7,
    gap: 8,
  },
  plusToolBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#3D3D3D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusToolText: {
    color: '#ECECEC',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 22,
  },
  textInput: {
    flex: 1,
    maxHeight: 110,
    color: '#ECECEC',
    fontSize: 15,
    lineHeight: 21,
    paddingTop: 6,
    paddingBottom: 6,
  },
  sendCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircleBtnDisabled: {
    backgroundColor: '#4A4A4A',
  },
  sendArrow: {
    color: '#212121',
    fontSize: 18,
    fontWeight: '800',
  },
  stopCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 11,
    height: 11,
    borderRadius: 2,
    backgroundColor: '#212121',
  },
  footerDisclaimer: {
    color: '#7A7A7A',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  drawerPanel: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: '#171717',
  },
  drawerSafe: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
  },
  newChatDrawerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#262626',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
    marginBottom: 18,
  },
  newChatDrawerIcon: {
    color: '#10A37F',
    fontSize: 16,
    fontWeight: '700',
  },
  newChatDrawerText: {
    color: '#ECECEC',
    fontSize: 15,
    fontWeight: '600',
  },
  drawerSectionLabel: {
    color: '#8E8EA0',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    marginBottom: 4,
    paddingRight: 6,
  },
  sessionRowActive: {
    backgroundColor: '#2A2A2A',
  },
  sessionTitleBtn: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 10,
  },
  sessionTitleText: {
    color: '#B4B4B4',
    fontSize: 14,
  },
  sessionTitleTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sessionDeleteBtn: {
    padding: 8,
  },
  sessionDeleteText: {
    color: '#7A7A7A',
    fontSize: 13,
  },
  drawerFooterGroup: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingTop: 10,
    gap: 12,
  },
  drawerFooterBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  drawerFooterText: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '90%',
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  modalClose: {
    color: '#9B9B9B',
    fontSize: 15,
    fontWeight: '600',
  },
  modalDesc: {
    color: '#9B9B9B',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  toggleSettingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#383838',
    borderRadius: 14,
    padding: 13,
    marginBottom: 11,
    gap: 10,
  },
  toggleTextCol: {
    flex: 1,
    gap: 3,
  },
  toggleTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  toggleSub: {
    color: '#A1A1AA',
    fontSize: 11,
    lineHeight: 16,
  },
  clipboardQuickAction: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  clipboardQuickActionText: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '700',
  },
  pluginRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2A2A2A',
    borderRadius: 13,
    padding: 13,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    gap: 10,
  },
  pluginInfoCol: {
    flex: 1,
    gap: 4,
  },
  pluginTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pluginTitleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  onlineOnlyTag: {
    backgroundColor: '#13392E',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  onlineOnlyTagText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '700',
  },
  pluginDescText: {
    color: '#B4B4B4',
    fontSize: 12,
    lineHeight: 17,
  },
  autoModeCard: {
    backgroundColor: '#172A24',
    borderRadius: 14,
    padding: 13,
    borderWidth: 1.5,
    borderColor: '#2A4A3F',
    marginBottom: 12,
    gap: 5,
  },
  autoModeCardActive: {
    borderColor: '#10A37F',
  },
  autoModeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  autoModeTitle: {
    color: '#ECFDF5',
    fontSize: 14,
    fontWeight: '700',
  },
  autoModeActiveTag: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '700',
  },
  autoModeDesc: {
    color: '#A7F3D0',
    fontSize: 12,
    lineHeight: 17,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  modelCard: {
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.2,
    borderColor: '#3A3A3A',
    gap: 10,
  },
  modelCardInfo: {
    gap: 5,
  },
  modelCardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  modelNameBadgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  specialtyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  specialtyBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  modelCardName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  modelCardSize: {
    fontSize: 13,
    fontWeight: '700',
  },
  modelCardSub: {
    color: '#B4B4B4',
    fontSize: 12,
  },
  downloadingCol: {
    gap: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#171717',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  downloadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  downloadingPct: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  cancelDlBtn: {
    backgroundColor: '#3F3F46',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cancelDlText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
  },
  installedActions: {
    flexDirection: 'row',
    gap: 8,
  },
  useModelBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  useModelBtnCurrent: {
    opacity: 0.65,
  },
  useModelBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteModelBtn: {
    backgroundColor: '#3A2323',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  deleteModelBtnText: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '600',
  },
  downloadModelBtn: {
    backgroundColor: '#ECECEC',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  downloadModelBtnText: {
    color: '#171717',
    fontSize: 14,
    fontWeight: '700',
  },
});
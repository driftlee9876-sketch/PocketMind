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
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
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
type IntegrationKey =
  | 'github'
  | 'google'
  | 'notion'
  | 'web_reader'
  | 'calendar'
  | 'weather'
  | 'finance'
  | 'knowledge'
  | 'reminders'
  | 'kakao';

interface GoogleIntegrationState {
  enabled: boolean;
  accessToken: string;
  accountNote: string;
}

interface KakaoIntegrationState {
  enabled: boolean;
  accessToken: string;
  nicknameNote: string;
}

interface GitHubIntegrationState {
  enabled: boolean;
  repo: string;
  token: string;
}

interface NotionIntegrationState {
  enabled: boolean;
  token: string;
  workspaceNote: string;
}

interface SimplePluginState {
  enabled: boolean;
}

interface IntegrationsBundle {
  github: GitHubIntegrationState;
  google: GoogleIntegrationState;
  notion: NotionIntegrationState;
  web_reader: SimplePluginState;
  calendar: SimplePluginState;
  weather: SimplePluginState;
  finance: SimplePluginState;
  knowledge: SimplePluginState;
  reminders: SimplePluginState;
  kakao: KakaoIntegrationState;
}

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

interface CalendarEventDraft {
  title: string;
  startDate: Date;
  endDate: Date;
  displayText: string;
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
  integrationBadges?: string[];
  calendarDraft?: CalendarEventDraft;
  hasTodoCard?: boolean;
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
      '당신은 아이폰 16 Pro 온디바이스 환경에서 동작하는 AI 어시스턴트 PocketMind입니다. 연동된 GitHub, Google, Notion, 실시간 날씨, 환율·시세, 뉴스·위키, 웹페이지, 캘린더, 할 일 데이터를 정확히 반영해 한국어로 명확하게 답변하세요.',
  },
  math: {
    key: 'math',
    badge: '수학·논리 7B',
    badgeColor: '#3B82F6',
    title: 'Qwen2.5-Math 7B',
    shortTitle: 'Math 7B',
    subtitle: '고난도 방정식·미적분·환율/투자 계산·단계별 수리 증명 특화 모델',
    sizeLabel: '4.68 GB',
    expectedBytes: 4680000000,
    minBytes: 2300 * 1024 * 1024,
    filename: 'Qwen2.5-Math-7B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen2.5-Math-7B-Instruct-GGUF/resolve/main/Qwen2.5-Math-7B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
    systemPrompt:
      '당신은 수학 및 수리 논리 추론 전문 AI입니다. 모든 수리·금융 계산 문제는 풀이 과정을 단계별(Step-by-step)로 엄밀하게 전개하고 검산한 뒤 최종 정답을 명확히 도출하세요.',
  },
  korean: {
    key: 'korean',
    badge: '한국어 7.8B',
    badgeColor: '#A855F7',
    title: 'LG EXAONE 3.5 7.8B',
    shortTitle: 'EXAONE 7.8B',
    subtitle: 'LG AI 연구원 7.8B · 최상급 한국어 작문·뉴스 브리핑·문맥 이해',
    sizeLabel: '4.77 GB',
    expectedBytes: 4770000000,
    minBytes: 2300 * 1024 * 1024,
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    promptFormat: 'exaone',
    systemPrompt:
      '당신은 LG AI Research에서 개발한 한국어 특화 언어모델 EXAONE입니다. 유려하고 정확한 한국어 문장과 어휘를 구사하며, 실시간 검색·연동 데이터를 바탕으로 품격 있고 논리적으로 답변합니다.',
  },
};

const MODEL_ORDER: ModelKey[] = ['allrounder', 'math', 'korean'];

const INTEGRATION_SUGGESTIONS: SuggestionItem[] = [
  {
    badge: '🌤️ 실시간 날씨 + EXAONE 7.8B',
    title: '오늘 서울·청주 실시간 날씨와 옷차림 추천',
    desc: '기온·습도·강수 확률을 실시간 조회해 외출 브리핑 생성',
    prompt: '오늘 서울 실시간 날씨와 기온을 확인하고 옷차림을 추천해 줘.',
  },
  {
    badge: '💱 실시간 환율·시세 + Math 7B',
    title: '실시간 달러·엔화 환율 및 비트코인 시세 계산',
    desc: '현재 시장 환율을 불러와 원화 환산 금액까지 정밀 계산',
    prompt: '오늘 실시간 달러·엔화 환율과 비트코인 시세를 확인하고 1,500달러가 원화로 얼마인지 계산해 줘.',
  },
  {
    badge: '📰 실시간 뉴스 + EXAONE 7.8B',
    title: '오늘 대한민국 주요 뉴스 헤드라인 브리핑',
    desc: '최신 실시간 뉴스 피드를 수집해 핵심 이슈만 깔끔하게 요약',
    prompt: '오늘 주요 실시간 뉴스 헤드라인을 모아서 핵심만 브리핑해 줘.',
  },
  {
    badge: '✅ 할 일 · 📅 캘린더 연동',
    title: '할 일 체크리스트 등록 및 iOS 캘린더 일정 추가',
    desc: '대화 속 할 일과 약속을 자동으로 추출해 체크리스트·캘린더에 등록',
    prompt: '프로젝트 코드 리뷰, 운동하기, 내일 오후 3시 팀 미팅을 할 일에 추가해 줘.',
  },
];

const STORAGE_SESSIONS_KEY = '@pocketmind_sessions_v8';
const STORAGE_MODE_KEY = '@pocketmind_selection_mode_v8';
const STORAGE_SETTINGS_KEY = '@pocketmind_settings_v8';
const STORAGE_INTEGRATIONS_KEY = '@pocketmind_integrations_v8';
const STORAGE_TODOS_KEY = '@pocketmind_todos_v8';

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
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '));
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

function normalizeGitHubRepo(rawInput: string): string {
  const trimmed = rawInput.trim();
  const urlMatch = trimmed.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  if (urlMatch) {
    return urlMatch[1].replace(/\.git$/, '');
  }
  return trimmed.replace(/^\/+|\/+$/g, '');
}

async function fetchGitHubIntegrationContext(
  promptText: string,
  gh: GitHubIntegrationState,
): Promise<{ contextText: string; badge: string } | null> {
  if (!gh.enabled) return null;

  const fileUrlMatch = promptText.match(
    /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/blob\/([^/\s]+)\/([^\s)]+)/i,
  );
  const repoUrlMatch = promptText.match(
    /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i,
  );
  const mentionsGitHub =
    /(깃허브|github|커밋|commit|이슈|issue|풀리퀘|pr|저장소|repo|레포|소스코드)/i.test(
      promptText,
    );

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PocketMind-iOS',
  };
  if (gh.token.trim()) {
    headers.Authorization = `Bearer ${gh.token.trim()}`;
  }

  if (fileUrlMatch) {
    const repoPath = fileUrlMatch[1];
    const branch = fileUrlMatch[2];
    const filePath = fileUrlMatch[3];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${filePath}`;
      const res = await fetch(rawUrl, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const codeText = (await res.text()).slice(0, 3600);
        return {
          contextText: `[GitHub 파일 원문: ${repoPath}/${filePath} (${branch})]\n${codeText}`,
          badge: `🐙 GitHub (${filePath})`,
        };
      }
    } catch {
      // 폴백
    }
  }

  const targetRepo = repoUrlMatch
    ? repoUrlMatch[1].replace(/\.git$/, '')
    : mentionsGitHub && gh.repo.trim()
      ? normalizeGitHubRepo(gh.repo)
      : '';

  if (!targetRepo || !targetRepo.includes('/')) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const [repoRes, commitsRes, issuesRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${targetRepo}`, {
        headers,
        signal: controller.signal,
      }),
      fetch(`https://api.github.com/repos/${targetRepo}/commits?per_page=5`, {
        headers,
        signal: controller.signal,
      }),
      fetch(`https://api.github.com/repos/${targetRepo}/issues?state=open&per_page=5`, {
        headers,
        signal: controller.signal,
      }),
    ]);
    clearTimeout(timer);

    if (!repoRes.ok) return null;

    const repoData = await repoRes.json();
    const commitsData = commitsRes.ok ? await commitsRes.json() : [];
    const issuesData = issuesRes.ok ? await issuesRes.json() : [];

    const lines: string[] = [
      `[GitHub 저장소: ${repoData.full_name}]`,
      `• 설명: ${repoData.description || '없음'}`,
      `• 주 사용 언어: ${repoData.language || '미지정'} | ⭐ ${repoData.stargazers_count ?? 0} | 기본 브랜치: ${repoData.default_branch ?? 'main'}`,
    ];

    if (Array.isArray(commitsData) && commitsData.length > 0) {
      lines.push('• 최근 커밋 내역:');
      for (const c of commitsData.slice(0, 5)) {
        const msg = String(c?.commit?.message || '').split('\n')[0];
        const author = c?.commit?.author?.name || 'unknown';
        const sha = String(c?.sha || '').slice(0, 7);
        lines.push(`  - [${sha}] ${msg} (${author})`);
      }
    }

    if (Array.isArray(issuesData) && issuesData.length > 0) {
      const realIssues = issuesData.filter((it: any) => !it.pull_request);
      if (realIssues.length > 0) {
        lines.push('• 열린 이슈:');
        for (const iss of realIssues.slice(0, 4)) {
          lines.push(`  - #${iss.number} ${iss.title}`);
        }
      }
    }

    return {
      contextText: lines.join('\n'),
      badge: `🐙 GitHub (${repoData.full_name})`,
    };
  } catch {
    return null;
  }
}

async function fetchGoogleIntegrationContext(
  promptText: string,
  google: GoogleIntegrationState,
): Promise<{ contextText: string; badge: string } | null> {
  if (!google.enabled) return null;

  const docsMatch = promptText.match(
    /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i,
  );
  const sheetsMatch = promptText.match(
    /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i,
  );
  const driveFileMatch = promptText.match(
    /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
  );
  const mentionsGoogleDrive =
    /(구글\s*드라이브|google\s*drive|구글\s*문서|google\s*docs|구글\s*시트|내\s*드라이브)/i.test(
      promptText,
    );

  const authHeaders: Record<string, string> = {};
  if (google.accessToken.trim()) {
    authHeaders.Authorization = `Bearer ${google.accessToken.trim()}`;
  }

  if (docsMatch) {
    const docId = docsMatch[1];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const exportUrl = google.accessToken.trim()
        ? `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`
        : `https://docs.google.com/document/d/${docId}/export?format=txt`;
      const res = await fetch(exportUrl, {
        headers: authHeaders,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = (await res.text()).trim().slice(0, 3600);
        if (text.length > 10 && !text.startsWith('<!DOCTYPE html')) {
          return {
            contextText: `[Google Docs 문서 내용 (ID: ${docId})]\n${text}`,
            badge: '🔵 Google Docs',
          };
        }
      }
    } catch {
      // 무시
    }
  }

  if (sheetsMatch) {
    const sheetId = sheetsMatch[1];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const exportUrl = google.accessToken.trim()
        ? `https://www.googleapis.com/drive/v3/files/${sheetId}/export?mimeType=text/csv`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const res = await fetch(exportUrl, {
        headers: authHeaders,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const csvText = (await res.text()).trim().slice(0, 3600);
        if (csvText.length > 5 && !csvText.startsWith('<!DOCTYPE html')) {
          return {
            contextText: `[Google Sheets 데이터 (ID: ${sheetId})]\n${csvText}`,
            badge: '🔵 Google Sheets',
          };
        }
      }
    } catch {
      // 무시
    }
  }

  if (driveFileMatch && google.accessToken.trim()) {
    const fileId = driveFileMatch[1];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime,size`,
        { headers: authHeaders, signal: controller.signal },
      );
      clearTimeout(timer);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        return {
          contextText: `[Google Drive 파일 정보]\n• 파일명: ${meta.name}\n• 형식: ${meta.mimeType}\n• 수정일: ${meta.modifiedTime}`,
          badge: `🔵 Google Drive (${meta.name})`,
        };
      }
    } catch {
      // 무시
    }
  }

  if (mentionsGoogleDrive && google.accessToken.trim()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const listRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?pageSize=7&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime)',
        { headers: authHeaders, signal: controller.signal },
      );
      clearTimeout(timer);
      if (listRes.ok) {
        const json = await listRes.json();
        const files = json?.files ?? [];
        if (files.length > 0) {
          const listText = files
            .map(
              (f: any, i: number) =>
                `${i + 1}. ${f.name} (${f.mimeType}, 수정: ${String(f.modifiedTime || '').slice(0, 10)})`,
            )
            .join('\n');
          return {
            contextText: `[연동된 Google Drive 최근 파일 목록]\n${listText}`,
            badge: `🔵 Google Drive (${files.length}개 파일)`,
          };
        }
      }
    } catch {
      // 무시
    }
  }

  return null;
}

function extractNotionPageTitle(pageObj: any): string {
  const props = pageObj?.properties ?? {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      const joined = prop.title.map((t: any) => t?.plain_text || '').join('');
      if (joined.trim()) return joined.trim();
    }
  }
  return '제목 없는 페이지';
}

async function fetchNotionIntegrationContext(
  promptText: string,
  notion: NotionIntegrationState,
): Promise<{ contextText: string; badge: string } | null> {
  if (!notion.enabled || !notion.token.trim()) return null;
  if (!/(노션|notion|워크스페이스|페이지|노트|회의록)/i.test(promptText)) {
    return null;
  }

  const headers = {
    Authorization: `Bearer ${notion.token.trim()}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 4,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    const pages = data?.results ?? [];
    if (pages.length === 0) return null;

    const lines: string[] = ['[연동된 Notion 최근 페이지 목록]'];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const title = extractNotionPageTitle(p);
      const edited = String(p.last_edited_time || '').slice(0, 10);
      lines.push(`${i + 1}. ${title} (수정일: ${edited})`);

      if (i === 0 && p.id) {
        try {
          const blkRes = await fetch(
            `https://api.notion.com/v1/blocks/${p.id}/children?page_size=12`,
            { headers },
          );
          if (blkRes.ok) {
            const blkJson = await blkRes.json();
            const texts: string[] = [];
            for (const b of blkJson?.results ?? []) {
              const rich = b?.[b.type]?.rich_text;
              if (Array.isArray(rich)) {
                const line = rich.map((r: any) => r?.plain_text || '').join('');
                if (line.trim()) texts.push(line.trim());
              }
            }
            if (texts.length > 0) {
              lines.push(`   └ 본문 미리보기: ${texts.join(' / ').slice(0, 900)}`);
            }
          }
        } catch {
          // 무시
        }
      }
    }

    return {
      contextText: lines.join('\n'),
      badge: `📝 Notion (${pages.length}개 페이지)`,
    };
  } catch {
    return null;
  }
}

async function saveSummaryToNotionPage(
  notion: NotionIntegrationState,
  title: string,
  content: string,
): Promise<boolean> {
  if (!notion.enabled || !notion.token.trim()) return false;
  const headers = {
    Authorization: `Bearer ${notion.token.trim()}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        page_size: 1,
      }),
    });
    if (!searchRes.ok) return false;
    const searchData = await searchRes.json();
    const parentId = searchData?.results?.[0]?.id;
    if (!parentId) return false;

    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties: {
          title: {
            title: [{ text: { content: title.slice(0, 80) } }],
          },
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: content.slice(0, 1900) } }],
            },
          },
        ],
      }),
    });
    return createRes.ok;
  } catch {
    return false;
  }
}

async function fetchGenericWebUrlContext(
  promptText: string,
  enabled: boolean,
): Promise<{ contextText: string; badge: string } | null> {
  if (!enabled) return null;
  const urlMatches = promptText.match(/https?:\/\/[^\s)]+/gi);
  if (!urlMatches) return null;

  const targetUrl = urlMatches.find(
    (u) =>
      !/github\.com/i.test(u) &&
      !/docs\.google\.com/i.test(u) &&
      !/drive\.google\.com/i.test(u),
  );
  if (!targetUrl) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? stripHtmlTags(titleMatch[1]) : targetUrl;
    const cleanedBody = stripHtmlTags(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' '),
    ).slice(0, 3200);

    if (cleanedBody.length < 40) return null;

    return {
      contextText: `[웹페이지 본문 추출: ${pageTitle} (${targetUrl})]\n${cleanedBody}`,
      badge: `🌐 웹 URL (${pageTitle.slice(0, 16)})`,
    };
  } catch {
    return null;
  }
}

function describeWeatherCode(code: number): string {
  if (code === 0) return '맑음';
  if (code <= 3) return '구름 조금·흐림';
  if (code <= 48) return '안개';
  if (code <= 67) return '비·이슬비';
  if (code <= 77) return '눈';
  if (code <= 82) return '소나기';
  if (code <= 99) return '뇌우';
  return '보통';
}

async function fetchWeatherContext(
  promptText: string,
  enabled: boolean,
): Promise<{ contextText: string; badge: string } | null> {
  if (!enabled) return null;
  if (!/(날씨|기온|온도|비\s*오|비\s*와|눈\s*와|미세먼지|우산|옷차림|일기예보)/i.test(promptText)) {
    return null;
  }

  const cityPresets: { pattern: RegExp; label: string; lat: number; lon: number }[] = [
    { pattern: /서울/, label: '서울', lat: 37.5665, lon: 126.978 },
    { pattern: /청주/, label: '청주', lat: 36.6424, lon: 127.489 },
    { pattern: /부산/, label: '부산', lat: 35.1796, lon: 129.0756 },
    { pattern: /인천/, label: '인천', lat: 37.4563, lon: 126.7052 },
    { pattern: /대구/, label: '대구', lat: 35.8714, lon: 128.6014 },
    { pattern: /대전/, label: '대전', lat: 36.3504, lon: 127.3845 },
    { pattern: /광주/, label: '광주', lat: 35.1595, lon: 126.8526 },
    { pattern: /제주/, label: '제주', lat: 33.4996, lon: 126.5312 },
    { pattern: /도쿄/, label: '도쿄', lat: 35.6762, lon: 139.6503 },
    { pattern: /뉴욕/, label: '뉴욕', lat: 40.7128, lon: -74.006 },
  ];

  const matched = cityPresets.find((c) => c.pattern.test(promptText)) ?? cityPresets[0];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${matched.lat}&longitude=${matched.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=2`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    const cur = data?.current;
    const daily = data?.daily;
    if (!cur) return null;

    const statusStr = describeWeatherCode(Number(cur.weather_code ?? 0));
    const lines = [
      `[실시간 날씨 데이터: ${matched.label}]`,
      `• 현재 상태: ${statusStr} | 현재 기온: ${cur.temperature_2m}°C (체감 ${cur.apparent_temperature}°C)`,
      `• 습도: ${cur.relative_humidity_2m}% | 풍속: ${cur.wind_speed_10m} km/h | 강수량: ${cur.precipitation} mm`,
    ];
    if (daily?.temperature_2m_min && daily?.temperature_2m_max) {
      lines.push(
        `• 오늘 최저/최고: ${daily.temperature_2m_min[0]}°C / ${daily.temperature_2m_max[0]}°C (강수확률 ${daily.precipitation_probability_max?.[0] ?? 0}%)`,
      );
      if (daily.temperature_2m_min.length > 1) {
        lines.push(
          `• 내일 최저/최고: ${daily.temperature_2m_min[1]}°C / ${daily.temperature_2m_max[1]}°C (강수확률 ${daily.precipitation_probability_max?.[1] ?? 0}%)`,
        );
      }
    }

    return {
      contextText: lines.join('\n'),
      badge: `🌤️ ${matched.label} ${cur.temperature_2m}°C`,
    };
  } catch {
    return null;
  }
}

async function fetchFinanceMarketContext(
  promptText: string,
  enabled: boolean,
): Promise<{ contextText: string; badge: string } | null> {
  if (!enabled) return null;
  const wantsFx = /(환율|달러|엔화|유로|위안|usd|jpy|eur|krw)/i.test(promptText);
  const wantsCrypto = /(비트코인|이더리움|솔라나|코인|암호화폐|btc|eth|sol)/i.test(promptText);
  if (!wantsFx && !wantsCrypto) return null;

  const lines: string[] = ['[실시간 금융·환율 시장 데이터]'];
  let badgeText = '💱 실시간 시세';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);

    if (wantsFx) {
      const fxRes = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: controller.signal,
      });
      if (fxRes.ok) {
        const fx = await fxRes.json();
        const rates = fx?.rates;
        if (rates?.KRW) {
          const usdKrw = Number(rates.KRW);
          const jpy100Krw = rates.JPY ? (usdKrw / Number(rates.JPY)) * 100 : 0;
          const eurKrw = rates.EUR ? usdKrw / Number(rates.EUR) : 0;
          lines.push(`• 미국 달러 (1 USD): ${usdKrw.toFixed(2)} 원`);
          if (jpy100Krw > 0) {
            lines.push(`• 일본 엔화 (100 JPY): ${jpy100Krw.toFixed(2)} 원`);
          }
          if (eurKrw > 0) {
            lines.push(`• 유럽 유로 (1 EUR): ${eurKrw.toFixed(2)} 원`);
          }
          badgeText = `💱 1달러=${Math.round(usdKrw)}원`;
        }
      }
    }

    if (wantsCrypto) {
      const cryptoRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=krw,usd',
        { signal: controller.signal },
      );
      if (cryptoRes.ok) {
        const c = await cryptoRes.json();
        if (c?.bitcoin?.krw) {
          lines.push(
            `• 비트코인 (BTC): ${Number(c.bitcoin.krw).toLocaleString()} 원 ($${Number(c.bitcoin.usd).toLocaleString()})`,
          );
          if (!wantsFx) {
            badgeText = `₿ BTC ${(Number(c.bitcoin.krw) / 10000).toFixed(0)}만원`;
          }
        }
        if (c?.ethereum?.krw) {
          lines.push(
            `• 이더리움 (ETH): ${Number(c.ethereum.krw).toLocaleString()} 원 ($${Number(c.ethereum.usd).toLocaleString()})`,
          );
        }
        if (c?.solana?.krw) {
          lines.push(
            `• 솔라나 (SOL): ${Number(c.solana.krw).toLocaleString()} 원 ($${Number(c.solana.usd).toLocaleString()})`,
          );
        }
      }
    }

    clearTimeout(timer);
    if (lines.length <= 1) return null;

    return {
      contextText: lines.join('\n'),
      badge: badgeText,
    };
  } catch {
    return null;
  }
}

async function fetchKnowledgeAndNewsContext(
  promptText: string,
  enabled: boolean,
): Promise<{ contextText: string; badge: string } | null> {
  if (!enabled) return null;

  const wantsNews = /(오늘\s*뉴스|최신\s*뉴스|주요\s*뉴스|헤드라인|속보|뉴스\s*브리핑|뉴스\s*요약)/i.test(
    promptText,
  );
  const wikiMatch = promptText.match(
    /([가-힣A-Za-z0-9_]+)\s*(?:위키|백과|정의|개념|란\s*무엇|이\s*뭐야)/i,
  );

  if (wantsNews) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);
      const res = await fetch(
        'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko',
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (res.ok) {
        const xml = await res.text();
        const itemMatches = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/gi)];
        const headlines = itemMatches
          .slice(0, 7)
          .map((m, idx) => `${idx + 1}. ${decodeHtmlEntities(m[1])}`);
        if (headlines.length > 0) {
          return {
            contextText: `[실시간 대한민국 주요 뉴스 헤드라인]\n${headlines.join('\n')}`,
            badge: `📰 실시간 뉴스 (${headlines.length}건)`,
          };
        }
      }
    } catch {
      // 무시
    }
  }

  if (wikiMatch) {
    const keyword = wikiMatch[1].trim();
    if (keyword.length >= 2) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7500);
        const res = await fetch(
          `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(keyword)}`,
          { signal: controller.signal },
        );
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data?.extract) {
            return {
              contextText: `[한국어 위키백과 백과사전: ${data.title}]\n${String(data.extract).slice(0, 1800)}`,
              badge: `📚 위키백과 (${data.title})`,
            };
          }
        }
      } catch {
        // 무시
      }
    }
  }

  return null;
}

function parseCalendarDraftFromPrompt(
  promptText: string,
  enabled: boolean,
): CalendarEventDraft | null {
  if (!enabled) return null;
  if (
    !/(일정\s*등록|캘린더에\s*추가|캘린더\s*등록|일정\s*잡아|약속\s*추가|스케줄\s*등록|미팅)/i.test(
      promptText,
    )
  ) {
    return null;
  }

  const now = new Date();
  const target = new Date(now.getTime());

  if (/내일/.test(promptText)) {
    target.setDate(target.getDate() + 1);
  } else if (/모레/.test(promptText)) {
    target.setDate(target.getDate() + 2);
  } else {
    const mdMatch = promptText.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (mdMatch) {
      target.setMonth(parseInt(mdMatch[1], 10) - 1, parseInt(mdMatch[2], 10));
    }
  }

  let hour = 10;
  let minute = 0;
  const timeMatch = promptText.match(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (timeMatch) {
    const meridiem = timeMatch[1];
    let h = parseInt(timeMatch[2], 10);
    const m = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    if (meridiem === '오후' && h < 12) h += 12;
    if (meridiem === '오전' && h === 12) h = 0;
    hour = h;
    minute = m;
  }

  target.setHours(hour, minute, 0, 0);
  const end = new Date(target.getTime() + 60 * 60 * 1000);

  const cleanedTitle = promptText
    .replace(/(오늘|내일|모레|\d{1,2}\s*월\s*\d{1,2}\s*일)/g, '')
    .replace(/(오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/g, '')
    .replace(/(일정을?|캘린더에|추가해\s*줘|등록해\s*줘|잡아\s*줘|할\s*일에|해줘)/g, '')
    .trim();

  const title = cleanedTitle.length >= 2 ? cleanedTitle.slice(0, 36) : 'PocketMind 새 일정';
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  const hh = String(target.getHours()).padStart(2, '0');
  const min = String(target.getMinutes()).padStart(2, '0');

  return {
    title,
    startDate: target,
    endDate: end,
    displayText: `${yyyy}.${mm}.${dd} ${hh}:${min} · ${title}`,
  };
}

function formatIcsUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${da}T${hh}${mi}${ss}Z`;
}

function analyzeAutonomousPlan(
  promptText: string,
  installed: Record<ModelKey, boolean>,
): ExecutionPlan {
  const lower = promptText.toLowerCase();

  const mathRegex =
    /(수학|방정식|미분|적분|극댓값|극솟값|확률|통계|기댓값|복리|단리|연리|이율|원리금|환율|원화|달러|엔화|시세|행렬|벡터|기하|삼각함수|로그|지수|수열|점화식|극한|순열|조합|경우의\s*수|증명|연립방정식|계산해|풀어\s*줘|풀이|sin|cos|tan|log|sqrt|\^2|\^3|\d+\s*[+\-*/=]\s*\d+)/i;
  const koreanWritingRegex =
    /(이메일|메일|초안|자기소개서|자소서|에세이|윤문|교정|맞춤법|띄어쓰기|보고서|제안서|기획서|안내문|공지문|사과문|편지|작문|문장|다듬어|사자성어|어휘|뉘앙스|소설|시\s*써|기사|번역|요약해|노션|회의록|뉴스|브리핑|날씨)/i;
  const codeTechRegex =
    /(코드|파이썬|python|javascript|typescript|react|sql|html|css|알고리즘|함수|클래스|버그|에러|디버깅|api|아키텍처|스크립트|깃허브|github|커밋|저장소)/i;

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
      summaryLabel: `복합 협업 · ${MODELS.allrounder.shortTitle} 기술 분석 → ${MODELS.korean.shortTitle} 한국어 정리`,
      steps: [
        {
          modelKey: 'allrounder',
          roleTitle: `1단계 · ${MODELS.allrounder.shortTitle} 기술·코드 핵심 분석`,
          instructionHint:
            '다음 요청에서 필요한 기술적 분석과 핵심 코드·구조만 정확하게 정리해 출력하세요:\n\n',
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

  // 네트워크 및 셀룰러 설정 상태
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [networkType, setNetworkType] = useState<'wifi' | 'cellular' | 'none' | 'unknown'>(
    'unknown',
  );
  const [allowCellularDownload, setAllowCellularDownload] = useState<boolean>(false);

  // 10종 핵심 외부·로컬 연동 플러그인
  const [integrations, setIntegrations] = useState<IntegrationsBundle>({
    github: { enabled: true, repo: '', token: '' },
    google: { enabled: true, accessToken: '', accountNote: '' },
    notion: { enabled: true, token: '', workspaceNote: '' },
    web_reader: { enabled: true },
    calendar: { enabled: true },
    weather: { enabled: true },
    finance: { enabled: true },
    knowledge: { enabled: true },
    reminders: { enabled: true },
    kakao: { enabled: true, accessToken: '', nicknameNote: '' },
  });
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [expandedCard, setExpandedCard] = useState<IntegrationKey | null>('github');
  const [testingIntegration, setTestingIntegration] = useState<IntegrationKey | null>(null);

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
  const todosRef = useRef<TodoItem[]>([]);
  todosRef.current = todos;
  const stopRequestedRef = useRef<boolean>(false);
  const allowCellularRef = useRef<boolean>(false);
  allowCellularRef.current = allowCellularDownload;

  const showToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => {
      setToastText((prev) => (prev === msg ? '' : prev));
    }, 2200);
  };

  const persistIntegrations = async (next: IntegrationsBundle) => {
    setIntegrations(next);
    try {
      await AsyncStorage.setItem(STORAGE_INTEGRATIONS_KEY, JSON.stringify(next));
    } catch {
      // 무시
    }
  };

  const persistTodos = async (next: TodoItem[]) => {
    setTodos(next);
    try {
      await AsyncStorage.setItem(STORAGE_TODOS_KEY, JSON.stringify(next));
    } catch {
      // 무시
    }
  };

  const toggleTodoItem = async (id: string) => {
    const updated = todosRef.current.map((t) =>
      t.id === id ? { ...t, done: !t.done } : t,
    );
    await persistTodos(updated);
  };

  const toggleAllowCellular = async (val: boolean) => {
    setAllowCellularDownload(val);
    try {
      await AsyncStorage.setItem(
        STORAGE_SETTINGS_KEY,
        JSON.stringify({ allowCellularDownload: val }),
      );
    } catch {
      // 무시
    }
    showToast(
      val
        ? '📶 셀룰러 데이터 모델 다운로드 허용됨'
        : 'Wi-Fi 전용 다운로드 보호 활성화됨',
    );
  };

  const handleExportCalendarIcs = async (draft: CalendarEventDraft) => {
    try {
      const startObj = new Date(draft.startDate);
      const endObj = new Date(draft.endDate);
      const uid = `pocketmind-${Date.now()}@ios`;
      const icsBody = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//PocketMind//iOS Calendar Plugin//KO',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${formatIcsUtc(new Date())}`,
        `DTSTART:${formatIcsUtc(startObj)}`,
        `DTEND:${formatIcsUtc(endObj)}`,
        `SUMMARY:${draft.title}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const icsPath = `${RNFS.CachesDirectoryPath}/event_${Date.now()}.ics`;
      await RNFS.writeFile(icsPath, icsBody, 'utf8');
      await Share.share({
        url: `file://${icsPath}`,
        title: draft.title,
      });
    } catch {
      try {
        await Linking.openURL('calshow://');
      } catch {
        showToast('캘린더 앱을 열 수 없습니다');
      }
    }
  };

  // 카카오톡 온디맨드 전송 (명시적 요청 시에만 실행)
  const sendMessageToKakaoTalk = useCallback(
    async (textToSend: string) => {
      if (!integrations.kakao.enabled) return;

      const trimmed = textToSend.trim();
      if (!trimmed) return;

      const token = integrations.kakao.accessToken.trim();
      if (token && isConnected) {
        try {
          const templateObj = JSON.stringify({
            object_type: 'text',
            text: trimmed.slice(0, 1000),
            link: {
              web_url: 'https://developers.kakao.com',
              mobile_web_url: 'https://developers.kakao.com',
            },
            button_title: 'PocketMind AI 요약',
          });

          const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            },
            body: `template_object=${encodeURIComponent(templateObj)}`,
          });

          if (res.ok) {
            showToast('💬 카카오톡 나에게 보내기 완료!');
            return;
          }
        } catch {
          // 폴백 진행
        }
      }

      try {
        await Share.share({ message: trimmed });
      } catch {
        // 무시
      }
    },
    [integrations.kakao.accessToken, integrations.kakao.enabled, isConnected],
  );

  const handlePullClipboard = async () => {
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
          : `다음 클립보드 내용을 핵심 요약해 줘:\n\n${trimmed}`,
      );
      showToast('📋 클립보드 내용을 불러왔습니다');
    } catch {
      showToast('클립보드를 읽지 못했습니다');
    }
  };

  const handleTestIntegration = async (key: IntegrationKey) => {
    setTestingIntegration(key);
    try {
      if (key === 'github') {
        const repo = normalizeGitHubRepo(integrations.github.repo);
        if (!repo || !repo.includes('/')) {
          Alert.alert(
            '저장소 형식 확인',
            '예시처럼 "소유자/저장소이름" 형식으로 입력해 주세요.\n(예: facebook/react-native)',
          );
          return;
        }
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'PocketMind-iOS',
        };
        if (integrations.github.token.trim()) {
          headers.Authorization = `Bearer ${integrations.github.token.trim()}`;
        }
        const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
        if (res.ok) {
          const data = await res.json();
          Alert.alert(
            'GitHub 연동 성공 ✓',
            `저장소: ${data.full_name}\n언어: ${data.language || '없음'} · ⭐ ${data.stargazers_count}`,
          );
        } else {
          Alert.alert(
            'GitHub 연결 실패',
            `저장소를 찾을 수 없거나 비공개 저장소입니다. (HTTP ${res.status})`,
          );
        }
      } else if (key === 'google') {
        const token = integrations.google.accessToken.trim();
        if (!token) {
          Alert.alert(
            'Google 기본 연동 안내',
            '토큰 없이도 대화창에 공개 Google Docs/Sheets 링크를 붙여넣으면 즉시 내용을 읽어옵니다.',
          );
          return;
        }
        const res = await fetch(
          'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = await res.json();
          const email = data?.user?.emailAddress || '연결됨';
          await persistIntegrations({
            ...integrations,
            google: { ...integrations.google, accountNote: email },
          });
          Alert.alert('Google Drive 연동 성공 ✓', `연결된 계정: ${email}`);
        } else {
          Alert.alert('Google 토큰 오류', `토큰을 확인해 주세요. (HTTP ${res.status})`);
        }
      } else if (key === 'notion') {
        const token = integrations.notion.token.trim();
        if (!token) {
          Alert.alert(
            'Notion 토큰 필요',
            'Notion 내 통합(Internal Integration) 시크릿 토큰(ntn_... 또는 secret_...)을 입력해 주세요.',
          );
          return;
        }
        const res = await fetch('https://api.notion.com/v1/users/me', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (res.ok) {
          const data = await res.json();
          const botName = data?.name || 'Notion 워크스페이스';
          await persistIntegrations({
            ...integrations,
            notion: { ...integrations.notion, workspaceNote: botName },
          });
          Alert.alert('Notion 연동 성공 ✓', `연결된 통합 앱: ${botName}`);
        } else {
          Alert.alert('Notion 토큰 오류', `토큰을 확인해 주세요. (HTTP ${res.status})`);
        }
      } else if (key === 'kakao') {
        const token = integrations.kakao.accessToken.trim();
        if (!token) {
          Alert.alert(
            '카카오톡 온디맨드 연동 안내',
            '평소에는 화면에 버튼을 띄우지 않으며, 대화 중 "카톡으로 보내줘"라고 말할 때만 전송됩니다.',
          );
          return;
        }
        const res = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const nick = data?.kakao_account?.profile?.nickname || `회원 #${data.id}`;
          await persistIntegrations({
            ...integrations,
            kakao: { ...integrations.kakao, nicknameNote: nick },
          });
          Alert.alert('카카오톡 연동 성공 ✓', `연결된 프로필: ${nick}`);
        } else {
          Alert.alert('카카오톡 토큰 오류', `토큰을 확인해 주세요. (HTTP ${res.status})`);
        }
      }
    } catch (err) {
      Alert.alert('네트워크 오류', `연결 테스트 중 오류가 발생했습니다.\n(${String(err)})`);
    } finally {
      setTestingIntegration(null);
    }
  };

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
          if (typeof parsed.allowCellularDownload === 'boolean') {
            setAllowCellularDownload(parsed.allowCellularDownload);
          }
        }

        const savedIntRaw = await AsyncStorage.getItem(STORAGE_INTEGRATIONS_KEY);
        if (savedIntRaw && mounted) {
          const parsedInt = JSON.parse(savedIntRaw);
          setIntegrations((prev) => ({
            github: { ...prev.github, ...(parsedInt.github || {}) },
            google: { ...prev.google, ...(parsedInt.google || {}) },
            notion: { ...prev.notion, ...(parsedInt.notion || {}) },
            web_reader: { ...prev.web_reader, ...(parsedInt.web_reader || {}) },
            calendar: { ...prev.calendar, ...(parsedInt.calendar || {}) },
            weather: { ...prev.weather, ...(parsedInt.weather || {}) },
            finance: { ...prev.finance, ...(parsedInt.finance || {}) },
            knowledge: { ...prev.knowledge, ...(parsedInt.knowledge || {}) },
            reminders: { ...prev.reminders, ...(parsedInt.reminders || {}) },
            kakao: { ...prev.kakao, ...(parsedInt.kakao || {}) },
          }));
        }

        const savedTodosRaw = await AsyncStorage.getItem(STORAGE_TODOS_KEY);
        if (savedTodosRaw && mounted) {
          setTodos(JSON.parse(savedTodosRaw));
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
          'User-Agent': 'PocketMind-iOS/8.0',
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
      ? `${spec.systemPrompt}\n\n[외부 연동 플러그인 실시간 데이터]\n${externalContextBlock}\n위 연동 데이터를 바탕으로 사용자 요청에 정확하게 답변하세요.`
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

    // 1. 10종 연동 플러그인 데이터 수집
    const integrationBadges: string[] = [];
    const contextSections: string[] = [];

    if (isConnected && integrations.github.enabled) {
      setEngineBannerText('🐙 GitHub 저장소 데이터 동기화 중...');
      const ghRes = await fetchGitHubIntegrationContext(userText, integrations.github);
      if (ghRes) {
        contextSections.push(ghRes.contextText);
        integrationBadges.push(ghRes.badge);
      }
      setEngineBannerText('');
    }

    if (isConnected && integrations.google.enabled) {
      setEngineBannerText('🔵 Google Drive · Docs 데이터 확인 중...');
      const googleRes = await fetchGoogleIntegrationContext(userText, integrations.google);
      if (googleRes) {
        contextSections.push(googleRes.contextText);
        integrationBadges.push(googleRes.badge);
      }
      setEngineBannerText('');
    }

    if (isConnected && integrations.notion.enabled) {
      setEngineBannerText('📝 Notion 워크스페이스 검색 중...');
      const notionRes = await fetchNotionIntegrationContext(userText, integrations.notion);
      if (notionRes) {
        contextSections.push(notionRes.contextText);
        integrationBadges.push(notionRes.badge);
      }
      setEngineBannerText('');
    }

    if (isConnected && integrations.weather.enabled) {
      setEngineBannerText('🌤️ 실시간 기상·날씨 데이터 수신 중...');
      const weatherRes = await fetchWeatherContext(
        userText,
        integrations.weather.enabled,
      );
      if (weatherRes) {
        contextSections.push(weatherRes.contextText);
        integrationBadges.push(weatherRes.badge);
      }
      setEngineBannerText('');
    }

    if (isConnected && integrations.finance.enabled) {
      setEngineBannerText('💱 실시간 환율·시세 데이터 수신 중...');
      const finRes = await fetchFinanceMarketContext(
        userText,
        integrations.finance.enabled,
      );
      if (finRes) {
        contextSections.push(finRes.contextText);
        integrationBadges.push(finRes.badge);
      }
      setEngineBannerText('');
    }

    if (isConnected && integrations.knowledge.enabled) {
      setEngineBannerText('📰 실시간 뉴스·백과 데이터 검색 중...');
      const knowRes = await fetchKnowledgeAndNewsContext(
        userText,
        integrations.knowledge.enabled,
      );
      if (knowRes) {
        contextSections.push(knowRes.contextText);
        integrationBadges.push(knowRes.badge);
      }
      setEngineBannerText('');
    }

    if (isConnected && integrations.web_reader.enabled) {
      setEngineBannerText('🌐 웹페이지 본문 추출 중...');
      const webRes = await fetchGenericWebUrlContext(
        userText,
        integrations.web_reader.enabled,
      );
      if (webRes) {
        contextSections.push(webRes.contextText);
        integrationBadges.push(webRes.badge);
      }
      setEngineBannerText('');
    }

    // 할 일 · 미리 알림 플러그인 처리
    let hasTodoCard = false;
    if (integrations.reminders.enabled) {
      const wantsAddTodo = /(할\s*일에\s*추가|할\s*일\s*등록|체크리스트에\s*추가|미리\s*알림에\s*추가)/i.test(
        userText,
      );
      const wantsShowTodo = /(할\s*일\s*목록|할\s*일\s*보여|체크리스트\s*보여|남은\s*할\s*일)/i.test(
        userText,
      );

      if (wantsAddTodo) {
        const cleaned = userText
          .replace(/(할\s*일에\s*추가해\s*줘|할\s*일에\s*추가|할\s*일\s*등록해\s*줘|체크리스트에\s*추가해\s*줘|미리\s*알림에\s*추가해\s*줘)/gi, '')
          .trim();
        const items = cleaned
          .split(/[,/\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 2);
        if (items.length > 0) {
          const newItems: TodoItem[] = items.map((text, idx) => ({
            id: `todo-${Date.now()}-${idx}`,
            text,
            done: false,
            createdAt: Date.now(),
          }));
          const merged = [...newItems, ...todosRef.current];
          await persistTodos(merged);
          hasTodoCard = true;
          integrationBadges.push(`✅ 할 일 ${items.length}건 추가됨`);
          contextSections.push(
            `[할 일 체크리스트 업데이트됨]\n방금 추가된 항목: ${items.join(', ')}\n전체 활성 할 일: ${merged
              .filter((t) => !t.done)
              .map((t) => t.text)
              .join(', ')}`,
          );
        }
      } else if (wantsShowTodo) {
        hasTodoCard = true;
        integrationBadges.push(`✅ 할 일 (${todosRef.current.length}건)`);
        const listStr =
          todosRef.current.length > 0
            ? todosRef.current
                .map((t, i) => `${i + 1}. [${t.done ? '완료' : '진행중'}] ${t.text}`)
                .join('\n')
            : '등록된 할 일이 없습니다.';
        contextSections.push(`[현재 저장된 할 일 목록]\n${listStr}`);
      }
    }

    const calendarDraft = parseCalendarDraftFromPrompt(
      userText,
      integrations.calendar.enabled,
    );
    if (calendarDraft) {
      contextSections.push(
        `[Apple 캘린더 일정 감지됨]\n• 일정명: ${calendarDraft.title}\n• 일시: ${calendarDraft.displayText}\n사용자에게 일정이 준비되었음을 안내해 주세요.`,
      );
      integrationBadges.push('📅 Apple 캘린더 준비됨');
    }

    const wantsNotionSave =
      isConnected &&
      integrations.notion.enabled &&
      Boolean(integrations.notion.token.trim()) &&
      /(노션에\s*저장|노션에\s*기록|노션에\s*정리|노션\s*페이지\s*만들어)/i.test(userText);

    const wantsKakaoSend =
      integrations.kakao.enabled &&
      /(카톡으로\s*보내|카카오톡으로\s*보내|카톡\s*전송|나에게\s*보내)/i.test(userText);

    const externalContextBlock = contextSections.join('\n\n');

    if (integrationBadges.length > 0) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, integrationBadges } : m,
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
      const finalizedBadges = [...integrationBadges];

      if (wantsNotionSave && finalText && !finalText.startsWith('(응답이 중지')) {
        const saved = await saveSummaryToNotionPage(
          integrations.notion,
          `PocketMind 노트 · ${userText.slice(0, 24)}`,
          finalText,
        );
        if (saved) {
          finalizedBadges.push('📝 Notion 페이지 생성됨');
          showToast('📝 Notion에 새 페이지로 저장되었습니다');
        }
      }

      if (wantsKakaoSend && finalText && !finalText.startsWith('(응답이 중지')) {
        finalizedBadges.push('💬 카카오톡 전송됨');
      }

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
                      integrationBadges:
                        finalizedBadges.length > 0 ? finalizedBadges : undefined,
                      calendarDraft: calendarDraft ?? undefined,
                      hasTodoCard: hasTodoCard || undefined,
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

      if (wantsKakaoSend && finalText && !finalText.startsWith('(응답이 중지')) {
        await sendMessageToKakaoTalk(finalText);
      }
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
  const activeIntegrationCount = [
    integrations.github.enabled,
    integrations.google.enabled,
    integrations.notion.enabled,
    integrations.web_reader.enabled,
    integrations.calendar.enabled,
    integrations.weather.enabled,
    integrations.finance.enabled,
    integrations.knowledge.enabled,
    integrations.reminders.enabled,
    integrations.kakao.enabled,
  ].filter(Boolean).length;
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

            {item.integrationBadges && item.integrationBadges.length > 0 ? (
              <View style={styles.pluginBadgeRow}>
                {item.integrationBadges.map((b, bIdx) => (
                  <View key={bIdx} style={styles.pluginUsedChip}>
                    <Text style={styles.pluginUsedChipText}>{b}</Text>
                  </View>
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

            {/* 할 일 체크리스트 카드 (할 일 관련 대화 시에만 표시) */}
            {item.hasTodoCard && todos.length > 0 && !isGenerating ? (
              <View style={styles.todoCard}>
                <Text style={styles.todoCardHeader}>
                  ✅ 내 할 일 체크리스트 ({todos.filter((t) => !t.done).length}개 남음)
                </Text>
                {todos.slice(0, 6).map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => toggleTodoItem(t.id)}
                    style={styles.todoItemRow}>
                    <Text style={styles.todoCheckbox}>{t.done ? '☑' : '☐'}</Text>
                    <Text
                      style={[
                        styles.todoItemText,
                        t.done && styles.todoItemTextDone,
                      ]}>
                      {t.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Apple 캘린더 등록 카드 (일정 관련 대화 시에만 표시) */}
            {item.calendarDraft && !isGenerating ? (
              <TouchableOpacity
                onPress={() => handleExportCalendarIcs(item.calendarDraft!)}
                style={styles.calendarActionCard}>
                <Text style={styles.calendarActionTitle}>
                  📅 Apple 캘린더에 일정 등록하기
                </Text>
                <Text style={styles.calendarActionSub}>
                  {item.calendarDraft.displayText}
                </Text>
              </TouchableOpacity>
            ) : null}

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

      {/* 10종 플러그인 가로 슬라이드 빠른 진입 바 */}
      <View style={styles.quickFeatureBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickFeatureScroll}>
          <TouchableOpacity
            onPress={() => setPluginModalVisible(true)}
            style={[styles.featurePill, styles.featurePillGithub]}>
            <Text style={[styles.featurePillText, styles.featurePillTextGithub]}>
              🔌 허브 ({activeIntegrationCount}/10)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('weather');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>🌤️ 날씨</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('finance');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>💱 환율·시세</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('knowledge');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>📰 뉴스·위키</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('reminders');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>
              ✅ 할 일 ({todos.filter((t) => !t.done).length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('github');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>🐙 GitHub</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('google');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>🔵 Google</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setExpandedCard('notion');
              setPluginModalVisible(true);
            }}
            style={styles.featurePill}>
            <Text style={styles.featurePillText}>📝 Notion</Text>
          </TouchableOpacity>

          {loadedModelKey === 'allrounder' && (
            <TouchableOpacity
              onPress={() => setQwenThinkingMode((prev) => !prev)}
              style={[
                styles.featurePill,
                qwenThinkingMode && styles.featurePillGoogle,
              ]}>
              <Text
                style={[
                  styles.featurePillText,
                  qwenThinkingMode && styles.featurePillTextGoogle,
                ]}>
                {qwenThinkingMode ? '깊은 사고 ON' : '빠른 응답'}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* 토스트 알림 배지 */}
      {toastText ? (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{toastText}</Text>
        </View>
      ) : null}

      {/* 모델 적재·외부 연동 동기화 배너 */}
      {engineBannerText ? (
        <View style={styles.loadingBanner}>
          <ActivityIndicator color="#10A37F" size="small" />
          <Text style={styles.loadingBannerText}>{engineBannerText}</Text>
        </View>
      ) : null}

      {/* 메인 대화 영역 또는 추천 카드 뷰 */}
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
                10 PLUGINS · WEATHER · FX · NEWS · GITHUB · NOTION
              </Text>
            </View>
            <Text style={styles.centerTitle}>무엇을 도와드릴까요?</Text>
            <Text style={styles.centerSubtitle}>
              {installedCount > 0
                ? `활성 플러그인 ${activeIntegrationCount}종과 8B 전문 AI ${installedCount}종이 능동 협업합니다`
                : '상단 버튼을 눌러 아이폰 16 Pro용 7B~8B AI 모델을 다운로드하세요'}
            </Text>
          </View>

          <View style={styles.suggestionsGrid}>
            {INTEGRATION_SUGGESTIONS.map((card, idx) => (
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
              placeholder="날씨, 환율, 뉴스, 할 일, GitHub, Google, Notion, 수학 입력"
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
              ? `온라인(${networkType === 'cellular' ? '셀룰러' : 'Wi-Fi'}) · 10종 플러그인 활성 · AI 추론은 기기 내 실행`
              : '오프라인 상태 · 로컬 8B AI 추론은 인터넷 없이 정상 작동'}
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
                  <Text style={styles.drawerFooterText}>
                    🔌 연동 플러그인 허브 (10종 관리)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    toggleDrawer(false);
                    setModelModalVisible(true);
                  }}
                  style={styles.drawerFooterBtn}>
                  <Text style={styles.drawerFooterText}>
                    ⚙ 8B 모델 다운로드 · 셀룰러 설정
                  </Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      )}

      {/* 10종 플러그인 통합 허브 모달 */}
      <Modal
        animationType="slide"
        onRequestClose={() => setPluginModalVisible(false)}
        transparent
        visible={pluginModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>플러그인 통합 허브 (10종)</Text>
              <TouchableOpacity onPress={() => setPluginModalVisible(false)}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDesc}>
              실시간 날씨·환율·뉴스·할 일은 별도 키 없이 즉시 작동하며, GitHub·Google·Notion은 토큰 등록 시 비공개 문서까지 읽어옵니다.
            </Text>

            <TouchableOpacity
              onPress={() => {
                setPluginModalVisible(false);
                handlePullClipboard();
              }}
              style={styles.clipboardBannerBtn}>
              <Text style={styles.clipboardBannerBtnText}>
                📋 아이폰 클립보드 텍스트를 입력창에 바로 불러오기
              </Text>
            </TouchableOpacity>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled">
              {/* 1. 실시간 날씨 · 주간 예보 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <View style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      🌤️ 실시간 날씨 · 주간 예보 (키 불필요)
                    </Text>
                    <Text style={styles.integrationSub}>
                      "서울 날씨 어때?", "청주 내일 비 와?" 입력 시 실시간 기상 조회
                    </Text>
                  </View>
                  <Switch
                    value={integrations.weather.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        weather: { enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#10A37F' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* 2. 실시간 환율 · 코인 시세 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <View style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      💱 실시간 환율 · 암호화폐 시세 (키 불필요)
                    </Text>
                    <Text style={styles.integrationSub}>
                      USD/KRW, JPY/KRW, EUR/KRW 및 비트코인·이더리움 실시간 시세 연동
                    </Text>
                  </View>
                  <Switch
                    value={integrations.finance.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        finance: { enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#3B82F6' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* 3. 실시간 뉴스 · 위키백과 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <View style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      📰 실시간 뉴스 · 한국어 위키백과 (키 불필요)
                    </Text>
                    <Text style={styles.integrationSub}>
                      "오늘 주요 뉴스 요약해줘" 또는 "OO 위키에서 찾아줘" 지원
                    </Text>
                  </View>
                  <Switch
                    value={integrations.knowledge.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        knowledge: { enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#A855F7' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* 4. 할 일 · 미리 알림 체크리스트 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <View style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      ✅ 할 일 · 미리 알림 매니저 (오프라인 작동)
                    </Text>
                    <Text style={styles.integrationSub}>
                      현재 {todos.filter((t) => !t.done).length}개의 미완료 할 일 저장됨
                    </Text>
                  </View>
                  <Switch
                    value={integrations.reminders.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        reminders: { enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#10A37F' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* 5. 웹 URL · 아티클 리더 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <View style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      🌐 웹 URL · 아티클 리더 (키 불필요)
                    </Text>
                    <Text style={styles.integrationSub}>
                      대화에 포함된 https:// 웹페이지 본문을 직접 읽어 요약·번역
                    </Text>
                  </View>
                  <Switch
                    value={integrations.web_reader.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        web_reader: { enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#10A37F' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* 6. Apple 캘린더 (.ics) 일정 연동 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <View style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      📅 Apple 캘린더 (.ics) 일정 등록 (키 불필요)
                    </Text>
                    <Text style={styles.integrationSub}>
                      "내일 오후 3시 회의 일정 등록해 줘" 입력 시 iOS 캘린더에 즉시 추가
                    </Text>
                  </View>
                  <Switch
                    value={integrations.calendar.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        calendar: { enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#3B82F6' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* 7. GitHub 연동 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedCard(expandedCard === 'github' ? null : 'github')
                    }
                    style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      🐙 GitHub 연동 (저장소 · 코드 · 커밋)
                    </Text>
                    <Text style={styles.integrationSub}>
                      {integrations.github.repo
                        ? `기본 저장소: ${integrations.github.repo}`
                        : '저장소(owner/repo)를 등록하거나 대화에 GitHub URL 입력'}
                    </Text>
                  </TouchableOpacity>
                  <Switch
                    value={integrations.github.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        github: { ...integrations.github, enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#10A37F' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {expandedCard === 'github' && (
                  <View style={styles.integrationBody}>
                    <Text style={styles.inputLabel}>기본 GitHub 저장소 (owner/repo)</Text>
                    <TextInput
                      value={integrations.github.repo}
                      onChangeText={(txt) =>
                        persistIntegrations({
                          ...integrations,
                          github: { ...integrations.github, repo: txt },
                        })
                      }
                      placeholder="예: username/PocketMind"
                      placeholderTextColor="#71717A"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.integrationInput}
                    />

                    <Text style={styles.inputLabel}>
                      Personal Access Token (비공개 저장소용 · 선택)
                    </Text>
                    <TextInput
                      value={integrations.github.token}
                      onChangeText={(txt) =>
                        persistIntegrations({
                          ...integrations,
                          github: { ...integrations.github, token: txt },
                        })
                      }
                      placeholder="ghp_... (공개 저장소는 비워두셔도 됩니다)"
                      placeholderTextColor="#71717A"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      style={styles.integrationInput}
                    />

                    <View style={styles.integrationBtnRow}>
                      <TouchableOpacity
                        onPress={() => handleTestIntegration('github')}
                        disabled={testingIntegration === 'github'}
                        style={styles.testConnBtn}>
                        <Text style={styles.testConnBtnText}>
                          {testingIntegration === 'github' ? '확인 중...' : '연결 확인'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* 8. Google 연동 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedCard(expandedCard === 'google' ? null : 'google')
                    }
                    style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      🔵 Google 연동 (Drive · Docs · Sheets)
                    </Text>
                    <Text style={styles.integrationSub}>
                      {integrations.google.accountNote
                        ? `연결 계정: ${integrations.google.accountNote}`
                        : 'Google Docs/Sheets 링크 읽기 및 Google Drive 파일 조회'}
                    </Text>
                  </TouchableOpacity>
                  <Switch
                    value={integrations.google.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        google: { ...integrations.google, enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#3B82F6' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {expandedCard === 'google' && (
                  <View style={styles.integrationBody}>
                    <Text style={styles.inputLabel}>
                      Google OAuth Access Token (비공개 Drive 조회용 · 선택)
                    </Text>
                    <TextInput
                      value={integrations.google.accessToken}
                      onChangeText={(txt) =>
                        persistIntegrations({
                          ...integrations,
                          google: { ...integrations.google, accessToken: txt },
                        })
                      }
                      placeholder="ya29...."
                      placeholderTextColor="#71717A"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      style={styles.integrationInput}
                    />
                    <View style={styles.integrationBtnRow}>
                      <TouchableOpacity
                        onPress={() => handleTestIntegration('google')}
                        disabled={testingIntegration === 'google'}
                        style={styles.testConnBtn}>
                        <Text style={styles.testConnBtnText}>
                          {testingIntegration === 'google' ? '확인 중...' : '연결 확인'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* 9. Notion 연동 */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedCard(expandedCard === 'notion' ? null : 'notion')
                    }
                    style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      📝 Notion 연동 (페이지 검색 · 읽기 · 노트 저장)
                    </Text>
                    <Text style={styles.integrationSub}>
                      {integrations.notion.workspaceNote
                        ? `연결됨: ${integrations.notion.workspaceNote}`
                        : '노션 페이지 내용 요약 및 새 페이지로 답변 자동 저장'}
                    </Text>
                  </TouchableOpacity>
                  <Switch
                    value={integrations.notion.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        notion: { ...integrations.notion, enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#A855F7' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {expandedCard === 'notion' && (
                  <View style={styles.integrationBody}>
                    <Text style={styles.inputLabel}>
                      Notion Internal Integration Token (ntn_... / secret_...)
                    </Text>
                    <TextInput
                      value={integrations.notion.token}
                      onChangeText={(txt) =>
                        persistIntegrations({
                          ...integrations,
                          notion: { ...integrations.notion, token: txt },
                        })
                      }
                      placeholder="ntn_... 또는 secret_..."
                      placeholderTextColor="#71717A"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      style={styles.integrationInput}
                    />
                    <View style={styles.integrationBtnRow}>
                      <TouchableOpacity
                        onPress={() => handleTestIntegration('notion')}
                        disabled={testingIntegration === 'notion'}
                        style={styles.testConnBtn}>
                        <Text style={styles.testConnBtnText}>
                          {testingIntegration === 'notion' ? '확인 중...' : '연결 확인'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* 10. 카카오톡 연동 (온디맨드 전송) */}
              <View style={styles.integrationCard}>
                <View style={styles.integrationHeaderRow}>
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedCard(expandedCard === 'kakao' ? null : 'kakao')
                    }
                    style={styles.integrationTitleCol}>
                    <Text style={styles.integrationTitle}>
                      💬 카카오톡 연동 (요청 시에만 전송)
                    </Text>
                    <Text style={styles.integrationSub}>
                      {integrations.kakao.nicknameNote
                        ? `연결 프로필: ${integrations.kakao.nicknameNote}`
                        : '평소 버튼 숨김 · "카톡으로 보내줘" 입력 시에만 발송'}
                    </Text>
                  </TouchableOpacity>
                  <Switch
                    value={integrations.kakao.enabled}
                    onValueChange={(val) =>
                      persistIntegrations({
                        ...integrations,
                        kakao: { ...integrations.kakao, enabled: val },
                      })
                    }
                    trackColor={{ false: '#3F3F46', true: '#EAB308' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {expandedCard === 'kakao' && (
                  <View style={styles.integrationBody}>
                    <Text style={styles.inputLabel}>
                      Kakao REST API Access Token (나에게 보내기 자동 발송용 · 선택)
                    </Text>
                    <TextInput
                      value={integrations.kakao.accessToken}
                      onChangeText={(txt) =>
                        persistIntegrations({
                          ...integrations,
                          kakao: { ...integrations.kakao, accessToken: txt },
                        })
                      }
                      placeholder="토큰 미입력 시에도 '카톡으로 보내줘' 요청 시 공유 시트로 연결됩니다"
                      placeholderTextColor="#71717A"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      style={styles.integrationInput}
                    />
                    <View style={styles.integrationBtnRow}>
                      <TouchableOpacity
                        onPress={() => handleTestIntegration('kakao')}
                        disabled={testingIntegration === 'kakao'}
                        style={styles.testConnBtn}>
                        <Text style={styles.testConnBtnText}>
                          {testingIntegration === 'kakao' ? '확인 중...' : '연결 확인'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
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
                질문 성격을 자동 분석해 최적의 AI를 고르거나, 수리+한국어·GitHub 코드+한국어 정리 같은 복합 요청 시 두 AI가 순차 협업합니다.
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
  quickFeatureBarWrap: {
    paddingBottom: 6,
  },
  quickFeatureScroll: {
    paddingHorizontal: 12,
    gap: 6,
    alignItems: 'center',
  },
  featurePill: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  featurePillGithub: {
    backgroundColor: '#132E26',
    borderColor: '#10A37F',
  },
  featurePillGoogle: {
    backgroundColor: '#172554',
    borderColor: '#3B82F6',
  },
  featurePillText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
  },
  featurePillTextGithub: {
    color: '#6EE7B7',
  },
  featurePillTextGoogle: {
    color: '#93C5FD',
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
  todoCard: {
    backgroundColor: '#142620',
    borderWidth: 1,
    borderColor: '#10A37F',
    borderRadius: 12,
    padding: 12,
    gap: 7,
  },
  todoCardHeader: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  todoItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todoCheckbox: {
    color: '#10A37F',
    fontSize: 16,
    fontWeight: '700',
  },
  todoItemText: {
    color: '#ECFDF5',
    fontSize: 13,
    flex: 1,
  },
  todoItemTextDone: {
    color: '#6EE7B7',
    textDecorationLine: 'line-through',
    opacity: 0.65,
  },
  calendarActionCard: {
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 3,
  },
  calendarActionTitle: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '700',
  },
  calendarActionSub: {
    color: '#DBEAFE',
    fontSize: 12,
  },
  actionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    gap: 10,
  },
  drawerFooterBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  drawerFooterText: {
    color: '#ECECEC',
    fontSize: 13,
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
  clipboardBannerBtn: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  clipboardBannerBtnText: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '700',
  },
  integrationCard: {
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    gap: 10,
  },
  integrationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  integrationTitleCol: {
    flex: 1,
    gap: 3,
  },
  integrationTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  integrationSub: {
    color: '#A1A1AA',
    fontSize: 12,
  },
  integrationBody: {
    borderTopWidth: 1,
    borderTopColor: '#383838',
    paddingTop: 10,
    gap: 7,
  },
  inputLabel: {
    color: '#D4D4D8',
    fontSize: 11,
    fontWeight: '600',
  },
  integrationInput: {
    backgroundColor: '#1B1B1B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#FFFFFF',
    fontSize: 13,
  },
  integrationBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  testConnBtn: {
    backgroundColor: '#10A37F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  testConnBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { initLlama, LlamaContext } from 'llama.rn';

type ModelKey = 'allrounder' | 'math' | 'korean';
type PromptFormat = 'chatml' | 'exaone';

interface SuggestionItem {
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
  suggestions: SuggestionItem[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

const MODELS: Record<ModelKey, ModelSpec> = {
  allrounder: {
    key: 'allrounder',
    badge: '올라운더',
    badgeColor: '#10A37F',
    title: 'Qwen3 4B (올라운더)',
    shortTitle: '올라운더 · Qwen3 4B',
    subtitle: '코딩 · 요약 · 일반 지식 균형 잡힌 고성능 모델',
    sizeLabel: '2.50 GB',
    expectedBytes: 2497280000,
    minBytes: 1200 * 1024 * 1024,
    filename: 'Qwen3-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    promptFormat: 'chatml',
    systemPrompt:
      '당신은 아이폰 온디바이스 환경에서 오프라인으로 동작하는 다재다능한 AI 어시스턴트 PocketMind입니다. 한국어로 명확하고 논리적으로 답변하며, 코드는 마크다운 코드 블록으로 감싸서 제공하세요.',
    suggestions: [
      {
        title: '핵심 내용 3줄 요약',
        desc: '긴 글이나 회의록을 핵심만 간결하게 정리',
        prompt: '내가 다음에 붙여넣는 글의 핵심 내용만 뽑아 3줄 불릿 포인트로 요약해 줘. 준비됐으면 대답해 줘.',
      },
      {
        title: '파이썬 자동화 코드',
        desc: '텍스트 파일 중복 제거 스크립트 작성',
        prompt: '폴더 내의 텍스트 파일들을 읽어서 중복된 줄을 제거하고 새 파일로 저장하는 파이썬 코드를 작성해 줘.',
      },
      {
        title: '아이디어 브레인스토밍',
        desc: '오프라인 환경에서 집중할 프로젝트 추천',
        prompt: '주말 동안 인터넷 없이 혼자 집중해서 완성할 수 있는 생산적인 미니 프로젝트 5가지를 추천해 줘.',
      },
      {
        title: '개념 쉽게 이해하기',
        desc: '복잡한 IT·과학 원리를 비유로 설명',
        prompt: '양자 컴퓨터가 기존 컴퓨터와 무엇이 다른지 고등학생도 이해할 수 있게 비유를 들어 설명해 줘.',
      },
    ],
  },
  math: {
    key: 'math',
    badge: '수학·논리 특화',
    badgeColor: '#3B82F6',
    title: 'Qwen2.5-Math 1.5B',
    shortTitle: '수학 특화 · Qwen2.5-Math',
    subtitle: '방정식 · 미적분 · 확률 · 단계별 수리 추론 특화',
    sizeLabel: '0.99 GB',
    expectedBytes: 986000000,
    minBytes: 500 * 1024 * 1024,
    filename: 'Qwen2.5-Math-1.5B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen2.5-Math-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-Math-1.5B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
    systemPrompt:
      '당신은 수학 및 논리 추론 전문 AI입니다. 모든 수학 문제는 풀이 과정을 단계별(Step-by-step)로 정확하게 전개하고 마지막에 최종 정답을 명확히 제시하세요. 한국어로 친절하게 설명하세요.',
    suggestions: [
      {
        title: '이차방정식 · 함수 풀이',
        desc: '판별식과 최댓값·최솟값 단계별 계산',
        prompt: '이차함수 f(x) = 2x^2 - 8x + 5의 최솟값을 구하고, f(x) = 0의 두 근의 합과 곱을 단계별로 풀이해 줘.',
      },
      {
        title: '확률과 통계 문제',
        desc: '조건부 확률 및 경우의 수 논리 풀이',
        prompt: '빨간 공 4개와 파란 공 6개가 들어 있는 주머니에서 임의로 2개를 동시에 꺼낼 때, 두 공이 서로 다른 색일 확률을 구해 줘.',
      },
      {
        title: '미적분 도함수 계산',
        desc: '극값 판정 및 접선의 방정식 도출',
        prompt: '함수 f(x) = x^3 - 3x^2 + 2의 극댓값과 극솟값을 미분을 이용해 단계별로 구해 줘.',
      },
      {
        title: '수리 논리 퍼즐',
        desc: '연립방정식 기반 실생활 응용 문제',
        prompt: '닭과 토끼가 합쳐서 35마리 있고, 다리 수의 합이 94개일 때 닭과 토끼는 각각 몇 마리인지 연립방정식으로 풀어 줘.',
      },
    ],
  },
  korean: {
    key: 'korean',
    badge: '한국어 특화',
    badgeColor: '#A855F7',
    title: 'LG EXAONE 3.5 2.4B',
    shortTitle: '한국어 특화 · EXAONE 3.5',
    subtitle: 'LG AI 연구원 한국어 최적화 · 자연스러운 작문·교정',
    sizeLabel: '1.65 GB',
    expectedBytes: 1650000000,
    minBytes: 800 * 1024 * 1024,
    filename: 'EXAONE-3.5-2.4B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/EXAONE-3.5-2.4B-Instruct-GGUF/resolve/main/EXAONE-3.5-2.4B-Instruct-Q4_K_M.gguf',
    promptFormat: 'exaone',
    systemPrompt:
      '당신은 LG AI Research에서 개발한 한국어 특화 언어모델 EXAONE입니다. 자연스럽고 정확한 한국어 어휘와 문맥을 구사하며, 사용자의 질문에 깊이 있고 정중하게 답변합니다.',
    suggestions: [
      {
        title: '비즈니스 이메일 작성',
        desc: '격식 있고 정중한 협조·일정 조율 메일',
        prompt: '거래처 담당자에게 프로젝트 납기 일정을 일주일 조율해 달라고 정중하게 요청하는 비즈니스 이메일 초안을 작성해 줘.',
      },
      {
        title: '맞춤법 · 문맥 자연스럽게 교정',
        desc: '어색한 번역투나 비문을 매끄러운 한국어로 다듬기',
        prompt: '내가 다음에 입력하는 한국어 문장의 맞춤법, 띄어쓰기, 어색한 표현을 자연스럽게 다듬고 수정 이유를 알려줘. 준비됐으면 대답해 줘.',
      },
      {
        title: '자기소개서 · 에세이 윤문',
        desc: '핵심 강점이 돋보이도록 설득력 있게 구성',
        prompt: '문제 해결 능력과 꾸준함을 강조하는 400자 분량의 자기소개서 도입부 예시를 작성해 줘.',
      },
      {
        title: '사자성어 · 한국어 뉘앙스',
        desc: '상황에 딱 맞는 고급 어휘와 표현 추천',
        prompt: '위기를 기회로 바꾼다는 뜻의 사자성어 3가지를 알려주고, 각각 어떤 상황에서 쓰면 자연스러운지 예문과 함께 설명해 줘.',
      },
    ],
  },
};

const MODEL_ORDER: ModelKey[] = ['allrounder', 'math', 'korean'];

const STORAGE_SESSIONS_KEY = '@pocketmind_sessions_v2';
const STORAGE_ACTIVE_MODEL_KEY = '@pocketmind_active_model_v2';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(290, SCREEN_WIDTH * 0.78);

interface ContentBlock {
  type: 'text' | 'code';
  language?: string;
  content: string;
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function cleanModelOutput(raw: string): string {
  // Qwen3 빈 <think>\n\n</think> 태그 정리
  return raw.replace(/<think>\s*<\/think>/g, '').trim();
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
  title,
  desc,
  index,
  onPress,
}: {
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
  }, [enterAnim, index, title]);

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
  const [loadedModelKey, setLoadedModelKey] = useState<ModelKey | null>(null);
  const [isInitializingEngine, setIsInitializingEngine] = useState<boolean>(false);
  const [qwenThinkingMode, setQwenThinkingMode] = useState<boolean>(false);

  const [downloadingKey, setDownloadingKey] = useState<ModelKey | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const progressBarAnim = useRef(new Animated.Value(0)).current;
  const downloadJobIdRef = useRef<number | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [modelModalVisible, setModelModalVisible] = useState<boolean>(false);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const llamaContextRef = useRef<LlamaContext | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage> | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;

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

  const loadModelIntoMemory = useCallback(async (key: ModelKey) => {
    setIsInitializingEngine(true);
    try {
      if (llamaContextRef.current) {
        await llamaContextRef.current.release();
        llamaContextRef.current = null;
        setLoadedModelKey(null);
      }
      const context = await initLlama({
        model: getModelPath(key),
        use_mlock: true,
        n_ctx: 2048,
        n_gpu_layers: 99,
      });
      llamaContextRef.current = context;
      setLoadedModelKey(key);
      await AsyncStorage.setItem(STORAGE_ACTIVE_MODEL_KEY, key);
    } catch (error) {
      Alert.alert(
        '모델 로딩 실패',
        `메모리 부족 또는 파일 오류로 모델을 불러오지 못했습니다.\n(${String(error)})`,
      );
    } finally {
      setIsInitializingEngine(false);
    }
  }, []);

  const persistSessions = async (updated: ChatSession[]) => {
    setSessions(updated);
    try {
      await AsyncStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(updated));
    } catch {
      // 저장 실패 시 메모리 상태 유지
    }
  };

  const createNewSession = useCallback(
    async (existingList?: ChatSession[]) => {
      const base = existingList ?? sessionsRef.current;
      const newSession: ChatSession = {
        id: `session-${Date.now()}`,
        title: '새 대화',
        updatedAt: Date.now(),
        messages: [],
      };
      const updated = [newSession, ...base];
      await persistSessions(updated);
      setActiveSessionId(newSession.id);
      return newSession;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      try {
        const savedSessionsRaw = await AsyncStorage.getItem(STORAGE_SESSIONS_KEY);
        let parsedSessions: ChatSession[] = savedSessionsRaw
          ? JSON.parse(savedSessionsRaw)
          : [];
        if (parsedSessions.length === 0) {
          const initial: ChatSession = {
            id: `session-${Date.now()}`,
            title: '새 대화',
            updatedAt: Date.now(),
            messages: [],
          };
          parsedSessions = [initial];
          await AsyncStorage.setItem(
            STORAGE_SESSIONS_KEY,
            JSON.stringify(parsedSessions),
          );
        }
        if (mounted) {
          setSessions(parsedSessions);
          setActiveSessionId(parsedSessions[0].id);
        }

        const savedModel = (await AsyncStorage.getItem(
          STORAGE_ACTIVE_MODEL_KEY,
        )) as ModelKey | null;
        const preferredKey: ModelKey =
          savedModel && MODEL_ORDER.includes(savedModel) ? savedModel : 'allrounder';

        const available = await scanDownloadedModels();
        if (!mounted) return;

        if (available[preferredKey]) {
          await loadModelIntoMemory(preferredKey);
        } else {
          const firstAvailable = MODEL_ORDER.find((k) => available[k]);
          if (firstAvailable) {
            await loadModelIntoMemory(firstAvailable);
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
  }, [loadModelIntoMemory, scanDownloadedModels]);

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

  const handleDownloadModel = async (key: ModelKey) => {
    if (downloadingKey) return;
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
          'User-Agent': 'PocketMind-iOS/1.0',
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
        await loadModelIntoMemory(key);
        setModelModalVisible(false);
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
        `모델을 내려받지 못했습니다. Wi-Fi 연결 상태를 확인한 뒤 다시 시도해 주세요.\n(${String(error)})`,
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
                await loadModelIntoMemory(fallback);
              }
            }
          },
        },
      ],
    );
  };

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const currentMessages = activeSession?.messages ?? [];
  const activeModelSpec: ModelSpec = loadedModelKey
    ? MODELS[loadedModelKey]
    : MODELS.allrounder;

  const buildModelPrompt = (
    spec: ModelSpec,
    history: ChatMessage[],
    userPrompt: string,
  ): { prompt: string; stop: string[]; penaltyRepeat: number } => {
    const contextSlice = history.slice(-6);

    if (spec.promptFormat === 'exaone') {
      let prompt = `[|system|]${spec.systemPrompt}[|endofturn|]\n`;
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

    // Qwen3 / Qwen2.5-Math ChatML 형식
    const effectiveUserPrompt =
      spec.key === 'allrounder' && !qwenThinkingMode
        ? `${userPrompt} /no_think`
        : userPrompt;

    let prompt = `<|im_start|>system\n${spec.systemPrompt}<|im_end|>\n`;
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
    if (!llamaContextRef.current || !loadedModelKey) {
      setModelModalVisible(true);
      return;
    }

    const spec = MODELS[loadedModelKey];
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

    let fullAnswer = '';
    let lastUiUpdate = 0;

    try {
      const { prompt, stop, penaltyRepeat } = buildModelPrompt(
        spec,
        historyBeforeUser,
        userText,
      );
      await llamaContextRef.current.completion(
        {
          prompt,
          n_predict: 1280,
          temperature: spec.key === 'math' ? 0.3 : 0.7,
          top_p: 0.9,
          penalty_repeat: penaltyRepeat,
          stop,
        },
        (tokenData) => {
          fullAnswer += tokenData.token;
          const now = Date.now();
          if (now - lastUiUpdate >= 50) {
            lastUiUpdate = now;
            const snapshot = cleanModelOutput(fullAnswer);
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
    } catch (error) {
      if (!fullAnswer) {
        fullAnswer = `응답 생성 중 오류가 발생했습니다: ${String(error)}`;
      }
    } finally {
      const finalText = cleanModelOutput(fullAnswer) || '(응답이 중지되었습니다)';
      const finalizedSessions = sessionsRef.current.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, content: finalText } : m,
              ),
            }
          : s,
      );
      await persistSessions(finalizedSessions);
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputText).trim();
    if (!textToSend || isGenerating) return;

    if (!llamaContextRef.current) {
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
    if (!isGenerating || !llamaContextRef.current) return;
    try {
      await llamaContextRef.current.stopCompletion();
    } catch {
      // 이미 완료된 경우 무시
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
            await createNewSession([]);
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
          <View
            style={[
              styles.avatarBadge,
              { backgroundColor: activeModelSpec.badgeColor },
            ]}>
            <Text style={styles.avatarGlyph}>✦</Text>
          </View>
          <View style={styles.assistantContentCol}>
            {item.content.length === 0 ? (
              <ThinkingWave color={activeModelSpec.badgeColor} />
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

      {/* 상단 모델 스위처 & 메뉴 헤더 */}
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
                backgroundColor: loadedModelKey
                  ? MODELS[loadedModelKey].badgeColor
                  : '#F59E0B',
              },
            ]}
          />
          <Text style={styles.modelPillTitle}>
            {loadedModelKey ? MODELS[loadedModelKey].shortTitle : 'AI 모델 선택'}
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

      {/* 올라운더(Qwen3 4B) 전용 깊은 생각(Thinking) 모드 토글 바 */}
      {loadedModelKey === 'allrounder' && !isInitializingEngine && (
        <View style={styles.subModeBar}>
          <TouchableOpacity
            onPress={() => setQwenThinkingMode((prev) => !prev)}
            style={[
              styles.thinkingChip,
              qwenThinkingMode && styles.thinkingChipActive,
            ]}>
            <Text
              style={[
                styles.thinkingChipText,
                qwenThinkingMode && styles.thinkingChipTextActive,
              ]}>
              {qwenThinkingMode
                ? '🧠 깊은 사고 모드 ON (정밀 추론)'
                : '⚡ 빠른 응답 모드 (터치해 깊은 사고 전환)'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 모델 로딩 배너 */}
      {isInitializingEngine && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator color="#10A37F" size="small" />
          <Text style={styles.loadingBannerText}>
            아이폰 Metal GPU에 AI 모델을 올리는 중...
          </Text>
        </View>
      )}

      {/* 메인 대화 영역 또는 모델별 맞춤 추천 뷰 */}
      {currentMessages.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          keyboardShouldPersistTaps="handled">
          <View style={styles.centerLogoWrap}>
            <BreathingLogo accentColor={activeModelSpec.badgeColor} />
            {loadedModelKey && (
              <View
                style={[
                  styles.activeSpecialtyBadge,
                  { borderColor: activeModelSpec.badgeColor },
                ]}>
                <Text
                  style={[
                    styles.activeSpecialtyText,
                    { color: activeModelSpec.badgeColor },
                  ]}>
                  {activeModelSpec.badge}
                </Text>
              </View>
            )}
            <Text style={styles.centerTitle}>무엇을 도와드릴까요?</Text>
            <Text style={styles.centerSubtitle}>
              {loadedModelKey
                ? `${MODELS[loadedModelKey].title} · 오프라인 기기 내 추론 활성`
                : '상단 메뉴에서 올라운더 · 수학 · 한국어 AI 모델을 선택하세요'}
            </Text>
          </View>

          <View style={styles.suggestionsGrid}>
            {activeModelSpec.suggestions.map((card, idx) => (
              <AnimatedSuggestionCard
                key={`${activeModelSpec.key}-${idx}`}
                index={idx}
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
            <TextInput
              maxLength={2000}
              multiline
              onChangeText={setInputText}
              placeholder={
                loadedModelKey === 'math'
                  ? '수학 문제나 논리 퍼즐을 입력하세요'
                  : loadedModelKey === 'korean'
                    ? '작문, 교정, 한국어 질문을 입력하세요'
                    : 'PocketMind에게 메시지 보내기'
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
            모든 연산은 인터넷 연결 없이 아이폰 기기 내부에서 처리됩니다.
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

              <TouchableOpacity
                onPress={() => {
                  toggleDrawer(false);
                  setModelModalVisible(true);
                }}
                style={styles.drawerFooterBtn}>
                <Text style={styles.drawerFooterText}>⚙ 특화 AI 모델 다운로드 · 관리</Text>
              </TouchableOpacity>
            </SafeAreaView>
          </Animated.View>
        </View>
      )}

      {/* 특화 AI 모델 선택 및 다운로드 모달 */}
      <Modal
        animationType="slide"
        onRequestClose={() => setModelModalVisible(false)}
        transparent
        visible={modelModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>분야별 오프라인 AI 모델</Text>
              <TouchableOpacity onPress={() => setModelModalVisible(false)}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDesc}>
              작은 모델의 한계를 넘기 위해 분야별 특화 모델을 각각 받아 상황에 맞게 전환할 수 있습니다.
            </Text>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}>
              {MODEL_ORDER.map((key) => {
                const spec = MODELS[key];
                const isInstalled = downloadedModels[key];
                const isLoaded = loadedModelKey === key;
                const isThisDownloading = downloadingKey === key;

                return (
                  <View
                    key={key}
                    style={[
                      styles.modelCard,
                      isLoaded && { borderColor: spec.badgeColor },
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
                          disabled={isLoaded || isInitializingEngine}
                          onPress={async () => {
                            await loadModelIntoMemory(key);
                            setModelModalVisible(false);
                          }}
                          style={[
                            styles.useModelBtn,
                            { backgroundColor: spec.badgeColor },
                            isLoaded && styles.useModelBtnCurrent,
                          ]}>
                          <Text style={styles.useModelBtnText}>
                            {isLoaded ? '현재 사용 중 ✓' : '이 모델로 전환'}
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
                          다운로드 ({spec.sizeLabel})
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
    height: 52,
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
  subModeBar: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  thinkingChip: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  thinkingChipActive: {
    backgroundColor: '#14332B',
    borderColor: '#10A37F',
  },
  thinkingChipText: {
    color: '#9B9B9B',
    fontSize: 11,
    fontWeight: '600',
  },
  thinkingChipTextActive: {
    color: '#6EE7B7',
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
    paddingTop: 28,
    paddingBottom: 18,
  },
  centerLogoWrap: {
    alignItems: 'center',
    marginTop: 12,
  },
  logoOuterWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoGlowRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  centerLogoCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLogoIcon: {
    color: '#212121',
    fontSize: 26,
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
    fontSize: 11,
    fontWeight: '700',
  },
  centerTitle: {
    color: '#ECECEC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  centerSubtitle: {
    color: '#9B9B9B',
    fontSize: 13,
    textAlign: 'center',
  },
  suggestionsGrid: {
    gap: 10,
    marginTop: 24,
  },
  suggestionCard: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#383838',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionTitle: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
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
    gap: 10,
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
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 7,
    gap: 8,
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
  drawerFooterBtn: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingTop: 14,
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
    maxHeight: '85%',
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
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    gap: 12,
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
    fontSize: 14,
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
    fontSize: 14,
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
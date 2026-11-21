import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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

type ModelKey = '1.5b' | '3b';

interface ModelSpec {
  key: ModelKey;
  title: string;
  subtitle: string;
  sizeLabel: string;
  minBytes: number;
  filename: string;
  url: string;
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
  '1.5b': {
    key: '1.5b',
    title: 'PocketMind 1.5B',
    subtitle: '빠른 응답 · 모든 아이폰 권장',
    sizeLabel: '1.12 GB',
    minBytes: 500 * 1024 * 1024,
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  '3b': {
    key: '3b',
    title: 'PocketMind 3B',
    subtitle: '깊은 추론 · RAM 6GB 이상 권장',
    sizeLabel: '2.10 GB',
    minBytes: 1000 * 1024 * 1024,
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
  },
};

const STORAGE_SESSIONS_KEY = '@pocketmind_sessions_v1';
const STORAGE_ACTIVE_MODEL_KEY = '@pocketmind_active_model_v1';

const SUGGESTION_CARDS = [
  {
    title: '이메일 초안 작성',
    desc: '정중한 비즈니스 협조 요청 메일 쓰기',
    prompt: '거래처 담당자에게 일정 조율을 정중하게 요청하는 비즈니스 이메일 초안을 작성해 줘.',
  },
  {
    title: '핵심 내용 요약',
    desc: '긴 글을 3줄로 깔끔하게 정리하기',
    prompt: '내가 다음에 붙여넣는 긴 글을 핵심만 뽑아서 3줄 불릿 포인트로 요약해 줘. 준비됐으면 대답해 줘.',
  },
  {
    title: '아이디어 브레인스토밍',
    desc: '주말에 혼자 즐길 생산적인 활동 추천',
    prompt: '집에서 주말 동안 인터넷 없이도 집중해서 할 수 있는 생산적인 취미나 프로젝트 5가지를 추천해 줘.',
  },
  {
    title: '파이썬 코드 작성',
    desc: '간단한 데이터 정리 스크립트 만들기',
    prompt: '폴더 내의 텍스트 파일들을 읽어서 중복된 줄을 제거하고 새 파일로 저장하는 파이썬 코드를 작성해 줘.',
  },
];

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(290, SCREEN_WIDTH * 0.78);

interface ContentBlock {
  type: 'text' | 'code';
  language?: string;
  content: string;
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

function RichTextRenderer({ text }: { text: string }): React.JSX.Element {
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
    </Text>
  );
}

export default function App(): React.JSX.Element {
  const [downloadedModels, setDownloadedModels] = useState<Record<ModelKey, boolean>>({
    '1.5b': false,
    '3b': false,
  });
  const [loadedModelKey, setLoadedModelKey] = useState<ModelKey | null>(null);
  const [isInitializingEngine, setIsInitializingEngine] = useState<boolean>(false);

  const [downloadingKey, setDownloadingKey] = useState<ModelKey | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const downloadJobIdRef = useRef<number | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [modelModalVisible, setModelModalVisible] = useState<boolean>(false);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  const llamaContextRef = useRef<LlamaContext | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage> | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;

  const getModelPath = (key: ModelKey) =>
    `${RNFS.DocumentDirectoryPath}/${MODELS[key].filename}`;

  const scanDownloadedModels = useCallback(async (): Promise<Record<ModelKey, boolean>> => {
    const result: Record<ModelKey, boolean> = { '1.5b': false, '3b': false };
    for (const key of ['1.5b', '3b'] as ModelKey[]) {
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
          savedModel === '1.5b' || savedModel === '3b' ? savedModel : '1.5b';

        const available = await scanDownloadedModels();
        if (!mounted) return;

        if (available[preferredKey]) {
          await loadModelIntoMemory(preferredKey);
        } else if (available['1.5b']) {
          await loadModelIntoMemory('1.5b');
        } else if (available['3b']) {
          await loadModelIntoMemory('3b');
        } else {
          setModelModalVisible(true);
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
      Animated.timing(drawerAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(drawerAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setDrawerOpen(false));
    }
  };

  const handleDownloadModel = async (key: ModelKey) => {
    if (downloadingKey) return;
    const spec = MODELS[key];
    const targetPath = getModelPath(key);

    setDownloadingKey(key);
    setDownloadProgress(0);

    try {
      if (await RNFS.exists(targetPath)) {
        await RNFS.unlink(targetPath);
      }

      const task = RNFS.downloadFile({
        fromUrl: spec.url,
        toFile: targetPath,
        background: true,
        progressDivider: 2,
        progress: (res) => {
          if (res.contentLength > 0) {
            const pct = Math.min(
              100,
              Math.round((res.bytesWritten / res.contentLength) * 100),
            );
            setDownloadProgress(pct);
          }
        },
      });

      downloadJobIdRef.current = task.jobId;
      const response = await task.promise;

      if (response.statusCode === 200) {
        setDownloadingKey(null);
        downloadJobIdRef.current = null;
        await scanDownloadedModels();
        await loadModelIntoMemory(key);
        setModelModalVisible(false);
      } else {
        throw new Error(`HTTP ${response.statusCode}`);
      }
    } catch (error) {
      setDownloadingKey(null);
      downloadJobIdRef.current = null;
      if (await RNFS.exists(targetPath)) {
        await RNFS.unlink(targetPath);
      }
      Alert.alert('다운로드 중단', `모델 다운로드를 완료하지 못했습니다.\n${String(error)}`);
    }
  };

  const handleCancelDownload = async () => {
    if (downloadJobIdRef.current !== null && downloadingKey) {
      RNFS.stopDownload(downloadJobIdRef.current);
      const path = getModelPath(downloadingKey);
      setDownloadingKey(null);
      downloadJobIdRef.current = null;
      setDownloadProgress(0);
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
              const fallback: ModelKey | null = updated['1.5b']
                ? '1.5b'
                : updated['3b']
                  ? '3b'
                  : null;
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

  const buildPrompt = (history: ChatMessage[], userPrompt: string): string => {
    let prompt =
      '<|im_start|>system\n당신은 아이폰 온디바이스 환경에서 오프라인으로 동작하는 스마트 AI 어시스턴트 PocketMind입니다. 한국어로 명확하고 체계적으로 답변하며, 코드는 마크다운 코드 블록으로 감싸서 제공하세요.<|im_end|>\n';
    const contextSlice = history.slice(-6);
    for (const msg of contextSlice) {
      prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
    }
    prompt += `<|im_start|>user\n${userPrompt}<|im_end|>\n<|im_start|>assistant\n`;
    return prompt;
  };

  const runCompletion = async (
    sessionId: string,
    historyBeforeUser: ChatMessage[],
    userText: string,
  ) => {
    if (!llamaContextRef.current) {
      setModelModalVisible(true);
      return;
    }

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
      const prompt = buildPrompt(historyBeforeUser, userText);
      await llamaContextRef.current.completion(
        {
          prompt,
          n_predict: 768,
          temperature: 0.7,
          top_p: 0.9,
          stop: ['<|im_end|>', '<|endoftext|>'],
        },
        (tokenData) => {
          fullAnswer += tokenData.token;
          const now = Date.now();
          if (now - lastUiUpdate >= 60) {
            lastUiUpdate = now;
            const snapshot = fullAnswer;
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
      const finalText = fullAnswer.trim() || '(응답이 중지되었습니다)';
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
    const isLastAssistant =
      !isUser && index === currentMessages.length - 1 && !isGenerating;

    if (isUser) {
      return (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    const blocks = parseMessageBlocks(item.content);

    return (
      <View style={styles.assistantRow}>
        <View style={styles.avatarBadge}>
          <Text style={styles.avatarGlyph}>✦</Text>
        </View>
        <View style={styles.assistantContentCol}>
          {item.content.length === 0 ? (
            <View style={styles.typingRow}>
              <ActivityIndicator color="#10A37F" size="small" />
              <Text style={styles.typingHint}>생각하는 중...</Text>
            </View>
          ) : (
            blocks.map((block, bIdx) => {
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
              return <RichTextRenderer key={bIdx} text={block.content} />;
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
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar backgroundColor="#212121" barStyle="light-content" />

      {/* 상단 ChatGPT 스타일 헤더 */}
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
          <Text style={styles.modelPillTitle}>
            {loadedModelKey ? MODELS[loadedModelKey].title : '모델 선택 필요'}
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

      {/* 모델 로딩 배너 */}
      {isInitializingEngine && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator color="#10A37F" size="small" />
          <Text style={styles.loadingBannerText}>
            아이폰 Metal GPU에 AI 모델을 올리는 중...
          </Text>
        </View>
      )}

      {/* 메인 대화 영역 또는 빈 화면 웰컴 뷰 */}
      {currentMessages.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          keyboardShouldPersistTaps="handled">
          <View style={styles.centerLogoWrap}>
            <View style={styles.centerLogoCircle}>
              <Text style={styles.centerLogoIcon}>✦</Text>
            </View>
            <Text style={styles.centerTitle}>무엇을 도와드릴까요?</Text>
            <Text style={styles.centerSubtitle}>
              {loadedModelKey
                ? `${MODELS[loadedModelKey].title} · 오프라인 기기 내 추론 활성`
                : '상단 메뉴에서 AI 모델을 다운로드하면 오프라인으로 작동합니다'}
            </Text>
          </View>

          <View style={styles.suggestionsGrid}>
            {SUGGESTION_CARDS.map((card, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => handleSendMessage(card.prompt)}
                style={styles.suggestionCard}>
                <Text style={styles.suggestionTitle}>{card.title}</Text>
                <Text style={styles.suggestionDesc}>{card.desc}</Text>
              </TouchableOpacity>
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
              placeholder="PocketMind에게 메시지 보내기"
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
          <Pressable
            onPress={() => toggleDrawer(false)}
            style={styles.drawerBackdrop}
          />
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
                <Text style={styles.drawerFooterText}>⚙ 오프라인 AI 모델 관리</Text>
              </TouchableOpacity>
            </SafeAreaView>
          </Animated.View>
        </View>
      )}

      {/* 모델 선택 및 다운로드 모달 */}
      <Modal
        animationType="slide"
        onRequestClose={() => setModelModalVisible(false)}
        transparent
        visible={modelModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>오프라인 AI 모델 선택</Text>
              <TouchableOpacity onPress={() => setModelModalVisible(false)}>
                <Text style={styles.modalClose}>닫기</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDesc}>
              Wi-Fi에서 한 번 다운로드하면 이후 비행기 모드에서도 즉시 작동합니다.
            </Text>

            {(['1.5b', '3b'] as ModelKey[]).map((key) => {
              const spec = MODELS[key];
              const isInstalled = downloadedModels[key];
              const isLoaded = loadedModelKey === key;
              const isThisDownloading = downloadingKey === key;

              return (
                <View
                  key={key}
                  style={[
                    styles.modelCard,
                    isLoaded && styles.modelCardActive,
                  ]}>
                  <View style={styles.modelCardInfo}>
                    <View style={styles.modelCardTitleRow}>
                      <Text style={styles.modelCardName}>{spec.title}</Text>
                      <Text style={styles.modelCardSize}>{spec.sizeLabel}</Text>
                    </View>
                    <Text style={styles.modelCardSub}>{spec.subtitle}</Text>
                  </View>

                  {isThisDownloading ? (
                    <View style={styles.downloadingRow}>
                      <ActivityIndicator color="#10A37F" size="small" />
                      <Text style={styles.downloadingPct}>
                        {downloadProgress}%
                      </Text>
                      <TouchableOpacity
                        onPress={handleCancelDownload}
                        style={styles.cancelDlBtn}>
                        <Text style={styles.cancelDlText}>취소</Text>
                      </TouchableOpacity>
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
                          isLoaded && styles.useModelBtnCurrent,
                        ]}>
                        <Text style={styles.useModelBtnText}>
                          {isLoaded ? '사용 중 ✓' : '불러오기'}
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
                      <Text style={styles.downloadModelBtnText}>다운로드</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
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
    gap: 6,
  },
  modelPillTitle: {
    color: '#ECECEC',
    fontSize: 15,
    fontWeight: '600',
  },
  modelPillChevron: {
    color: '#9B9B9B',
    fontSize: 13,
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
    paddingTop: 48,
    paddingBottom: 20,
  },
  centerLogoWrap: {
    alignItems: 'center',
    marginTop: 24,
  },
  centerLogoCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  centerLogoIcon: {
    color: '#212121',
    fontSize: 26,
    fontWeight: '700',
  },
  centerTitle: {
    color: '#ECECEC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  centerSubtitle: {
    color: '#9B9B9B',
    fontSize: 13,
    textAlign: 'center',
  },
  suggestionsGrid: {
    gap: 10,
    marginTop: 32,
  },
  suggestionCard: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#383838',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
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
    backgroundColor: '#10A37F',
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
    gap: 8,
    paddingVertical: 4,
  },
  typingHint: {
    color: '#9B9B9B',
    fontSize: 14,
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
    backgroundColor: 'rgba(0,0,0,0.55)',
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 34,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    marginBottom: 4,
  },
  modelCard: {
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    gap: 10,
  },
  modelCardActive: {
    borderColor: '#10A37F',
  },
  modelCardInfo: {
    gap: 4,
  },
  modelCardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelCardName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  modelCardSize: {
    color: '#10A37F',
    fontSize: 13,
    fontWeight: '600',
  },
  modelCardSub: {
    color: '#B4B4B4',
    fontSize: 13,
  },
  downloadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  downloadingPct: {
    color: '#10A37F',
    fontSize: 14,
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
    backgroundColor: '#10A37F',
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  useModelBtnCurrent: {
    backgroundColor: '#2F4F47',
  },
  useModelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
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
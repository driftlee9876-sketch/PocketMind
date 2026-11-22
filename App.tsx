import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
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
import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import {
  AI_MODEL_CATALOG,
  AIModelSpec,
  openPluginActionUrl,
  PICKLE_PLUGINS,
  PluginActionLink,
  PluginCategory,
  runActivePlugins,
} from './src/aiModelsAndPlugins';

const DEFAULT_RELAY_URL = 'wss://pocketmind-relay.driftlee9876.workers.dev';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
  pluginsUsed?: string[];
  actionLinks?: PluginActionLink[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
}

const STARTER_CARDS = [
  { icon: '🌤️', title: '오늘 청주 날씨', prompt: '오늘 청주 날씨와 옷차림 알려줘' },
  { icon: '🚄', title: 'KTX 열차 예매', prompt: '오송역에서 서울역 가는 KTX 열차 조회해줘' },
  { icon: '💬', title: '카카오톡 메시지', prompt: '카카오톡으로 보낼 정중한 안부 인사 쓰고 카톡 열어줘' },
  { icon: '🧠', title: '내 기기 기억하기', prompt: '기억해: 내 기기는 갤탭 S7 FE, 아이폰 16 Pro, RTX 3060 랩탑이야' },
];

const PLUGIN_CATEGORIES: ('전체' | PluginCategory)[] = [
  '전체',
  '메신저·연락',
  '지도·교통·여행',
  '쇼핑·배달·결제',
  '미디어·엔터',
  '정보·검색',
  '생산성·기기',
];

export default function App() {
  const [selectedModel, setSelectedModel] = useState<AIModelSpec>(AI_MODEL_CATALOG[1]); // Qwen 2.5 1.5B (갤탭 S7 FE 최적)
  const [downloadedModels, setDownloadedModels] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  // 무설치 WebSocket GPU 공유 상태
  const [relayUrl, setRelayUrl] = useState<string>(DEFAULT_RELAY_URL);
  const [swarmRoom, setSwarmRoom] = useState<string>('pocketmind-my-devices');
  const [gpuShareEnabled, setGpuShareEnabled] = useState<boolean>(false);
  const [workerModeEnabled, setWorkerModeEnabled] = useState<boolean>(Platform.OS === 'android');
  const [relayConnected, setRelayConnected] = useState<boolean>(false);
  const [onlineWorkers, setOnlineWorkers] = useState<number>(0);

  // 30종 앱 플러그인 활성화 목록 (전체 활성 기본값)
  const [enabledPlugins, setEnabledPlugins] = useState<string[]>(
    PICKLE_PLUGINS.map((p) => p.id),
  );
  const [selectedPluginCategory, setSelectedPluginCategory] = useState<'전체' | PluginCategory>('전체');
  const [pluginSearch, setPluginSearch] = useState<string>('');

  // ChatGPT 스타일 세션 & UI 패널 상태
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: 'session-1', title: '새 대화', messages: [] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session-1');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [activeSheet, setActiveSheet] = useState<'none' | 'models' | 'plugins' | 'swarm'>('none');

  const [inputText, setInputText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const llamaRef = useRef<LlamaContext | null>(null);
  const loadedModelIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<boolean>(false);
  const pendingJobsRef = useRef<
    Map<
      string,
      {
        onToken: (t: string) => void;
        resolve: (full: string) => void;
        reject: (err: Error) => void;
        buffer: string;
      }
    >
  >(new Map());
  const scrollViewRef = useRef<ScrollView | null>(null);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = activeSession.messages;

  const getModelPath = (model: AIModelSpec) =>
    `${RNFS.DocumentDirectoryPath}/${model.filename}`;

  const refreshDownloadedModels = async () => {
    const statusMap: Record<string, boolean> = {};
    for (const m of AI_MODEL_CATALOG) {
      statusMap[m.id] = await RNFS.exists(getModelPath(m));
    }
    setDownloadedModels(statusMap);
  };

  useEffect(() => {
    refreshDownloadedModels();
    return () => {
      if (llamaRef.current) {
        llamaRef.current.release().catch(() => {});
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const ensureLocalEngine = async (model: AIModelSpec): Promise<LlamaContext> => {
    const path = getModelPath(model);
    const exists = await RNFS.exists(path);
    if (!exists) {
      throw new Error(
        `'${model.shortName}' 모델 파일이 아직 없습니다. 상단 모델 이름을 눌러 먼저 다운로드해 주세요.`,
      );
    }
    if (llamaRef.current && loadedModelIdRef.current === model.id) {
      return llamaRef.current;
    }
    if (llamaRef.current) {
      await llamaRef.current.release();
      llamaRef.current = null;
    }
    const ctx = await initLlama({
      model: path,
      use_mlock: false,
      use_mmap: true,
      n_ctx: model.nCtx,
      n_gpu_layers: Platform.OS === 'ios' ? 99 : 24,
    });
    llamaRef.current = ctx;
    loadedModelIdRef.current = model.id;
    return ctx;
  };

  // 무설치 WebSocket GPU 공유 연결
  useEffect(() => {
    if (!gpuShareEnabled) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setRelayConnected(false);
      setOnlineWorkers(0);
      return;
    }

    const role = workerModeEnabled && Platform.OS !== 'ios' ? 'worker' : 'client';
    const deviceLabel =
      Platform.OS === 'ios' ? 'iPhone-16-Pro' : 'Galaxy-Tab-S7-FE';
    const tier = Platform.OS === 'ios' ? 2 : 1;
    const cleanBase = relayUrl.trim().replace(/\/+$/, '');
    const fullWsUrl = `${cleanBase}/ws?role=${role}&room=${encodeURIComponent(
      swarmRoom.trim() || 'public',
    )}&device=${encodeURIComponent(deviceLabel)}&tier=${tier}&maxB=3`;

    const ws = new WebSocket(fullWsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setRelayConnected(true);
      ws.send(JSON.stringify({ type: 'ping' }));
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong' || msg.type === 'swarm_update') {
          setOnlineWorkers(Number(msg.onlineWorkers ?? msg.workers ?? 0));
          return;
        }
        if (msg.type === 'job_token') {
          const job = pendingJobsRef.current.get(msg.jobId);
          if (job) {
            job.buffer += msg.token;
            job.onToken(msg.token);
          }
          return;
        }
        if (msg.type === 'job_done') {
          const job = pendingJobsRef.current.get(msg.jobId);
          if (job) {
            pendingJobsRef.current.delete(msg.jobId);
            job.resolve(job.buffer);
          }
          return;
        }
        if (msg.type === 'no_worker' || msg.type === 'job_error') {
          const job = pendingJobsRef.current.get(msg.jobId);
          if (job) {
            pendingJobsRef.current.delete(msg.jobId);
            job.reject(new Error(msg.reason || '원격 워커 응답 실패'));
          }
          return;
        }
        if (msg.type === 'execute_job') {
          try {
            const targetModel =
              AI_MODEL_CATALOG.find((m) => m.id === msg.modelId) || selectedModel;
            const ctx = await ensureLocalEngine(targetModel);
            const formatted = `<|im_start|>system\n${msg.systemPrompt}<|im_end|>\n<|im_start|>user\n${msg.prompt}<|im_end|>\n<|im_start|>assistant\n`;

            await ctx.completion(
              {
                prompt: formatted,
                n_predict: msg.maxTokens || 800,
                temperature: msg.temperature || 0.65,
                stop: ['<|im_end|>', '[|endofturn|]'],
              },
              (tok) => {
                if (ws.readyState === 1) {
                  ws.send(
                    JSON.stringify({
                      type: 'job_token',
                      jobId: msg.jobId,
                      token: tok.token,
                    }),
                  );
                }
              },
            );
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'job_done', jobId: msg.jobId }));
            }
          } catch (err: any) {
            if (ws.readyState === 1) {
              ws.send(
                JSON.stringify({
                  type: 'job_error',
                  jobId: msg.jobId,
                  reason: err?.message || '워커 실행 오류',
                }),
              );
            }
          }
        }
      } catch {
        // 무시
      }
    };

    ws.onclose = () => {
      setRelayConnected(false);
    };

    const pingTimer = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    return () => {
      clearInterval(pingTimer);
      ws.close();
    };
  }, [gpuShareEnabled, workerModeEnabled, relayUrl, swarmRoom]);

  const handleDownloadModel = async (model: AIModelSpec) => {
    if (downloadingId) return;
    setDownloadingId(model.id);
    setDownloadProgress(0);
    try {
      const dest = getModelPath(model);
      const task = RNFS.downloadFile({
        fromUrl: model.downloadUrl,
        toFile: dest,
        progressDivider: 2,
        progress: (res) => {
          if (res.contentLength > 0) {
            setDownloadProgress(Math.round((res.bytesWritten / res.contentLength) * 100));
          }
        },
      });
      const result = await task.promise;
      if (result.statusCode !== 200) {
        await RNFS.unlink(dest).catch(() => {});
        throw new Error(`HTTP ${result.statusCode} 다운로드 실패`);
      }
      await refreshDownloadedModels();
      setSelectedModel(model);
      Alert.alert('다운로드 완료', `${model.shortName} 모델이 준비되었습니다.`);
    } catch (e: any) {
      Alert.alert('다운로드 오류', e?.message || '모델을 내려받지 못했습니다.');
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  const tryRemoteGpuInference = (
    systemPrompt: string,
    prompt: string,
    onToken: (t: string) => void,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!gpuShareEnabled || !ws || ws.readyState !== 1) {
        reject(new Error('공유 네트워크 미연결'));
        return;
      }
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timeout = setTimeout(() => {
        pendingJobsRef.current.delete(jobId);
        reject(new Error('원격 GPU 응답 시간 초과'));
      }, 12000);

      pendingJobsRef.current.set(jobId, {
        buffer: '',
        onToken,
        resolve: (full) => {
          clearTimeout(timeout);
          resolve(full);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      ws.send(
        JSON.stringify({
          type: 'infer_request',
          jobId,
          modelId: selectedModel.id,
          systemPrompt,
          prompt,
          temperature: 0.65,
          maxTokens: 1200,
        }),
      );
    });
  };

  const updateSessionMessages = (
    sessionId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[],
    newTitle?: string,
  ) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              title: newTitle && s.title === '새 대화' ? newTitle : s.title,
              messages: updater(s.messages),
            }
          : s,
      ),
    );
  };

  const handleNewChat = () => {
    const newId = `session-${Date.now()}`;
    setSessions((prev) => [{ id: newId, title: '새 대화', messages: [] }, ...prev]);
    setActiveSessionId(newId);
    setSidebarOpen(false);
  };

  const handleSend = async (overrideText?: string) => {
    const query = (overrideText ?? inputText).trim();
    if (!query || isGenerating) return;

    const targetSessionId = activeSession.id;
    setInputText('');
    setIsGenerating(true);
    abortRef.current = false;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: query,
    };
    const botMsgId = `a-${Date.now() + 1}`;

    updateSessionMessages(
      targetSessionId,
      (prev) => [...prev, userMsg, { id: botMsgId, role: 'assistant', text: '●' }],
      query.slice(0, 22),
    );

    try {
      const pluginRes = await runActivePlugins(query, enabledPlugins);
      const historyContext = messages
        .slice(-4)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n');

      const systemPrompt =
        '당신은 ChatGPT처럼 자연스럽고 똑똑하게 대화하는 PocketMind AI 어시스턴트입니다. 한국어로 친절하고 명확하게 답변하며, 아래 실시간 앱 플러그인 데이터가 제공되면 반드시 반영해서 안내하세요.' +
        pluginRes.contextBlock;

      const combinedPrompt = historyContext
        ? `${historyContext}\nUser: ${query}`
        : query;

      let streamedText = '';
      const appendToken = (tok: string, metaLabel: string) => {
        if (abortRef.current) return;
        streamedText += tok;
        updateSessionMessages(targetSessionId, (prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? {
                  ...m,
                  text: streamedText,
                  meta: metaLabel,
                  pluginsUsed: pluginRes.usedPlugins,
                  actionLinks: pluginRes.actionLinks,
                }
              : m,
          ),
        );
      };

      let remoteSucceeded = false;
      if (gpuShareEnabled && relayConnected) {
        try {
          await tryRemoteGpuInference(systemPrompt, combinedPrompt, (tok) =>
            appendToken(tok, '🌐 원격 공유 GPU'),
          );
          remoteSucceeded = true;
        } catch {
          // 대기 워커 없으면 로컬 온디바이스로 자동 전환
        }
      }

      if (!remoteSucceeded) {
        const ctx = await ensureLocalEngine(selectedModel);
        const formattedPrompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${combinedPrompt}<|im_end|>\n<|im_start|>assistant\n`;

        await ctx.completion(
          {
            prompt: formattedPrompt,
            n_predict: 1200,
            temperature: 0.65,
            top_p: 0.9,
            stop: ['<|im_end|>', '[|endofturn|>'],
          },
          (tok) => appendToken(tok.token, selectedModel.shortName),
        );
      }
    } catch (err: any) {
      updateSessionMessages(targetSessionId, (prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? {
                ...m,
                text: `${err?.message || '모델을 먼저 다운로드해 주세요.'}`,
                meta: '안내',
              }
            : m,
        ),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlugin = (id: string) => {
    setEnabledPlugins((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const filteredPlugins = PICKLE_PLUGINS.filter((p) => {
    const matchCat =
      selectedPluginCategory === '전체' || p.category === selectedPluginCategory;
    const matchQuery =
      !pluginSearch.trim() ||
      p.name.toLowerCase().includes(pluginSearch.toLowerCase()) ||
      p.description.toLowerCase().includes(pluginSearch.toLowerCase());
    return matchCat && matchQuery;
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#212121" />

      {/* ChatGPT 스타일 미니멀 상단 헤더 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setSidebarOpen(true)}
        >
          <Text style={styles.iconBtnText}>☰</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modelPill}
          onPress={() => setActiveSheet('models')}
        >
          <Text style={styles.modelPillTitle}>PocketMind</Text>
          <Text style={styles.modelPillSub}>
            {gpuShareEnabled && relayConnected
              ? `🌐 공유GPU(${onlineWorkers})`
              : selectedModel.shortName}{' '}
            ▾
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconBtn} onPress={handleNewChat}>
          <Text style={styles.iconBtnText}>✎</Text>
        </TouchableOpacity>
      </View>

      {/* 메인 대화 영역 */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatScroll}
        contentContainerStyle={
          messages.length === 0 ? styles.emptyCenterContainer : styles.threadContainer
        }
        onContentSizeChange={() =>
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }
      >
        {messages.length === 0 ? (
          /* ChatGPT 초기 화면 */
          <View style={styles.welcomeWrap}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoGlyph}>✦</Text>
            </View>
            <Text style={styles.welcomeTitle}>무엇을 도와드릴까요?</Text>
            <Text style={styles.welcomeSub}>
              {downloadedModels[selectedModel.id]
                ? `${selectedModel.shortName} 준비됨 · 앱 플러그인 ${enabledPlugins.length}개 활성`
                : `상단 모델 메뉴에서 ${selectedModel.shortName}를 먼저 받아주세요`}
            </Text>

            <View style={styles.starterGrid}>
              {STARTER_CARDS.map((card, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.starterCard}
                  onPress={() => handleSend(card.prompt)}
                >
                  <Text style={styles.starterIcon}>{card.icon}</Text>
                  <Text style={styles.starterTitle}>{card.title}</Text>
                  <Text style={styles.starterDesc} numberOfLines={2}>
                    {card.prompt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          /* ChatGPT 대화 스레드 */
          messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={styles.userRow}>
                <View style={styles.userPill}>
                  <Text style={styles.userText}>{m.text}</Text>
                </View>
              </View>
            ) : (
              <View key={m.id} style={styles.assistantRow}>
                <View style={styles.assistantAvatar}>
                  <Text style={styles.assistantAvatarText}>✦</Text>
                </View>
                <View style={styles.assistantBody}>
                  {m.meta && (
                    <Text style={styles.assistantMeta}>
                      {m.meta}
                      {m.pluginsUsed && m.pluginsUsed.length > 0
                        ? ` · ${m.pluginsUsed.join(', ')}`
                        : ''}
                    </Text>
                  )}
                  <Text style={styles.assistantText}>{m.text}</Text>

                  {m.actionLinks && m.actionLinks.length > 0 && (
                    <View style={styles.appLaunchWrap}>
                      {m.actionLinks.map((act, idx) => (
                        <TouchableOpacity
                          key={idx}
                          style={styles.appLaunchPill}
                          onPress={() =>
                            openPluginActionUrl(act.url, act.fallbackUrl)
                          }
                        >
                          <Text style={styles.appLaunchText}>{act.label} ↗</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {m.text !== '●' && (
                    <View style={styles.msgActionRow}>
                      <TouchableOpacity
                        onPress={() => Share.share({ message: m.text })}
                      >
                        <Text style={styles.msgActionBtn}>공유·복사</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            ),
          )
        )}
      </ScrollView>

      {/* ChatGPT 스타일 하단 캡슐형 입력창 */}
      <View style={styles.composerOuter}>
        <View style={styles.composerPill}>
          <TouchableOpacity
            style={styles.plusBtn}
            onPress={() => setActiveSheet('plugins')}
          >
            <Text style={styles.plusBtnText}>+</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.composerInput}
            placeholder="PocketMind에게 메시지 보내기"
            placeholderTextColor="#8E8EA0"
            value={inputText}
            onChangeText={setInputText}
            multiline
          />

          {isGenerating ? (
            <TouchableOpacity
              style={styles.sendCircleBtn}
              onPress={() => {
                abortRef.current = true;
                setIsGenerating(false);
              }}
            >
              <Text style={styles.stopGlyph}>■</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.sendCircleBtn,
                !inputText.trim() && styles.sendCircleDisabled,
              ]}
              onPress={() => handleSend()}
              disabled={!inputText.trim()}
            >
              <Text style={styles.sendArrow}>↑</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ChatGPT 스타일 좌측 사이드바 드로어 */}
      <Modal visible={sidebarOpen} transparent animationType="fade">
        <View style={styles.sidebarOverlay}>
          <View style={styles.sidebarPanel}>
            <TouchableOpacity style={styles.newChatRow} onPress={handleNewChat}>
              <Text style={styles.newChatText}>✦  새 채팅</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sidebarMenuBtn}
              onPress={() => {
                setSidebarOpen(false);
                setActiveSheet('plugins');
              }}
            >
              <Text style={styles.sidebarMenuText}>
                🧩  앱 플러그인 스토어 ({enabledPlugins.length}/30)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sidebarMenuBtn}
              onPress={() => {
                setSidebarOpen(false);
                setActiveSheet('models');
              }}
            >
              <Text style={styles.sidebarMenuText}>
                🧠  AI 모델 선택 ({selectedModel.shortName})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sidebarMenuBtn}
              onPress={() => {
                setSidebarOpen(false);
                setActiveSheet('swarm');
              }}
            >
              <Text style={styles.sidebarMenuText}>
                🌐  무설치 GPU 공유 ({gpuShareEnabled ? `ON · ${onlineWorkers}대` : 'OFF'})
              </Text>
            </TouchableOpacity>

            <Text style={styles.sidebarSectionLabel}>최근 대화</Text>
            <ScrollView style={{ flex: 1 }}>
              {sessions.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[
                    styles.sessionItem,
                    s.id === activeSession.id && styles.sessionItemActive,
                  ]}
                  onPress={() => {
                    setActiveSessionId(s.id);
                    setSidebarOpen(false);
                  }}
                >
                  <Text style={styles.sessionItemText} numberOfLines={1}>
                    {s.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <TouchableOpacity
            style={styles.sidebarBackdrop}
            onPress={() => setSidebarOpen(false)}
          />
        </View>
      </Modal>

      {/* 하단 바텀시트: AI 모델 (7종) */}
      <Modal
        visible={activeSheet === 'models'}
        transparent
        animationType="slide"
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>AI 모델 선택 (저사양 ~ 초고사양)</Text>
            <ScrollView style={{ maxHeight: 450 }}>
              {AI_MODEL_CATALOG.map((m) => {
                const installed = !!downloadedModels[m.id];
                const selected = selectedModel.id === m.id;
                const isDl = downloadingId === m.id;
                return (
                  <View
                    key={m.id}
                    style={[styles.sheetItem, selected && styles.sheetItemActive]}
                  >
                    <Text style={styles.sheetItemTitle}>
                      [{m.tierLabel}] {m.name} · {m.sizeLabel}
                    </Text>
                    <Text style={styles.sheetItemSub}>{m.recommendedDevices}</Text>
                    <Text style={styles.sheetItemDesc}>{m.description}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      {installed ? (
                        <TouchableOpacity
                          style={styles.sheetPrimaryBtn}
                          onPress={() => {
                            setSelectedModel(m);
                            setActiveSheet('none');
                          }}
                        >
                          <Text style={styles.sheetBtnText}>
                            {selected ? '✓ 현재 사용 중' : '이 모델로 대화'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.sheetDownloadBtn}
                          disabled={!!downloadingId}
                          onPress={() => handleDownloadModel(m)}
                        >
                          <Text style={styles.sheetBtnText}>
                            {isDl ? `다운로드 중 ${downloadProgress}%` : '⬇️ 다운로드'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.sheetCloseBtn}
              onPress={() => setActiveSheet('none')}
            >
              <Text style={styles.sheetCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 하단 바텀시트: 앱 플러그인 30종 */}
      <Modal
        visible={activeSheet === 'plugins'}
        transparent
        animationType="slide"
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              실생활 앱 플러그인 ({enabledPlugins.length}/30 활성)
            </Text>

            <TextInput
              style={styles.searchInput}
              placeholder="플러그인 이름 검색 (예: 카톡, 카카오맵, 배민, 토스...)"
              placeholderTextColor="#8E8EA0"
              value={pluginSearch}
              onChangeText={setPluginSearch}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: 38, marginBottom: 8 }}
            >
              {PLUGIN_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.catChip,
                    selectedPluginCategory === cat && styles.catChipActive,
                  ]}
                  onPress={() => setSelectedPluginCategory(cat)}
                >
                  <Text style={styles.catChipText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <ScrollView style={{ maxHeight: 380 }}>
              {filteredPlugins.map((p) => {
                const active = enabledPlugins.includes(p.id);
                return (
                  <View key={p.id} style={styles.sheetItem}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.sheetItemTitle}>
                        {p.icon} {p.name}
                      </Text>
                      <Switch
                        value={active}
                        onValueChange={() => togglePlugin(p.id)}
                      />
                    </View>
                    <Text style={styles.sheetItemDesc}>{p.description}</Text>
                    <TouchableOpacity
                      style={styles.hintActionBtn}
                      onPress={() => {
                        if (!active) togglePlugin(p.id);
                        setActiveSheet('none');
                        handleSend(p.promptHint);
                      }}
                    >
                      <Text style={styles.hintActionText}>
                        ▶ 실행: "{p.promptHint}"
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={styles.sheetCloseBtn}
              onPress={() => setActiveSheet('none')}
            >
              <Text style={styles.sheetCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 하단 바텀시트: 무설치 GPU 공유 */}
      <Modal
        visible={activeSheet === 'swarm'}
        transparent
        animationType="slide"
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>무설치 GPU 공유 (VPN 불필요)</Text>
            <Text style={styles.sheetItemDesc}>
              테일스케일 설치 없이 wss:// 암호화 중계로 내 RTX 3060 랩탑·LG 그램·아이폰·갤탭을 자동 연결합니다.
            </Text>

            <View style={[styles.rowBetween, { marginTop: 12 }]}>
              <Text style={styles.sheetItemTitle}>GPU 공유 네트워크 켜기</Text>
              <Switch
                value={gpuShareEnabled}
                onValueChange={setGpuShareEnabled}
              />
            </View>

            {Platform.OS === 'android' && (
              <View style={[styles.rowBetween, { marginTop: 8 }]}>
                <Text style={styles.sheetItemTitle}>내 갤탭 유휴 연산력 공유</Text>
                <Switch
                  value={workerModeEnabled}
                  onValueChange={setWorkerModeEnabled}
                />
              </View>
            )}

            <Text style={styles.fieldLabel}>중계 서버 주소</Text>
            <TextInput
              style={styles.searchInput}
              value={relayUrl}
              onChangeText={setRelayUrl}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>내 기기 그룹 코드</Text>
            <TextInput
              style={styles.searchInput}
              value={swarmRoom}
              onChangeText={setSwarmRoom}
              autoCapitalize="none"
            />

            <Text style={styles.swarmStatusText}>
              상태: {relayConnected ? '🟢 연결됨' : '⚪ 대기 중'} · 온라인 워커{' '}
              {onlineWorkers}대
            </Text>

            <TouchableOpacity
              style={styles.sheetCloseBtn}
              onPress={() => setActiveSheet('none')}
            >
              <Text style={styles.sheetCloseText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#212121' },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    backgroundColor: '#212121',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { color: '#ECECEC', fontSize: 20 },
  modelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    gap: 6,
  },
  modelPillTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  modelPillSub: { color: '#B4B4B4', fontSize: 13, fontWeight: '500' },
  chatScroll: { flex: 1 },
  emptyCenterContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  threadContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 20,
  },
  welcomeWrap: { alignItems: 'center' },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logoGlyph: { color: '#171717', fontSize: 24, fontWeight: '800' },
  welcomeTitle: {
    color: '#ECECEC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  welcomeSub: {
    color: '#9B9B9B',
    fontSize: 13,
    marginBottom: 22,
    textAlign: 'center',
  },
  starterGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  starterCard: {
    width: '47%',
    backgroundColor: '#2A2A2A',
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: '#383838',
  },
  starterIcon: { fontSize: 18, marginBottom: 4 },
  starterTitle: { color: '#ECECEC', fontSize: 13, fontWeight: '700' },
  starterDesc: { color: '#9B9B9B', fontSize: 12, marginTop: 3, lineHeight: 17 },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userPill: {
    maxWidth: '82%',
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 22,
  },
  userText: { color: '#ECECEC', fontSize: 15, lineHeight: 22 },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  assistantAvatarText: { color: '#171717', fontSize: 14, fontWeight: '800' },
  assistantBody: { flex: 1 },
  assistantMeta: { color: '#8E8EA0', fontSize: 11, marginBottom: 4 },
  assistantText: { color: '#ECECEC', fontSize: 15, lineHeight: 24 },
  appLaunchWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  appLaunchPill: {
    backgroundColor: '#2F2F2F',
    borderWidth: 1,
    borderColor: '#4A4A4A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  appLaunchText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  msgActionRow: { flexDirection: 'row', marginTop: 8 },
  msgActionBtn: { color: '#8E8EA0', fontSize: 12 },
  composerOuter: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#212121',
  },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#2F2F2F',
    borderRadius: 26,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
  },
  plusBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#3E3E3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBtnText: { color: '#ECECEC', fontSize: 20, fontWeight: '500' },
  composerInput: {
    flex: 1,
    color: '#ECECEC',
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 6,
  },
  sendCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircleDisabled: { backgroundColor: '#565869' },
  sendArrow: { color: '#171717', fontSize: 18, fontWeight: '800' },
  stopGlyph: { color: '#171717', fontSize: 12 },
  sidebarOverlay: { flex: 1, flexDirection: 'row' },
  sidebarPanel: {
    width: '76%',
    maxWidth: 320,
    backgroundColor: '#171717',
    paddingTop: 18,
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  sidebarBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  newChatRow: {
    backgroundColor: '#2A2A2A',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  newChatText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  sidebarMenuBtn: {
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  sidebarMenuText: { color: '#ECECEC', fontSize: 14, fontWeight: '500' },
  sidebarSectionLabel: {
    color: '#8E8EA0',
    fontSize: 12,
    marginTop: 16,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  sessionItem: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  sessionItemActive: { backgroundColor: '#2A2A2A' },
  sessionItemText: { color: '#D1D5DB', fontSize: 14 },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: '#212121',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    borderTopWidth: 1,
    borderColor: '#383838',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#565869',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: '#2F2F2F',
    color: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    marginBottom: 10,
  },
  catChip: {
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 6,
  },
  catChipActive: { backgroundColor: '#FFFFFF' },
  catChipText: { color: '#9B9B9B', fontSize: 12, fontWeight: '700' },
  sheetItem: {
    backgroundColor: '#2A2A2A',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  sheetItemActive: { borderWidth: 1, borderColor: '#FFFFFF' },
  sheetItemTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  sheetItemSub: { color: '#A3A3A3', fontSize: 12, marginTop: 2 },
  sheetItemDesc: { color: '#B4B4B4', fontSize: 12, marginTop: 4, lineHeight: 18 },
  sheetPrimaryBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  sheetDownloadBtn: {
    backgroundColor: '#10A37F',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  sheetBtnText: { color: '#171717', fontSize: 12, fontWeight: '700' },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hintActionBtn: {
    marginTop: 8,
    backgroundColor: '#212121',
    padding: 8,
    borderRadius: 8,
  },
  hintActionText: { color: '#10A37F', fontSize: 12, fontWeight: '600' },
  fieldLabel: { color: '#9B9B9B', fontSize: 12, marginTop: 8, marginBottom: 4 },
  swarmStatusText: {
    color: '#10A37F',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  sheetCloseBtn: {
    marginTop: 12,
    backgroundColor: '#2F2F2F',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  sheetCloseText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
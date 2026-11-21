import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
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
import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import {
  AI_MODEL_CATALOG,
  AIModelSpec,
  openPluginActionUrl,
  PICKLE_PLUGINS,
  runActivePlugins,
} from './src/aiModelsAndPlugins';

// 1단계에서 배포한 본인의 Cloudflare Workers 주소를 여기에 넣으세요
const DEFAULT_RELAY_URL = 'wss://pocketmind-relay.workers.dev';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  badge?: string;
  pluginsUsed?: string[];
  actionLinks?: { label: string; url: string }[];
}

export default function App() {
  const [selectedModel, setSelectedModel] = useState<AIModelSpec>(AI_MODEL_CATALOG[1]); // 기본: Qwen 2.5 1.5B (갤탭 S7 FE 최적)
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

  // 피클 스타일 플러그인 활성화 목록 (기본 10종 모두 활성)
  const [enabledPlugins, setEnabledPlugins] = useState<string[]>(
    PICKLE_PLUGINS.map((p) => p.id),
  );

  // 모달 상태
  const [showModelModal, setShowModelModal] = useState<boolean>(false);
  const [showPluginModal, setShowPluginModal] = useState<boolean>(false);
  const [showSwarmModal, setShowSwarmModal] = useState<boolean>(false);

  // 채팅 상태
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '안녕하세요! PocketMind입니다.\n• 상단 [모델]에서 갤탭 S7 FE용 초경량(0.5B~3B)부터 RTX 3060용 14B 모델까지 선택할 수 있습니다.\n• [플러그인]에서 날씨·검색·KTX·쇼핑·전화·캘린더·기억 10종 도구가 자동 작동합니다.\n• [GPU 공유]를 켜면 VPN 앱 없이 다른 기기와 연산력을 자동 공유합니다.',
      badge: '준비 완료',
    },
  ]);
  const [inputText, setInputText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const llamaRef = useRef<LlamaContext | null>(null);
  const loadedModelIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
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

  // 로컬 GGUF 엔진 로드
  const ensureLocalEngine = async (model: AIModelSpec): Promise<LlamaContext> => {
    const path = getModelPath(model);
    const exists = await RNFS.exists(path);
    if (!exists) {
      throw new Error(`'${model.name}' 모델 파일이 아직 다운로드되지 않았습니다. 상단 [모델]에서 받아주세요.`);
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

  // WebSocket 무설치 GPU 공유 연결 관리
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

        // 클라이언트 요청에 대한 원격 GPU 응답 수신
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

        // 워커 모드: 다른 기기(아이폰 등)가 보낸 추론 작업을 내 기기에서 대신 처리
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

  // 모델 다운로드
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
      Alert.alert('다운로드 완료', `${model.name} 모델이 준비되었습니다.`);
    } catch (e: any) {
      Alert.alert('다운로드 오류', e?.message || '모델을 내려받지 못했습니다.');
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  // 원격 GPU 오프로딩 요청
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

  // 메시지 전송 및 플러그인 + 로컬/원격 추론 실행
  const handleSend = async (overrideText?: string) => {
    const query = (overrideText ?? inputText).trim();
    if (!query || isGenerating) return;

    setInputText('');
    setIsGenerating(true);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: query,
    };
    const botMsgId = `a-${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: botMsgId, role: 'assistant', text: '생각 중...', badge: '준비 중' },
    ]);

    try {
      // 1. 피클 스타일 10종 플러그인 자동 실행
      const pluginRes = await runActivePlugins(query, enabledPlugins);
      const systemPrompt =
        '당신은 PocketMind AI 비서입니다. 사용자의 질문에 한국어로 정확하고 간결하게 답하며, 아래 제공된 실시간 플러그인 데이터가 있으면 반드시 이를 반영해 답하세요.' +
        pluginRes.contextBlock;

      let usedBadge = '';
      let streamedText = '';

      const appendToken = (tok: string, badgeLabel: string) => {
        streamedText += tok;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? {
                  ...m,
                  text: streamedText,
                  badge: badgeLabel,
                  pluginsUsed: pluginRes.usedPlugins,
                  actionLinks: pluginRes.actionLinks,
                }
              : m,
          ),
        );
      };

      // 2. GPU 공유가 켜져 있으면 원격 고성능 GPU(RTX 3060 등) 우선 시도
      let remoteSucceeded = false;
      if (gpuShareEnabled && relayConnected) {
        try {
          usedBadge = '🌐 원격 공유 GPU 실행';
          await tryRemoteGpuInference(systemPrompt, query, (tok) =>
            appendToken(tok, usedBadge),
          );
          remoteSucceeded = true;
        } catch {
          // 대기 워커가 없으면 자동으로 내 기기 온디바이스 추론으로 매끄럽게 전환
        }
      }

      // 3. 로컬 온디바이스 추론 폴백
      if (!remoteSucceeded) {
        usedBadge =
          Platform.OS === 'ios'
            ? `📱 아이폰 로컬 (${selectedModel.tierLabel})`
            : `📱 갤탭 로컬 (${selectedModel.tierLabel})`;

        const ctx = await ensureLocalEngine(selectedModel);
        const formattedPrompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${query}<|im_end|>\n<|im_start|>assistant\n`;

        await ctx.completion(
          {
            prompt: formattedPrompt,
            n_predict: 1200,
            temperature: 0.65,
            top_p: 0.9,
            stop: ['<|im_end|>', '[|endofturn|>'],
          },
          (tok) => appendToken(tok.token, usedBadge),
        );
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? {
                ...m,
                text: `실행 안내: ${err?.message || '모델을 먼저 다운로드해 주세요.'}`,
                badge: '안내',
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* 상단 컨트롤 바 */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.appTitle}>PocketMind</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={[styles.chipBtn, gpuShareEnabled && styles.chipBtnActive]}
              onPress={() => setShowSwarmModal(true)}
            >
              <Text style={styles.chipText}>
                {gpuShareEnabled
                  ? `🌐 공유ON (${onlineWorkers})`
                  : '🌐 GPU공유'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chipBtn}
              onPress={() => setShowPluginModal(true)}
            >
              <Text style={styles.chipText}>🧩 플러그인({enabledPlugins.length})</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chipBtn}
              onPress={() => setShowModelModal(true)}
            >
              <Text style={styles.chipText}>🧠 {selectedModel.tierLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.subStatus}>
          현재 모델: {selectedModel.name} ·{' '}
          {downloadedModels[selectedModel.id] ? '로컬 설치됨' : '다운로드 필요'}
        </Text>
      </View>

      {/* 채팅 영역 */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() =>
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }
      >
        {messages.map((m) => (
          <View
            key={m.id}
            style={[
              styles.msgBubble,
              m.role === 'user' ? styles.userBubble : styles.botBubble,
            ]}
          >
            {m.badge && <Text style={styles.badgeText}>{m.badge}</Text>}
            <Text style={styles.msgText}>{m.text}</Text>

            {m.pluginsUsed && m.pluginsUsed.length > 0 && (
              <View style={styles.pluginTagRow}>
                {m.pluginsUsed.map((tag, idx) => (
                  <Text key={idx} style={styles.pluginTag}>
                    {tag}
                  </Text>
                ))}
              </View>
            )}

            {m.actionLinks && m.actionLinks.length > 0 && (
              <View style={styles.actionLinkBox}>
                {m.actionLinks.map((act, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.actionLinkBtn}
                    onPress={() => openPluginActionUrl(act.url)}
                  >
                    <Text style={styles.actionLinkText}>{act.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* 입력창 */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="질문하거나 날씨·KTX·쇼핑·기억해 등을 입력..."
          placeholderTextColor="#94A3B8"
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, isGenerating && styles.sendBtnDisabled]}
          onPress={() => handleSend()}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>전송</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 1. 저사양~초고사양 AI 모델 선택 모달 */}
      <Modal visible={showModelModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🧠 기기 사양별 AI 모델 (7종)</Text>
            <ScrollView style={{ maxHeight: 440 }}>
              {AI_MODEL_CATALOG.map((m) => {
                const isInstalled = !!downloadedModels[m.id];
                const isSelected = selectedModel.id === m.id;
                const isThisDownloading = downloadingId === m.id;

                return (
                  <View
                    key={m.id}
                    style={[styles.cardItem, isSelected && styles.cardItemSelected]}
                  >
                    <Text style={styles.itemTitle}>
                      [{m.tierLabel}] {m.name} ({m.sizeLabel})
                    </Text>
                    <Text style={styles.itemSub}>권장: {m.recommendedDevices}</Text>
                    <Text style={styles.itemDesc}>{m.description}</Text>

                    <View style={styles.itemBtnRow}>
                      {isInstalled ? (
                        <TouchableOpacity
                          style={styles.primarySmallBtn}
                          onPress={() => {
                            setSelectedModel(m);
                            setShowModelModal(false);
                          }}
                        >
                          <Text style={styles.btnSmallText}>
                            {isSelected ? '✓ 사용 중' : '이 모델 선택'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.downloadSmallBtn}
                          disabled={!!downloadingId}
                          onPress={() => handleDownloadModel(m)}
                        >
                          <Text style={styles.btnSmallText}>
                            {isThisDownloading
                              ? `다운로드 중 ${downloadProgress}%`
                              : '⬇️ 모델 다운로드'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setShowModelModal(false)}
            >
              <Text style={styles.closeModalText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 2. 피클 스타일 10종 플러그인 허브 모달 */}
      <Modal visible={showPluginModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🧩 피클 스타일 실생활 플러그인 (10종)</Text>
            <ScrollView style={{ maxHeight: 440 }}>
              {PICKLE_PLUGINS.map((p) => {
                const active = enabledPlugins.includes(p.id);
                return (
                  <View key={p.id} style={styles.cardItem}>
                    <View style={styles.switchRow}>
                      <Text style={styles.itemTitle}>
                        {p.icon} {p.name}
                      </Text>
                      <Switch value={active} onValueChange={() => togglePlugin(p.id)} />
                    </View>
                    <Text style={styles.itemSub}>{p.category}</Text>
                    <Text style={styles.itemDesc}>{p.description}</Text>
                    <TouchableOpacity
                      style={styles.tryHintBtn}
                      onPress={() => {
                        if (!active) togglePlugin(p.id);
                        setShowPluginModal(false);
                        handleSend(p.promptHint);
                      }}
                    >
                      <Text style={styles.tryHintText}>
                        ▶ 바로 실행: "{p.promptHint}"
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setShowPluginModal(false)}
            >
              <Text style={styles.closeModalText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 3. 무설치 WebSocket GPU 공유 설정 모달 */}
      <Modal visible={showSwarmModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🌐 무설치 GPU 공유 네트워크 (VPN 불필요)</Text>
            <Text style={styles.itemDesc}>
              테일스케일이나 IP 설정 없이 wss:// 암호화 중계로 내 RTX 3060 랩탑·LG 그램·갤탭·아이폰을 자동 연결합니다.
            </Text>

            <View style={styles.switchRow}>
              <Text style={styles.itemTitle}>GPU 공유 네트워크 활성화</Text>
              <Switch value={gpuShareEnabled} onValueChange={setGpuShareEnabled} />
            </View>

            {Platform.OS === 'android' && (
              <View style={styles.switchRow}>
                <Text style={styles.itemTitle}>내 갤탭 유휴 연산력도 공유(워커)</Text>
                <Switch
                  value={workerModeEnabled}
                  onValueChange={setWorkerModeEnabled}
                />
              </View>
            )}

            <Text style={styles.inputLabel}>중계 서버 주소 (Cloudflare Workers)</Text>
            <TextInput
              style={styles.modalInput}
              value={relayUrl}
              onChangeText={setRelayUrl}
              autoCapitalize="none"
            />

            <Text style={styles.inputLabel}>내 기기 그룹 코드 (같은 코드끼리 자동 연결)</Text>
            <TextInput
              style={styles.modalInput}
              value={swarmRoom}
              onChangeText={setSwarmRoom}
              autoCapitalize="none"
            />

            <Text style={styles.statusBanner}>
              연결 상태: {relayConnected ? '🟢 연결됨' : '⚪ 대기 중'} · 현재 온라인 워커:{' '}
              {onlineWorkers}대
            </Text>

            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setShowSwarmModal(false)}
            >
              <Text style={styles.closeModalText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  headerButtons: { flexDirection: 'row', gap: 6 },
  chipBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  chipBtnActive: { backgroundColor: '#0284C7' },
  chipText: { color: '#F8FAFC', fontSize: 12, fontWeight: '700' },
  subStatus: { color: '#94A3B8', fontSize: 11, marginTop: 4 },
  chatArea: { flex: 1 },
  chatContent: { padding: 14, gap: 10 },
  msgBubble: {
    maxWidth: '88%',
    padding: 12,
    borderRadius: 14,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  badgeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  msgText: { color: '#F8FAFC', fontSize: 15, lineHeight: 22 },
  pluginTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  pluginTag: {
    backgroundColor: '#0F172A',
    color: '#A5F3FC',
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  actionLinkBox: { marginTop: 8, gap: 6 },
  actionLinkBtn: {
    backgroundColor: '#0369A1',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  actionLinkText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  inputBar: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 110,
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  sendBtnDisabled: { backgroundColor: '#475569' },
  sendBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#475569',
  },
  modalTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '800', marginBottom: 10 },
  cardItem: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardItemSelected: { borderColor: '#38BDF8' },
  itemTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  itemSub: { color: '#38BDF8', fontSize: 11, marginTop: 2 },
  itemDesc: { color: '#CBD5E1', fontSize: 12, marginTop: 4, lineHeight: 18 },
  itemBtnRow: { flexDirection: 'row', marginTop: 8 },
  primarySmallBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  downloadSmallBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  btnSmallText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  tryHintBtn: {
    marginTop: 8,
    backgroundColor: '#1E293B',
    padding: 8,
    borderRadius: 8,
  },
  tryHintText: { color: '#7DD3FC', fontSize: 12, fontWeight: '600' },
  inputLabel: { color: '#94A3B8', fontSize: 12, marginTop: 10, marginBottom: 4 },
  modalInput: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 13,
  },
  statusBanner: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  closeModalBtn: {
    marginTop: 12,
    backgroundColor: '#334155',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeModalText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
});

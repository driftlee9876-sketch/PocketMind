import React, { Component, ErrorInfo, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
import {
  AIModelSpec,
  executeMultiModelCommand,
  getOrHotSwapLocalContext,
  releaseAllCachedContexts,
  SAFE_DEFAULT_MODELS,
  StageExecutionTrace,
} from './src/multiModelOrchestrator';

// 안전하게 카탈로그 로드 (aiModelsAndPlugins.ts 누락/오류 시에도 절대 크래시 나지 않음)
function loadCatalogSafely(): AIModelSpec[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./src/aiModelsAndPlugins');
    if (mod && Array.isArray(mod.AI_MODEL_CATALOG) && mod.AI_MODEL_CATALOG.length > 0) {
      return mod.AI_MODEL_CATALOG;
    }
  } catch {}
  return SAFE_DEFAULT_MODELS;
}

const AI_MODEL_CATALOG: AIModelSpec[] = loadCatalogSafely();

// Hermes/Android ICU 로케일 RangeError 방지용 안전한 시간 포맷터
function formatNowTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 앱 강제 종료(팅김)를 막고 정확한 원인을 화면에 띄워주는 ErrorBoundary
interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  errorStack: string;
}

class AppCrashGuard extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '', errorStack: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || '알 수 없는 렌더링 오류',
      errorStack: error?.stack || '',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PocketMind CrashGuard caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.crashContainer}>
          <Text style={styles.crashTitle}>⚠️ 앱 오류 감지 (강제 종료 방지됨)</Text>
          <Text style={styles.crashMsg}>{this.state.errorMessage}</Text>
          <ScrollView style={styles.crashScroll}>
            <Text style={styles.crashStack}>{this.state.errorStack}</Text>
          </ScrollView>
          <TouchableOpacity
            style={styles.actionBtnPrimary}
            onPress={() => this.setState({ hasError: false, errorMessage: '', errorStack: '' })}>
            <Text style={styles.actionBtnText}>앱 화면 다시 복구하기</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  traces?: StageExecutionTrace[];
  isMultiModel?: boolean;
}

type TierFilter = 'all' | 'ultra-light' | 'light' | 'mid' | 'high';

const QUICK_MODEL_TAGS = [
  { tag: '@r1', label: '🧠 @r1 추론' },
  { tag: '@coder', label: '💻 @coder 코딩' },
  { tag: '@exaone', label: '🇰🇷 @exaone 한국어' },
  { tag: '@qwen3', label: '⚡ @qwen3 만능' },
  { tag: '@gemma3', label: '✍️ @gemma3 작문' },
  { tag: '@dolphin', label: '🔓 @dolphin 무검열' },
];

function PocketMindMain() {
  const defaultInitialId = AI_MODEL_CATALOG[0]?.id || 'qwen3-4b';
  const [selectedModelId, setSelectedModelId] = useState<string>(defaultInitialId);
  const activeModelIdRef = useRef<string>(defaultInitialId);

  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [downloadingMap, setDownloadingMap] = useState<Record<string, number>>({});
  const downloadJobsRef = useRef<Record<string, number>>({});

  const [autoMultiModelEnabled, setAutoMultiModelEnabled] = useState<boolean>(true);
  const [activeStageBanner, setActiveStageBanner] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const [inputText, setInputText] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome-1',
      role: 'assistant',
      content:
        'PocketMind 하이브리드 멀티 모델 AI가 준비되었습니다.\n' +
        '• 상단 모델 칩을 누르면 RAM 캐시를 통해 즉시 모델이 전환됩니다.\n' +
        '• "멀티체인 ON" 상태에서는 한 번의 명령 안에 추론·코딩·한국어 정리를 여러 모델이 자동으로 분담 실행합니다.\n' +
        '• `@r1 @coder @exaone`처럼 태그를 입력해 원하는 모델 순서를 직접 지정할 수도 있습니다.',
      timestamp: formatNowTime(),
    },
  ]);

  const [isModelModalVisible, setIsModelModalVisible] = useState<boolean>(false);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [modelSearchQuery, setModelSearchQuery] = useState<string>('');

  const [isWorkerModalVisible, setIsWorkerModalVisible] = useState<boolean>(false);
  const [workerUrl, setWorkerUrl] = useState<string>('ws://192.168.0.10:8765');
  const [workerConnected, setWorkerConnected] = useState<boolean>(false);
  const workerSocketRef = useRef<WebSocket | null>(null);
  const pendingWorkerResolversRef = useRef<
    Map<string, { resolve: (text: string) => void; reject: (err: Error) => void }>
  >(new Map());

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  const getRNFS = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('react-native-fs');
    } catch {
      return null;
    }
  };

  const scanInstalledModels = async () => {
    const RNFS = getRNFS();
    if (!RNFS || !RNFS.DocumentDirectoryPath) return;

    const foundIds: string[] = [];
    for (const model of AI_MODEL_CATALOG) {
      const path = `${RNFS.DocumentDirectoryPath}/${model.filename}`;
      try {
        const exists = await RNFS.exists(path);
        if (exists) {
          foundIds.push(model.id);
        }
      } catch {}
    }
    setInstalledModels(foundIds);
    if (foundIds.length > 0 && !foundIds.includes(activeModelIdRef.current)) {
      activeModelIdRef.current = foundIds[0];
      setSelectedModelId(foundIds[0]);
    }
  };

  useEffect(() => {
    scanInstalledModels();
    return () => {
      releaseAllCachedContexts();
      if (workerSocketRef.current) {
        workerSocketRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentModel =
    AI_MODEL_CATALOG.find((m) => m.id === selectedModelId) || AI_MODEL_CATALOG[0];

  const handleInstantModelSwitch = async (targetModel: AIModelSpec, stageLabel?: string) => {
    activeModelIdRef.current = targetModel.id;
    setSelectedModelId(targetModel.id);
    if (stageLabel) {
      setActiveStageBanner(stageLabel);
    }

    if (workerSocketRef.current && workerSocketRef.current.readyState === WebSocket.OPEN) {
      workerSocketRef.current.send(
        JSON.stringify({
          type: 'switch_model',
          modelId: targetModel.id,
          filename: targetModel.filename,
          downloadUrl: targetModel.downloadUrl,
        }),
      );
    }

    if (installedModels.includes(targetModel.id)) {
      try {
        await getOrHotSwapLocalContext(targetModel, (statusMsg) => {
          setActiveStageBanner(statusMsg);
        });
        setTimeout(() => {
          setActiveStageBanner((prev) =>
            prev.startsWith('⚡') || prev.startsWith('✅') ? '' : prev,
          );
        }, 1800);
      } catch (err: any) {
        setActiveStageBanner('');
        Alert.alert('모델 로딩 오류', err?.message || '로컬 모델을 불러오지 못했습니다.');
      }
    } else if (!workerConnected) {
      setActiveStageBanner('');
      Alert.alert(
        '모델 미설치',
        `${targetModel.name} (${targetModel.sizeGB}GB) 모델이 기기에 설치되어 있지 않습니다. 모델 관리자에서 다운로드하거나 원격 PC 워커를 연결하세요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '모델 다운로드 열기', onPress: () => setIsModelModalVisible(true) },
        ],
      );
    }
  };

  const handleDownloadModel = async (model: AIModelSpec) => {
    if (downloadingMap[model.id] !== undefined) return;
    const RNFS = getRNFS();
    if (!RNFS || !RNFS.DocumentDirectoryPath) {
      Alert.alert('오류', '저장소 모듈(RNFS)을 사용할 수 없습니다.');
      return;
    }

    const destPath = `${RNFS.DocumentDirectoryPath}/${model.filename}`;
    setDownloadingMap((prev) => ({ ...prev, [model.id]: 0 }));

    try {
      const ret = RNFS.downloadFile({
        fromUrl: model.downloadUrl,
        toFile: destPath,
        progressDivider: 2,
        begin: () => {
          setDownloadingMap((prev) => ({ ...prev, [model.id]: 1 }));
        },
        progress: (res: { contentLength: number; bytesWritten: number }) => {
          if (res.contentLength > 0) {
            const pct = Math.min(99, Math.round((res.bytesWritten / res.contentLength) * 100));
            setDownloadingMap((prev) => ({ ...prev, [model.id]: pct }));
          }
        },
      });

      downloadJobsRef.current[model.id] = ret.jobId;
      const result = await ret.promise;

      delete downloadJobsRef.current[model.id];
      setDownloadingMap((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });

      if (result.statusCode === 200) {
        await scanInstalledModels();
        await handleInstantModelSwitch(model, `✅ 다운로드 완료 및 즉시 활성화: ${model.shortName}`);
      } else {
        if (await RNFS.exists(destPath)) {
          await RNFS.unlink(destPath);
        }
        Alert.alert('다운로드 실패', `HTTP 상태 코드: ${result.statusCode}`);
      }
    } catch (err: any) {
      delete downloadJobsRef.current[model.id];
      setDownloadingMap((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
      try {
        if (await RNFS.exists(destPath)) {
          await RNFS.unlink(destPath);
        }
      } catch {}
      Alert.alert('다운로드 중단/오류', err?.message || '네트워크 상태를 확인하세요.');
    }
  };

  const handleDeleteModel = async (model: AIModelSpec) => {
    const RNFS = getRNFS();
    if (!RNFS || !RNFS.DocumentDirectoryPath) return;

    const destPath = `${RNFS.DocumentDirectoryPath}/${model.filename}`;
    Alert.alert('모델 삭제', `${model.name} (${model.sizeGB}GB) 파일을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            if (await RNFS.exists(destPath)) {
              await RNFS.unlink(destPath);
            }
            await scanInstalledModels();
          } catch (e: any) {
            Alert.alert('삭제 실패', e?.message || '파일 삭제 중 오류가 발생했습니다.');
          }
        },
      },
    ]);
  };

  const connectRemoteWorker = () => {
    if (workerSocketRef.current) {
      workerSocketRef.current.close();
      workerSocketRef.current = null;
    }
    try {
      const ws = new WebSocket(workerUrl.trim());
      ws.onopen = () => {
        setWorkerConnected(true);
        setIsWorkerModalVisible(false);
        Alert.alert('원격 워커 연결됨', '14B~32B 대형 모델 및 멀티 모델 오프로딩이 활성화되었습니다.');
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.requestId && pendingWorkerResolversRef.current.has(data.requestId)) {
            const resolver = pendingWorkerResolversRef.current.get(data.requestId)!;
            pendingWorkerResolversRef.current.delete(data.requestId);
            if (data.error) {
              resolver.reject(new Error(data.error));
            } else {
              resolver.resolve(String(data.text || data.response || ''));
            }
          }
        } catch {}
      };
      ws.onerror = () => {
        setWorkerConnected(false);
      };
      ws.onclose = () => {
        setWorkerConnected(false);
        for (const [, resolver] of pendingWorkerResolversRef.current.entries()) {
          resolver.reject(new Error('원격 워커 연결이 종료되었습니다.'));
        }
        pendingWorkerResolversRef.current.clear();
      };
      workerSocketRef.current = ws;
    } catch (err: any) {
      Alert.alert('연결 오류', err?.message || '올바른 WebSocket 주소를 입력하세요.');
    }
  };

  const sendRequestToRemoteWorker = (payload: {
    modelId: string;
    filename: string;
    downloadUrl: string;
    systemPrompt: string;
    prompt: string;
  }): Promise<string> => {
    return new Promise((resolve, reject) => {
      const ws = workerSocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('원격 GPU 워커가 연결되어 있지 않습니다.'));
        return;
      }
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingWorkerResolversRef.current.set(requestId, { resolve, reject });
      ws.send(
        JSON.stringify({
          type: 'inference',
          requestId,
          ...payload,
        }),
      );
    });
  };

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isGenerating) return;

    if (installedModels.length === 0 && !workerConnected) {
      Alert.alert(
        '실행 가능한 모델 없음',
        '최소 1개 이상의 로컬 AI 모델을 다운로드하거나 원격 PC GPU 워커를 연결해주세요.',
        [{ text: '모델 다운로드', onPress: () => setIsModelModalVisible(true) }],
      );
      return;
    }

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: formatNowTime(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsGenerating(true);

    try {
      let pluginContextBlock = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./src/aiModelsAndPlugins');
        if (mod && typeof mod.runAutonomousPlugins === 'function') {
          const pluginResults = await mod.runAutonomousPlugins(trimmed);
          if (Array.isArray(pluginResults) && pluginResults.length > 0) {
            pluginContextBlock =
              '\n[자율 실행 플러그인 컨텍스트]\n' +
              pluginResults.map((p: any) => `- ${p.title}: ${p.result}`).join('\n');
          }
        }
      } catch {}

      const result = await executeMultiModelCommand({
        rawPrompt: trimmed,
        pluginContextBlock,
        installedModelIds: installedModels,
        currentModelId: activeModelIdRef.current,
        remoteWorkerConnected: workerConnected,
        autoMultiModelEnabled,
        onModelHotSwap: (swappedModel, stageLabel) => {
          activeModelIdRef.current = swappedModel.id;
          setSelectedModelId(swappedModel.id);
          setActiveStageBanner(stageLabel);
        },
        onStageProgress: (trace) => {
          setActiveStageBanner(
            `완료: ${trace.roleTitle} (${trace.modelShortName}, ${(trace.elapsedMs / 1000).toFixed(1)}초)`,
          );
        },
        runRemoteInference: async (model, systemPrompt, userPrompt) => {
          return await sendRequestToRemoteWorker({
            modelId: model.id,
            filename: model.filename,
            downloadUrl: model.downloadUrl,
            systemPrompt,
            prompt: userPrompt,
          });
        },
      });

      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: result.finalResponse || '(응답이 비어 있습니다)',
        timestamp: formatNowTime(),
        traces: result.traces,
        isMultiModel: result.isMultiModel,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'system',
        content: `⚠️ 실행 오류: ${err?.message || '알 수 없는 오류가 발생했습니다.'}`,
        timestamp: formatNowTime(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
      setActiveStageBanner('');
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const handleInsertTag = (tag: string) => {
    setInputText((prev) => {
      if (prev.includes(tag)) return prev;
      return prev.trim().length > 0 ? `${tag} ${prev}` : `${tag} `;
    });
  };

  const filteredCatalog = AI_MODEL_CATALOG.filter((m) => {
    const matchTier = tierFilter === 'all' || m.tier === tierFilter;
    const q = modelSearchQuery.trim().toLowerCase();
    const matchQuery =
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.family.toLowerCase().includes(q) ||
      (Array.isArray(m.tags) && m.tags.some((t) => t.toLowerCase().includes(q))) ||
      (Array.isArray(m.specialtyRoles) && m.specialtyRoles.some((r) => r.toLowerCase().includes(q)));
    return matchTier && matchQuery;
  });

  const quickSwitchModels = AI_MODEL_CATALOG.filter(
    (m) => installedModels.includes(m.id) || (workerConnected && m.tier !== 'ultra-light'),
  );
  const displayQuickModels =
    quickSwitchModels.length > 0 ? quickSwitchModels : AI_MODEL_CATALOG.slice(0, 6);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appTitle}>PocketMind AI</Text>
          <Text style={styles.subTitle}>
            활성: {currentModel?.shortName || '준비됨'} ({currentModel?.params || '-'})
          </Text>
        </View>

        <View style={styles.headerControls}>
          <View style={styles.switchPill}>
            <Text style={styles.switchLabel}>멀티체인</Text>
            <Switch
              value={autoMultiModelEnabled}
              onValueChange={setAutoMultiModelEnabled}
              trackColor={{ false: '#334155', true: '#2563EB' }}
              thumbColor="#F8FAFC"
            />
          </View>

          <TouchableOpacity
            style={[styles.iconBtn, workerConnected && styles.iconBtnConnected]}
            onPress={() => setIsWorkerModalVisible(true)}>
            <Text style={styles.iconBtnText}>{workerConnected ? 'GPU연결됨' : 'PC워커'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.modelManagerBtn}
            onPress={() => setIsModelModalVisible(true)}>
            <Text style={styles.modelManagerBtnText}>
              모델 ({installedModels.length}/{AI_MODEL_CATALOG.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.hotSwapBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hotSwapScroll}>
          {displayQuickModels.map((model) => {
            const isSelected = model.id === selectedModelId;
            const isInstalled = installedModels.includes(model.id);
            return (
              <TouchableOpacity
                key={model.id}
                style={[
                  styles.modelChip,
                  isSelected && styles.modelChipActive,
                  !isInstalled && !workerConnected && styles.modelChipUninstalled,
                ]}
                onPress={() => handleInstantModelSwitch(model)}>
                <Text style={[styles.modelChipText, isSelected && styles.modelChipTextActive]}>
                  {isInstalled ? '● ' : '☁ '}
                  {model.shortName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {activeStageBanner.length > 0 && (
        <View style={styles.stageBanner}>
          <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 8 }} />
          <Text style={styles.stageBannerText} numberOfLines={1}>
            {activeStageBanner}
          </Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          const isSystem = item.role === 'system';
          return (
            <View
              style={[
                styles.messageBubble,
                isUser ? styles.userBubble : isSystem ? styles.systemBubble : styles.assistantBubble,
              ]}>
              {item.traces && item.traces.length > 0 && (
                <View style={styles.traceContainer}>
                  <Text style={styles.traceHeader}>
                    {item.isMultiModel
                      ? `🔗 멀티 모델 파이프라인 (${item.traces.length}개 모델 협업)`
                      : `⚡ 단일 모델 실행`}
                  </Text>
                  {item.traces.map((t) => (
                    <Text key={`${item.id}_st_${t.stageIndex}`} style={styles.traceItem}>
                      {t.stageIndex}. [{t.roleTitle}] {t.modelShortName} (
                      {t.viaWorker ? 'PC GPU' : '로컬'}, {(t.elapsedMs / 1000).toFixed(1)}s)
                    </Text>
                  ))}
                </View>
              )}
              <Text style={styles.messageText}>{item.content}</Text>
              <Text style={styles.timestampText}>{item.timestamp}</Text>
            </View>
          );
        }}
      />

      <View style={styles.tagBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagScroll}>
          {QUICK_MODEL_TAGS.map((item) => (
            <TouchableOpacity
              key={item.tag}
              style={styles.tagChip}
              onPress={() => handleInsertTag(item.tag)}>
              <Text style={styles.tagChipText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="명령 입력 (예: @r1 @coder @exaone 알고리즘 설계하고 코드 짠 뒤 요약해줘)"
          placeholderTextColor="#64748B"
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || isGenerating) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isGenerating}>
          {isGenerating ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.sendBtnText}>전송</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={isModelModalVisible}
        animationType="slide"
        onRequestClose={() => setIsModelModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>AI 모델 허브 ({AI_MODEL_CATALOG.length}종 GGUF)</Text>
            <TouchableOpacity onPress={() => setIsModelModalVisible(false)}>
              <Text style={styles.modalCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            value={modelSearchQuery}
            onChangeText={setModelSearchQuery}
            placeholder="모델명, Qwen3, Gemma3, DeepSeek, 무검열, 코딩 검색..."
            placeholderTextColor="#64748B"
          />

          <View style={styles.filterRow}>
            {(
              [
                { key: 'all', label: '전체' },
                { key: 'ultra-light', label: '초경량(0.5~2B)' },
                { key: 'light', label: '표준(3~4B)' },
                { key: 'mid', label: '중형(7~12B)' },
                { key: 'high', label: '대형(14~32B)' },
              ] as { key: TierFilter; label: string }[]
            ).map((tab) => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.filterTab, tierFilter === tab.key && styles.filterTabActive]}
                onPress={() => setTierFilter(tab.key)}>
                <Text
                  style={[
                    styles.filterTabText,
                    tierFilter === tab.key && styles.filterTabTextActive,
                  ]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <FlatList
            data={filteredCatalog}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.modelListContent}
            renderItem={({ item }) => {
              const isInstalled = installedModels.includes(item.id);
              const isActive = item.id === selectedModelId;
              const progress = downloadingMap[item.id];
              const isDownloading = progress !== undefined;

              return (
                <View style={[styles.modelCard, isActive && styles.modelCardActive]}>
                  <View style={styles.modelCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modelName}>{item.name}</Text>
                      <Text style={styles.modelMeta}>
                        {item.params} · {item.quant} · {item.sizeGB}GB · 최소 RAM {item.minRamGB}GB
                      </Text>
                    </View>
                    {item.uncensored && (
                      <View style={styles.uncensoredBadge}>
                        <Text style={styles.uncensoredBadgeText}>무검열</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.modelDesc}>{item.description}</Text>

                  <View style={styles.tagWrap}>
                    {(item.tags || []).map((t) => (
                      <View key={t} style={styles.specTag}>
                        <Text style={styles.specTagText}>{t}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.cardActions}>
                    {isDownloading ? (
                      <View style={styles.progressBox}>
                        <ActivityIndicator size="small" color="#38BDF8" />
                        <Text style={styles.progressText}>다운로드 중... {progress}%</Text>
                      </View>
                    ) : isInstalled ? (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtnPrimary, isActive && styles.actionBtnCurrent]}
                          onPress={() => {
                            handleInstantModelSwitch(item);
                            setIsModelModalVisible(false);
                          }}>
                          <Text style={styles.actionBtnText}>
                            {isActive ? '현재 활성 모델' : '즉시 전환'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionBtnDelete}
                          onPress={() => handleDeleteModel(item)}>
                          <Text style={styles.actionBtnDeleteText}>삭제</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.actionBtnDownload}
                          onPress={() => handleDownloadModel(item)}>
                          <Text style={styles.actionBtnText}>다운로드 ({item.sizeGB}GB)</Text>
                        </TouchableOpacity>
                        {workerConnected && (
                          <TouchableOpacity
                            style={styles.actionBtnWorker}
                            onPress={() => {
                              handleInstantModelSwitch(item);
                              setIsModelModalVisible(false);
                            }}>
                            <Text style={styles.actionBtnText}>PC워커로 즉시 실행</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                </View>
              );
            }}
          />
        </SafeAreaView>
      </Modal>

      <Modal
        visible={isWorkerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsWorkerModalVisible(false)}>
        <View style={styles.overlayBg}>
          <View style={styles.workerBox}>
            <Text style={styles.modalTitle}>원격 PC GPU 워커 연결</Text>
            <Text style={styles.modelDesc}>
              RTX 3060 12GB 등 PC 워커를 연결하면 스마트폰 용량 부담 없이 14B~32B 대형 모델과 다중 모델 체인을 초고속으로 실행합니다.
            </Text>
            <TextInput
              style={styles.searchInput}
              value={workerUrl}
              onChangeText={setWorkerUrl}
              placeholder="ws://192.168.0.10:8765"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
            />
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.actionBtnPrimary} onPress={connectRemoteWorker}>
                <Text style={styles.actionBtnText}>연결하기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtnDelete}
                onPress={() => setIsWorkerModalVisible(false)}>
                <Text style={styles.actionBtnDeleteText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppCrashGuard>
      <PocketMindMain />
    </AppCrashGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  crashContainer: { flex: 1, backgroundColor: '#0B0F19', padding: 20, justifyContent: 'center' },
  crashTitle: { color: '#F87171', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  crashMsg: { color: '#F8FAFC', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  crashScroll: {
    maxHeight: 280,
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  crashStack: { color: '#94A3B8', fontSize: 11 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  headerLeft: { flex: 1 },
  appTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '700' },
  subTitle: { color: '#38BDF8', fontSize: 12, marginTop: 2 },
  headerControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingLeft: 8,
    paddingRight: 2,
    borderRadius: 16,
  },
  switchLabel: { color: '#CBD5E1', fontSize: 11, fontWeight: '600', marginRight: 2 },
  iconBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
  },
  iconBtnConnected: { backgroundColor: '#065F46' },
  iconBtnText: { color: '#E2E8F0', fontSize: 11, fontWeight: '600' },
  modelManagerBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  modelManagerBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  hotSwapBar: {
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingVertical: 6,
  },
  hotSwapScroll: { paddingHorizontal: 12, gap: 6 },
  modelChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modelChipActive: { backgroundColor: '#1D4ED8', borderColor: '#60A5FA' },
  modelChipUninstalled: { opacity: 0.7 },
  modelChipText: { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  modelChipTextActive: { color: '#FFFFFF' },
  stageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0C4A6E',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  stageBannerText: { color: '#E0F2FE', fontSize: 12, fontWeight: '600', flex: 1 },
  chatList: { padding: 14, gap: 10 },
  messageBubble: { maxWidth: '88%', padding: 12, borderRadius: 14 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#2563EB' },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#991B1B',
  },
  traceContainer: {
    backgroundColor: '#0F172A',
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8',
  },
  traceHeader: { color: '#38BDF8', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  traceItem: { color: '#94A3B8', fontSize: 11, lineHeight: 16 },
  messageText: { color: '#F8FAFC', fontSize: 14, lineHeight: 20 },
  timestampText: { color: '#94A3B8', fontSize: 10, marginTop: 6, alignSelf: 'flex-end' },
  tagBar: {
    backgroundColor: '#0F172A',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  tagScroll: { paddingHorizontal: 12, gap: 6 },
  tagChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagChipText: { color: '#93C5FD', fontSize: 11, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    backgroundColor: '#111827',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 110,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#334155' },
  sendBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  modalContainer: { flex: 1, backgroundColor: '#0B0F19' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  modalTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '700' },
  modalCloseText: { color: '#38BDF8', fontSize: 15, fontWeight: '600' },
  searchInput: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    fontSize: 13,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    flexWrap: 'wrap',
  },
  filterTab: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  filterTabActive: { backgroundColor: '#2563EB' },
  filterTabText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  filterTabTextActive: { color: '#FFFFFF' },
  modelListContent: { padding: 14, gap: 10 },
  modelCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modelCardActive: { borderColor: '#3B82F6' },
  modelCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  modelName: { color: '#F8FAFC', fontSize: 15, fontWeight: '700' },
  modelMeta: { color: '#38BDF8', fontSize: 12, marginTop: 2 },
  uncensoredBadge: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  uncensoredBadgeText: { color: '#FCA5A5', fontSize: 11, fontWeight: '700' },
  modelDesc: { color: '#CBD5E1', fontSize: 13, marginTop: 8, lineHeight: 18 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  specTag: { backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  specTagText: { color: '#94A3B8', fontSize: 11 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  progressBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  progressText: { color: '#38BDF8', fontSize: 13, fontWeight: '600' },
  actionBtnPrimary: {
    flex: 1,
    backgroundColor: '#2563EB',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnCurrent: { backgroundColor: '#059669' },
  actionBtnDownload: {
    flex: 1,
    backgroundColor: '#0284C7',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnWorker: {
    flex: 1,
    backgroundColor: '#4F46E5',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnDelete: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  actionBtnDeleteText: { color: '#FCA5A5', fontSize: 13, fontWeight: '600' },
  overlayBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  workerBox: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
});

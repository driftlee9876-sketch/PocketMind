// App.tsx
// ChatGPT 스타일 다크 모바일 UI + 60종 플러그인 스토어 + 초경량 무검열 모델 허브 + 자율 멀티모델 체인

import React, { Component, ErrorInfo, ReactNode, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  Modal,
  NativeModules,
  PermissionsAndroid,
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
import {
  AI_MODEL_CATALOG,
  AI_PLUGIN_CATALOG,
  PluginCategory,
  PluginExecutionOutput,
} from './src/aiModelsAndPlugins';
import { CONNECTED_APP_CATALOG } from './src/connectedAppsCatalog';
import {
  getConfiguredIntegrations,
  submitIntegrationAction,
  approveIntegrationAction,
  rejectIntegrationAction,
} from './src/integrationActions';
import { discoverCoordinatorWorkers } from './src/distributedCoordinatorClient';
import { stopAndroidWorkerService } from './src/androidWorkerRuntime';
import type { CoordinatorWorker } from './src/distributedCoordinatorClient';
import {
  multiModelOrchestrator,
  PipelineStepResult,
  RemotePCConfig,
} from './src/multiModelOrchestrator';

function formatNowTime(): string {
  try {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '00:00';
  }
}

function getRNFS(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-fs');
  } catch {
    return null;
  }
}

// ============================================================================
// 전역 크래시 가드 (실행 즉시 종료 방지)
// ============================================================================
interface CrashGuardProps {
  children: ReactNode;
}
interface CrashGuardState {
  hasError: boolean;
  errorMessage: string;
}

class AppCrashGuard extends Component<CrashGuardProps, CrashGuardState> {
  constructor(props: CrashGuardProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): CrashGuardState {
    return { hasError: true, errorMessage: error?.message || '알 수 없는 런타임 오류' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PocketMind CrashGuard]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.crashContainer}>
          <Text style={styles.crashTitle}>⚠️ PocketMind 오류 복구</Text>
          <Text style={styles.crashSub}>{this.state.errorMessage}</Text>
          <TouchableOpacity
            style={styles.crashRetryBtn}
            onPress={() => this.setState({ hasError: false, errorMessage: '' })}
          >
            <Text style={styles.crashRetryText}>앱 다시 시작</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// 메인 ChatGPT 스타일 화면
// ============================================================================
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  pipelineSteps?: PipelineStepResult[];
  pluginOutputs?: PluginExecutionOutput[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  pinned?: boolean;
}

interface DeviceMetrics {
  cpuUsagePercent?: number | null;
  cpuTemperatureC?: number | null;
  gpuTemperatureC?: number | null;
  usedRamMb?: number;
  totalRamMb?: number;
  ramUsagePercent?: number;
  usbConnected?: boolean;
  usbDeviceCount?: number;
  usbStatus?: string;
  thermalState?: string;
}

function summarizeSessionPreview(session: ChatSession): string {
  const latestAssistant = [...session.messages].reverse().find((message) => message.role === 'assistant');
  const latestUser = [...session.messages].reverse().find((message) => message.role === 'user');
  const source = latestAssistant?.text || latestUser?.text || '아직 대화가 없습니다.';
  const clean = source.replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 69)}…` : clean;
}

const PLUGIN_CATEGORIES: ('전체' | PluginCategory)[] = [
  '전체',
  '웹·검색',
  '수학·금융',
  '코딩·개발',
  '문서·언어',
  '메모·시스템',
  'AI부스터',
];

const MODEL_FILTER_TABS = ['전체', '초경량·무검열', '경량 (3B~4B)', '중형 (7B~12B)', 'PC GPU (14B+)'];

function PocketMindChatGPTScreen() {
  const safeCatalog = Array.isArray(AI_MODEL_CATALOG) ? AI_MODEL_CATALOG : [];
  const safePlugins = Array.isArray(AI_PLUGIN_CATALOG) ? AI_PLUGIN_CATALOG : [];

  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: 'session-1', title: '새 채팅', messages: [] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session-1');
  const [historyReady, setHistoryReady] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [deviceMetrics, setDeviceMetrics] = useState<DeviceMetrics | null>(null);
  const [connectionSettingsReady, setConnectionSettingsReady] = useState(false);

  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [streamingText, setStreamingText] = useState('');

  // 설치된 모델 및 기본 선택 모델
  const [installedModelIds, setInstalledModelIds] = useState<string[]>([]);
  const [primaryModelId, setPrimaryModelId] = useState<string>('qwen2.5-0.5b-abliterated');
  const [autoMultiModel, setAutoMultiModel] = useState<boolean>(true);
  const [downloadingMap, setDownloadingMap] = useState<Record<string, number>>({});

  // 60종 플러그인 활성화 상태 (기본 전체 활성화)
  const [enabledPluginIds, setEnabledPluginIds] = useState<string[]>(() =>
    safePlugins.map((p) => p.id),
  );

  // PC GPU 워커 설정
  const [remotePC, setRemotePC] = useState<RemotePCConfig>({
    enabled: false,
    serverUrl: '',
    apiKey: '',
  });

  // 모달 & 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelStoreOpen, setModelStoreOpen] = useState(false);
  const [pluginStoreOpen, setPluginStoreOpen] = useState(false);
  const [quickPlusOpen, setQuickPlusOpen] = useState(false);
  const [pcWorkerOpen, setPcWorkerOpen] = useState(false);
  const [connectedAppsOpen, setConnectedAppsOpen] = useState(false);
  const [androidWorkerOpen, setAndroidWorkerOpen] = useState(false);
  const [androidWorkerRunning, setAndroidWorkerRunning] = useState(false);
  const [workerEnrollmentToken, setWorkerEnrollmentToken] = useState('');
  const [workerModelIds, setWorkerModelIds] = useState<string[]>([]);
  const [workerUseGpu, setWorkerUseGpu] = useState(false);
  const [configuredIntegrationIds, setConfiguredIntegrationIds] = useState<string[]>([]);
  const [coordinatorWorkers, setCoordinatorWorkers] = useState<CoordinatorWorker[]>([]);
  const [workerDiscoveryMessage, setWorkerDiscoveryMessage] = useState('아직 검색하지 않았습니다.');

  // 필터 검색 상태
  const [pluginCategory, setPluginCategory] = useState<'전체' | PluginCategory>('전체');
  const [pluginSearch, setPluginSearch] = useState('');
  const [modelTab, setModelTab] = useState<string>('전체');

  const scrollRef = useRef<any>(null);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];

  const scanInstalledModels = async () => {
    try {
      const RNFS = getRNFS();
      if (!RNFS || !RNFS.DocumentDirectoryPath) return;
      const found: string[] = [];
      for (const spec of safeCatalog) {
        const filePath = `${RNFS.DocumentDirectoryPath}/${spec.filename}`;
        const exists = await RNFS.exists(filePath);
        if (exists) {
          const stat = await RNFS.stat(filePath);
          if (Number(stat.size || 0) > 1024 * 1024) {
            found.push(spec.id);
          }
        }
      }
      setInstalledModelIds(found);
      if (found.length > 0 && !found.includes(primaryModelId)) {
        setPrimaryModelId(found[0]);
      }
    } catch {}
  };

  useEffect(() => {
    scanInstalledModels();
    return () => {
      multiModelOrchestrator.releaseAll().catch(() => {});
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const restoreHistory = async () => {
      try {
        const raw = await AsyncStorage.getItem('pocketmind.chat-history.v1');
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved?.sessions)) return;
        const restored = saved.sessions
          .filter((session: any) => session && typeof session.id === 'string' && Array.isArray(session.messages))
          .slice(0, 50)
          .map((session: any) => ({
            id: session.id,
            title: typeof session.title === 'string' ? session.title.slice(0, 80) : '대화',
            pinned: session.pinned === true,
            messages: session.messages
              .filter((message: any) => message && typeof message.id === 'string' &&
                (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string')
              .slice(-120),
          }));
        if (mounted && restored.length > 0) {
          setSessions(restored);
          const savedActiveId = typeof saved.activeSessionId === 'string' ? saved.activeSessionId : '';
          setActiveSessionId(restored.some((session: ChatSession) => session.id === savedActiveId)
            ? savedActiveId : restored[0].id);
        }
      } catch (error) {
        console.warn('[PocketMind] 대화 기록을 복원하지 못했습니다.', error);
      } finally {
        if (mounted) setHistoryReady(true);
      }
    };
    restoreHistory();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    const snapshot = {
      sessions: sessions.slice(0, 50).map((session) => ({
        ...session,
        messages: session.messages.slice(-120),
      })),
      activeSessionId,
    };
    AsyncStorage.setItem('pocketmind.chat-history.v1', JSON.stringify(snapshot)).catch((error) => {
      console.warn('[PocketMind] 대화 기록을 저장하지 못했습니다.', error);
    });
  }, [sessions, activeSessionId, historyReady]);

  useEffect(() => {
    let mounted = true;
    const restoreConnectionSettings = async () => {
      try {
        const savedUrl = await AsyncStorage.getItem('pocketmind.coordinator-url.v1');
        const native = NativeModules.PocketMindWorker;
        const savedToken = Platform.OS === 'android' && typeof native?.getSecret === 'function'
          ? await native.getSecret('pocketmind.coordinator-api-token.v1')
          : '';
        if (mounted) {
          setRemotePC((previous) => ({
            ...previous,
            serverUrl: savedUrl || '',
            apiKey: typeof savedToken === 'string' ? savedToken : '',
          }));
        }
      } catch (error) {
        console.warn('[PocketMind] 연결 설정을 복원하지 못했습니다.', error);
      } finally {
        if (mounted) setConnectionSettingsReady(true);
      }
    };
    restoreConnectionSettings();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!connectionSettingsReady) return;
    AsyncStorage.setItem('pocketmind.coordinator-url.v1', remotePC.serverUrl).catch(() => {});
    if (Platform.OS === 'android') {
      const native = NativeModules.PocketMindWorker;
      if (remotePC.apiKey && typeof native?.setSecret === 'function') {
        native.setSecret('pocketmind.coordinator-api-token.v1', remotePC.apiKey).catch(() => {});
      } else if (typeof native?.removeSecret === 'function') {
        native.removeSecret('pocketmind.coordinator-api-token.v1').catch(() => {});
      }
    }
  }, [connectionSettingsReady, remotePC.serverUrl, remotePC.apiKey]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;
    const refreshMetrics = async () => {
      try {
        const native = NativeModules.PocketMindWorker;
        if (typeof native?.getDeviceMetrics !== 'function') return;
        const metrics = await native.getDeviceMetrics();
        if (mounted && metrics) setDeviceMetrics(metrics as DeviceMetrics);
      } catch (error) {
        console.warn('[PocketMind] 기기 상태를 읽지 못했습니다.', error);
      }
    };
    refreshMetrics();
    const timer = setInterval(refreshMetrics, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const updateActiveSessionMessages = (
    updater: (prev: ChatMessage[]) => ChatMessage[],
    newTitleIfFirst?: string,
  ) => {
    setSessions((prevSessions) =>
      prevSessions.map((sess) => {
        if (sess.id !== activeSession.id) return sess;
        const nextMsgs = updater(sess.messages);
        const nextTitle =
          sess.messages.length === 0 && newTitleIfFirst
            ? newTitleIfFirst.slice(0, 24)
            : sess.title;
        return { ...sess, title: nextTitle, messages: nextMsgs };
      }),
    );
  };

  const visibleSessions = sessions
    .filter((session) => {
      const query = historySearch.trim().toLocaleLowerCase();
      return !query || session.title.toLocaleLowerCase().includes(query) ||
        summarizeSessionPreview(session).toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  const toggleSessionPinned = (sessionId: string) => {
    setSessions((previous) => previous.map((session) =>
      session.id === sessionId ? { ...session, pinned: !session.pinned } : session,
    ));
  };

  const handleNewChat = () => {
    const newId = `session-${Date.now()}`;
    setSessions((prev) => [{ id: newId, title: '새 채팅', messages: [] }, ...prev]);
    setActiveSessionId(newId);
    setSidebarOpen(false);
  };

  const handleDownloadModel = async (modelId: string) => {
    const spec = safeCatalog.find((m) => m.id === modelId);
    if (!spec || downloadingMap[modelId] !== undefined) return;
    const RNFS = getRNFS();
    if (!RNFS || !RNFS.DocumentDirectoryPath) {
      Alert.alert('저장소 오류', '파일 시스템 모듈을 찾을 수 없습니다.');
      return;
    }

    const destPath = `${RNFS.DocumentDirectoryPath}/${spec.filename}`;
    setDownloadingMap((prev) => ({ ...prev, [modelId]: 0 }));

    try {
      const downloadJob = RNFS.downloadFile({
        fromUrl: spec.downloadUrl,
        toFile: destPath,
        background: true,
        progressDivider: 4,
        progress: (res: any) => {
          if (res.contentLength > 0) {
            const pct = Math.min(99, Math.round((res.bytesWritten / res.contentLength) * 100));
            setDownloadingMap((prev) => ({ ...prev, [modelId]: pct }));
          }
        },
      });

      const result = await downloadJob.promise;
      if (result.statusCode >= 200 && result.statusCode < 300) {
        await scanInstalledModels();
        setPrimaryModelId(spec.id);
        Alert.alert('설치 완료', `${spec.name} 모델이 준비되었습니다.`);
      } else {
        throw new Error(`HTTP ${result.statusCode}`);
      }
    } catch (err: any) {
      try {
        await RNFS.unlink(destPath);
      } catch {}
      Alert.alert('다운로드 실패', err?.message || '네트워크 또는 저장공간을 확인하세요.');
    } finally {
      setDownloadingMap((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    const spec = safeCatalog.find((m) => m.id === modelId);
    const RNFS = getRNFS();
    if (!spec || !RNFS) return;
    try {
      const path = `${RNFS.DocumentDirectoryPath}/${spec.filename}`;
      if (await RNFS.exists(path)) await RNFS.unlink(path);
      await scanInstalledModels();
    } catch {}
  };

  const handleSendMessage = async (overridePrompt?: string) => {
    const trimmed = (overridePrompt !== undefined ? overridePrompt : inputText).trim();
    if (!trimmed || isGenerating) return;

    const hasLocal = installedModelIds.length > 0;
    const hasPC = remotePC.enabled && remotePC.serverUrl.trim().length > 0;

    // 플러그인 슬래시 명령어 단독 실행일 경우 모델 없이도 즉시 실행 가능
    const isPurePluginCommand = /^\/[a-z0-9-]+(\s|$)/i.test(trimmed);

    if (!hasLocal && !hasPC && !isPurePluginCommand) {
      Alert.alert(
        'AI 모델 다운로드 필요',
        '초경량 무검열 모델(490MB Qwen 2.5 0.5B 또는 810MB Dolphin 3.0 1B)을 먼저 다운로드하거나 PC GPU 워커를 연결해 주세요.',
        [{ text: '모델 허브 열기', onPress: () => setModelStoreOpen(true) }],
      );
      return;
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: formatNowTime(),
    };

    updateActiveSessionMessages((prev) => [...prev, userMsg], trimmed);
    if (overridePrompt === undefined) setInputText('');
    setIsGenerating(true);
    setLiveStatus('생각 중...');
    setStreamingText('');

    try {
      const response = await multiModelOrchestrator.executeAutonomousPipeline({
        userPrompt: trimmed,
        installedModelIds,
        primaryModelId,
        autoMultiModelEnabled: autoMultiModel,
        enabledPluginIds,
        remotePC,
        callbacks: {
          onStatusUpdate: (s) => setLiveStatus(s),
          onTokenStream: (partial) => setStreamingText(partial),
        },
      });

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: response.finalText || '응답을 생성하지 못했습니다.',
        timestamp: formatNowTime(),
        pipelineSteps: response.steps,
        pluginOutputs: response.pluginOutputs,
      };
      updateActiveSessionMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        text: `⚠️ 실행 오류: ${err?.message || '알 수 없는 오류'}`,
        timestamp: formatNowTime(),
      };
      updateActiveSessionMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsGenerating(false);
      setLiveStatus('');
      setStreamingText('');
    }
  };

  const togglePlugin = (pluginId: string) => {
    setEnabledPluginIds((prev) =>
      prev.includes(pluginId) ? prev.filter((id) => id !== pluginId) : [...prev, pluginId],
    );
  };

  const refreshCoordinatorWorkers = async () => {
    if (!remotePC.serverUrl.trim() || (remotePC.apiKey || '').trim().length < 24) {
      setWorkerDiscoveryMessage('Coordinator 주소와 API 토큰을 먼저 설정하세요.');
      return;
    }
    setWorkerDiscoveryMessage('Worker 네트워크를 검색하고 있습니다...');
    try {
      const workers = await discoverCoordinatorWorkers(remotePC.serverUrl, (remotePC.apiKey || ''));
      setCoordinatorWorkers(workers);
      setWorkerDiscoveryMessage(workers.length ? `${workers.length}개 기기를 찾았습니다.` : '연결된 Worker가 없습니다. Windows 또는 Android Worker를 등록하세요.');
    } catch (error: any) {
      setWorkerDiscoveryMessage(error?.message || 'Worker 검색 실패');
    }
  };

  useEffect(() => {
    if (!androidWorkerOpen) return;
    if (!remotePC.serverUrl.trim() || (remotePC.apiKey || '').trim().length < 24) return;
    refreshCoordinatorWorkers();
  }, [androidWorkerOpen, remotePC.serverUrl, remotePC.apiKey]);

  const openConnectedApps = async () => {
    setConnectedAppsOpen(true);
    setConfiguredIntegrationIds([]);
    if (!remotePC.serverUrl.trim() || !(remotePC.apiKey || '').trim()) return;
    try {
      const ids = await getConfiguredIntegrations(remotePC.serverUrl, (remotePC.apiKey || ''));
      setConfiguredIntegrationIds(ids);
    } catch (error: any) {
      Alert.alert('앱 연결 상태 확인 실패', error?.message || 'Coordinator 주소와 API 토큰을 확인하세요.');
    }
  };

  const handleConnectedAppAction = async (
    app: (typeof CONNECTED_APP_CATALOG)[number],
    action: (typeof CONNECTED_APP_CATALOG)[number]['actions'][number],
  ) => {
    if (!remotePC.serverUrl.trim() || (remotePC.apiKey || '').trim().length < 24) {
      Alert.alert('Coordinator 설정 필요', '분산 Worker 설정에서 Coordinator 주소와 API 토큰을 먼저 입력하세요.');
      return;
    }
    if (!configuredIntegrationIds.includes(app.id)) {
      Alert.alert(
        '앱 연동 설정 필요',
        `${app.name}의 공식 OAuth/API 연결 또는 자동화 웹훅이 Coordinator에 아직 설정되지 않았습니다. 서버의 POCKETMIND_INTEGRATION_WEBHOOKS_JSON 설정을 확인하세요.`,
      );
      return;
    }
    const prompt = inputText.trim() || messages.slice(-4).map((message) => `${message.role}: ${message.text}`).join('\n');
    if (!prompt.trim()) {
      Alert.alert('요청 내용 필요', '채팅에 작업 내용을 입력하거나 먼저 요청을 보내 주세요.');
      return;
    }
    try {
      const submitted = await submitIntegrationAction(remotePC.serverUrl, (remotePC.apiKey || ''), app.id, action.id, {
        prompt,
        conversation: messages.slice(-6).map((message) => ({ role: message.role, content: message.text })),
        requestedAt: new Date().toISOString(),
      });
      if (submitted.status === 'awaiting_approval') {
        Alert.alert(
          `${app.name} 작업 승인`,
          `“${action.label}” 작업을 실행하려고 합니다. 실제 외부 앱에서 변경이 발생할 수 있습니다. 계속할까요?`,
          [
            {
              text: '거절',
              style: 'cancel',
              onPress: () => {
                rejectIntegrationAction(remotePC.serverUrl, (remotePC.apiKey || ''), submitted.actionId)
                  .catch((error: any) => Alert.alert('거절 처리 실패', error?.message || '오류'));
              },
            },
            {
              text: '승인하고 실행',
              onPress: async () => {
                try {
                  const result = await approveIntegrationAction(remotePC.serverUrl, (remotePC.apiKey || ''), submitted.actionId);
                  Alert.alert(
                    result.status === 'completed' ? '작업 완료' : '작업 결과',
                    result.result || result.lastError || result.status,
                  );
                } catch (error: any) {
                  Alert.alert('작업 실행 실패', error?.message || '오류');
                }
              },
            },
          ],
        );
      } else {
        Alert.alert(
          submitted.status === 'completed' ? '조회 완료' : '연동 작업 결과',
          submitted.result || submitted.lastError || submitted.status,
        );
      }
    } catch (error: any) {
      Alert.alert('앱 작업 실패', error?.message || '연동 서버를 확인하세요.');
    }
  };

  const startAndroidWorker = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('플랫폼 제한', 'iOS는 임의의 상시 백그라운드 GPU Worker 실행을 지원하지 않습니다.');
      return;
    }
    const selectedModels = workerModelIds.filter((id) => installedModelIds.includes(id));
    if (!remotePC.serverUrl.trim() || !workerEnrollmentToken.trim()) {
      Alert.alert('Worker 설정 필요', 'Coordinator 주소와 Worker 등록 토큰을 입력하세요.');
      return;
    }
    if (selectedModels.length === 0) {
      Alert.alert('모델 선택 필요', '이 기기에 설치된 GGUF 모델을 하나 이상 선택하세요.');
      return;
    }
    try {
      if (Number(Platform.Version) >= 33) {
        const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('알림 권한 필요', 'Worker 실행 상태를 표시하려면 알림 권한을 허용해 주세요.');
          return;
        }
      }
      const stableWorkerId = await NativeModules.PocketMindWorker.getWorkerId();
      await NativeModules.PocketMindWorker.startWorker({
        enabled: true,
        coordinatorUrl: remotePC.serverUrl.trim(),
        enrollmentToken: workerEnrollmentToken.trim(),
        workerId: stableWorkerId,
        displayName: 'PocketMind Android Worker',
        modelIds: selectedModels,
        useGpu: workerUseGpu,
        minimumBatteryPercent: 50,
        requireCharging: true,
        requireUnmeteredNetwork: true,
      });
      setAndroidWorkerRunning(true);
      Alert.alert('Android Worker 시작', '충전 중·비과금 네트워크·안전한 발열 조건을 만족할 때 분산 작업을 확인합니다.');
    } catch (error: any) {
      Alert.alert('Worker 시작 실패', error?.message || 'Android Worker 서비스를 시작할 수 없습니다.');
    }
  };

  const stopAndroidWorker = async () => {
    try {
      await stopAndroidWorkerService();
      setAndroidWorkerRunning(false);
    } catch (error: any) {
      Alert.alert('Worker 중지 실패', error?.message || '서비스를 중지할 수 없습니다.');
    }
  };

  const activeModelSpec =
    safeCatalog.find((m) => m.id === primaryModelId) || safeCatalog[0];

  const filteredPlugins = safePlugins.filter((p) => {
    const matchCat = pluginCategory === '전체' || p.category === pluginCategory;
    const q = pluginSearch.trim().toLowerCase();
    const matchQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.triggerKeywords.some((k) => k.toLowerCase().includes(q));
    return matchCat && matchQ;
  });

  const filteredModels = safeCatalog.filter((m) => {
    if (modelTab === '초경량·무검열') return m.uncensored || m.tier === 'ultra-light';
    if (modelTab === '경량 (3B~4B)') return m.tier === 'light';
    if (modelTab === '중형 (7B~12B)') return m.tier === 'mid';
    if (modelTab === 'PC GPU (14B+)') return m.tier === 'high';
    return true;
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ================= ChatGPT 상단 헤더 ================= */}
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setSidebarOpen(true)}>
          <Text style={styles.iconBtnText}>☰</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modelPillBtn}
          onPress={() => setModelPickerOpen(true)}
        >
          <Text style={styles.modelPillBrand}>PocketMind</Text>
          <Text style={styles.modelPillName} numberOfLines={1}>
            {activeModelSpec ? activeModelSpec.shortName : '모델 선택'} ▾
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconBtn} onPress={handleNewChat}>
          <Text style={styles.iconBtnText}>✎</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.deviceMetricsBar}>
        <View style={styles.deviceMetricCell}>
          <Text style={styles.deviceMetricLabel}>CPU</Text>
          <Text style={styles.deviceMetricValue}>{typeof deviceMetrics?.cpuUsagePercent === 'number' ? `${Math.round(deviceMetrics.cpuUsagePercent)}%` : '—'}</Text>
        </View>
        <View style={styles.deviceMetricCell}>
          <Text style={styles.deviceMetricLabel}>CPU 온도</Text>
          <Text style={styles.deviceMetricValue}>{typeof deviceMetrics?.cpuTemperatureC === 'number' ? `${deviceMetrics.cpuTemperatureC.toFixed(1)}°` : '미지원'}</Text>
        </View>
        <View style={styles.deviceMetricCell}>
          <Text style={styles.deviceMetricLabel}>GPU 온도</Text>
          <Text style={styles.deviceMetricValue}>{typeof deviceMetrics?.gpuTemperatureC === 'number' ? `${deviceMetrics.gpuTemperatureC.toFixed(1)}°` : '미지원'}</Text>
        </View>
        <View style={styles.deviceMetricCell}>
          <Text style={styles.deviceMetricLabel}>RAM</Text>
          <Text style={styles.deviceMetricValue}>{typeof deviceMetrics?.usedRamMb === 'number' && typeof deviceMetrics?.totalRamMb === 'number' ? `${(deviceMetrics.usedRamMb / 1024).toFixed(1)}/${(deviceMetrics.totalRamMb / 1024).toFixed(1)}G` : '—'}</Text>
        </View>
        <TouchableOpacity style={styles.deviceMetricCell} onPress={() => { setWorkerModelIds(installedModelIds); setAndroidWorkerOpen(true); }}>
          <Text style={styles.deviceMetricLabel}>USB 기기</Text>
          <Text style={styles.deviceMetricValue}>{typeof deviceMetrics?.usbDeviceCount === 'number' && deviceMetrics.usbDeviceCount > 0 ? `${deviceMetrics.usbDeviceCount}개` : deviceMetrics?.usbConnected ? '연결됨' : '없음'}</Text>
        </TouchableOpacity>
      </View>

      {/* ================= ChatGPT 메인 대화 영역 ================= */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={
          messages.length === 0 ? styles.emptyChatContainer : styles.chatContentContainer
        }
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <View style={styles.welcomeHero}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoSymbol}>✦</Text>
            </View>
            <Text style={styles.welcomeTitle}>무엇을 도와드릴까요?</Text>
            <Text style={styles.welcomeSub}>
              질문하고, 생각을 정리하고, 필요한 작업을 이어가세요.
            </Text>

            <View style={styles.suggestionGrid}>
              <TouchableOpacity
                style={styles.suggestionCard}
                onPress={() => setInputText('새로운 아이디어를 구체적인 초안으로 정리해줘.')}
              >
                <Text style={styles.suggestionTitle}>글쓰기</Text>
                <Text style={styles.suggestionDesc}>아이디어부터 초안까지 정리하기</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.suggestionCard}
                onPress={() => setInputText('다음 문서의 핵심 내용과 중요한 항목을 요약해줘: ')}
              >
                <Text style={styles.suggestionTitle}>문서 요약</Text>
                <Text style={styles.suggestionDesc}>긴 글에서 핵심 내용 찾기</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.suggestionCard}
                onPress={() => setInputText('이 코드의 문제를 찾아서 수정 방법을 알려줘: ')}
              >
                <Text style={styles.suggestionTitle}>코딩 도움</Text>
                <Text style={styles.suggestionDesc}>코드 작성과 오류 해결하기</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.suggestionCard}
                onPress={() => { setWorkerModelIds(installedModelIds); setAndroidWorkerOpen(true); }}
              >
                <Text style={styles.suggestionTitle}>기기 연결</Text>
                <Text style={styles.suggestionDesc}>사용 가능한 연산 기기 확인하기</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          messages.map((msg) => (
            <View
              key={msg.id}
              style={msg.role === 'user' ? styles.userRow : styles.assistantRow}
            >
              {msg.role === 'user' ? (
                <View style={styles.userBubble}>
                  <Text style={styles.userBubbleText}>{msg.text}</Text>
                </View>
              ) : (
                <View style={styles.assistantBlock}>
                  <View style={styles.assistantHeaderRow}>
                    <View style={styles.assistantAvatar}>
                      <Text style={styles.assistantAvatarText}>✦</Text>
                    </View>
                    <Text style={styles.assistantName}>PocketMind</Text>
                    {msg.pipelineSteps && msg.pipelineSteps.length > 0 && (
                      <View style={styles.traceBadge}>
                        <Text style={styles.traceBadgeText}>
                          {msg.pipelineSteps.map((s) => s.modelName).join(' → ')}
                        </Text>
                      </View>
                    )}
                  </View>

                  {msg.pluginOutputs && msg.pluginOutputs.length > 0 && (
                    <View style={styles.pluginResultBox}>
                      <Text style={styles.pluginResultHeader}>
                        🧩 실행된 플러그인 ({msg.pluginOutputs.length}개)
                      </Text>
                      {msg.pluginOutputs.map((po) => (
                        <Text key={po.id} style={styles.pluginResultLine}>
                          • {po.title}: {po.result}
                        </Text>
                      ))}
                    </View>
                  )}

                  <Text style={styles.assistantBodyText}>{msg.text}</Text>
                </View>
              )}
            </View>
          ))
        )}

        {isGenerating && (
          <View style={styles.assistantRow}>
            <View style={styles.assistantBlock}>
              <View style={styles.assistantHeaderRow}>
                <View style={styles.assistantAvatar}>
                  <Text style={styles.assistantAvatarText}>✦</Text>
                </View>
                <Text style={styles.streamingStatusText}>{liveStatus || '생성 중...'}</Text>
              </View>
              {streamingText ? (
                <Text style={styles.assistantBodyText}>{streamingText}</Text>
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ================= ChatGPT 하단 캡슐 입력창 ================= */}
      <View style={styles.composerOuter}>
        <View style={styles.composerPill}>
          <TouchableOpacity
            style={styles.plusBtn}
            onPress={() => setQuickPlusOpen(true)}
          >
            <Text style={styles.plusBtnText}>+</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.composerInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="PocketMind에게 메시지 보내기..."
            placeholderTextColor="#8E8EA0"
            multiline
          />

          <TouchableOpacity
            style={[
              styles.sendCircleBtn,
              (!inputText.trim() || isGenerating) && styles.sendCircleDisabled,
            ]}
            onPress={() => handleSendMessage()}
            disabled={!inputText.trim() || isGenerating}
          >
            <Text
              style={[
                styles.sendArrowText,
                (!inputText.trim() || isGenerating) && styles.sendArrowDisabled,
              ]}
            >
              ↑
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ================= 좌측 ChatGPT 사이드바 Drawer ================= */}
      <Modal visible={sidebarOpen} transparent animationType="fade">
        <View style={styles.drawerOverlay}>
          <View style={styles.drawerPanel}>
            <TouchableOpacity style={styles.drawerNewChatBtn} onPress={handleNewChat}>
              <Text style={styles.drawerNewChatText}>✎  새 채팅</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.drawerNavItem}
              onPress={() => {
                setSidebarOpen(false);
                setPluginStoreOpen(true);
              }}
            >
              <Text style={styles.drawerNavText}>
                🧩  플러그인 60종 허브 ({enabledPluginIds.length}/60)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.drawerNavItem}
              onPress={() => {
                setSidebarOpen(false);
                setModelStoreOpen(true);
              }}
            >
              <Text style={styles.drawerNavText}>
                🤖  AI 모델 허브 ({installedModelIds.length}개 설치됨)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.drawerNavItem}
              onPress={() => {
                setSidebarOpen(false);
                setPcWorkerOpen(true);
              }}
            >
              <Text style={styles.drawerNavText}>
                🖥️  PC GPU 워커 ({remotePC.enabled ? '연결됨' : '꺼짐'})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.drawerNavItem} onPress={() => { setSidebarOpen(false); openConnectedApps(); }}>
              <Text style={styles.drawerNavText}>🔌 연결 앱 허브 ({configuredIntegrationIds.length}개 웹훅 설정)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawerNavItem} onPress={() => {
              setSidebarOpen(false);
              setWorkerModelIds(installedModelIds);
              setAndroidWorkerOpen(true);
            }}>
              <Text style={styles.drawerNavText}>📡 Android Worker ({androidWorkerRunning ? '실행 중' : '설정'})</Text>
            </TouchableOpacity>

            <View style={styles.drawerToggleRow}>
              <Text style={styles.drawerToggleLabel}>🔗 자율 멀티모델 체인</Text>
              <Switch
                value={autoMultiModel}
                onValueChange={setAutoMultiModel}
                trackColor={{ false: '#3E3E42', true: '#10A37F' }}
              />
            </View>

            <Text style={styles.drawerSectionTitle}>대화 기록</Text>
            <TextInput
              style={styles.historySearchInput}
              value={historySearch}
              onChangeText={setHistorySearch}
              placeholder="대화 검색"
              placeholderTextColor="#8E8EA0"
              returnKeyType="search"
              autoCapitalize="none"
            />
            <ScrollView style={styles.drawerHistoryList}>
              {visibleSessions.map((sess) => (
                <TouchableOpacity
                  key={sess.id}
                  style={[
                    styles.drawerHistoryItem,
                    sess.id === activeSession.id && styles.drawerHistoryActive,
                  ]}
                  onPress={() => {
                    setActiveSessionId(sess.id);
                    setSidebarOpen(false);
                  }}
                  onLongPress={() => Alert.alert(
                    sess.pinned ? '고정 해제' : '대화 고정',
                    `“${sess.title}” 대화를 ${sess.pinned ? '고정 해제' : '상단에 고정'}할까요?`,
                    [
                      { text: '취소', style: 'cancel' },
                      { text: sess.pinned ? '고정 해제' : '고정', onPress: () => toggleSessionPinned(sess.id) },
                    ],
                  )}
                >
                  <View style={styles.drawerHistoryTextWrap}>
                    <Text style={styles.drawerHistoryText} numberOfLines={1}>{sess.pinned ? '📌 ' : ''}{sess.title}</Text>
                    <Text style={styles.drawerHistoryMeta} numberOfLines={1}>{summarizeSessionPreview(sess)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.drawerCloseBtn}
              onPress={() => setSidebarOpen(false)}
            >
              <Text style={styles.drawerCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.drawerBackdrop}
            onPress={() => setSidebarOpen(false)}
          />
        </View>
      </Modal>

      {/* ================= 상단 모델 빠른 전환 팝업 ================= */}
      <Modal visible={modelPickerOpen} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>활성 AI 모델 선택</Text>
              <TouchableOpacity onPress={() => setModelPickerOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {safeCatalog.map((m) => {
                const isInstalled = installedModelIds.includes(m.id);
                const isSelected = primaryModelId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                    onPress={() => {
                      if (isInstalled || remotePC.enabled) {
                        setPrimaryModelId(m.id);
                        setModelPickerOpen(false);
                      } else {
                        setModelPickerOpen(false);
                        setModelStoreOpen(true);
                      }
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.pickerModelName}>{m.shortName}</Text>
                        {m.uncensored && (
                          <View style={styles.uncensoredBadge}>
                            <Text style={styles.uncensoredBadgeText}>무검열</Text>
                          </View>
                        )}
                        {m.tier === 'ultra-light' && (
                          <View style={styles.ultraLightBadge}>
                            <Text style={styles.ultraLightBadgeText}>초경량</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.pickerModelMeta}>
                        {m.params} · {m.sizeGB}GB · {isInstalled ? '설치됨' : '미설치'}
                      </Text>
                    </View>
                    <Text style={styles.pickerCheck}>{isSelected ? '✓' : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={styles.sheetPrimaryBtn}
              onPress={() => {
                setModelPickerOpen(false);
                setModelStoreOpen(true);
              }}
            >
              <Text style={styles.sheetPrimaryBtnText}>+ 모델 다운로드 관리 열기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================= 입력창 '+' 빠른 실행 메뉴 ================= */}
      <Modal visible={quickPlusOpen} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>빠른 도구 및 모델 태그</Text>
              <TouchableOpacity onPress={() => setQuickPlusOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.quickActionRow}>
              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => {
                  setQuickPlusOpen(false);
                  setPluginStoreOpen(true);
                }}
              >
                <Text style={styles.quickActionIcon}>🧩</Text>
                <Text style={styles.quickActionLabel}>플러그인 60종</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => {
                  setQuickPlusOpen(false);
                  setInputText((prev) => `@무검열 ${prev}`.trim() + ' ');
                }}
              >
                <Text style={styles.quickActionIcon}>🔓</Text>
                <Text style={styles.quickActionLabel}>@무검열 호출</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => {
                  setQuickPlusOpen(false);
                  setInputText((prev) => `@deepseek @coder @exaone ${prev}`.trim() + ' ');
                }}
              >
                <Text style={styles.quickActionIcon}>🔗</Text>
                <Text style={styles.quickActionLabel}>3단 멀티체인</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.drawerNavItem} onPress={() => {
              setQuickPlusOpen(false);
              openConnectedApps();
            }}>
              <Text style={styles.drawerNavText}>🔌 Gmail·Calendar·Notion 등 연결 앱 열기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawerNavItem} onPress={() => {
              setQuickPlusOpen(false);
              setWorkerModelIds(installedModelIds);
              setAndroidWorkerOpen(true);
            }}>
              <Text style={styles.drawerNavText}>📡 Android Worker 설정</Text>
            </TouchableOpacity>
            <Text style={styles.quickSubHeader}>인기 플러그인 원터치 삽입</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {safePlugins.slice(0, 12).map((pl) => (
                <TouchableOpacity
                  key={pl.id}
                  style={styles.quickPluginRow}
                  onPress={() => {
                    setQuickPlusOpen(false);
                    setInputText(`/${pl.id} `);
                  }}
                >
                  <Text style={styles.quickPluginTitle}>
                    #{String(pl.index).padStart(2, '0')} {pl.name}
                  </Text>
                  <Text style={styles.quickPluginCmd}>/{pl.id}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ================= 60종 플러그인 전체 허브 모달 ================= */}
      <Modal visible={pluginStoreOpen} animationType="slide">
        <SafeAreaView style={styles.fullModal}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>
              🧩 자율·수동 플러그인 허브 ({enabledPluginIds.length}/60 활성)
            </Text>
            <TouchableOpacity onPress={() => setPluginStoreOpen(false)}>
              <Text style={styles.sheetClose}>닫기</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchBarBox}>
            <TextInput
              style={styles.searchInput}
              value={pluginSearch}
              onChangeText={setPluginSearch}
              placeholder="플러그인 이름, 키워드, ID 검색..."
              placeholderTextColor="#8E8EA0"
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.catScroll}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
          >
            {PLUGIN_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.catChip, pluginCategory === cat && styles.catChipActive]}
                onPress={() => setPluginCategory(cat)}
              >
                <Text
                  style={[
                    styles.catChipText,
                    pluginCategory === cat && styles.catChipTextActive,
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={styles.modalScrollBody}>
            {filteredPlugins.map((pl) => {
              const isEnabled = enabledPluginIds.includes(pl.id);
              return (
                <View key={pl.id} style={styles.pluginCard}>
                  <View style={styles.pluginCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pluginCardTitle}>
                        #{String(pl.index).padStart(2, '0')} {pl.name}
                      </Text>
                      <Text style={styles.pluginCardCat}>
                        {pl.category} · /{pl.id} · {pl.autoRun ? '자동트리거' : '수동호출'}
                      </Text>
                    </View>
                    <Switch
                      value={isEnabled}
                      onValueChange={() => togglePlugin(pl.id)}
                      trackColor={{ false: '#3E3E42', true: '#10A37F' }}
                    />
                  </View>

                  <Text style={styles.pluginCardDesc}>{pl.description}</Text>

                  <View style={styles.pluginCardBottom}>
                    <Text style={styles.pluginKeywordsText} numberOfLines={1}>
                      키워드: {pl.triggerKeywords.join(', ')}
                    </Text>
                    <TouchableOpacity
                      style={styles.pluginRunBtn}
                      onPress={() => {
                        setPluginStoreOpen(false);
                        setInputText(`/${pl.id} `);
                      }}
                    >
                      <Text style={styles.pluginRunBtnText}>즉시 입력</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ================= Pickle-style connected app hub ================= */}
      <Modal visible={connectedAppsOpen} animationType="slide">
        <SafeAreaView style={styles.fullModal}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>
              🔌 연결 앱 허브 ({configuredIntegrationIds.length}/{CONNECTED_APP_CATALOG.length} 웹훅 설정)
            </Text>
            <TouchableOpacity onPress={() => setConnectedAppsOpen(false)}>
              <Text style={styles.sheetClose}>닫기</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.pluginCardDesc, { paddingHorizontal: 16, paddingTop: 10 }]}>
            앱을 선택해 자동화 작업을 요청할 수 있습니다. 목록에 있다고 연결된 것은 아닙니다. Coordinator에 HTTPS 웹훅과 각 서비스의 공식 인증을 설정해야 실제로 동작합니다.
          </Text>
          <ScrollView style={styles.modalScrollBody}>
            {CONNECTED_APP_CATALOG.map((app) => {
              const configured = configuredIntegrationIds.includes(app.id);
              return (
                <View key={app.id} style={styles.pluginCard}>
                  <View style={styles.pluginCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pluginCardTitle}>{app.name}</Text>
                      <Text style={styles.pluginCardCat}>{app.category} · {app.auth.toUpperCase()}</Text>
                    </View>
                    <Text style={{ color: configured ? '#10A37F' : '#F59E0B', fontSize: 11, fontWeight: '700' }}>
                      {configured ? '웹훅 설정됨' : '연결 설정 필요'}
                    </Text>
                  </View>
                  <Text style={styles.pluginCardDesc}>{app.description}</Text>
                  {app.actions.map((action) => (
                    <TouchableOpacity
                      key={action.id}
                      style={[styles.pluginRunBtn, { alignSelf: 'stretch', marginTop: 8 }]}
                      onPress={() => handleConnectedAppAction(app, action)}
                    >
                      <Text style={styles.pluginRunBtnText}>
                        {action.label} · {action.risk === 'read' ? '읽기' : action.risk === 'write' ? '승인 필요' : '중요 승인 필요'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <Text style={[styles.pluginKeywordsText, { marginTop: 8 }]} numberOfLines={2}>
                    공식 API 설정: {app.officialSetupUrl}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ================= AI 모델 허브 모달 (초경량 무검열 포함) ================= */}
      <Modal visible={modelStoreOpen} animationType="slide">
        <SafeAreaView style={styles.fullModal}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>🤖 온디바이스 GGUF 모델 허브</Text>
            <TouchableOpacity onPress={() => setModelStoreOpen(false)}>
              <Text style={styles.sheetClose}>닫기</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.catScroll}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
          >
            {MODEL_FILTER_TABS.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.catChip, modelTab === tab && styles.catChipActive]}
                onPress={() => setModelTab(tab)}
              >
                <Text
                  style={[styles.catChipText, modelTab === tab && styles.catChipTextActive]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={styles.modalScrollBody}>
            {filteredModels.map((m) => {
              const isInstalled = installedModelIds.includes(m.id);
              const pct = downloadingMap[m.id];
              return (
                <View key={m.id} style={styles.modelCard}>
                  <View style={styles.modelCardTop}>
                    <Text style={styles.modelCardTitle}>{m.name}</Text>
                    {m.uncensored && (
                      <View style={styles.uncensoredBadge}>
                        <Text style={styles.uncensoredBadgeText}>무검열</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.modelCardMeta}>
                    파라미터: {m.params} · 용량: {m.sizeGB}GB · 권장 RAM: {m.minRamGB}GB+
                  </Text>
                  <Text style={styles.modelCardDesc}>{m.description}</Text>

                  <View style={styles.modelCardActions}>
                    {isInstalled ? (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.useModelBtn,
                            primaryModelId === m.id && styles.useModelBtnActive,
                          ]}
                          onPress={() => {
                            setPrimaryModelId(m.id);
                            setModelStoreOpen(false);
                          }}
                        >
                          <Text style={styles.useModelBtnText}>
                            {primaryModelId === m.id ? '✓ 현재 선택됨' : '기본 모델로 사용'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.delModelBtn}
                          onPress={() => handleDeleteModel(m.id)}
                        >
                          <Text style={styles.delModelBtnText}>삭제</Text>
                        </TouchableOpacity>
                      </>
                    ) : pct !== undefined ? (
                      <View style={styles.progressBox}>
                        <Text style={styles.progressText}>다운로드 중... {pct}%</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.downloadModelBtn}
                        onPress={() => handleDownloadModel(m.id)}
                      >
                        <Text style={styles.downloadModelBtnText}>
                          다운로드 ({m.sizeGB}GB)
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ================= PC GPU 워커 모달 ================= */}
      <Modal visible={pcWorkerOpen} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>🖥️ 원격 PC GPU 워커 오프로딩</Text>
              <TouchableOpacity onPress={() => setPcWorkerOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.drawerToggleRow}>
              <Text style={styles.drawerToggleLabel}>PC GPU 워커 활성화</Text>
              <Switch
                value={remotePC.enabled}
                onValueChange={(v) => setRemotePC((p) => ({ ...p, enabled: v }))}
                trackColor={{ false: '#3E3E42', true: '#10A37F' }}
              />
            </View>

            <Text style={styles.inputFieldLabel}>Coordinator 또는 기존 OpenAI 호환 서버 주소</Text>
            <TextInput
              style={styles.modalInput}
              value={remotePC.serverUrl}
              onChangeText={(t) => setRemotePC((p) => ({ ...p, serverUrl: t }))}
              placeholder="https://your-coordinator.example"
              placeholderTextColor="#8E8EA0"
            />

            <Text style={styles.inputFieldLabel}>Coordinator API 토큰 (작업 제출·앱 연결용)</Text>
            <TextInput
              style={styles.modalInput}
              value={remotePC.apiKey || ''}
              onChangeText={(t) => setRemotePC((p) => ({ ...p, apiKey: t }))}
              placeholder="POCKETMIND_API_TOKEN"
              placeholderTextColor="#8E8EA0"
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={styles.sheetPrimaryBtn}
              onPress={() => setPcWorkerOpen(false)}
            >
              <Text style={styles.sheetPrimaryBtnText}>저장 후 닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* ================= Android foreground worker settings ================= */}
      <Modal visible={androidWorkerOpen} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={[styles.bottomSheetCard, { maxHeight: '90%' }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>📡 기기 분산 Worker</Text>
              <TouchableOpacity onPress={() => setAndroidWorkerOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={[styles.pluginCardDesc, { marginBottom: 10 }]}>
              USB 상태: {deviceMetrics?.usbStatus || '확인 중'} · 분산 작업 참여는 각 기기의 앱에서 Worker를 켜고 동일한 Coordinator에 등록해야 합니다. USB 케이블만 연결하면 두 기기의 GPU가 자동으로 합쳐지는 것은 아닙니다.
            </Text>
            <Text style={styles.inputFieldLabel}>Coordinator 주소</Text>
              <TextInput
                style={styles.modalInput}
                value={remotePC.serverUrl}
                onChangeText={(t) => setRemotePC((p) => ({ ...p, serverUrl: t }))}
                placeholder="https://your-coordinator.example"
                placeholderTextColor="#8E8EA0"
                autoCapitalize="none"
              />
              <Text style={styles.inputFieldLabel}>Worker 등록 토큰</Text>
              <TextInput
                style={styles.modalInput}
                value={workerEnrollmentToken}
                onChangeText={setWorkerEnrollmentToken}
                placeholder="POCKETMIND_ENROLLMENT_TOKEN"
                placeholderTextColor="#8E8EA0"
                secureTextEntry
                autoCapitalize="none"
              />
              <View style={styles.drawerToggleRow}>
                <Text style={styles.drawerToggleLabel}>GPU 가속 사용 (기기 지원 확인 필요)</Text>
                <Switch value={workerUseGpu} onValueChange={setWorkerUseGpu} />
              </View>
              <TouchableOpacity style={styles.sheetPrimaryBtn} onPress={refreshCoordinatorWorkers}>
                <Text style={styles.sheetPrimaryBtnText}>연결된 Worker 기기 검색</Text>
              </TouchableOpacity>
              <Text style={[styles.pluginCardDesc, { marginVertical: 8 }]}>{workerDiscoveryMessage}</Text>
              {coordinatorWorkers.map((worker) => (
                <View key={worker.workerId} style={styles.pluginCard}>
                  <Text style={styles.pluginCardTitle}>{worker.displayName}</Text>
                  <Text style={styles.pluginCardDesc}>
                    {worker.capabilities.platform} · {worker.capabilities.gpu ? 'GPU' : 'CPU'} · {worker.state} · {worker.capabilities.modelIds.join(', ')}
                  </Text>
                </View>
              ))}
              <Text style={styles.inputFieldLabel}>제공할 설치 모델</Text>
              {installedModelIds.length === 0 ? (
                <Text style={styles.pluginCardDesc}>설치된 모델이 없습니다. 모델 허브에서 GGUF 모델을 설치하세요.</Text>
              ) : installedModelIds.map((modelId) => {
                const model = safeCatalog.find((item) => item.id === modelId);
                const selected = workerModelIds.includes(modelId);
                return (
                  <View key={modelId} style={styles.drawerToggleRow}>
                    <Text style={[styles.drawerToggleLabel, { flex: 1 }]}>{model?.shortName || modelId}</Text>
                    <Switch
                      value={selected}
                      onValueChange={(value) => setWorkerModelIds((previous) =>
                        value ? [...previous, modelId] : previous.filter((id) => id !== modelId)
                      )}
                    />
                  </View>
                );
              })}
              <Text style={[styles.pluginCardDesc, { marginVertical: 10 }]}>
                Android 포그라운드 서비스는 명시적으로 켠 동안에만 동작합니다. 충전 중·비과금 네트워크·안전한 발열 상태에서 작업을 받습니다. 배터리 50% 미만일 때는 충전 중이 아니면 쉬며, 강제 종료·제조사 절전 정책으로 중단될 수 있습니다.
              </Text>
              {Platform.OS === 'ios' ? (
                <Text style={styles.pluginCardDesc}>iOS는 이 상시 Worker 서비스를 지원하지 않습니다. iOS에서는 앱이 활성 상태일 때만 작업 참여를 지원합니다.</Text>
              ) : null}
              <TouchableOpacity
                style={styles.sheetPrimaryBtn}
                onPress={androidWorkerRunning ? stopAndroidWorker : startAndroidWorker}
              >
                <Text style={styles.sheetPrimaryBtnText}>{androidWorkerRunning ? 'Worker 중지' : 'Worker 시작'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppCrashGuard>
      <PocketMindChatGPTScreen />
    </AppCrashGuard>
  );
}

// ============================================================================
// ChatGPT 다크 테마 스타일시트 (#212121 메인, #171717 사이드바, #2F2F2F 버블/입력창)
// ============================================================================
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#212121',
  },
  crashContainer: {
    flex: 1,
    backgroundColor: '#171717',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  crashTitle: {
    color: '#F87171',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  crashSub: {
    color: '#D1D5DB',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  crashRetryBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  crashRetryText: {
    color: '#000000',
    fontWeight: '700',
  },

  // Top Header
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#212121',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnText: {
    color: '#ECECEC',
    fontSize: 20,
    fontWeight: '600',
  },
  modelPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    gap: 6,
    maxWidth: 230,
  },
  modelPillBrand: {
    color: '#ECECEC',
    fontSize: 15,
    fontWeight: '700',
  },
  modelPillName: {
    color: '#B4B4B4',
    fontSize: 13,
    fontWeight: '500',
  },

  deviceMetricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    paddingVertical: 8,
    backgroundColor: '#212121',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#383838',
  },
  deviceMetricCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  deviceMetricLabel: {
    color: '#8E8EA0',
    fontSize: 9,
    marginBottom: 3,
  },
  deviceMetricValue: {
    color: '#ECECEC',
    fontSize: 10,
    fontWeight: '600',
  },

  // Chat Feed
  chatArea: {
    flex: 1,
  },
  emptyChatContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  chatContentContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  welcomeHero: {
    alignItems: 'center',
  },
  logoCircle: {
    display: 'none',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  logoSymbol: {
    color: '#000000',
    fontSize: 24,
    fontWeight: '700',
  },
  welcomeTitle: {
    color: '#ECECEC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  welcomeSub: {
    color: '#9B9B9B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  suggestionGrid: {
    width: '100%',
    gap: 10,
  },
  suggestionCard: {
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#383838',
    borderRadius: 16,
    padding: 14,
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

  // Messages
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 18,
  },
  userBubble: {
    backgroundColor: '#2F2F2F',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 11,
    maxWidth: '82%',
  },
  userBubbleText: {
    color: '#ECECEC',
    fontSize: 15,
    lineHeight: 22,
  },
  assistantRow: {
    marginBottom: 22,
  },
  assistantBlock: {
    width: '100%',
  },
  assistantHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  assistantAvatar: {
    display: 'none',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10A37F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  assistantAvatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  assistantName: {
    display: 'none',
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '700',
  },
  traceBadge: {
    display: 'none',
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  traceBadgeText: {
    color: '#10A37F',
    fontSize: 11,
    fontWeight: '600',
  },
  streamingStatusText: {
    color: '#10A37F',
    fontSize: 13,
    fontWeight: '600',
  },
  pluginResultBox: {
    backgroundColor: '#1E2422',
    borderLeftWidth: 3,
    borderLeftColor: '#10A37F',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  pluginResultHeader: {
    color: '#10A37F',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  pluginResultLine: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 18,
  },
  assistantBodyText: {
    color: '#ECECEC',
    fontSize: 15,
    lineHeight: 23,
  },

  // Bottom Composer Pill
  composerOuter: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 14 : 12,
    backgroundColor: '#212121',
  },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#2F2F2F',
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 50,
  },
  plusBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3E3E42',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  plusBtnText: {
    color: '#ECECEC',
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 24,
  },
  composerInput: {
    flex: 1,
    color: '#ECECEC',
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 7,
  },
  sendCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendCircleDisabled: {
    backgroundColor: '#4A4A4F',
  },
  sendArrowText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '800',
  },
  sendArrowDisabled: {
    color: '#212121',
  },

  // Sidebar Drawer
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  drawerPanel: {
    width: '78%',
    maxWidth: 320,
    backgroundColor: '#171717',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  drawerBackdrop: {
    flex: 1,
  },
  drawerNewChatBtn: {
    backgroundColor: '#262626',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  drawerNewChatText: {
    color: '#ECECEC',
    fontSize: 15,
    fontWeight: '600',
  },
  drawerNavItem: {
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  drawerNavText: {
    color: '#D1D5DB',
    fontSize: 14,
    fontWeight: '500',
  },
  drawerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2A2A2A',
  },
  drawerToggleLabel: {
    color: '#ECECEC',
    fontSize: 14,
  },
  drawerSectionTitle: {
    color: '#8E8EA0',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  historySearchInput: {
    backgroundColor: '#262626',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#383838',
    color: '#ECECEC',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 6,
    marginBottom: 10,
  },
  drawerHistoryList: {
    flex: 1,
  },
  drawerHistoryItem: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
  },
  drawerHistoryActive: {
    backgroundColor: '#2A2A2A',
  },
  drawerHistoryTextWrap: {
    flex: 1,
  },
  drawerHistoryText: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '500',
  },
  drawerHistoryMeta: {
    color: '#8E8EA0',
    fontSize: 11,
    marginTop: 3,
  },
  drawerCloseBtn: {
    backgroundColor: '#2F2F2F',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  drawerCloseText: {
    color: '#ECECEC',
    fontWeight: '600',
  },

  // Bottom Sheets & Modals
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  bottomSheetCard: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 30,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: '#ECECEC',
    fontSize: 17,
    fontWeight: '700',
  },
  sheetClose: {
    color: '#B4B4B4',
    fontSize: 16,
    fontWeight: '600',
    padding: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#282828',
  },
  pickerRowSelected: {
    borderWidth: 1,
    borderColor: '#10A37F',
  },
  pickerModelName: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '700',
  },
  pickerModelMeta: {
    color: '#9B9B9B',
    fontSize: 12,
    marginTop: 2,
  },
  pickerCheck: {
    color: '#10A37F',
    fontSize: 18,
    fontWeight: '700',
  },
  uncensoredBadge: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  uncensoredBadgeText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '700',
  },
  ultraLightBadge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ultraLightBadgeText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '700',
  },
  sheetPrimaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
  },
  sheetPrimaryBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },

  // Quick Plus Sheet
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickActionCard: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  quickActionIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  quickActionLabel: {
    color: '#ECECEC',
    fontSize: 12,
    fontWeight: '600',
  },
  quickSubHeader: {
    color: '#9B9B9B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  quickPluginRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2C',
  },
  quickPluginTitle: {
    color: '#ECECEC',
    fontSize: 13,
  },
  quickPluginCmd: {
    color: '#10A37F',
    fontSize: 12,
    fontWeight: '600',
  },

  // Full Modals (Plugin Store & Model Hub)
  fullModal: {
    flex: 1,
    backgroundColor: '#171717',
  },
  fullModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  fullModalTitle: {
    color: '#ECECEC',
    fontSize: 17,
    fontWeight: '700',
  },
  searchBarBox: {
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  searchInput: {
    backgroundColor: '#262626',
    color: '#ECECEC',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  catScroll: {
    maxHeight: 48,
    marginVertical: 10,
  },
  catChip: {
    backgroundColor: '#262626',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  catChipActive: {
    backgroundColor: '#FFFFFF',
  },
  catChipText: {
    color: '#B4B4B4',
    fontSize: 13,
    fontWeight: '600',
  },
  catChipTextActive: {
    color: '#000000',
  },
  modalScrollBody: {
    flex: 1,
    paddingHorizontal: 14,
  },
  pluginCard: {
    backgroundColor: '#212121',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2F2F2F',
  },
  pluginCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pluginCardTitle: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '700',
  },
  pluginCardCat: {
    color: '#10A37F',
    fontSize: 11,
    marginTop: 2,
  },
  pluginCardDesc: {
    color: '#B4B4B4',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  pluginCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pluginKeywordsText: {
    color: '#8E8EA0',
    fontSize: 11,
    flex: 1,
    marginRight: 8,
  },
  pluginRunBtn: {
    backgroundColor: '#2F2F2F',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pluginRunBtnText: {
    color: '#ECECEC',
    fontSize: 12,
    fontWeight: '600',
  },

  // Model Store Cards
  modelCard: {
    backgroundColor: '#212121',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2F2F2F',
  },
  modelCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  modelCardTitle: {
    color: '#ECECEC',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  modelCardMeta: {
    color: '#10A37F',
    fontSize: 12,
    marginBottom: 6,
  },
  modelCardDesc: {
    color: '#B4B4B4',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  modelCardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  downloadModelBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  downloadModelBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  useModelBtn: {
    flex: 1,
    backgroundColor: '#2F2F2F',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  useModelBtnActive: {
    backgroundColor: '#10A37F',
  },
  useModelBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  delModelBtn: {
    backgroundColor: '#3F1D1D',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
  },
  delModelBtnText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBox: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  progressText: {
    color: '#10A37F',
    fontSize: 13,
    fontWeight: '700',
  },
  inputFieldLabel: {
    color: '#B4B4B4',
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#2A2A2A',
    color: '#ECECEC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
});

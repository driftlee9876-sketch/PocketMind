// App.tsx
// ChatGPT 스타일 다크 모바일 UI + 60종 플러그인 스토어 + 초경량 무검열 모델 허브 + 자율 멀티모델 체인

import React, {
  Component,
  ErrorInfo,
  ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  LayoutAnimation,
  Linking,
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
  UIManager,
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
  beginIntegrationConnection,
  disconnectIntegration,
  getIntegrationConnections,
  submitIntegrationAction,
  approveIntegrationAction,
  rejectIntegrationAction,
} from './src/integrationActions';
import type { IntegrationConnection } from './src/integrationActions';
import { discoverCoordinatorWorkers } from './src/distributedCoordinatorClient';
import { stopAndroidWorkerService } from './src/androidWorkerRuntime';
import {
  normalizeSessionTitle,
  prepareAnswerRegeneration,
  removeSessionById,
  replaceUserMessageAndTrim,
  renameSessionById,
  summarizeConversation,
  sessionTitleMode,
} from './src/chatHistory';
import { ChatSettingsSheet } from './src/ChatSettingsSheet';
import { defaultChatPreferences, enterSubmits, restoreChatPreferences } from './src/chatPreferences';
import type { ChatPreferences } from './src/chatPreferences';
import type { CoordinatorWorker } from './src/distributedCoordinatorClient';
import {
  beginChatGPTPlanLogin,
  chatWithChatGPTPlan,
  disconnectChatGPTPlan,
  getChatGPTPlanModels,
  getChatGPTPlanStatus,
  stopChatGPTPlan,
} from './src/chatGPTPlan';
import type { ChatGPTPlanModel, ChatGPTPlanStatus } from './src/chatGPTPlan';
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
  source?: string;
  issue?: string;
  issueCode?: string;
  pipelineSteps?: PipelineStepResult[];
  pluginOutputs?: PluginExecutionOutput[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  pinned?: boolean;
  titleMode?: 'auto' | 'custom';
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

interface ChatMessageCardProps {
  message: ChatMessage;
  largeText: boolean;
  canRegenerate: boolean;
  disabled: boolean;
  onCopy: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
}

const ChatMessageCard = memo(function ChatMessageCard({
  message,
  largeText,
  canRegenerate,
  disabled,
  onCopy,
  onEdit,
  onRegenerate,
}: ChatMessageCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const motionStyle = {
    opacity: entrance,
    transform: [{
      translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
    }],
  };

  return (
    <Animated.View
      style={[message.role === 'user' ? styles.userRow : styles.assistantRow, motionStyle]}
    >
      {message.role === 'user' ? (
        <View style={styles.userMessageColumn}>
          <View style={styles.userBubble}>
            <Text selectable style={[styles.userBubbleText, largeText && styles.largeChatText]}>{message.text}</Text>
          </View>
          <View style={styles.messageActionRow}>
            <TouchableOpacity
              style={styles.messageActionButton}
              onPress={() => onCopy(message)}
              accessibilityRole="button"
              accessibilityLabel="사용자 메시지 복사"
            >
              <Text style={styles.messageActionText}>복사</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.messageActionButton}
              onPress={() => onEdit(message)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="사용자 메시지 수정"
            >
              <Text style={[styles.messageActionText, disabled && styles.messageActionDisabled]}>
                수정
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.assistantBlock}>
          <View style={styles.assistantHeaderRow}>
            <View style={styles.assistantAvatar}>
              <Text style={styles.assistantAvatarText}>✦</Text>
            </View>
            <Text style={styles.assistantName}>PocketMind</Text>
            {message.pipelineSteps && message.pipelineSteps.length > 0 ? (
              <View style={styles.traceBadge}>
                <Text style={styles.traceBadgeText}>
                  {message.pipelineSteps.map((step) => step.modelName).join(' → ')}
                </Text>
              </View>
            ) : null}
          </View>
          {message.pluginOutputs && message.pluginOutputs.length > 0 ? (
            <View style={styles.pluginResultBox}>
              <Text style={styles.pluginResultHeader}>
                🧩 실행된 플러그인 ({message.pluginOutputs.length}개)
              </Text>
              {message.pluginOutputs.map((output) => (
                <Text key={output.id} style={styles.pluginResultLine}>
                  • {output.title}: {output.result}
                </Text>
              ))}
            </View>
          ) : null}
          {message.source && <Text style={styles.replySource}>{message.source}</Text>}
          {Boolean(message.text) && <Text selectable style={[styles.assistantBodyText, largeText && styles.largeChatText]}>{message.text}</Text>}
          {message.issue && <View style={styles.replyIssue}>
            <Text selectable style={styles.replyIssueText}>{message.issue}</Text>
            {message.issueCode === 'subscription_sharing_usage_limit_exceeded' &&
              <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL('https://chatgpt.com/settings/usage').catch(() => Alert.alert('사용량', 'ChatGPT 설정에서 사용량을 확인해 주세요.'))}>
                <Text style={styles.sheetTextBtnText}>ChatGPT 사용량 보기 ↗</Text>
              </TouchableOpacity>}
          </View>}
          <View style={styles.messageActionRow}>
            <TouchableOpacity
              style={styles.messageActionButton}
              onPress={() => onCopy(message)}
              accessibilityRole="button"
              accessibilityLabel="답변 복사"
            >
              <Text style={styles.messageActionText}>복사</Text>
            </TouchableOpacity>
            {canRegenerate ? (
              <TouchableOpacity
                style={styles.messageActionButton}
                onPress={() => onRegenerate(message)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="답변 다시 생성"
              >
                <Text style={[styles.messageActionText, disabled && styles.messageActionDisabled]}>
                  다시 생성
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}
    </Animated.View>
  );
});

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
  const [sessionActionTargetId, setSessionActionTargetId] = useState<string | null>(null);
  const [sessionRenameTargetId, setSessionRenameTargetId] = useState<string | null>(null);
  const [sessionRenameText, setSessionRenameText] = useState('');
  const [messageEditTargetId, setMessageEditTargetId] = useState<string | null>(null);
  const [messageEditText, setMessageEditText] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [deviceMetrics, setDeviceMetrics] = useState<DeviceMetrics | null>(null);
  const [connectionSettingsReady, setConnectionSettingsReady] = useState(false);

  const [inputText, setInputText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [preferences, setPreferences] = useState(defaultChatPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generatingSession, setGeneratingSession] = useState('');
  const submitOnEnter = enterSubmits(preferences.enterMode, inputText, selection.start, selection.end);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem('pocketmind.chat-preferences.v1')
      .then(raw => { if (mounted) setPreferences(restoreChatPreferences(raw)); })
      .catch(() => {}).finally(() => { if (mounted) setPreferencesReady(true); });
    return () => { mounted = false; };
  }, []);

  const savePreferences = (changes: Partial<ChatPreferences>) =>
    setPreferences(previous => ({ ...previous, ...changes }));
  useEffect(() => {
    if (preferencesReady) AsyncStorage.setItem('pocketmind.chat-preferences.v1', JSON.stringify(preferences))
      .catch(() => Alert.alert('설정 저장 실패', '기기 저장 공간을 확인해 주세요.'));
  }, [preferences, preferencesReady]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [streamingText, setStreamingText] = useState('');

  // 설치된 모델 및 기본 선택 모델
  const [installedModelIds, setInstalledModelIds] = useState<string[]>([]);
  const [primaryModelId, setPrimaryModelId] = useState<string>('qwen2.5-0.5b-abliterated');
  const [useChatGPTPlan, setUseChatGPTPlan] = useState(false);
  const [chatGPTModelId, setChatGPTModelId] = useState('');
  const [chatGPTModels, setChatGPTModels] = useState<ChatGPTPlanModel[]>([]);
  const [chatGPTStatus, setChatGPTStatus] = useState<ChatGPTPlanStatus>({ connected: false, pending: false, email: '', error: '' });
  const [chatGPTPreferenceReady, setChatGPTPreferenceReady] = useState(false);
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
  const [drawerToolsOpen, setDrawerToolsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [chatGPTSettingsOpen, setChatGPTSettingsOpen] = useState(false);
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
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [connectingIntegrationId, setConnectingIntegrationId] = useState<string | null>(null);
  const [integrationSearch, setIntegrationSearch] = useState('');
  const [integrationFilter, setIntegrationFilter] = useState<'all' | 'connected' | 'setup'>('all');
  const [integrationStatus, setIntegrationStatus] = useState<'idle' | 'checking' | 'ready' | 'error'>('idle');
  const [integrationStatusMessage, setIntegrationStatusMessage] = useState('연결 상태를 확인하지 않았습니다.');
  const [integrationCheckedAt, setIntegrationCheckedAt] = useState<string>('');
  const [coordinatorWorkers, setCoordinatorWorkers] = useState<CoordinatorWorker[]>([]);
  const [workerDiscoveryMessage, setWorkerDiscoveryMessage] = useState('아직 검색하지 않았습니다.');

  // 필터 검색 상태
  const [pluginCategory, setPluginCategory] = useState<'전체' | PluginCategory>('전체');
  const [pluginSearch, setPluginSearch] = useState('');
  const [modelTab, setModelTab] = useState<string>('전체');

  const scrollRef = useRef<any>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationPulse = useRef(new Animated.Value(0.45)).current;

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];
  const sessionActionTarget = sessions.find((session) => session.id === sessionActionTargetId);
  const sessionRenameTarget = sessions.find((session) => session.id === sessionRenameTargetId);
  const messageEditTarget = messages.find((message) => message.id === messageEditTargetId);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    if (!isGenerating) {
      generationPulse.stopAnimation();
      generationPulse.setValue(0.45);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(generationPulse, {
        toValue: 1,
        duration: 650,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(generationPulse, {
        toValue: 0.45,
        duration: 650,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [generationPulse, isGenerating]);

  useEffect(() => () => {
    generationAbortRef.current?.abort();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

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

  const refreshChatGPTPlan = useCallback(async () => {
    try {
      const status = await getChatGPTPlanStatus();
      setChatGPTStatus(status);
      if (status.connected) {
        try {
          const catalog = await getChatGPTPlanModels();
          setChatGPTModels(catalog);
          setChatGPTModelId(previous => catalog.some(item => item.id === previous) ? previous : catalog[0]?.id || '');
        } catch {
          setChatGPTStatus({ ...status, error: '모델 목록을 불러오지 못했어요. 잠시 후 상태를 새로고침해 주세요.' });
        }
      } else {
        setChatGPTModels([]);
      }
    } catch (error: any) {
      setChatGPTStatus({ connected: false, pending: false, email: '', error: error?.message || '연결 상태 확인 실패' });
    }
  }, []);

  useEffect(() => { refreshChatGPTPlan(); }, [refreshChatGPTPlan]);

  useEffect(() => {
    if (!chatGPTStatus.pending) return;
    const timer = setInterval(refreshChatGPTPlan, 2000);
    return () => clearInterval(timer);
  }, [chatGPTStatus.pending, refreshChatGPTPlan]);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('pocketmind.chatgpt-selected.v1'),
      AsyncStorage.getItem('pocketmind.chatgpt-model.v1'),
    ]).then(values => {
      setUseChatGPTPlan(values[0] === 'true');
      if (values[1]) setChatGPTModelId(values[1]);
    }).catch(() => {}).finally(() => setChatGPTPreferenceReady(true));
  }, []);

  useEffect(() => {
    if (!chatGPTPreferenceReady) return;
    Promise.all([
      AsyncStorage.setItem('pocketmind.chatgpt-selected.v1', String(useChatGPTPlan)),
      AsyncStorage.setItem('pocketmind.chatgpt-model.v1', chatGPTModelId),
    ]).catch(() => {});
  }, [chatGPTPreferenceReady, useChatGPTPlan, chatGPTModelId]);

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
            titleMode: session.titleMode,
            messages: session.messages
              .filter((message: any) => message && typeof message.id === 'string' &&
                (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string')
              .slice(-120),
          })).map((session: ChatSession) => {
            const titleMode = sessionTitleMode(session);
            return { ...session, titleMode, title: titleMode === 'auto' && !session.titleMode ? summarizeConversation(session.messages) : session.title };
          });
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
    if (Platform.OS !== 'android' || (!preferences.showMetrics && !androidWorkerOpen)) return;
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
  }, [preferences.showMetrics, androidWorkerOpen]);

  const updateActiveSessionMessages = useCallback((
    updater: (prev: ChatMessage[]) => ChatMessage[],

  ) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSessions((prevSessions) =>
      prevSessions.map((sess) => {
        if (sess.id !== activeSession.id) return sess;
        const nextMsgs = updater(sess.messages);
        const titleMode = sessionTitleMode(sess);
        const title = titleMode === 'custom' ? sess.title : summarizeConversation(nextMsgs);
        return { ...sess, title, titleMode, messages: nextMsgs };
      }),
    );
  }, [activeSession.id]);

  const visibleSessions = useMemo(() => sessions
    .filter((session) => {
      const query = historySearch.trim().toLocaleLowerCase();
      return !query || session.title.toLocaleLowerCase().includes(query) ||
        session.messages.some(message => message.text.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [historySearch, sessions]);

  const configuredIntegrationSet = useMemo(
    () => new Set(configuredIntegrationIds),
    [configuredIntegrationIds],
  );
  const integrationConnectionMap = useMemo(
    () => new Map(integrationConnections.map((connection) => [connection.id, connection])),
    [integrationConnections],
  );
  const lastAssistantMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant')?.id || null,
    [messages],
  );

  const toggleSessionPinned = (sessionId: string) => {
    setSessions((previous) => previous.map((session) =>
      session.id === sessionId ? { ...session, pinned: !session.pinned } : session,
    ));
  };

  const openSessionActions = (sessionId: string) => {
    setSidebarOpen(false);
    setSessionActionTargetId(sessionId);
  };

  const startSessionRename = () => {
    if (!sessionActionTarget) return;
    setSessionRenameTargetId(sessionActionTarget.id);
    setSessionRenameText(sessionActionTarget.title);
    setSessionActionTargetId(null);
  };

  const saveSessionRename = () => {
    if (!sessionRenameTarget) return;
    const nextTitle = normalizeSessionTitle(sessionRenameText);
    if (!nextTitle) {
      Alert.alert('이름을 입력하세요', '대화 이름은 공백으로만 저장할 수 없습니다.');
      return;
    }
    setSessions((previous) => renameSessionById(previous, sessionRenameTarget.id, nextTitle));
    setSessionRenameTargetId(null);
    setSessionRenameText('');
  };

  const deleteSession = (sessionId: string) => {
    const remaining = removeSessionById(sessions, sessionId);
    if (remaining.length === 0) {
      const replacement: ChatSession = {
        id: `session-${Date.now()}`,
        title: '새 채팅',
        messages: [],
      };
      setSessions([replacement]);
      setActiveSessionId(replacement.id);
    } else {
      setSessions(remaining);
      if (activeSessionId === sessionId) setActiveSessionId(remaining[0].id);
    }
    setHistorySearch('');
  };

  const confirmSessionDelete = () => {
    if (!sessionActionTarget) return;
    const target = sessionActionTarget;
    setSessionActionTargetId(null);
    Alert.alert(
      '대화 삭제',
      `“${target.title}” 대화와 저장된 메시지를 이 기기에서 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => deleteSession(target.id) },
      ],
    );
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

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 1800);
  }, []);

  const ensureGenerationAvailable = useCallback((prompt: string): boolean => {
    if (useChatGPTPlan) {
      if (chatGPTStatus.connected && chatGPTModelId) return true;
      Alert.alert('ChatGPT 연결 필요', 'ChatGPT 계정에 연결하고 사용 가능한 모델을 선택하세요.', [
        { text: '설정 열기', onPress: () => setChatGPTSettingsOpen(true) },
      ]);
      return false;
    }
    const hasLocal = installedModelIds.length > 0;
    const hasPC = remotePC.enabled && remotePC.serverUrl.trim().length > 0;
    const isPurePluginCommand = /^\/[a-z0-9-]+(\s|$)/i.test(prompt);
    if (!hasLocal && !hasPC && !isPurePluginCommand) {
      Alert.alert(
        'AI 모델 다운로드 필요',
        '초경량 무검열 모델(490MB Qwen 2.5 0.5B 또는 810MB Dolphin 3.0 1B)을 먼저 다운로드하거나 PC GPU 워커를 연결해 주세요.',
        [{ text: '모델 허브 열기', onPress: () => setModelStoreOpen(true) }],
      );
      return false;
    }
    return true;
  }, [installedModelIds.length, remotePC.enabled, remotePC.serverUrl, useChatGPTPlan, chatGPTStatus.connected, chatGPTModelId]);

  const runAssistantGeneration = useCallback(async (prompt: string, context: ChatMessage[]) => {
    if (!prompt.trim() || generationAbortRef.current || isGenerating || !ensureGenerationAvailable(prompt)) return;
    const controller = new AbortController();
    generationAbortRef.current = controller;

    setGeneratingSession(activeSession.id);
    setIsGenerating(true);
    setLiveStatus('생각 중...');
    setStreamingText('');

    try {
      if (useChatGPTPlan) {
        setLiveStatus('ChatGPT 플랜으로 응답 생성 중...');
        const result = await chatWithChatGPTPlan(
          chatGPTModelId,
          context.filter(message => !message.issue && !message.id.startsWith('err-') &&
            (message.role === 'user' || !message.pipelineSteps?.length))
            .map(message => ({ role: message.role, content: message.text })),
          prompt,
          partial => { if (!controller.signal.aborted) setStreamingText(partial); },
        );
        if (controller.signal.aborted) return;
        updateActiveSessionMessages(previous => [...previous, {
          id: `a-${Date.now()}`, role: 'assistant', text: result.text, timestamp: formatNowTime(),
          source: chatGPTModels.find(model => model.id === chatGPTModelId)?.name || chatGPTModelId,
          issue: result.issue, issueCode: result.code,
        }]);
        return;
      }
      const response = await multiModelOrchestrator.executeAutonomousPipeline({
        userPrompt: prompt,
        installedModelIds,
        primaryModelId,
        autoMultiModelEnabled: autoMultiModel,
        enabledPluginIds,
        remotePC,
        signal: controller.signal,
        callbacks: {
          onStatusUpdate: (status) => {
            if (!controller.signal.aborted) setLiveStatus(status);
          },
          onTokenStream: (partial) => {
            if (!controller.signal.aborted) setStreamingText(partial);
          },
        },
      });
      if (controller.signal.aborted) return;
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: response.finalText || '응답을 생성하지 못했습니다.',
        timestamp: formatNowTime(),
        source: response.steps.at(-1)?.modelName || 'PocketMind 플러그인',
        pipelineSteps: response.steps,
        pluginOutputs: response.pluginOutputs,
      };
      updateActiveSessionMessages((previous) => [...previous, assistantMsg]);
    } catch (error: any) {
      if (controller.signal.aborted) return;
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        text: '', issue: error?.message || '요청을 처리하지 못했어요. 다시 시도해 주세요.',
        source: useChatGPTPlan ? chatGPTModelId : 'PocketMind',
        timestamp: formatNowTime(),
      };
      updateActiveSessionMessages((previous) => [...previous, errMsg]);
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
        setIsGenerating(false);
        setLiveStatus('');
        setStreamingText('');
      }
    }
  }, [
    autoMultiModel,
    enabledPluginIds,
    ensureGenerationAvailable,
    installedModelIds,
    isGenerating,
    activeSession.id,
    chatGPTModels,
    chatGPTModelId,
    useChatGPTPlan,
    primaryModelId,
    remotePC,
    updateActiveSessionMessages,
  ]);

  const handleSendMessage = async (overridePrompt?: string) => {
    const trimmed = (overridePrompt !== undefined ? overridePrompt : inputText).trim();
    if (!trimmed || generationAbortRef.current || isGenerating || !ensureGenerationAvailable(trimmed)) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: formatNowTime(),
    };

    updateActiveSessionMessages((prev) => [...prev, userMsg]);
    setInputText('');
    await runAssistantGeneration(trimmed, messages);
  };

  const handleCopyMessage = useCallback((message: ChatMessage) => {
    Clipboard.setString(message.text || message.issue || '');
    showToast('메시지를 복사했습니다.');
  }, [showToast]);

  const handleEditMessage = useCallback((message: ChatMessage) => {
    if (message.role !== 'user') return;
    setMessageEditTargetId(message.id);
    setMessageEditText(message.text);
  }, []);

  const handleSaveEditedMessage = async () => {
    if (!messageEditTarget || messageEditTarget.role !== 'user' || isGenerating) return;
    const prompt = messageEditText.trim();
    if (!prompt || !ensureGenerationAvailable(prompt)) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    updateActiveSessionMessages((previous) =>
      replaceUserMessageAndTrim(previous, messageEditTarget.id, prompt),
    );
    setMessageEditTargetId(null);
    setMessageEditText('');
    await runAssistantGeneration(prompt, messages.slice(0, messages.findIndex(item => item.id === messageEditTarget.id)));
  };

  const handleRegenerateMessage = useCallback(async (message: ChatMessage) => {
    if (isGenerating) return;
    const prepared = prepareAnswerRegeneration(messages, message.id);
    if (!prepared || !ensureGenerationAvailable(prepared.prompt)) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    updateActiveSessionMessages(() => prepared.messages);
    await runAssistantGeneration(prepared.prompt, prepared.messages.slice(0, -1));
  }, [ensureGenerationAvailable, isGenerating, messages, runAssistantGeneration, updateActiveSessionMessages]);

  const handleStopGeneration = useCallback(() => {
    generationAbortRef.current?.abort();
    if (useChatGPTPlan) stopChatGPTPlan().catch(() => {});
    generationAbortRef.current = null;
    multiModelOrchestrator.cancelActive().catch(() => {});
    setIsGenerating(false);
    setLiveStatus('');
    setStreamingText('');
    showToast('답변 생성을 중지했습니다.');
  }, [showToast, useChatGPTPlan]);

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

  const refreshConnectedApps = useCallback(async () => {
    if (!remotePC.serverUrl.trim() || (remotePC.apiKey || '').trim().length < 24) {
      setConfiguredIntegrationIds([]);
      setIntegrationConnections([]);
      setIntegrationStatus('error');
      setIntegrationStatusMessage('Coordinator 주소와 24자 이상의 API 토큰을 먼저 설정하세요.');
      return;
    }
    setIntegrationStatus('checking');
    setIntegrationStatusMessage('Coordinator에서 연결 상태를 확인하고 있습니다...');
    try {
      const connections = await getIntegrationConnections(remotePC.serverUrl, (remotePC.apiKey || ''));
      const ids = connections
        .filter((connection) => connection.connectable ? connection.connected : connection.configured)
        .map((connection) => connection.id);
      const available = connections.filter((connection) => connection.connectable && !connection.connected).length;
      setIntegrationConnections(connections);
      setConfiguredIntegrationIds(ids);
      setIntegrationStatus('ready');
      setIntegrationStatusMessage(
        connections.length > 0
          ? `${ids.length}개 연결됨${available ? ` · ${available}개 원클릭 연결 가능` : ''}`
          : 'Coordinator는 연결됐지만 설치된 연결 어댑터가 없습니다.',
      );
      setIntegrationCheckedAt(formatNowTime());
    } catch (error: any) {
      setConfiguredIntegrationIds([]);
      setIntegrationConnections([]);
      setIntegrationStatus('error');
      setIntegrationStatusMessage(error?.message || 'Coordinator 주소와 API 토큰을 확인하세요.');
    }
  }, [remotePC.apiKey, remotePC.serverUrl]);

  const openConnectedApps = async () => {
    setConnectedAppsOpen(true);
    await refreshConnectedApps();
  };

  const openIntegrationSetup = async (url: string) => {
    try {
      const target = url.trim();
      if (!/^https:\/\//i.test(target)) throw new Error('안전하지 않은 설정 주소입니다.');
      // Android 11+ may report false from canOpenURL for normal HTTPS links when
      // browser package visibility is restricted even though openURL succeeds.
      await Linking.openURL(target);
    } catch (error: any) {
      Alert.alert('공식 설정 문서를 열 수 없음', error?.message || '브라우저와 주소를 확인하세요.');
    }
  };

  const handleConnectIntegration = async (
    app: (typeof CONNECTED_APP_CATALOG)[number],
  ) => {
    if (!remotePC.serverUrl.trim() || (remotePC.apiKey || '').trim().length < 24) {
      Alert.alert('Coordinator 설정 필요', 'Coordinator 주소와 API 토큰을 먼저 입력하세요.');
      return;
    }
    setConnectingIntegrationId(app.id);
    try {
      const authorizationUrl = await beginIntegrationConnection(
        remotePC.serverUrl,
        remotePC.apiKey || '',
        app.id,
      );
      setIntegrationStatusMessage(`${app.name} 공식 로그인 화면을 열었습니다. 인증 후 PocketMind로 돌아오세요.`);
      await Linking.openURL(authorizationUrl);
    } catch (error: any) {
      setConnectingIntegrationId(null);
      Alert.alert('연결을 시작할 수 없음', error?.message || '연결 어댑터 설정을 확인하세요.');
    }
  };

  const handleDisconnectIntegration = (
    app: (typeof CONNECTED_APP_CATALOG)[number],
  ) => {
    Alert.alert(
      `${app.name} 연결 해제`,
      'PocketMind에서 이 계정의 연결을 해제할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '연결 해제',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnectIntegration(remotePC.serverUrl, remotePC.apiKey || '', app.id);
              await refreshConnectedApps();
              showToast(`${app.name} 연결을 해제했습니다.`);
            } catch (error: any) {
              Alert.alert('연결 해제 실패', error?.message || '연결 어댑터를 확인하세요.');
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      if (!url.startsWith('pocketmind://integrations/callback')) return;
      setConnectedAppsOpen(true);
      setConnectingIntegrationId(null);
      refreshConnectedApps().then(() => showToast('계정 연결 상태를 확인했습니다.'));
    };
    const linkSubscription = Linking.addEventListener('url', handleUrl);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && connectingIntegrationId) {
        refreshConnectedApps().then(() => setConnectingIntegrationId(null));
      }
    });
    return () => {
      linkSubscription.remove();
      appStateSubscription.remove();
    };
  }, [connectingIntegrationId, refreshConnectedApps, showToast]);

  const handleConnectedAppAction = async (
    app: (typeof CONNECTED_APP_CATALOG)[number],
    action: (typeof CONNECTED_APP_CATALOG)[number]['actions'][number],
  ) => {
    if (!remotePC.serverUrl.trim() || (remotePC.apiKey || '').trim().length < 24) {
      Alert.alert('Coordinator 설정 필요', '분산 Worker 설정에서 Coordinator 주소와 API 토큰을 먼저 입력하세요.');
      return;
    }
    if (!configuredIntegrationSet.has(app.id)) {
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
  const activeModelLabel = useChatGPTPlan
    ? (chatGPTModels.find(model => model.id === chatGPTModelId)?.name || 'ChatGPT 연결 필요')
    : (activeModelSpec?.shortName || '모델 선택');

  const filteredPlugins = useMemo(() => safePlugins.filter((p) => {
    const matchCat = pluginCategory === '전체' || p.category === pluginCategory;
    const q = pluginSearch.trim().toLowerCase();
    const matchQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.triggerKeywords.some((k) => k.toLowerCase().includes(q));
    return matchCat && matchQ;
  }), [pluginCategory, pluginSearch, safePlugins]);

  const filteredModels = useMemo(() => safeCatalog.filter((m) => {
    if (modelTab === '초경량·무검열') return m.uncensored || m.tier === 'ultra-light';
    if (modelTab === '경량 (3B~4B)') return m.tier === 'light';
    if (modelTab === '중형 (7B~12B)') return m.tier === 'mid';
    if (modelTab === 'PC GPU (14B+)') return m.tier === 'high';
    return true;
  }), [modelTab, safeCatalog]);

  const filteredConnectedApps = useMemo(() => {
    const query = integrationSearch.trim().toLocaleLowerCase();
    return CONNECTED_APP_CATALOG.filter((app) => {
      const connected = configuredIntegrationSet.has(app.id);
      const matchesFilter = integrationFilter === 'all' ||
        (integrationFilter === 'connected' ? connected : !connected);
      const matchesQuery = !query || [app.name, app.category, app.description, app.id]
        .some((value) => value.toLocaleLowerCase().includes(query));
      return matchesFilter && matchesQuery;
    });
  }, [configuredIntegrationSet, integrationFilter, integrationSearch]);

  const renderChatMessage = useCallback(({ item }: { item: ChatMessage }) => (
    <ChatMessageCard
      message={item}
      largeText={preferences.largeText}
      canRegenerate={item.id === lastAssistantMessageId}
      disabled={isGenerating}
      onCopy={handleCopyMessage}
      onEdit={handleEditMessage}
      onRegenerate={handleRegenerateMessage}
    />
  ), [
    handleCopyMessage,
    handleEditMessage,
    handleRegenerateMessage,
    isGenerating,
    lastAssistantMessageId,
    preferences.largeText,
  ]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      <ChatSettingsSheet visible={settingsOpen} values={preferences} onChange={savePreferences} onClose={() => setSettingsOpen(false)} />

      {/* ================= ChatGPT 상단 헤더 ================= */}
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setSidebarOpen(true)}>
          <Text style={styles.iconBtnText}>☰</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modelPillBtn}
          onPress={() => setModelPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`모델 선택, 현재 ${activeModelLabel}`}
        >
          <View style={styles.modelPillContent}>
            <Text style={styles.modelPillBrand}>PocketMind</Text>
            <Text style={styles.modelPillName} numberOfLines={1}>{activeModelLabel}</Text>
          </View>
          <Text style={styles.modelPillChevron}>⌄</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconBtn} onPress={handleNewChat}>
          <Text style={styles.iconBtnText}>✎</Text>
        </TouchableOpacity>
      </View>

      {preferences.showMetrics && <View style={styles.deviceMetricsBar}>
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
      </View>}

      {/* ================= ChatGPT 메인 대화 영역 ================= */}
      <FlatList
        ref={scrollRef}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={renderChatMessage}
        style={styles.chatArea}
        contentContainerStyle={
          messages.length === 0 ? styles.emptyChatContainer : styles.chatContentContainer
        }
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { if (preferences.autoScroll) scrollRef.current?.scrollToEnd({ animated: true }); }}
        ListEmptyComponent={(
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
        )}
        ListFooterComponent={isGenerating && generatingSession === activeSession.id ? (
          <View style={styles.assistantRow}>
            <View style={styles.assistantBlock}>
              <View style={styles.progressRow}>
                <View style={styles.assistantAvatar}>
                  <Text style={styles.assistantAvatarText}>✦</Text>
                </View>
                <Animated.Text style={[styles.streamingStatusText, { opacity: generationPulse }]}>
                  {liveStatus || '생성 중...'}
                </Animated.Text>
              </View>
              {streamingText ? (
                <Text style={[styles.assistantBodyText, preferences.largeText && styles.largeChatText]}>{streamingText}</Text>
              ) : null}
              <TouchableOpacity
                style={styles.stopGenerationButton}
                onPress={handleStopGeneration}
                accessibilityRole="button"
                accessibilityLabel="답변 생성 중지"
              >
                <Text style={styles.stopGenerationText}>■ 생성 중지</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : undefined}
      />

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
            nativeID="pocketmind-composer"
            accessibilityLabel="메시지 입력"
            style={[styles.composerInput, preferences.largeText && styles.largeChatText]}
            onSelectionChange={event => setSelection(event.nativeEvent.selection)}
            submitBehavior={submitOnEnter || preferences.enterMode === 'send' ? 'submit' : 'newline'}
            returnKeyType={submitOnEnter ? 'send' : 'default'}
            disableFullscreenUI
            onSubmitEditing={event => {
              const text = event.nativeEvent.text;
              if (enterSubmits(preferences.enterMode, text, selection.start, selection.end)) handleSendMessage(text);
            }}
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
            accessibilityRole="button" accessibilityLabel="메시지 보내기"
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
      <Modal visible={sidebarOpen} transparent animationType="fade" onRequestClose={() => setSidebarOpen(false)}>
        <View style={styles.drawerOverlay}>
          <View style={styles.drawerPanel}>
            <TouchableOpacity style={styles.drawerNewChatBtn} onPress={handleNewChat}>
              <Text style={styles.drawerNewChatText}>✎  새 채팅</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.drawerNavItem} accessibilityRole="button" accessibilityState={{ expanded: drawerToolsOpen }}
              onPress={() => setDrawerToolsOpen(value => !value)}>
              <Text style={styles.drawerNavText}>{drawerToolsOpen ? '▾' : '▸'}  모델·플러그인·기기</Text>
            </TouchableOpacity>
            {drawerToolsOpen && <ScrollView style={{ maxHeight: 195 }} keyboardShouldPersistTaps="handled">
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
                🖥️  PC GPU 워커 ({remotePC.enabled ? '사용 설정' : '꺼짐'})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.drawerNavItem} onPress={() => { setSidebarOpen(false); openConnectedApps(); }}>
              <Text style={styles.drawerNavText}>🔌 연결 앱 허브 ({configuredIntegrationIds.length}개 사용 가능)</Text>
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

            </ScrollView>}
            <TouchableOpacity style={styles.drawerNavItem} accessibilityRole="button" disabled={!preferencesReady}
              onPress={() => { setSidebarOpen(false); setSettingsOpen(true); }}>
              <Text style={styles.drawerNavText}>⚙  채팅 설정</Text>
            </TouchableOpacity>
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
                  accessibilityRole="button" accessibilityLabel={sess.title} accessibilityState={{ selected: sess.id === activeSession.id }}
                  onLongPress={() => openSessionActions(sess.id)}
                  delayLongPress={350}
                >
                  <View style={styles.drawerHistoryTextWrap}>
                    <Text style={styles.drawerHistoryText} numberOfLines={1}>{sess.pinned ? '📌 ' : ''}{sess.title}</Text>
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

      {/* ================= 대화 기록 관리 ================= */}
      <Modal
        visible={Boolean(sessionActionTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => setSessionActionTargetId(null)}
      >
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {sessionActionTarget?.title || '대화 관리'}
              </Text>
              <TouchableOpacity onPress={() => setSessionActionTargetId(null)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.sessionActionButton}
              onPress={() => {
                if (sessionActionTarget) toggleSessionPinned(sessionActionTarget.id);
                setSessionActionTargetId(null);
              }}
            >
              <Text style={styles.sessionActionText}>
                {sessionActionTarget?.pinned ? '📌 고정 해제' : '📌 상단에 고정'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={startSessionRename}>
              <Text style={styles.sessionActionText}>✎ 이름 변경</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={confirmSessionDelete}>
              <Text style={styles.sessionDeleteActionText}>삭제</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(sessionRenameTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => setSessionRenameTargetId(null)}
      >
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>대화 이름 변경</Text>
              <TouchableOpacity onPress={() => setSessionRenameTargetId(null)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.sessionRenameInput}
              value={sessionRenameText}
              onChangeText={setSessionRenameText}
              placeholder="대화 이름"
              placeholderTextColor="#8E8EA0"
              maxLength={80}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={saveSessionRename}
            />
            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                !normalizeSessionTitle(sessionRenameText) && styles.sendCircleDisabled,
              ]}
              onPress={saveSessionRename}
              disabled={!normalizeSessionTitle(sessionRenameText)}
            >
              <Text style={styles.sheetPrimaryBtnText}>저장</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(messageEditTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => setMessageEditTargetId(null)}
      >
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>메시지 수정·재전송</Text>
              <TouchableOpacity onPress={() => setMessageEditTargetId(null)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.editMessageNotice}>
              이 메시지 뒤의 답변과 후속 대화는 새 답변으로 교체됩니다.
            </Text>
            <TextInput
              style={styles.messageEditInput}
              value={messageEditText}
              onChangeText={setMessageEditText}
              placeholder="수정할 메시지"
              placeholderTextColor="#8E8EA0"
              multiline
              maxLength={8000}
              autoFocus
            />
            <TouchableOpacity
              style={[
                styles.sheetPrimaryBtn,
                (!messageEditText.trim() || isGenerating) && styles.sendCircleDisabled,
              ]}
              onPress={handleSaveEditedMessage}
              disabled={!messageEditText.trim() || isGenerating}
            >
              <Text style={styles.sheetPrimaryBtnText}>수정하고 다시 보내기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================= 상단 모델 빠른 전환 팝업 ================= */}
      <Modal visible={modelPickerOpen} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={[styles.bottomSheetCard, styles.modelPickerSheet]}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>모델 선택</Text>
                <Text style={styles.sheetSubtitle}>대화에 사용할 모델을 고르세요</Text>
              </View>
              <TouchableOpacity onPress={() => setModelPickerOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modelPickerList} contentContainerStyle={styles.modelPickerListContent}>
              <View style={styles.modelSectionHeading}>
                <Text style={styles.modelSectionTitle}>클라우드</Text>
                <Text style={styles.modelSectionHint}>기기 용량 사용 안 함</Text>
              </View>
              {chatGPTStatus.connected ? chatGPTModels.map(model => (
                <TouchableOpacity
                  key={model.id}
                  style={[styles.pickerRow, styles.cloudPickerRow, useChatGPTPlan && chatGPTModelId === model.id && styles.pickerRowSelected]}
                  onPress={() => {
                    setChatGPTModelId(model.id);
                    setUseChatGPTPlan(true);
                    setModelPickerOpen(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerModelName}>{model.name}</Text>
                    <Text style={styles.pickerModelMeta}>내 ChatGPT 플랜 · 온라인 사용</Text>
                  </View>
                  <Text style={styles.pickerCheck}>{useChatGPTPlan && chatGPTModelId === model.id ? '✓' : ''}</Text>
                </TouchableOpacity>
              )) : (
                <TouchableOpacity style={[styles.pickerRow, styles.cloudPickerRow]} onPress={() => {
                  setModelPickerOpen(false);
                  setChatGPTSettingsOpen(true);
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerModelName}>ChatGPT 연결</Text>
                    <Text style={styles.pickerModelMeta}>계정으로 로그인하고 모델 사용하기</Text>
                  </View>
                  <Text style={styles.modelRowArrow}>›</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modelSectionHeading}>
                <Text style={styles.modelSectionTitle}>기기 및 Worker</Text>
                <Text style={styles.modelSectionHint}>설치 모델</Text>
              </View>
              {safeCatalog.map((m) => {
                const isInstalled = installedModelIds.includes(m.id);
                const isSelected = !useChatGPTPlan && primaryModelId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                    onPress={() => {
                      if (isInstalled || remotePC.enabled) {
                        setPrimaryModelId(m.id);
                        setUseChatGPTPlan(false);
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

            <View style={styles.modelPickerActions}>
              <TouchableOpacity
              style={[styles.sheetSecondaryBtn, styles.modelActionBtn]}
              onPress={() => {
                setModelPickerOpen(false);
                setChatGPTSettingsOpen(true);
              }}
            >
              <Text style={styles.sheetSecondaryBtnText}>ChatGPT 계정</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetSecondaryBtn, styles.modelActionBtn]}
              onPress={() => {
                setModelPickerOpen(false);
                setModelStoreOpen(true);
              }}
            >
              <Text style={styles.sheetSecondaryBtnText}>모델 관리</Text>
            </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={chatGPTSettingsOpen} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>ChatGPT 연결</Text>
                <Text style={styles.sheetSubtitle}>PocketMind에서 내 플랜으로 대화</Text>
              </View>
              <TouchableOpacity onPress={() => setChatGPTSettingsOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.accountStatusCard, chatGPTStatus.connected && styles.accountStatusCardConnected]}>
              <Text style={styles.accountStatusLabel}>
                {chatGPTStatus.connected ? '● 연결됨' : chatGPTStatus.pending ? '● 연결 중' : '○ 연결 안 됨'}
              </Text>
              <Text style={styles.accountStatusTitle} numberOfLines={1}>
                {chatGPTStatus.connected ? (chatGPTStatus.email || 'ChatGPT 계정') : 'ChatGPT 계정을 연결하세요'}
              </Text>
              <Text style={styles.accountStatusDescription}>
                {chatGPTStatus.pending ? '브라우저에서 로그인을 마치면 이 화면이 갱신됩니다.'
                  : chatGPTStatus.error || (chatGPTStatus.connected
                    ? '계정에서 사용 가능한 모델을 위쪽 모델 메뉴에서 선택할 수 있어요.'
                    : '기기에서 모델을 다운로드하지 않고 온라인으로 대화할 수 있어요.')}
              </Text>
            </View>
            {!chatGPTStatus.connected && !chatGPTStatus.pending && (
              <TouchableOpacity style={styles.sheetPrimaryBtn} onPress={async () => {
                try {
                  const url = await beginChatGPTPlanLogin();
                  await refreshChatGPTPlan();
                  await Linking.openURL(url);
                } catch (error: any) {
                  Alert.alert('ChatGPT 로그인 실패', error?.message || '브라우저를 열 수 없습니다.');
                }
              }}>
                <Text style={styles.sheetPrimaryBtnText}>ChatGPT 계정으로 로그인</Text>
              </TouchableOpacity>
            )}
            {chatGPTStatus.connected && (
              <TouchableOpacity style={styles.sheetSecondaryBtn} onPress={() => {
                Alert.alert('연결 해제', '이 기기의 ChatGPT 로그인 정보를 지울까요?', [
                  { text: '취소', style: 'cancel' },
                  { text: '연결 해제', style: 'destructive', onPress: async () => {
                    await disconnectChatGPTPlan();
                    setUseChatGPTPlan(false);
                    setChatGPTModels([]);
                    await refreshChatGPTPlan();
                  } },
                ]);
              }}>
                <Text style={styles.sheetDangerText}>연결 해제</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.sheetTextBtn} onPress={refreshChatGPTPlan}>
              <Text style={styles.sheetTextBtnText}>상태 새로고침</Text>
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
              🔌 연결 앱 ({configuredIntegrationIds.length}/{CONNECTED_APP_CATALOG.length} 연결됨)
            </Text>
            <TouchableOpacity onPress={() => setConnectedAppsOpen(false)}>
              <Text style={styles.sheetClose}>닫기</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.pluginCardDesc, { paddingHorizontal: 16, paddingTop: 10 }]}>
            원클릭 연결이 준비된 앱은 연결 버튼을 누른 뒤 공식 로그인만 완료하면 됩니다. 계정 비밀번호는 PocketMind에 저장되지 않습니다.
          </Text>
          <View style={styles.integrationStatusPanel}>
            <View style={styles.integrationStatusHeader}>
              <Text style={styles.integrationStatusTitle}>
                {integrationStatus === 'checking' ? '확인 중' :
                  integrationStatus === 'ready' ? '연결 상태 확인됨' :
                  integrationStatus === 'error' ? '설정 확인 필요' : '연결 상태'}
              </Text>
              {integrationCheckedAt ? (
                <Text style={styles.integrationCheckedAt}>마지막 확인 {integrationCheckedAt}</Text>
              ) : null}
            </View>
            <Text style={styles.integrationStatusMessage}>{integrationStatusMessage}</Text>
            <View style={styles.integrationStatusActions}>
              <TouchableOpacity
                style={styles.integrationSecondaryButton}
                onPress={() => {
                  setConnectedAppsOpen(false);
                  setPcWorkerOpen(true);
                }}
              >
                <Text style={styles.integrationSecondaryButtonText}>Coordinator 설정</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.integrationRefreshButton}
                onPress={refreshConnectedApps}
                disabled={integrationStatus === 'checking'}
              >
                <Text style={styles.integrationRefreshButtonText}>
                  {integrationStatus === 'checking' ? '확인 중…' : '상태 새로고침'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <TextInput
            style={[styles.historySearchInput, styles.integrationSearchInput]}
            value={integrationSearch}
            onChangeText={setIntegrationSearch}
            placeholder="앱 이름·카테고리 검색"
            placeholderTextColor="#8E8EA0"
            autoCapitalize="none"
          />
          <View style={styles.integrationFilterRow}>
            {([
              ['all', '전체'],
              ['connected', '연결됨'],
              ['setup', '설정 필요'],
            ] as const).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                style={[
                  styles.integrationFilterChip,
                  integrationFilter === value && styles.integrationFilterChipActive,
                ]}
                onPress={() => setIntegrationFilter(value)}
              >
                <Text style={[
                  styles.integrationFilterText,
                  integrationFilter === value && styles.integrationFilterTextActive,
                ]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={styles.modalScrollBody}>
            {filteredConnectedApps.map((app) => {
              const configured = configuredIntegrationSet.has(app.id);
              const connection = integrationConnectionMap.get(app.id);
              const connectable = connection?.connectable === true;
              const connecting = connectingIntegrationId === app.id;
              const statusLabel = configured
                ? '연결됨'
                : connectable
                  ? '연결 가능'
                  : connection?.configured
                    ? '웹훅 준비됨'
                    : '어댑터 필요';
              return (
                <View key={app.id} style={styles.pluginCard}>
                  <View style={styles.pluginCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pluginCardTitle}>{app.name}</Text>
                      <Text style={styles.pluginCardCat}>{app.category} · {app.auth.toUpperCase()}</Text>
                    </View>
                    <Text style={{ color: configured ? '#10A37F' : '#F59E0B', fontSize: 11, fontWeight: '700' }}>
                      {statusLabel}
                    </Text>
                  </View>
                  <Text style={styles.pluginCardDesc}>{app.description}</Text>
                  <Text style={styles.integrationAuthText}>
                    인증 방식: {app.auth.toUpperCase()} · 서버 키: {app.webhookKey}
                  </Text>
                  {connection?.accountLabel ? (
                    <Text style={styles.integrationAccountLabel}>계정: {connection.accountLabel}</Text>
                  ) : null}
                  {connection?.statusError ? (
                    <Text style={styles.integrationConnectionError}>{connection.statusError}</Text>
                  ) : null}
                  {connectable && !configured ? (
                    <TouchableOpacity
                      style={[styles.integrationConnectButton, connecting && styles.integrationActionDisabled]}
                      onPress={() => handleConnectIntegration(app)}
                      disabled={connecting}
                    >
                      <Text style={styles.integrationConnectButtonText}>
                        {connecting ? '로그인 확인 중…' : `${app.name} 원클릭 연결`}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {connectable && configured ? (
                    <TouchableOpacity
                      style={styles.integrationDisconnectButton}
                      onPress={() => handleDisconnectIntegration(app)}
                    >
                      <Text style={styles.integrationDisconnectButtonText}>연결 해제</Text>
                    </TouchableOpacity>
                  ) : null}
                  {app.actions.map((action) => (
                    <TouchableOpacity
                      key={action.id}
                      style={[
                        styles.pluginRunBtn,
                        { alignSelf: 'stretch', marginTop: 8 },
                        !configured && styles.integrationActionDisabled,
                      ]}
                      onPress={() => handleConnectedAppAction(app, action)}
                      disabled={!configured}
                    >
                      <Text style={styles.pluginRunBtnText}>
                        {action.label} · {action.risk === 'read' ? '읽기' : action.risk === 'write' ? '승인 필요' : '중요 승인 필요'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {!connectable ? <TouchableOpacity
                    style={styles.integrationSetupLink}
                    onPress={() => openIntegrationSetup(app.officialSetupUrl)}
                  >
                    <Text style={styles.integrationSetupLinkText}>연결 어댑터 설정 안내 ↗</Text>
                  </TouchableOpacity> : null}
                </View>
              );
            })}
            {filteredConnectedApps.length === 0 ? (
              <Text style={styles.integrationEmptyText}>조건에 맞는 연결 앱이 없습니다.</Text>
            ) : null}
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
      {toastMessage ? (
        <Animated.View style={styles.toastBanner} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      ) : null}
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
    backgroundColor: '#2B2B2B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#454545',
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 7,
    borderRadius: 15,
    gap: 12,
    maxWidth: 280,
    minWidth: 142,
  },
  modelPillContent: {
    flexShrink: 1,
  },
  modelPillBrand: {
    color: '#A9ABA9',
    fontSize: 10,
    fontWeight: '700',
  },
  modelPillName: {
    color: '#F5F5F5',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 1,
  },
  modelPillChevron: {
    color: '#B9BBB9',
    fontSize: 18,
    fontWeight: '600',
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
  userMessageColumn: {
    maxWidth: '86%',
    alignItems: 'flex-end',
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
  messageActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
  },
  messageActionButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: '#292929',
  },
  messageActionText: {
    color: '#AFAFAF',
    fontSize: 11,
    fontWeight: '600',
  },
  messageActionDisabled: {
    color: '#626262',
  },
  stopGenerationButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#565656',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stopGenerationText: {
    color: '#D1D5DB',
    fontSize: 12,
    fontWeight: '600',
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
    paddingTop: 16,
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
  largeChatText: { fontSize: 19, lineHeight: 29 },
  replySource: { color: '#A4B8B1', fontSize: 12, marginBottom: 5, fontWeight: '600' },
  replyIssue: { paddingVertical: 8, paddingHorizontal: 12, marginTop: 4, borderLeftWidth: 2, borderColor: '#BD996A', backgroundColor: '#2C2925', borderRadius: 5 },
  replyIssueText: { color: '#E2CDB1', fontSize: 14, lineHeight: 21 },
  progressRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
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
  sessionActionButton: {
    backgroundColor: '#282828',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  sessionActionText: {
    color: '#ECECEC',
    fontSize: 15,
    fontWeight: '600',
  },
  sessionDeleteActionText: {
    color: '#F87171',
    fontSize: 15,
    fontWeight: '700',
  },
  sessionRenameInput: {
    backgroundColor: '#282828',
    borderWidth: 1,
    borderColor: '#4A4A4F',
    borderRadius: 12,
    color: '#ECECEC',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  editMessageNotice: {
    color: '#FBBF24',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  messageEditInput: {
    minHeight: 130,
    maxHeight: 300,
    backgroundColor: '#282828',
    borderWidth: 1,
    borderColor: '#4A4A4F',
    borderRadius: 12,
    color: '#ECECEC',
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    textAlignVertical: 'top',
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
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  modelPickerSheet: {
    maxHeight: '82%',
  },
  modelPickerList: {
    flexGrow: 0,
  },
  modelPickerListContent: {
    paddingBottom: 8,
  },
  modelSectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 10,
  },
  modelSectionTitle: {
    color: '#F0F0F0',
    fontSize: 14,
    fontWeight: '700',
  },
  modelSectionHint: {
    color: '#8F9390',
    fontSize: 11,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: '#ECECEC',
    fontSize: 20,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: '#9C9F9D',
    fontSize: 12,
    marginTop: 4,
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
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: '#282828',
    borderWidth: 1,
    borderColor: '#383838',
    minHeight: 64,
  },
  pickerRowSelected: {
    borderColor: '#10A37F',
    backgroundColor: '#1D302A',
  },
  cloudPickerRow: {
    backgroundColor: '#24302C',
    borderColor: '#315247',
  },
  modelRowArrow: {
    color: '#76D6B6',
    fontSize: 25,
    marginLeft: 10,
  },
  pickerModelName: {
    color: '#ECECEC',
    fontSize: 14,
    fontWeight: '700',
  },
  pickerModelMeta: {
    color: '#B4B7B5',
    fontSize: 12,
    marginTop: 4,
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
  modelPickerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  sheetSecondaryBtn: {
    backgroundColor: '#2D2D2D',
    borderWidth: 1,
    borderColor: '#454545',
    borderRadius: 13,
    minHeight: 46,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  modelActionBtn: {
    flex: 1,
  },
  sheetSecondaryBtnText: {
    color: '#E7E7E7',
    fontSize: 13,
    fontWeight: '600',
  },
  sheetDangerText: {
    color: '#F5A1A1',
    fontSize: 13,
    fontWeight: '600',
  },
  sheetTextBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  sheetTextBtnText: {
    color: '#AAB2AE',
    fontSize: 12,
    fontWeight: '600',
  },
  accountStatusCard: {
    backgroundColor: '#292929',
    borderWidth: 1,
    borderColor: '#3D3D3D',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  accountStatusCardConnected: {
    backgroundColor: '#1D302A',
    borderColor: '#315D4D',
  },
  accountStatusLabel: {
    color: '#72D4AE',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
  },
  accountStatusTitle: {
    color: '#F2F2F2',
    fontSize: 16,
    fontWeight: '700',
  },
  accountStatusDescription: {
    color: '#B3B9B5',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
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
  integrationStatusPanel: {
    backgroundColor: '#212121',
    borderWidth: 1,
    borderColor: '#343434',
    borderRadius: 14,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
  },
  integrationStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  integrationStatusTitle: {
    color: '#ECECEC',
    fontSize: 13,
    fontWeight: '700',
  },
  integrationCheckedAt: {
    color: '#8E8EA0',
    fontSize: 10,
  },
  integrationStatusMessage: {
    color: '#B4B4B4',
    fontSize: 12,
    lineHeight: 17,
  },
  integrationStatusActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  integrationSecondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#4A4A4F',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  integrationSecondaryButtonText: {
    color: '#D1D5DB',
    fontSize: 12,
    fontWeight: '600',
  },
  integrationRefreshButton: {
    flex: 1,
    backgroundColor: '#10A37F',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  integrationRefreshButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  integrationSearchInput: {
    marginTop: 10,
    marginHorizontal: 14,
  },
  integrationFilterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  integrationFilterChip: {
    backgroundColor: '#262626',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  integrationFilterChipActive: {
    backgroundColor: '#ECECEC',
  },
  integrationFilterText: {
    color: '#B4B4B4',
    fontSize: 12,
    fontWeight: '600',
  },
  integrationFilterTextActive: {
    color: '#111111',
  },
  integrationAuthText: {
    color: '#8E8EA0',
    fontSize: 11,
    marginBottom: 2,
  },
  integrationAccountLabel: {
    color: '#86EFAC',
    fontSize: 12,
    marginTop: 5,
  },
  integrationConnectionError: {
    color: '#FBBF24',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  integrationConnectButton: {
    backgroundColor: '#10A37F',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 10,
  },
  integrationConnectButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  integrationDisconnectButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#4A4A4F',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginTop: 9,
  },
  integrationDisconnectButtonText: {
    color: '#D1D5DB',
    fontSize: 11,
    fontWeight: '600',
  },
  integrationActionDisabled: {
    opacity: 0.42,
  },
  integrationSetupLink: {
    marginTop: 10,
    paddingVertical: 5,
  },
  integrationSetupLinkText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '600',
  },
  integrationEmptyText: {
    color: '#8E8EA0',
    textAlign: 'center',
    paddingVertical: 28,
  },
  toastBanner: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 82,
    backgroundColor: '#ECECEC',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
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

import { Linking } from 'react-native';
import RNFS from 'react-native-fs';

export type ModelTier = 'ultra-light' | 'light' | 'mid' | 'high';

export interface AIModelSpec {
  id: string;
  name: string;
  shortName: string;
  tier: ModelTier;
  tierLabel: string;
  paramB: number;
  sizeLabel: string;
  recommendedDevices: string;
  filename: string;
  downloadUrl: string;
  nCtx: number;
  description: string;
}

export const AI_MODEL_CATALOG: AIModelSpec[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen 2.5 0.5B (초경량 번개)',
    shortName: 'Qwen 2.5 0.5B',
    tier: 'ultra-light',
    tierLabel: '초저사양',
    paramB: 0.5,
    sizeLabel: '491 MB',
    recommendedDevices: '갤럭시 탭 S7 FE (4GB RAM) · 구형 폰',
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    nCtx: 2048,
    description: '메모리 1GB 미만 점유. 갤탭 S7 FE에서 절대 튕기지 않고 즉각 응답',
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen 2.5 1.5B (갤탭 S7 FE 최적)',
    shortName: 'Qwen 2.5 1.5B',
    tier: 'light',
    tierLabel: '저사양',
    paramB: 1.5,
    sizeLabel: '1.12 GB',
    recommendedDevices: '갤럭시 탭 S7 FE · 기본 온디바이스 표준',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    nCtx: 2048,
    description: '갤탭 S7 FE에서 로컬 단독 실행 시 속도와 한국어 품질 균형이 가장 좋은 모델',
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B (균형형 올라운더)',
    shortName: 'Qwen 2.5 3B',
    tier: 'light',
    tierLabel: '경량',
    paramB: 3,
    sizeLabel: '2.10 GB',
    recommendedDevices: '갤탭 S7 FE (6GB) · 아이폰 16 Pro · LG 그램',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    nCtx: 3072,
    description: '일상 대화, 요약, 앱 플러그인 도구 호출을 매끄럽게 소화하는 표준 모델',
  },
  {
    id: 'exaone-3.5-7.8b',
    name: 'LG EXAONE 3.5 7.8B (한국어 최강)',
    shortName: 'EXAONE 3.5 7.8B',
    tier: 'mid',
    tierLabel: '중고사양',
    paramB: 7.8,
    sizeLabel: '4.77 GB',
    recommendedDevices: '아이폰 16 Pro · LG 그램(16GB) · RTX 3060',
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
    description: '한국어 문맥, 문서 작성, 국내 생활 비서 업무에 압도적인 성능',
  },
  {
    id: 'qwen2.5-7b',
    name: 'Qwen 2.5 7B (코딩·범용 고성능)',
    shortName: 'Qwen 2.5 7B',
    tier: 'mid',
    tierLabel: '중고사양',
    paramB: 7,
    sizeLabel: '4.68 GB',
    recommendedDevices: '아이폰 16 Pro · LG 그램(16GB) · RTX 3060',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
    description: '코딩, 논리 추론, 다국어 번역에 강한 고성능 7B 모델',
  },
  {
    id: 'qwen2.5-14b',
    name: 'Qwen 2.5 14B (RTX 3060 전문가급)',
    shortName: 'Qwen 2.5 14B',
    tier: 'high',
    tierLabel: '초고사양',
    paramB: 14,
    sizeLabel: '8.99 GB',
    recommendedDevices: 'RTX 3060 랩탑 · GPU 공유 클러스터 전용',
    filename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
    description: '갤탭·아이폰에서는 GPU 공유(wss://)로 연결해 쓰는 대형 전문가 모델',
  },
  {
    id: 'deepseek-r1-14b',
    name: 'DeepSeek-R1 14B (심층 사고 추론)',
    shortName: 'DeepSeek-R1 14B',
    tier: 'high',
    tierLabel: '초고사양',
    paramB: 14,
    sizeLabel: '8.99 GB',
    recommendedDevices: 'RTX 3060 랩탑 · GPU 공유 클러스터 전용',
    filename: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    nCtx: 4096,
    description: '복잡한 수학, 코딩 설계, 단계별 추론(Chain-of-Thought) 특화 대형 모델',
  },
];

export type PluginCategory =
  | '정보·검색'
  | '메신저·연락'
  | '지도·교통·여행'
  | '쇼핑·배달·결제'
  | '미디어·엔터'
  | '생산성·기기';

export interface PicklePlugin {
  id: string;
  icon: string;
  name: string;
  category: PluginCategory;
  description: string;
  promptHint: string;
}

export const PICKLE_PLUGINS: PicklePlugin[] = [
  // 1~10: 핵심 기본 플러그인
  {
    id: 'web_search',
    icon: '🌐',
    name: '실시간 웹·지식 검색',
    category: '정보·검색',
    description: '위키백과 및 네이버/구글 웹 검색 결과를 실시간으로 가져와 답변 생성',
    promptHint: '양자컴퓨터 최신 동향 검색해줘',
  },
  {
    id: 'weather_live',
    icon: '🌤️',
    name: '실시간 날씨·기온 예보',
    category: '정보·검색',
    description: '현재 기온, 체감온도, 습도, 강수량 실시간 조회 및 옷차림 추천',
    promptHint: '오늘 청주 날씨 어때?',
  },
  {
    id: 'transit_ktx',
    icon: '🚄',
    name: '코레일 KTX · SRT 열차 앱',
    category: '지도·교통·여행',
    description: '코레일톡(KTX)·SRT 예매 앱 및 네이버 대중교통 길찾기 즉시 실행',
    promptHint: '오송역에서 서울역 가는 KTX 열차 조회해줘',
  },
  {
    id: 'shopping_deal',
    icon: '🛒',
    name: '네이버쇼핑 · 쿠팡 앱',
    category: '쇼핑·배달·결제',
    description: '쿠팡 로켓배송 앱 및 네이버쇼핑 가격비교 검색 화면 즉시 실행',
    promptHint: '갤럭시 탭 S7 FE S펜 촉 최저가 쿠팡에서 찾아줘',
  },
  {
    id: 'phone_sms',
    icon: '📞',
    name: '전화 다이얼 · 문자 메시지 앱',
    category: '메신저·연락',
    description: '전화번호 인식 후 갤럭시 전화·문자 앱 즉시 실행 및 메시지 초안 작성',
    promptHint: '010-1234-5678로 내일 2시 미팅 확인 문자 보내줘',
  },
  {
    id: 'calendar_schedule',
    icon: '📅',
    name: '구글 캘린더 · 일정 등록 앱',
    category: '생산성·기기',
    description: '캘린더 일정 등록 화면 바로 실행 및 약속 시간 조율 메시지 작성',
    promptHint: '내일 오후 3시 프로젝트 회의 캘린더에 등록해줘',
  },
  {
    id: 'finance_calc',
    icon: '💱',
    name: '실시간 환율 · 스마트 계산기',
    category: '정보·검색',
    description: '달러/엔화/유로 실시간 원화 환율 계산 및 복잡한 수식 정밀 연산',
    promptHint: '지금 200달러가 한국 돈으로 얼마야?',
  },
  {
    id: 'youtube_summary',
    icon: '🎬',
    name: '유튜브 앱 · 영상 검색',
    category: '미디어·엔터',
    description: '유튜브 앱으로 영상 바로 검색 및 붙여넣은 자막·스크립트 3줄 요약',
    promptHint: '유튜브에서 갤럭시 탭 S7 FE 활용법 영상 찾아줘',
  },
  {
    id: 'doc_writer',
    icon: '📄',
    name: '보고서 · 기획안 · 문서 작성',
    category: '생산성·기기',
    description: '기획안, 이메일, 회의록, 표 데이터를 깔끔한 문서 양식으로 자동 작성',
    promptHint: 'AI GPU 공유 서비스 소개서 초안 써줘',
  },
  {
    id: 'long_memory',
    icon: '🧠',
    name: '장기 개인화 기억 (Memory)',
    category: '생산성·기기',
    description: '내 기기 목록, 선호 모델, 주요 메모를 기기에 영구 저장해 매 대화에 반영',
    promptHint: '기억해: 내 노트북은 RTX 3060 랩탑이랑 LG 그램이야',
  },

  // 11~30: 추가 앱 플러그인 20종
  {
    id: 'kakaotalk_app',
    icon: '💬',
    name: '카카오톡 앱 연동',
    category: '메신저·연락',
    description: '카톡 메시지 초안 작성 후 카카오톡 앱 즉시 실행',
    promptHint: '카카오톡으로 팀장님께 보낼 업무 보고 메시지 쓰고 카톡 열어줘',
  },
  {
    id: 'kakaomap_tmap',
    icon: '🗺️',
    name: '카카오맵 · 티맵(TMAP) 내비',
    category: '지도·교통·여행',
    description: '카카오맵 길찾기 앱 및 티맵 내비게이션 목적지 검색 바로 실행',
    promptHint: '카카오맵으로 청주국제공항 가는 길 찾아줘',
  },
  {
    id: 'kakaot_taxi',
    icon: '🚕',
    name: '카카오 T 택시 · 대리 호출',
    category: '지도·교통·여행',
    description: '카카오 T 앱을 즉시 호출해 택시·대리운전·바이크 배차 화면 연결',
    promptHint: '카카오택시 호출 앱 열어줘',
  },
  {
    id: 'delivery_food',
    icon: '🛵',
    name: '배달의민족 · 쿠팡이츠 주문',
    category: '쇼핑·배달·결제',
    description: '메뉴 추천 후 배달의민족 및 쿠팡이츠 앱 즉시 실행',
    promptHint: '야식 메뉴 추천해주고 배달의민족 앱 열어줘',
  },
  {
    id: 'cafe_order',
    icon: '☕',
    name: '스타벅스 · 메가커피 오더',
    category: '쇼핑·배달·결제',
    description: '스타벅스 사이렌오더 및 메가MGC커피 앱 바로 열기',
    promptHint: '스타벅스 앱 열어서 아메리카노 주문하게 해줘',
  },
  {
    id: 'music_player',
    icon: '🎵',
    name: '멜론 · 유튜브뮤직 · 스포티파이',
    category: '미디어·엔터',
    description: '분위기별 플레이리스트 추천 및 멜론·유튜브뮤직·스포티파이 앱 실행',
    promptHint: '코딩할 때 듣기 좋은 잔잔한 음악 추천하고 유튜브뮤직 열어줘',
  },
  {
    id: 'ott_streaming',
    icon: '📺',
    name: '넷플릭스 · 티빙 · 쿠팡플레이',
    category: '미디어·엔터',
    description: '영화·드라마 작품 추천 후 넷플릭스·티빙·쿠팡플레이 앱 즉시 실행',
    promptHint: 'SF 영화 추천해주고 넷플릭스 앱 열어줘',
  },
  {
    id: 'movie_ticket',
    icon: '🍿',
    name: 'CGV · 롯데시네마 · 메가박스',
    category: '미디어·엔터',
    description: '현재 상영작 예매를 위해 CGV·롯데시네마·메가박스 앱 바로 연결',
    promptHint: '주말 영화 예매하게 CGV 앱 열어줘',
  },
  {
    id: 'bank_toss',
    icon: '🏦',
    name: '토스(Toss) · 카카오뱅크 금융',
    category: '쇼핑·배달·결제',
    description: '송금·계좌조회·자산관리를 위해 토스 및 카카오뱅크 앱 즉시 실행',
    promptHint: '계좌 이체하게 토스 앱 열어줘',
  },
  {
    id: 'pay_wallet',
    icon: '💳',
    name: '네이버페이 · 삼성페이 결제',
    category: '쇼핑·배달·결제',
    description: '현장 결제 및 포인트 확인을 위한 네이버페이·삼성월렛 앱 실행',
    promptHint: '네이버페이 포인트 확인하게 앱 열어줘',
  },
  {
    id: 'email_sender',
    icon: '📧',
    name: '지메일(Gmail) · 네이버 메일',
    category: '메신저·연락',
    description: '비즈니스 이메일 본문 자동 작성 및 지메일·네이버메일 앱 즉시 실행',
    promptHint: '거래처 미팅 요청 이메일 초안 써주고 지메일 열어줘',
  },
  {
    id: 'notes_notion',
    icon: '📝',
    name: '노션(Notion) · 삼성 노트 메모',
    category: '생산성·기기',
    description: '아이디어·회의록 정리 후 노션(Notion) 및 삼성 노트 앱 바로 실행',
    promptHint: '오늘 할 일 체크리스트 정리해주고 노션 앱 열어줘',
  },
  {
    id: 'clock_alarm',
    icon: '⏰',
    name: '시계 · 알람 · 타이머 앱',
    category: '생산성·기기',
    description: '기상 알람 및 집중 뽀모도로 타이머 설정을 위한 시계 앱 실행',
    promptHint: '내일 아침 7시 알람 맞추게 시계 앱 열어줘',
  },
  {
    id: 'camera_gallery',
    icon: '📷',
    name: '카메라 · 갤러리 · 사진 앱',
    category: '생산성·기기',
    description: '문서 스캔 및 사진 확인을 위해 갤러리·구글 포토 앱 즉시 열기',
    promptHint: '방금 찍은 사진 보게 갤러리 앱 열어줘',
  },
  {
    id: 'translator_app',
    icon: '🈯',
    name: '파파고 · 구글 번역기 앱',
    category: '정보·검색',
    description: '문장 즉시 번역 및 네이버 파파고·구글 번역 앱 바로 연결',
    promptHint: '이 문장 자연스러운 영어로 번역하고 파파고 앱 열어줘',
  },
  {
    id: 'hospital_pharmacy',
    icon: '🏥',
    name: '근처 병원 · 야간 약국 · 응급실',
    category: '지도·교통·여행',
    description: '내 주변 진료 중인 병원·약국 위치 검색 및 지도 앱 즉시 연결',
    promptHint: '내 근처 지금 문 연 약국 찾아줘',
  },
  {
    id: 'parking_gas',
    icon: '🅿️',
    name: '모두의주차장 · 오피넷 주유소',
    category: '지도·교통·여행',
    description: '주변 공영주차장 및 최저가 주유소·전기차 충전소 앱 연결',
    promptHint: '근처 공영주차장 찾을 수 있게 주차장 앱 열어줘',
  },
  {
    id: 'hotel_travel',
    icon: '🏨',
    name: '야놀자 · 여기어때 숙소 예약',
    category: '지도·교통·여행',
    description: '국내외 호텔·펜션·항공권 검색을 위해 야놀자·여기어때 앱 실행',
    promptHint: '부산 해운대 호텔 찾게 야놀자 앱 열어줘',
  },
  {
    id: 'books_reading',
    icon: '📚',
    name: '교보문고 · 밀리의서재 도서',
    category: '정보·검색',
    description: '책 추천 및 베스트셀러 검색을 위해 교보문고·밀리의서재 앱 실행',
    promptHint: 'AI 트렌드 책 추천해주고 교보문고 앱 열어줘',
  },
  {
    id: 'device_settings',
    icon: '⚙️',
    name: '갤럭시 기기 설정 (Wi-Fi·배터리)',
    category: '생산성·기기',
    description: 'Wi-Fi, 블루투스, 배터리 최적화 해제를 위해 시스템 설정 화면 즉시 오픈',
    promptHint: '배터리 제한 해제하게 갤럭시 설정 화면 열어줘',
  },
];

export interface PluginActionLink {
  label: string;
  url: string;
  fallbackUrl?: string;
}

const MEMORY_FILE = `${RNFS.DocumentDirectoryPath}/pocketmind_long_memory.json`;

export async function loadLongMemories(): Promise<string[]> {
  try {
    const exists = await RNFS.exists(MEMORY_FILE);
    if (!exists) return [];
    const raw = await RNFS.readFile(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLongMemory(item: string): Promise<string[]> {
  const list = await loadLongMemories();
  const next = [item.trim(), ...list.filter((x) => x !== item.trim())].slice(0, 30);
  await RNFS.writeFile(MEMORY_FILE, JSON.stringify(next), 'utf8');
  return next;
}

export interface PluginExecutionResult {
  usedPlugins: string[];
  contextBlock: string;
  actionLinks: PluginActionLink[];
}

export async function runActivePlugins(
  userQuery: string,
  enabledPluginIds: string[],
): Promise<PluginExecutionResult> {
  const usedPlugins: string[] = [];
  const notes: string[] = [];
  const actionLinks: PluginActionLink[] = [];
  const q = userQuery.trim();

  // 1. 장기 기억
  if (enabledPluginIds.includes('long_memory')) {
    if (q.includes('기억해') || q.includes('메모해')) {
      const cleaned = q.replace(/^(기억해|메모해)[:\s]*/i, '').trim();
      if (cleaned) {
        await saveLongMemory(cleaned);
        usedPlugins.push('🧠 장기 기억 저장');
        notes.push(`[신규 기억 저장 완료]: ${cleaned}`);
      }
    }
    const memories = await loadLongMemories();
    if (memories.length > 0) {
      usedPlugins.push('🧠 장기 기억');
      notes.push(`[사용자 장기 기억]:\n- ${memories.slice(0, 8).join('\n- ')}`);
    }
  }

  // 2. 실시간 날씨 (Open-Meteo 무료 API)
  if (
    enabledPluginIds.includes('weather_live') &&
    /(날씨|기온|비\s*오|미세먼지|우산|더워|추워)/.test(q)
  ) {
    try {
      const cities: Record<string, { lat: number; lon: number; label: string }> = {
        청주: { lat: 36.6424, lon: 127.489, label: '청주' },
        서울: { lat: 37.5665, lon: 126.978, label: '서울' },
        부산: { lat: 35.1796, lon: 129.0756, label: '부산' },
        대전: { lat: 36.3504, lon: 127.3845, label: '대전' },
        대구: { lat: 35.8714, lon: 128.6014, label: '대구' },
        인천: { lat: 37.4563, lon: 126.7052, label: '인천' },
        제주: { lat: 33.4996, lon: 126.5312, label: '제주' },
      };
      const foundKey = Object.keys(cities).find((k) => q.includes(k)) || '청주';
      const target = cities[foundKey];
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${target.lat}&longitude=${target.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m&timezone=Asia%2FSeoul`,
      );
      if (res.ok) {
        const data = await res.json();
        const cur = data.current;
        usedPlugins.push('🌤️ 실시간 날씨');
        notes.push(
          `[실시간 ${target.label} 날씨]: 기온 ${cur.temperature_2m}°C (체감 ${cur.apparent_temperature}°C), 습도 ${cur.relative_humidity_2m}%, 강수량 ${cur.precipitation}mm, 풍속 ${cur.wind_speed_10m}km/h`,
        );
      }
    } catch {
      // 오프라인 무시
    }
  }

  // 3. 실시간 환율
  if (
    enabledPluginIds.includes('finance_calc') &&
    /(환율|달러|엔화|유로|계산|원화|USD|JPY|EUR)/i.test(q)
  ) {
    try {
      const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW,JPY,EUR');
      if (res.ok) {
        const fx = await res.json();
        usedPlugins.push('💱 실시간 환율');
        notes.push(
          `[실시간 기준 환율 (${fx.date})]: 1 USD = ${fx.rates?.KRW} KRW, 1 EUR = ${(
            fx.rates?.KRW / fx.rates?.EUR
          ).toFixed(2)} KRW`,
        );
      }
    } catch {
      // 오프라인 무시
    }
  }

  // 4. 실시간 웹·백과 검색
  if (
    enabledPluginIds.includes('web_search') &&
    /(검색|찾아줘|알려줘|뉴스|누구|무엇|뜻이|동향)/.test(q)
  ) {
    try {
      const keyword = q
        .replace(/(검색해줘|찾아줘|알려줘|최신|뉴스|동향|에 대해)/g, '')
        .trim()
        .slice(0, 40);
      if (keyword.length >= 2) {
        const wikiRes = await fetch(
          `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
            keyword,
          )}&format=json&origin=*&srlimit=2`,
        );
        if (wikiRes.ok) {
          const wData = await wikiRes.json();
          const hits = wData?.query?.search || [];
          if (hits.length > 0) {
            const summary = hits
              .map(
                (h: any) =>
                  `• ${h.title}: ${String(h.snippet || '').replace(/<[^>]+>/g, '')}`,
              )
              .join('\n');
            usedPlugins.push('🌐 웹·백과 검색');
            notes.push(`[검색 요약]:\n${summary}`);
          }
        }
        actionLinks.push({
          label: `🌐 네이버에서 "${keyword}" 검색`,
          url: `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`,
        });
      }
    } catch {
      // 오프라인 무시
    }
  }

  // 5. KTX/SRT 열차 앱
  if (enabledPluginIds.includes('transit_ktx') && /(KTX|SRT|코레일|기차|열차)/i.test(q)) {
    usedPlugins.push('🚄 코레일·SRT 앱');
    actionLinks.push(
      {
        label: '🚄 코레일톡(KTX) 열차 예매',
        url: 'korailtalk://',
        fallbackUrl: 'https://www.letskorail.com/',
      },
      {
        label: '🚄 SRT 고속열차 예매',
        url: 'srail://',
        fallbackUrl: 'https://etk.srail.kr/',
      },
    );
  }

  // 6. 네이버쇼핑 · 쿠팡 앱
  if (
    enabledPluginIds.includes('shopping_deal') &&
    /(최저가|쇼핑|쿠팡|구매|가격|사려고)/.test(q)
  ) {
    const item = q.replace(/(최저가|찾아줘|알려줘|쿠팡|네이버|에서|구매)/g, '').trim() || q;
    usedPlugins.push('🛒 쿠팡·네이버쇼핑 앱');
    actionLinks.push(
      {
        label: `🚀 쿠팡 앱에서 "${item}" 열기`,
        url: `coupang://search?q=${encodeURIComponent(item)}`,
        fallbackUrl: `https://www.coupang.com/np/search?q=${encodeURIComponent(item)}`,
      },
      {
        label: `🟢 네이버쇼핑 "${item}" 비교`,
        url: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(item)}`,
      },
    );
  }

  // 7. 전화 · 문자 앱
  if (enabledPluginIds.includes('phone_sms') && /(전화|통화|문자|연락)/.test(q)) {
    const phoneMatch = q.match(/01[0-9]-?\d{3,4}-?\d{4}/);
    usedPlugins.push('📞 전화·문자 앱');
    if (phoneMatch) {
      const digits = phoneMatch[0].replace(/-/g, '');
      actionLinks.push(
        { label: `📞 ${phoneMatch[0]} 전화 걸기`, url: `tel:${digits}` },
        { label: `💬 ${phoneMatch[0]} 문자 보내기`, url: `sms:${digits}` },
      );
    } else {
      actionLinks.push({ label: '📞 전화 다이얼 앱 열기', url: 'tel:' });
    }
  }

  // 8. 캘린더 앱
  if (enabledPluginIds.includes('calendar_schedule') && /(일정|캘린더|약속|회의|미팅)/.test(q)) {
    usedPlugins.push('📅 캘린더 앱');
    actionLinks.push({
      label: '📅 구글 캘린더 일정 등록 열기',
      url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
        q.slice(0, 40),
      )}`,
    });
  }

  // 9. 유튜브 앱
  if (enabledPluginIds.includes('youtube_summary') && /(유튜브|영상|동영상)/i.test(q)) {
    const kw = q.replace(/(유튜브|에서|영상|동영상|찾아줘|요약)/g, '').trim() || q;
    usedPlugins.push('🎬 유튜브 앱');
    actionLinks.push({
      label: `▶️ 유튜브 앱에서 "${kw}" 보기`,
      url: `youtube://www.youtube.com/results?search_query=${encodeURIComponent(kw)}`,
      fallbackUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(kw)}`,
    });
  }

  // 11. 카카오톡 앱
  if (enabledPluginIds.includes('kakaotalk_app') && /(카톡|카카오톡)/.test(q)) {
    usedPlugins.push('💬 카카오톡 앱');
    actionLinks.push({
      label: '💬 카카오톡 앱 바로 열기',
      url: 'kakaotalk://',
      fallbackUrl: 'https://www.kakaocorp.com/page/service/service/KakaoTalk',
    });
  }

  // 12. 카카오맵 · 티맵 내비
  if (
    enabledPluginIds.includes('kakaomap_tmap') &&
    /(카카오맵|티맵|내비|길찾기|가는\s*길|가는\s*법)/.test(q)
  ) {
    const dest = q.replace(/(카카오맵|티맵|내비|으로|로|가는\s*길|가는\s*법|찾아줘)/g, '').trim() || q;
    usedPlugins.push('🗺️ 카카오맵·티맵 앱');
    actionLinks.push(
      {
        label: `🗺️ 카카오맵 "${dest}" 길찾기`,
        url: `kakaomap://search?q=${encodeURIComponent(dest)}`,
        fallbackUrl: `https://map.kakao.com/link/search/${encodeURIComponent(dest)}`,
      },
      {
        label: `🧭 티맵(TMAP) "${dest}" 안내`,
        url: `tmap://search?name=${encodeURIComponent(dest)}`,
        fallbackUrl: `https://map.naver.com/p/search/${encodeURIComponent(dest)}`,
      },
    );
  }

  // 13. 카카오 T 택시
  if (enabledPluginIds.includes('kakaot_taxi') && /(택시|카카오\s*t|카카오택시|대리운전)/i.test(q)) {
    usedPlugins.push('🚕 카카오 T 앱');
    actionLinks.push({
      label: '🚕 카카오 T 호출 앱 열기',
      url: 'kakaot://',
      fallbackUrl: 'https://www.kakaomobility.com/',
    });
  }

  // 14. 배달의민족 · 쿠팡이츠
  if (enabledPluginIds.includes('delivery_food') && /(배민|배달|쿠팡이츠|야식|치킨|피자)/.test(q)) {
    usedPlugins.push('🛵 배달앱 연동');
    actionLinks.push(
      {
        label: '🛵 배달의민족 앱 열기',
        url: 'baemin://',
        fallbackUrl: 'https://www.baemin.com/',
      },
      {
        label: '🍔 쿠팡이츠 앱 열기',
        url: 'coupangeats://',
        fallbackUrl: 'https://www.coupangeats.com/',
      },
    );
  }

  // 15. 스타벅스 · 메가커피
  if (enabledPluginIds.includes('cafe_order') && /(스타벅스|스벅|사이렌오더|메가커피|커피)/.test(q)) {
    usedPlugins.push('☕ 카페 오더 앱');
    actionLinks.push({
      label: '☕ 스타벅스 앱 열기',
      url: 'starbucks://',
      fallbackUrl: 'https://www.starbucks.co.kr/',
    });
  }

  // 16. 멜론 · 유튜브뮤직 · 스포티파이
  if (
    enabledPluginIds.includes('music_player') &&
    /(멜론|유튜브\s*뮤직|유튜브뮤직|스포티파이|음악|노래|플레이리스트)/.test(q)
  ) {
    usedPlugins.push('🎵 음악 스트리밍 앱');
    actionLinks.push(
      {
        label: '🎶 유튜브 뮤직 열기',
        url: 'youtubemusic://',
        fallbackUrl: 'https://music.youtube.com/',
      },
      {
        label: '💚 멜론(Melon) 앱 열기',
        url: 'melonapp://',
        fallbackUrl: 'https://www.melon.com/',
      },
      {
        label: '🎧 스포티파이 앱 열기',
        url: 'spotify://',
        fallbackUrl: 'https://open.spotify.com/',
      },
    );
  }

  // 17. 넷플릭스 · 티빙 · 쿠팡플레이
  if (
    enabledPluginIds.includes('ott_streaming') &&
    /(넷플릭스|티빙|쿠팡플레이|디즈니|드라마|OTT)/i.test(q)
  ) {
    usedPlugins.push('📺 OTT 스트리밍 앱');
    actionLinks.push(
      {
        label: '🎬 넷플릭스 앱 열기',
        url: 'nflx://',
        fallbackUrl: 'https://www.netflix.com/kr/',
      },
      {
        label: '📺 티빙(TVING) 열기',
        url: 'tving://',
        fallbackUrl: 'https://www.tving.com/',
      },
    );
  }

  // 18. CGV · 롯데시네마 · 메가박스
  if (
    enabledPluginIds.includes('movie_ticket') &&
    /(CGV|롯데시네마|메가박스|영화\s*예매|영화관)/i.test(q)
  ) {
    usedPlugins.push('🍿 영화 예매 앱');
    actionLinks.push(
      { label: '🍿 CGV 앱 열기', url: 'cgv://', fallbackUrl: 'https://www.cgv.co.kr/' },
      {
        label: '🎟️ 롯데시네마 열기',
        url: 'lottecinema://',
        fallbackUrl: 'https://www.lottecinema.co.kr/',
      },
      {
        label: '🎥 메가박스 열기',
        url: 'megabox://',
        fallbackUrl: 'https://www.megabox.co.kr/',
      },
    );
  }

  // 19. 토스 · 카카오뱅크
  if (enabledPluginIds.includes('bank_toss') && /(토스|카카오뱅크|송금|이체|계좌)/.test(q)) {
    usedPlugins.push('🏦 토스·카뱅 앱');
    actionLinks.push(
      { label: '💙 토스(Toss) 앱 열기', url: 'supertoss://', fallbackUrl: 'https://toss.im/' },
      {
        label: '💛 카카오뱅크 앱 열기',
        url: 'kakaobank://',
        fallbackUrl: 'https://www.kakaobank.com/',
      },
    );
  }

  // 20. 네이버페이 · 삼성페이
  if (enabledPluginIds.includes('pay_wallet') && /(네이버페이|삼성페이|삼성월렛|포인트|결제)/.test(q)) {
    usedPlugins.push('💳 간편결제 앱');
    actionLinks.push({
      label: '🟢 네이버페이 앱 열기',
      url: 'naversearchapp://',
      fallbackUrl: 'https://new-m.pay.naver.com/',
    });
  }

  // 21. 지메일 · 네이버 메일
  if (enabledPluginIds.includes('email_sender') && /(이메일|메일|지메일|gmail)/i.test(q)) {
    usedPlugins.push('📧 이메일 앱');
    actionLinks.push(
      {
        label: '✉️ 지메일(Gmail) 앱 열기',
        url: 'googlegmail://',
        fallbackUrl: 'https://mail.google.com/',
      },
      {
        label: '🟢 네이버 메일 열기',
        url: 'https://mail.naver.com/',
      },
    );
  }

  // 22. 노션 · 삼성 노트
  if (enabledPluginIds.includes('notes_notion') && /(노션|notion|삼성노트|노트|체크리스트)/i.test(q)) {
    usedPlugins.push('📝 노션·노트 앱');
    actionLinks.push({
      label: '⬛ 노션(Notion) 앱 열기',
      url: 'notion://',
      fallbackUrl: 'https://www.notion.so/',
    });
  }

  // 23. 알람 · 타이머
  if (enabledPluginIds.includes('clock_alarm') && /(알람|타이머|스톱워치|시계)/.test(q)) {
    usedPlugins.push('⏰ 시계·알람 앱');
    actionLinks.push({
      label: '⏰ 시계 및 알람 앱 열기',
      url: 'clock-app://',
      fallbackUrl: 'https://time.is/Seoul',
    });
  }

  // 24. 카메라 · 갤러리
  if (enabledPluginIds.includes('camera_gallery') && /(카메라|갤러리|사진|포토|QR)/i.test(q)) {
    usedPlugins.push('📷 갤러리·포토 앱');
    actionLinks.push({
      label: '🖼️ 구글 포토 / 갤러리 열기',
      url: 'googlephotos://',
      fallbackUrl: 'https://photos.google.com/',
    });
  }

  // 25. 파파고 · 구글 번역기
  if (enabledPluginIds.includes('translator_app') && /(번역|파파고|영어로|일본어로|중국어로)/.test(q)) {
    usedPlugins.push('🈯 번역기 앱');
    actionLinks.push(
      {
        label: '🦜 네이버 파파고 앱 열기',
        url: 'papago://',
        fallbackUrl: 'https://papago.naver.com/',
      },
      {
        label: '🌐 구글 번역 열기',
        url: `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(q)}`,
      },
    );
  }

  // 26. 근처 병원 · 약국
  if (enabledPluginIds.includes('hospital_pharmacy') && /(병원|약국|응급실|내과|치과|이비인후과)/.test(q)) {
    usedPlugins.push('🏥 병원·약국 검색');
    actionLinks.push({
      label: '🏥 카카오맵에서 근처 병원·약국 찾기',
      url: 'kakaomap://search?q=%EC%95%BD%EA%B5%AD',
      fallbackUrl: 'https://map.kakao.com/link/search/약국',
    });
  }

  // 27. 주차장 · 주유소
  if (enabledPluginIds.includes('parking_gas') && /(주차장|주유소|충전소|주차)/.test(q)) {
    usedPlugins.push('🅿️ 주차·주유 앱');
    actionLinks.push({
      label: '🅿️ 카카오맵 근처 주차장 보기',
      url: 'kakaomap://search?q=%EC%A3%BC%EC%B0%A8%EC%9E%A5',
      fallbackUrl: 'https://map.kakao.com/link/search/주차장',
    });
  }

  // 28. 야놀자 · 여기어때
  if (enabledPluginIds.includes('hotel_travel') && /(야놀자|여기어때|호텔|숙소|펜션|모텔|여행)/.test(q)) {
    usedPlugins.push('🏨 숙소 예약 앱');
    actionLinks.push(
      { label: '🩷 야놀자 앱 열기', url: 'yanolja://', fallbackUrl: 'https://www.yanolja.com/' },
      {
        label: '❤️ 여기어때 앱 열기',
        url: 'goodchoice://',
        fallbackUrl: 'https://www.yeogi.com/',
      },
    );
  }

  // 29. 교보문고 · 밀리의서재
  if (enabledPluginIds.includes('books_reading') && /(교보문고|밀리의서재|도서|책\s*추천|베스트셀러)/.test(q)) {
    usedPlugins.push('📚 도서·독서 앱');
    actionLinks.push(
      {
        label: '📘 교보문고 앱 열기',
        url: 'kyobobook://',
        fallbackUrl: 'https://www.kyobobook.co.kr/',
      },
      {
        label: '📙 밀리의서재 앱 열기',
        url: 'millie://',
        fallbackUrl: 'https://www.millie.co.kr/',
      },
    );
  }

  // 30. 갤럭시 기기 설정
  if (enabledPluginIds.includes('device_settings') && /(설정|와이파이|Wi-Fi|블루투스|배터리)/i.test(q)) {
    usedPlugins.push('⚙️ 기기 설정');
    actionLinks.push({
      label: '⚙️ 스마트폰·태블릿 설정 화면 열기',
      url: 'app-settings:',
    });
  }

  return {
    usedPlugins,
    contextBlock:
      notes.length > 0 ? `\n\n[활성화된 앱 플러그인 실시간 데이터]\n${notes.join('\n')}` : '',
    actionLinks,
  };
}

export async function openPluginActionUrl(url: string, fallbackUrl?: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // 딥링크 실패 시 fallback으로 이동
  }
  if (fallbackUrl) {
    try {
      await Linking.openURL(fallbackUrl);
    } catch {
      // 무시
    }
  } else {
    try {
      await Linking.openURL(url);
    } catch {
      // 무시
    }
  }
}

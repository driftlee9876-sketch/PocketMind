import { Linking } from 'react-native';
import RNFS from 'react-native-fs';

export type ModelTier = 'ultra-light' | 'light' | 'mid' | 'high';

export interface AIModelSpec {
  id: string;
  name: string;
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
    tier: 'light',
    tierLabel: '경량',
    paramB: 3,
    sizeLabel: '2.10 GB',
    recommendedDevices: '갤탭 S7 FE (6GB) · 아이폰 16 Pro · LG 그램',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    nCtx: 3072,
    description: '일상 대화, 요약, 플러그인 도구 호출을 매끄럽게 소화하는 표준 모델',
  },
  {
    id: 'exaone-3.5-7.8b',
    name: 'LG EXAONE 3.5 7.8B (한국어 최강)',
    tier: 'mid',
    tierLabel: '중고사양',
    paramB: 7.8,
    sizeLabel: '4.77 GB',
    recommendedDevices: '아이폰 16 Pro · LG 그램(16GB) · RTX 3060',
    filename: 'EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/EXAONE-3.5-7.8B-Instruct-GGUF/resolve/main/EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf',
    nCtx: 4096,
    description: '한국어 문맥, 문서 작성, 국내 생활 비서 업무에 압도적인 성능을 발휘',
  },
  {
    id: 'qwen2.5-7b',
    name: 'Qwen 2.5 7B (코딩·범용 고성능)',
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

export interface PicklePlugin {
  id: string;
  icon: string;
  name: string;
  category: '기본 즉시 실행' | '생활·교통·쇼핑' | '업무·기억';
  description: string;
  promptHint: string;
}

export const PICKLE_PLUGINS: PicklePlugin[] = [
  {
    id: 'web_search',
    icon: '🌐',
    name: '실시간 웹·지식 검색',
    category: '기본 즉시 실행',
    description: '위키백과 및 웹 검색 결과를 실시간으로 가져와 최신 정보 기반 답변 생성',
    promptHint: '청주 날씨 말고 최신 AI 뉴스 검색해줘',
  },
  {
    id: 'weather_live',
    icon: '🌤️',
    name: '실시간 날씨·기온 예보',
    category: '기본 즉시 실행',
    description: 'API 키 없이 현재 기온, 체감온도, 강수확률과 옷차림 추천',
    promptHint: '오늘 청주랑 서울 날씨 어때?',
  },
  {
    id: 'transit_ktx',
    icon: '🚄',
    name: '길찾기 · KTX/SRT 열차',
    category: '생활·교통·쇼핑',
    description: '네이버 지도 대중교통 길찾기 및 코레일(KTX)·SRT 예매 화면 즉시 실행',
    promptHint: '오송역에서 서울역 가는 KTX 열차 조회해줘',
  },
  {
    id: 'shopping_deal',
    icon: '🛒',
    name: '네이버·쿠팡 최저가 쇼핑',
    category: '생활·교통·쇼핑',
    description: '상품 검색 시 네이버쇼핑 가격비교 및 쿠팡 로켓배송 검색 링크 즉시 생성',
    promptHint: '갤럭시 탭 S7 FE 블루투스 키보드 최저가 찾아줘',
  },
  {
    id: 'phone_sms',
    icon: '📞',
    name: '전화 걸기 · 문자/메시지',
    category: '생활·교통·쇼핑',
    description: '전화번호 인식 후 기기 전화 앱 연결 및 정중한 문자·안부 초안 작성',
    promptHint: '010-1234-5678로 내일 2시 미팅 확인 문자 보내줘',
  },
  {
    id: 'calendar_schedule',
    icon: '📅',
    name: '일정 조율 · 캘린더 등록',
    category: '업무·기억',
    description: '구글 캘린더 일정 등록 링크 생성 및 약속 시간 조율 메시지 작성',
    promptHint: '내일 오후 3시 프로젝트 회의 캘린더에 등록해줘',
  },
  {
    id: 'finance_calc',
    icon: '💱',
    name: '실시간 환율 · 스마트 계산기',
    category: '기본 즉시 실행',
    description: '달러/엔화/유로 실시간 원화 환율 계산 및 복잡한 수식 정밀 연산',
    promptHint: '지금 150달러가 한국 돈으로 얼마야?',
  },
  {
    id: 'youtube_summary',
    icon: '🎬',
    name: '유튜브 검색 · 영상 핵심 요약',
    category: '업무·기억',
    description: '유튜브 영상 검색 링크 및 붙여넣은 스크립트·자막 3줄 핵심 요약',
    promptHint: '유튜브에서 로컬 LLM 분산 추론 영상 찾아줘',
  },
  {
    id: 'doc_writer',
    icon: '📄',
    name: '보고서 · 이메일 · 문서 생성',
    category: '업무·기억',
    description: '기획안, 이메일, 회의록, CSV 표 데이터를 즉시 복사 가능한 문서로 작성',
    promptHint: 'GPU 공유 앱 소개 기획서 초안 써줘',
  },
  {
    id: 'long_memory',
    icon: '🧠',
    name: '장기 개인화 기억 (Memory)',
    category: '업무·기억',
    description: '내 기기 목록, 선호 모델, 주요 메모를 기기에 영구 저장해 매 대화에 반영',
    promptHint: '기억해: 내 메인 노트북은 RTX 3060 랩탑이고 탭은 S7 FE야',
  },
];

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
  actionLinks: { label: string; url: string }[];
}

export async function runActivePlugins(
  userQuery: string,
  enabledPluginIds: string[],
): Promise<PluginExecutionResult> {
  const usedPlugins: string[] = [];
  const notes: string[] = [];
  const actionLinks: { label: string; url: string }[] = [];
  const q = userQuery.trim();

  // 1. 장기 기억 저장 및 불러오기
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
      usedPlugins.push('🧠 장기 기억 참조');
      notes.push(`[사용자 장기 기억 목록]:\n- ${memories.slice(0, 8).join('\n- ')}`);
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
          `[실시간 ${target.label} 날씨]: 현재 기온 ${cur.temperature_2m}°C (체감 ${cur.apparent_temperature}°C), 습도 ${cur.relative_humidity_2m}%, 강수량 ${cur.precipitation}mm, 풍속 ${cur.wind_speed_10m}km/h`,
        );
      }
    } catch {
      // 오프라인 시 무시
    }
  }

  // 3. 실시간 환율 및 스마트 계산기
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
      // 오프라인 시 무시
    }
  }

  // 4. 실시간 웹·백과 검색
  if (
    enabledPluginIds.includes('web_search') &&
    /(검색|찾아줘|알려줘|뉴스|누구|무엇|뜻이)/.test(q)
  ) {
    try {
      const keyword = q
        .replace(/(검색해줘|찾아줘|알려줘|최신|뉴스|에 대해)/g, '')
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
            notes.push(`[검색 요약 결과]:\n${summary}`);
          }
        }
        actionLinks.push({
          label: `🌐 네이버에서 "${keyword}" 검색 열기`,
          url: `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`,
        });
      }
    } catch {
      // 오프라인 시 무시
    }
  }

  // 5. 길찾기 · KTX/SRT 열차
  if (
    enabledPluginIds.includes('transit_ktx') &&
    /(길찾기|가는\s*법|KTX|SRT|기차|열차|역에서|버스|지하철)/i.test(q)
  ) {
    usedPlugins.push('🚄 길찾기·열차 연동');
    actionLinks.push({
      label: '🗺️ 네이버 지도 길찾기 열기',
      url: `https://map.naver.com/p/search/${encodeURIComponent(q)}`,
    });
    if (/KTX|코레일|기차|열차/i.test(q)) {
      actionLinks.push({
        label: '🚄 코레일(KTX) 예매 바로가기',
        url: 'https://www.letskorail.com/',
      });
    }
    if (/SRT/i.test(q)) {
      actionLinks.push({
        label: '🚄 SRT 수서고속철도 예매 바로가기',
        url: 'https://etk.srail.kr/',
      });
    }
  }

  // 6. 네이버·쿠팡 최저가 쇼핑
  if (
    enabledPluginIds.includes('shopping_deal') &&
    /(최저가|쇼핑|쿠팡|구매|가격|추천해줘|사려고)/.test(q)
  ) {
    const item = q.replace(/(최저가|찾아줘|알려줘|쿠팡|네이버|구매)/g, '').trim() || q;
    usedPlugins.push('🛒 최저가 쇼핑 연동');
    actionLinks.push(
      {
        label: `🟢 네이버쇼핑 "${item}" 최저가 비교`,
        url: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(item)}`,
      },
      {
        label: `🚀 쿠팡 "${item}" 로켓배송 검색`,
        url: `https://www.coupang.com/np/search?q=${encodeURIComponent(item)}`,
      },
    );
  }

  // 7. 전화 걸기 · 문자 발신
  if (
    enabledPluginIds.includes('phone_sms') &&
    /(전화|통화|문자|메시지|연락)/.test(q)
  ) {
    const phoneMatch = q.match(/01[0-9]-?\d{3,4}-?\d{4}/);
    usedPlugins.push('📞 전화·문자 대행');
    if (phoneMatch) {
      const digits = phoneMatch[0].replace(/-/g, '');
      actionLinks.push(
        { label: `📞 ${phoneMatch[0]} 바로 전화 걸기`, url: `tel:${digits}` },
        { label: `💬 ${phoneMatch[0]} 문자 앱 열기`, url: `sms:${digits}` },
      );
    }
  }

  // 8. 캘린더 일정 등록
  if (
    enabledPluginIds.includes('calendar_schedule') &&
    /(일정|캘린더|약속|회의|미팅|예약)/.test(q)
  ) {
    usedPlugins.push('📅 캘린더 일정 연동');
    actionLinks.push({
      label: '📅 구글 캘린더에 새 일정 바로 추가',
      url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
        q.slice(0, 40),
      )}`,
    });
  }

  // 9. 유튜브 검색
  if (enabledPluginIds.includes('youtube_summary') && /(유튜브|영상|동영상)/i.test(q)) {
    const ytKeyword = q.replace(/(유튜브|에서|영상|동영상|찾아줘|요약)/g, '').trim() || q;
    usedPlugins.push('🎬 유튜브 연동');
    actionLinks.push({
      label: `▶️ 유튜브 "${ytKeyword}" 검색 열기`,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(ytKeyword)}`,
    });
  }

  return {
    usedPlugins,
    contextBlock: notes.length > 0 ? `\n\n[활성화된 피클 플러그인 실시간 데이터]\n${notes.join('\n')}` : '',
    actionLinks,
  };
}

export async function openPluginActionUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // 지원하지 않는 스킴 무시
  }
}

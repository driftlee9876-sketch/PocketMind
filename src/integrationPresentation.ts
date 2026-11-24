import type { IntegrationActionResult } from './integrationActions';

function plain(value: unknown, limit = 260): string {
  return typeof value === 'string' ? value.replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function dateLabel(value: unknown) {
  const text = plain(value);
  if (!text) return '';
  const date = new Date(text);
  return isNaN(date.getTime()) ? text : date.toLocaleDateString('ko-KR', {month: 'long', day: 'numeric'});
}

function row(item: any, i: number) {
  if (!item || typeof item !== 'object') return plain(item);
  const headers = Object.fromEntries((Array.isArray(item.payload?.headers) ? item.payload.headers : [])
    .map((h: any) => [String(h?.name).toLowerCase(), h?.value]));
  const title = plain(item.subject || headers.subject || item.name || item.title || item.summary || item.snippet?.title || item.displayName) || '(제목 없음)';
  const sender = plain(item.from?.emailAddress?.name || item.from || headers.from || item.snippet?.channelTitle);
  const date = dateLabel(item.date || headers.date || item.modifiedTime || item.receivedDateTime || item.start?.dateTime || item.start?.date);
  const detail = plain(item.snippet?.description || item.snippet || item.bodyPreview || item.description);
  return [`${i + 1}. ${title}`, [sender, date].filter(Boolean).join(' · '), detail].filter(Boolean).join('\n');
}

export function integrationReply(reply: IntegrationActionResult) {
  if (reply.status !== 'completed') return reply.lastError || ({
    queued: '작업을 접수했어요.', rejected: '작업을 취소했어요.', not_configured: '연결 앱에서 이 서비스를 연결해 주세요.',
    failed: '작업을 실행하지 못했어요.', awaiting_approval: '승인을 기다리고 있어요.',
  }[reply.status] || '작업 상태를 확인해 주세요.');
  const raw = reply.result || '';
  let value;
  try { value = JSON.parse(raw); } catch { return /^[\s]*[\[{]/.test(raw) ? '결과가 너무 길어 표시할 수 없어요. 검색 범위를 좁혀 주세요.' : plain(raw, 1600) || '작업을 마쳤어요.'; }
  const rows = Array.isArray(value) ? value : [value?.files, value?.items, value?.value, value?.connections].find(Array.isArray);
  if (rows) return rows.length ? [`조회 결과 ${rows.length}개`, ...rows.slice(0, 20).map(row)].join('\n\n') : '조건에 맞는 결과가 없어요.';
  if (reply.action === 'read_content' && value?.text) return [value.name, value.text, value.truncated ? '(발췌)' : ''].filter(Boolean).join('\n');
  if (value?.subject || value?.name || value?.snippet || value?.payload?.headers || value?.summary || value?.title) return row(value, 0);
  return plain(value?.message || value?.text || value) || (reply.risk === 'read' ? '조회가 끝났어요. 표시할 내용이 없어요.' : '요청한 작업을 마쳤어요.');
}

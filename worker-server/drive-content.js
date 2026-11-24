'use strict';

const maxBytes = 12 * 1024 * 1024;
const maxChars = 12000;

async function limitedBytes(response) {
  if (!response.ok) throw Error('Drive에서 파일을 열 수 없어요. 파일 권한을 확인하세요.');
  if (Number(response.headers.get('content-length')) > maxBytes) {await response.body?.cancel(); throw Error('12 MB 이하의 파일을 선택하세요.');}
  const chunks = [];
  let total = 0;
  for await (const bytes of response.body) {
    total += bytes.length;
    if (total > maxBytes) throw Error('12 MB 이하의 파일을 선택하세요.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readDriveContent(meta, token) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(meta.id);
  const doc = meta.mimeType === 'application/vnd.google-apps.document';
  const pdf = meta.mimeType === 'application/pdf';
  if (!doc && !pdf && !String(meta.mimeType).startsWith('text/')) throw Error('Google 문서, 텍스트 또는 PDF를 선택하세요.');
  const response = await fetch(url + (doc ? '/export?mimeType=text%2Fplain' : '?alt=media'), {
    headers:{Authorization:'Bearer ' + token}, redirect:'error', signal:AbortSignal.timeout(25000),
  });
  const bytes = await limitedBytes(response);
  let text = '', truncated = false;
  if (pdf) {
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const file = await getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false}).promise;
    try {
      for (let i=1; i<=Math.min(file.numPages, 80); i++) {
        const page = await file.getPage(i);
        const content = await page.getTextContent();
        const result = content.items.map(item => item.str || '').join(' ').trim();
        page.cleanup();
        if (result) text += '\n[' + i + '쪽] ' + result;
        if (text.length >= maxChars) {truncated = true; break;}
      }
      truncated ||= file.numPages > 80;
    } finally {await file.destroy();}
  } else text = bytes.toString('utf8');
  if (!text.trim()) throw Error('추출 가능한 본문이 없어요. 스캔 PDF에는 텍스트 인식이 필요해요.');
  return {name:meta.name, text:text.trim().slice(0,maxChars), truncated:truncated || text.length>maxChars};
}
module.exports = {readDriveContent};

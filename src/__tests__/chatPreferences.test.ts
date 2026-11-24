import { defaultChatPreferences, enterSubmits, restoreChatPreferences } from '../chatPreferences';
import { sessionTitleMode, summarizeConversation } from '../chatHistory';

test('blank-line Enter sends only after a blank final line with a collapsed end selection', () => {
  const text = '설정 방법\n  ';
  expect(enterSubmits('blankLine', text, text.length, text.length)).toBe(true);
  for (const draft of ['', '\n  ', '설정 방법', '질문\n답변']) {
    expect(enterSubmits('blankLine', draft, draft.length, draft.length)).toBe(false);
  }
  expect(enterSubmits('blankLine', text, 1, 1)).toBe(false);
  expect(enterSubmits('blankLine', text, 1, text.length)).toBe(false);
  expect(enterSubmits('send', '안녕', 1, 1)).toBe(true);
  expect(enterSubmits('send', '  ', 2, 2)).toBe(false);
  expect(enterSubmits('newline', text, text.length, text.length)).toBe(false);
});

test('old or invalid preferences restore defaults and explicit choices survive a round trip', () => {
  for (const raw of ['{', 'null', '23', '{"enterMode":"other"}', null]) {
    expect(restoreChatPreferences(raw)).toEqual(defaultChatPreferences);
  }
  const custom = { enterMode: 'blankLine', largeText: true, autoScroll: false, showMetrics: false };
  expect(restoreChatPreferences(JSON.stringify(custom))).toEqual(custom);
});

test('history uses the topic of the conversation and preserves older manually renamed titles', () => {
  const messages = [
    { role: 'user' as const, text: '안녕' },
    { role: 'assistant' as const, text: '⚠️ 실행 오류' },
    { role: 'user' as const, text: '갤럭시탭\n' },
    { role: 'user' as const, text: 'Gmail 연결 알려줘' },
  ];
  expect(summarizeConversation(messages)).toBe('갤럭시탭 · Gmail 연결');
  expect(sessionTitleMode({ title: '안녕', messages })).toBe('auto');
  expect(sessionTitleMode({ title: '내 메모', messages })).toBe('custom');
  expect(summarizeConversation([])).toBe('새 채팅');
});

import {
  normalizeSessionTitle,
  prepareAnswerRegeneration,
  removeSessionById,
  replaceUserMessageAndTrim,
  renameSessionById,
} from '../chatHistory';

describe('chat history helpers', () => {
  const sessions = [
    { id: 'one', title: '첫 대화', messages: [] },
    { id: 'two', title: '둘째 대화', messages: [] },
  ];

  test('normalizes whitespace and limits titles to 80 characters', () => {
    expect(normalizeSessionTitle('  새\n  대화   제목  ')).toBe('새 대화 제목');
    expect(normalizeSessionTitle('가'.repeat(100))).toHaveLength(80);
  });

  test('renames only the selected session and rejects a blank title', () => {
    const renamed = renameSessionById(sessions, 'two', '  중요한   대화  ');
    expect(renamed[0]).toBe(sessions[0]);
    expect(renamed[1].title).toBe('중요한 대화');
    expect(renameSessionById(sessions, 'two', '   ')).toBe(sessions);
  });

  test('removes only the selected session', () => {
    expect(removeSessionById(sessions, 'one')).toEqual([sessions[1]]);
    expect(removeSessionById(sessions, 'missing')).toEqual(sessions);
  });

  test('edits a user message and removes the obsolete branch', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, text: '기존 질문' },
      { id: 'a1', role: 'assistant' as const, text: '기존 답변' },
      { id: 'u2', role: 'user' as const, text: '후속 질문' },
    ];
    expect(replaceUserMessageAndTrim(messages, 'u1', '  수정한 질문  ')).toEqual([
      { id: 'u1', role: 'user', text: '수정한 질문' },
    ]);
  });

  test('prepares regeneration from the user prompt before an answer', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, text: '질문' },
      { id: 'a1', role: 'assistant' as const, text: '답변' },
    ];
    expect(prepareAnswerRegeneration(messages, 'a1')).toEqual({
      messages: [messages[0]],
      prompt: '질문',
    });
  });
});

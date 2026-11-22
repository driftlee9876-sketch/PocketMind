import {
  normalizeSessionTitle,
  removeSessionById,
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
});

export function normalizeSessionTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

type TopicMessage = { role: 'user' | 'assistant'; text: string };

function topicPhrase(text: string): string {
  const lines = text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, ' ')
    .split(/\n+|[!?。！？]+|\.\s+/)
    .map(line => line.replace(/^[\s#>*•-]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const casual = /^(안녕(하세요)?|고마워(요)?|감사합니다|네|넵|응|ㅇㅇ|hello|hi|thanks)[\s~.]*$/i;
  const line = lines.find(part => !casual.test(part));
  if (!line) return '';
  return line.replace(/\s+(?:좀\s+)?(?:알려\s?줘|해\s?줘|부탁해)(?:요)?[.\s]*$/, '').trim() || line;
}

/** Pick a topic and, when space permits, a distinct follow-up. Keeps private chats on device. */
export function summarizeConversation(messages: TopicMessage[]): string {
  const topics = messages.filter(message => message.role === 'user').map(message => topicPhrase(message.text)).filter(Boolean);
  const first = topics[0];
  const last = topics[topics.length - 1];
  const fallback = messages.find(message => message.role === 'user')?.text || '새 채팅';
  const label = first && last !== first && first.length + last.length < 52
    ? `${first} · ${last}` : first || normalizeSessionTitle(fallback);
  const chars = Array.from(label);
  return chars.length > 52 ? chars.slice(0, 51).join('').trimEnd() + '…' : label;
}

export function sessionTitleMode(session: { title: string; titleMode?: string; messages: TopicMessage[] }): 'auto' | 'custom' {
  if (session.titleMode === 'custom' || session.titleMode === 'auto') return session.titleMode;
  const first = session.messages.find(message => message.role === 'user');
  return session.title === (first?.text.slice(0, 24) || '새 채팅') ? 'auto' : 'custom';
}

export function renameSessionById<T extends { id: string; title: string }>(
  sessions: T[],
  sessionId: string,
  title: string,
): T[] {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) return sessions;
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, title: normalizedTitle, titleMode: 'custom' } : session,
  );
}

export function removeSessionById<T extends { id: string }>(
  sessions: T[],
  sessionId: string,
): T[] {
  return sessions.filter((session) => session.id !== sessionId);
}

export function replaceUserMessageAndTrim<
  T extends { id: string; role: 'user' | 'assistant'; text: string },
>(messages: T[], messageId: string, text: string): T[] {
  const normalized = text.trim();
  const index = messages.findIndex((message) => message.id === messageId && message.role === 'user');
  if (!normalized || index < 0) return messages;
  return messages.slice(0, index + 1).map((message, messageIndex) =>
    messageIndex === index ? { ...message, text: normalized } : message,
  );
}

export function prepareAnswerRegeneration<
  T extends { id: string; role: 'user' | 'assistant'; text: string },
>(messages: T[], assistantMessageId: string): { messages: T[]; prompt: string } | null {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId && message.role === 'assistant',
  );
  if (assistantIndex < 0) return null;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return { messages: messages.slice(0, assistantIndex), prompt: messages[index].text };
    }
  }
  return null;
}

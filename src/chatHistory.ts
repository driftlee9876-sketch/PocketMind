export function normalizeSessionTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function renameSessionById<T extends { id: string; title: string }>(
  sessions: T[],
  sessionId: string,
  title: string,
): T[] {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) return sessions;
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, title: normalizedTitle } : session,
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

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

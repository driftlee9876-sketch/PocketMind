export type EnterMode = 'newline' | 'send' | 'blankLine';
export interface ChatPreferences {
  enterMode: EnterMode;
  showMetrics: boolean;
  autoScroll: boolean;
  largeText: boolean;
}

export const defaultChatPreferences: ChatPreferences = {
  enterMode: 'newline', showMetrics: false, autoScroll: true, largeText: false,
};

export function restoreChatPreferences(raw: string | null): ChatPreferences {
  let saved: Partial<ChatPreferences>;
  try { saved = raw ? JSON.parse(raw) ?? {} : {}; } catch { saved = {}; }
  return {
    enterMode: saved.enterMode === 'send' || saved.enterMode === 'blankLine' ? saved.enterMode : 'newline',
    showMetrics: saved.showMetrics === true,
    autoScroll: saved.autoScroll !== false,
    largeText: saved.largeText === true,
  };
}

export function enterSubmits(mode: EnterMode, text: string, start: number, end: number): boolean {
  if (!text.trim()) return false;
  return mode === 'send' || (mode === 'blankLine' && start === text.length && end === start && /\n[^\S\n]*$/.test(text));
}

// Each alternative owns its suffix, so following messages stay with the answer they refer to.
export type Versioned<T> = { versions?: { previous: T[][]; next: T[][] } };

function detach<T extends Versioned<T>>(messages: T[], index: number): T[] {
  const { versions: _, ...message } = messages[index];
  return [message as T, ...messages.slice(index + 1)];
}

export function forkMessage<T extends Versioned<T>>(messages: T[], index: number, replacement: T): T[] {
  if (index < 0 || index >= messages.length) return messages;
  const versions = messages[index].versions;
  const previous = [...(versions?.previous || []), detach(messages, index), ...(versions?.next || [])];
  return [...messages.slice(0, index), {...replacement, versions: {previous, next: []}}];
}

export function switchVersion<T extends Versioned<T>>(messages: T[], index: number, direction: -1 | 1): T[] {
  const versions = messages[index]?.versions;
  if (!versions) return messages;
  const {previous, next} = versions;
  const target = direction === -1 ? previous.at(-1) : next[0];
  if (!target?.length) return messages;
  const current = detach(messages, index);
  const alternatives = direction === -1
    ? {previous: previous.slice(0,-1), next: [current,...next]}
    : {previous: [...previous,current], next: next.slice(1)};
  return [...messages.slice(0,index), {...target[0], versions: alternatives}, ...target.slice(1)];
}

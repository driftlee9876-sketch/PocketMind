// Milliseconds from the current recording. Require voiced audio before accepting a pause.
export function detectTurnEnd() {
  let lastLoud = -1;
  let voicedSamples = 0;
  return (decibels: number, elapsed: number) => {
    if (decibels > -42) {
      lastLoud = elapsed;
      voicedSamples++;
    }
    if (voicedSamples >= 2 && elapsed - lastLoud >= 1200) return 'send';
    if (elapsed >= 29000) return voicedSamples >= 2 ? 'send' : 'empty';
    return 'listen';
  };
}

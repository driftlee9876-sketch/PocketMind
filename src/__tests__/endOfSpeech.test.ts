import {detectTurnEnd} from '../media/endOfSpeech';

test('sends a spoken turn after a pause and discards silence or an isolated click', () => {
  const spoken = detectTurnEnd();
  expect(spoken(-85, 1300)).toBe('listen');
  spoken(-24, 1500);
  spoken(-30, 1700);
  expect(spoken(-70, 2700)).toBe('listen');
  expect(spoken(-70, 2950)).toBe('send');
  const quiet = detectTurnEnd();
  quiet(-10, 4000);
  expect(quiet(-80, 29100)).toBe('empty');
});

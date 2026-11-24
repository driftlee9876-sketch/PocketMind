import {forkMessage,switchVersion,type Versioned} from '../chatBranches';
import {conversationContext,recentTurns} from '../chatContext';
type M=Versioned<M>&{text:string};
test('restores old follow-ups when a different reply version is selected after restart',()=>{
  const old:M[]=['question','first','follow-up'].map(text=>({text}));
  let now=forkMessage(old,1,{text:'second'});now.push({text:'new follow-up'});
  const restored=switchVersion<M>(JSON.parse(JSON.stringify(now)),1,-1);
  expect(restored.map(m=>m.text)).toEqual(['question','first','follow-up']);
  expect(switchVersion(restored,1,1).map(m=>m.text)).toEqual(['question','second','new follow-up']);
});
test('carries the selected conversation and attachment into a model follow-up',()=>{
  const h=conversationContext([{role:'user',text:'요약',attachment:{name:'a.txt',text:'참고 문장',truncated:false}},{role:'assistant',text:'요약문'}],true);
  expect(h[0].content).toContain('참고 문장');
  expect(recentTurns(h,500)).toEqual(h);expect(recentTurns(h,15)).toEqual([]);
});

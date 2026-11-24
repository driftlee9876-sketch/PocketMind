import AsyncStorage from '@react-native-async-storage/async-storage';
import {measureGpu, type WiredSession} from './wiredInference';

type Policy = 'equal'|'memory';
type Sample = {label:string; loadMs:number; firstMs:number; rate:number; split?:string};
type Report = {policy:Policy; samples:Sample[]; unavailable:string[]};
const key = (filename:string, ids:string[])=>'pocketmind.gpu.comparison.v1.'+JSON.stringify([filename,...ids]);
export async function savedComparison(filename:string,ids:string[]):Promise<Report|null> {
  const raw = await AsyncStorage.getItem(key(filename,ids));
  try {const report = raw && JSON.parse(raw); return report && ['equal','memory'].includes(report.policy) && Array.isArray(report.samples) && Array.isArray(report.unavailable) ? report : null;} catch {return null;}
}
export async function compareGpu(filename:string,ids:string[],signal:AbortSignal,
  host:(ids:string[],filename:string,policy:Policy)=>Promise<WiredSession>, stop:()=>Promise<unknown>, status:(label:string)=>void) {
  const report:Report = {policy:'memory',samples:[],unavailable:[]};
  let fastest = 0;
  for (const variant of ['solo','memory','equal'] as const) {
    if(signal.aborted) throw Error('측정을 취소했어요.');
    const label = variant==='solo'?'탭 단독':variant==='equal'?'균등 분배':'여유 메모리 기준';
    status(label+' 측정 중…');
    const start = Date.now();
    let session:WiredSession|undefined;
    try {
      session=await host(variant==='solo'?[]:ids,filename,variant==='equal'?'equal':'memory');
      const loadMs=Date.now()-start;
      const measurement=await measureGpu(session,signal);
      report.samples.push({label,loadMs,...measurement,split:session.split});
      if (variant!=='solo' && measurement.rate>fastest) {fastest=measurement.rate;report.policy=variant;}
    } catch(e) {
      if(signal.aborted) throw Error('측정을 취소했어요.');
      report.unavailable.push(label+' · '+(e instanceof Error?e.message:'실행할 수 없어요.'));
    } finally {if(session) await stop();}
  }
  if(signal.aborted) throw Error('측정을 취소했어요.');
  await AsyncStorage.setItem(key(filename,ids),JSON.stringify(report));
  return report;
}

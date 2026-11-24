import FS from 'react-native-fs';
import {NativeModules, Platform} from 'react-native';
import catalog from './catalog.json';

export const mediaModels=catalog;
export type MediaModel=(typeof catalog)[number];
export const mediaDir=(m:MediaModel)=>FS.DocumentDirectoryPath+'/media-models/'+m.id+'-'+m.revision.slice(0,8);
export const byteSize=(m:MediaModel)=>m.files.reduce((sum,f)=>sum+f.bytes,0);
function checksum(path:string):Promise<string> {
  return Platform.OS==='ios' ? NativeModules.PocketMindMetalPeer.hashMediaFile(path) : FS.hash(path,'sha256');
}
export async function installed(m:MediaModel){
  try{
    if(!(await FS.exists(mediaDir(m)+'/ready')))return false;
    const files=await Promise.all(m.files.map(f=>FS.stat(mediaDir(m)+'/'+f.path)));
    return files.every((f,i)=>Number(f.size)===m.files[i].bytes);
  }catch{return false;}
}
export async function install(m:MediaModel,progress:(n:number)=>void,signal:AbortSignal){
  if(await installed(m))return;
  const dir=mediaDir(m);
  await FS.mkdir(dir,{NSURLIsExcludedFromBackupKey:true});
  let done=0;
  const total=byteSize(m);
  for(const f of m.files){
    if(signal.aborted)throw Error('다운로드 취소');
    const path=dir+'/'+f.path;
    if(await FS.exists(path) && Number((await FS.stat(path)).size)===f.bytes &&
        (!f.sha256 || await checksum(path)===f.sha256)){done+=f.bytes;progress(done/total);continue;}
    if((await FS.getFSInfo()).freeSpace<f.bytes+32*1024*1024)throw Error('기기 저장 공간이 부족해요.');
    const tmp=path+'.part';
    if(await FS.exists(tmp))await FS.unlink(tmp);
    if(signal.aborted)throw Error('다운로드 취소');
    const job=FS.downloadFile({fromUrl:m.source+'/resolve/'+m.revision+'/'+f.remote,toFile:tmp,progressInterval:300,
      progress:e=>progress((done+e.bytesWritten)/total)});
    const stop=()=>FS.stopDownload(job.jobId);
    signal.addEventListener('abort',stop);
    try{
      const result=await job.promise;
      if(signal.aborted)throw Error('다운로드 취소');
      if(result.statusCode!==200 || Number((await FS.stat(tmp)).size)!==f.bytes ||
        (f.sha256 && await checksum(tmp)!==f.sha256))throw Error('모델 파일 검증에 실패했어요. 다시 다운로드해 주세요.');
      if(await FS.exists(path))await FS.unlink(path);
      await FS.moveFile(tmp,path);done+=f.bytes;progress(done/total);
    }finally{signal.removeEventListener('abort',stop);if(await FS.exists(tmp))await FS.unlink(tmp);}
  }
  await FS.writeFile(dir+'/ready',m.revision,'utf8');
}

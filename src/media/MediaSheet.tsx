import React,{useEffect,useRef,useState} from 'react';
import {Alert,AppState,Linking,Modal,NativeModules,PermissionsAndroid,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import FS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {fromByteArray} from 'base64-js';
import {mediaModels,mediaDir,byteSize,installed,install,type MediaModel} from './store';
import {generateImage} from './diffusion';

interface VoiceContext { transcribe(path:string,options:{language:string}):{stop:()=>Promise<void>;promise:Promise<{result:string}>};release():Promise<void> }
type Props={kind:'image'|'voice';onClose:()=>void;onImage:(prompt:string,name:string,file:string)=>void;
  ask:(text:string)=>Promise<string|undefined>;stopAnswer:()=>void};
const native=()=>Platform.OS==='android'?NativeModules.PocketMindWorker:NativeModules.PocketMindMetalPeer;
function Button({label,act,disabled=false}:{label:string;act:()=>void;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={act} style={[s.button,disabled&&{opacity:.4}]}><Text style={s.text}>{label}</Text></Pressable>;
}
export function MediaSheet(props:Props){
  const list=mediaModels.filter(m=>m.kind===props.kind);
  const [id,select]=useState(list[0].id),[ready,setReady]=useState<string[]>([]);
  const [prompt,setPrompt]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [recording,setRecording]=useState(false),[reply,setReply]=useState(''),[heard,setHeard]=useState('');
  const task=useRef<AbortController|null>(null),mic=useRef(false),alive=useRef(true),asking=useRef(false);
  const finishTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const transcribeStop=useRef<null|(()=>Promise<void>)>(null);
  const model=list.find(m=>m.id===id)||list[0];
  const selectedKey='pocketmind.media.'+props.kind;
  const choiceMade=useRef(false);
  const refresh=async()=>{const states=await Promise.all(list.map(installed));if(alive.current)setReady(list.filter((_,i)=>states[i]).map(m=>m.id));};
  function cancel(){
    task.current?.abort();
    if(finishTimer.current)clearTimeout(finishTimer.current);
    if(mic.current){mic.current=false;setRecording(false);task.current=null;setBusy(false);}
    void transcribeStop.current?.().catch(()=>{});
    void native()?.cancelVoice?.().catch(()=>{});
    if(asking.current)props.stopAnswer();
  }
  useEffect(()=>{
    alive.current=true;refresh().catch(()=>{});
    AsyncStorage.getItem(selectedKey).then(v=>{if(alive.current&&!choiceMade.current&&list.some(m=>m.id===v))select(v!);}).catch(()=>{});
    const sub=AppState.addEventListener('change',v=>{if(v==='background')cancel();});
    return ()=>{alive.current=false;sub.remove();cancel();};
  },[]);
  function choose(m:MediaModel){choiceMade.current=true;select(m.id);setStatus('');AsyncStorage.setItem(selectedKey,m.id).catch(()=>{});}
  function start(){if(task.current)return null;const ctl=new AbortController();task.current=ctl;setBusy(true);return ctl;}
  function end(ctl:AbortController){if(task.current===ctl){task.current=null;if(alive.current)setBusy(false);}}
  function update(ctl:AbortController,msg:string){if(alive.current && !ctl.signal.aborted)setStatus(msg);}
  async function download(){
    const ctl=start();if(!ctl)return;
    try{update(ctl,'다운로드 준비 중…');await install(model,p=>update(ctl,`다운로드 · ${Math.min(100,Math.floor(p*100))}%`),ctl.signal);await refresh();update(ctl,'기기에 저장했어요.');}
    catch(e){update(ctl,e instanceof Error?e.message:'다운로드에 실패했어요.');}
    finally{end(ctl);}
  }
  async function draw(){
    const ctl=start();if(!ctl)return;
    const dir=mediaDir(model);
    try{
      update(ctl,'모델을 여는 중…');
      const ort= require('onnxruntime-react-native') as typeof import('onnxruntime-react-native');
      const [vocab,merges]=await Promise.all(['vocab.json','merges.txt'].map(n=>FS.readFile(dir+'/'+n,'utf8')));
      const png=await generateImage(ort,dir,model.id==='sdxs',prompt.trim(),JSON.parse(vocab),merges,16,ctl.signal,v=>update(ctl,v));
      if(ctl.signal.aborted)return;
      const folder=FS.DocumentDirectoryPath+'/chat-images';await FS.mkdir(folder);
      const name=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.png';
      await FS.writeFile(folder+'/'+name,fromByteArray(png),'base64');
      if(ctl.signal.aborted){await FS.unlink(folder+'/'+name);return;}
      props.onImage(prompt.trim(),model.name,name);props.onClose();
    }catch(e){update(ctl,e instanceof Error?e.message:'이미지를 생성하지 못했어요.');}finally{end(ctl);}
  }
  async function finish(){
    const ctl=task.current;if(!ctl||!mic.current)return;
    mic.current=false;setRecording(false);if(finishTimer.current)clearTimeout(finishTimer.current);
    let wav='';let context:VoiceContext|undefined;
    try{
      wav=await native().finishVoiceRecording();
      update(ctl,'음성을 글로 바꾸는 중…');
      if(ctl.signal.aborted)return;
      context=await (require('whisper.rn/index') as {initWhisper(options:{filePath:string;useGpu:boolean}):Promise<VoiceContext>}).initWhisper({filePath:mediaDir(model)+'/whisper.bin',useGpu:false});
      if(ctl.signal.aborted)return;
      const job=context.transcribe(wav,{language:'ko'});transcribeStop.current=job.stop;
      const text=(await job.promise).result.trim();transcribeStop.current=null;
      await context.release();context=undefined;
      if(ctl.signal.aborted)return;if(!text)throw Error('인식된 음성이 없어요.');
      setHeard(text);update(ctl,'답변 생성 중…');asking.current=true;
      const answer=await props.ask(text);asking.current=false;
      if(ctl.signal.aborted)return;
      if(!answer){update(ctl,'답변할 채팅 모델을 선택하고 다시 시도해 주세요.');return;}
      setReply(answer);update(ctl,'답변을 읽는 중…');await native().speakReply(answer);
      update(ctl,'이어서 말할 수 있어요.');
    }catch(e){update(ctl,e instanceof Error?e.message:'음성 대화를 진행하지 못했어요.');}
    finally{asking.current=false;transcribeStop.current=null;if(context)await context.release().catch(()=>{});if(wav)await FS.unlink(wav).catch(()=>{});end(ctl);}
  }
  async function record(){
    const ctl=start();if(!ctl)return;
    try{
      if(Platform.OS==='android' && await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)!=='granted')throw Error('설정에서 마이크 권한을 허용해 주세요.');
      if(ctl.signal.aborted){end(ctl);return;}
      await native().startVoiceRecording();
      if(ctl.signal.aborted){await native().cancelVoice();end(ctl);return;}
      mic.current=true;setRecording(true);setHeard('');setReply('');update(ctl,'듣고 있어요. 다 말하면 눌러서 보내세요.');
      finishTimer.current=setTimeout(()=>void finish(),29500);
    }catch(e){update(ctl,e instanceof Error?e.message:'녹음 실패');end(ctl);}
  }
  function remove(){Alert.alert('다운로드한 모델 삭제',model.name,[{text:'취소'},{text:'삭제',onPress:async()=>{
    const ctl=start();if(!ctl)return;try{await FS.unlink(mediaDir(model));await refresh();update(ctl,'모델을 삭제했어요.');}catch(e){update(ctl,String(e));}finally{end(ctl);}
  }}]);}
  return <Modal visible transparent animationType="slide" onRequestClose={props.onClose}><View style={s.shade}><View style={s.sheet}>
    <View style={s.header}><Text style={s.title}>{props.kind==='image'?'이미지 만들기':'음성 대화'}</Text><Button label="닫기" act={props.onClose}/></View>
    <ScrollView keyboardShouldPersistTaps="handled">{list.map(m=><Pressable key={m.id} accessibilityRole="radio" accessibilityState={{selected:m.id===id}} disabled={busy} onPress={()=>choose(m)} style={[s.row,m.id===id&&s.selected]}>
      <Text style={s.text}>{m.name} {id===m.id?'✓':''}</Text><Text style={s.hint}>{m.parameters} · {(byteSize(m)/1e6).toFixed(0)} MB{ready.includes(m.id)?' · 설치됨':''}</Text></Pressable>)}
      <Pressable onPress={()=>Linking.openURL(model.source).catch(()=>setStatus('모델 페이지를 열 수 없어요.'))}><Text style={s.hint}>{model.license} · 모델 정보 ↗</Text></Pressable>
      {model.id==='sd15' && <Text style={s.hint}>고용량 모델이에요. 실행에 필요한 메모리가 부족하면 SDXS를 선택하세요.</Text>}
      {!ready.includes(id)?<Button label="선택한 모델 다운로드" act={download} disabled={busy}/>:<>
        {props.kind==='image'?<><TextInput multiline style={s.input} editable={!busy} placeholder="만들고 싶은 이미지를 영어로 설명하세요" placeholderTextColor="#aaa" value={prompt} onChangeText={setPrompt}/><Button label="이미지 생성" act={draw} disabled={busy||!prompt.trim()}/></>:
          <><Text style={s.hint}>한국어 음성을 선택한 모델로 인식하고, 현재 채팅 모델의 답변을 기기 음성으로 읽어요.</Text><Button label={recording?'녹음 종료하고 보내기':'말하기'} act={recording?finish:record} disabled={busy&&!recording}/></>}
        {!busy&&<Button label="모델 삭제" act={remove}/>}
      </>}
      {!!status&&<Text accessibilityLiveRegion="polite" style={s.hint}>{status}</Text>}{!!heard&&<Text style={s.text}>{heard}</Text>}{!!reply&&<Text selectable style={s.text}>{reply}</Text>}
      {busy&&<Button label="중지" act={()=>{cancel();setStatus('중지했어요.');}}/>}
    </ScrollView></View></View></Modal>;
}
const s=StyleSheet.create({shade:{flex:1,backgroundColor:'#0009',justifyContent:'flex-end'},sheet:{maxHeight:'88%',backgroundColor:'#202020',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:30},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{color:'#fff',fontSize:23,fontWeight:'600'},row:{padding:12,marginTop:6,borderRadius:14,borderWidth:1,borderColor:'#454545'},selected:{backgroundColor:'#373737',borderColor:'#999'},text:{color:'#eee',fontSize:16,lineHeight:23},hint:{color:'#bcbcbc',fontSize:13,lineHeight:19,marginVertical:5},button:{alignItems:'center',paddingHorizontal:12,paddingVertical:10,marginVertical:4,backgroundColor:'#393939',borderRadius:16},input:{minHeight:70,color:'#fff',backgroundColor:'#303030',borderRadius:14,padding:12,marginTop:9}});

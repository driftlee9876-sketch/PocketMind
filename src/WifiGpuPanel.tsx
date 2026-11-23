import React, {useEffect, useRef, useState} from 'react';
import {AppState, Modal, NativeModules, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {WiredSession} from './wiredInference';

type Peer = {ID: string; name: string; platform?: string};
type Status = {peers: Peer[]; trusted: string[]; offering: boolean; pending?: {id:string;code:string}; issue?:string};
type Preference = {id:string;filename:string};
const storageKey = 'pocketmind.wifi-gpu.preferred.v1';
const native = Platform.OS === 'ios' ? NativeModules.PocketMindMetalPeer : NativeModules.PocketMindWorker;
const initial:Status = {peers:[],trusted:[],offering:false};
async function command(op:string,args:object={}):Promise<Status> {
  return JSON.parse(await native.wifiGpu(JSON.stringify({op,...args})));
}
type Props={visible:boolean;reset:number;filename?:string;session:WiredSession|null;onSession:(v:WiredSession|null)=>void;onMode:(v:boolean)=>void;onClose:()=>void};
export function WifiGpuPanel(props:Props) {
  const [state,setState]=useState<Status>(initial);
  const [pref,setPref]=useState<Preference|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [foreground,setForeground]=useState(AppState.currentState!=='background');
  const current=useRef(props);current.current=props;
  const preference=useRef<Preference|null>(null);
  const generation=useRef(0);
  const loading=useRef(false);
  const nextTry=useRef(0);
  const failures=useRef(0);
  const restored=useRef(false);
  function remember(value:Preference|null) {
    generation.current++;preference.current=value;setPref(value);current.current.onMode(Boolean(value));
    nextTry.current=0;failures.current=0;
    (value ? AsyncStorage.setItem(storageKey,JSON.stringify(value)) : AsyncStorage.removeItem(storageKey)).catch(()=>{});
  }
  useEffect(()=>{
    let mounted=true;
    const epoch=generation.current;
    AsyncStorage.getItem(storageKey).then(raw=>{
      if(!mounted || !raw || epoch!==generation.current || Platform.OS!=='android')return;
      const value=JSON.parse(raw);if (/^[A-Za-z0-9_-]{43}$/.test(value.id) && typeof value.filename==='string'){
        preference.current=value;setPref(value);current.current.onMode(true);
      }
    }).catch(()=>{}).finally(()=>{ restored.current=true; });
    const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));
    return ()=>{mounted=false;generation.current++;sub.remove();};
  },[]);
  useEffect(()=>{
    if (!props.reset) return;
    remember(null);setError('');
    command('stop').catch(()=>{});
  },[props.reset]);
  const watch=Boolean(props.visible || pref);
  useEffect(()=>{
    if(!watch || !foreground || !native) return;
    let live=true, polling=false;
    async function tick(start=false){
      if(polling || !live)return;polling=true;
      try{
        const s=await command(start && Platform.OS==='android'?'browse':'status');
        if(!live)return;
        setState(s);
        const target=preference.current;
        if(target && !s.offering && !current.current.session && !loading.current && s.trusted.includes(target.id) &&
          s.peers.some(p=>p.ID===target.id) && Date.now()>=nextTry.current){
          const epoch=generation.current;loading.current=true;setBusy('두 GPU에 모델을 불러오는 중…');
          try{
            const result=await native.joinWifiGpu(target.id,target.filename);
            if(!live || epoch!==generation.current){await native.stopTabletGpu();return;}
            failures.current=0;setError('');current.current.onSession(result);
          } catch(e:any){
            if(live && epoch===generation.current){failures.current++;nextTry.current=Date.now()+Math.min(60000,5000*2**Math.min(failures.current,4));setError(e?.message || '다시 연결하는 중이에요.');}
          } finally{loading.current=false;setBusy('');}
        }
      }catch(e:any){if(live)setError(e?.message || 'Wi-Fi 연결을 확인해 주세요.');}
      finally{polling=false;}
    }
    tick(true);const timer=setInterval(()=>tick(),1500);
    return ()=>{live=false;clearInterval(timer);if(!preference.current)command('stop').catch(()=>{});};
  },[watch,foreground]);
  async function action(fn:()=>Promise<void>){
    setError('');
    try{await fn();setState(await command('status'));}catch(e:any){setError(e?.message||'연결하지 못했어요.');}
  }
  function button(label:string,fn:()=>void,disabled=false){
    return <TouchableOpacity key={label} accessibilityRole="button" disabled={disabled} style={[s.button,disabled&&s.dim]} onPress={fn}><Text style={s.label}>{label}</Text></TouchableOpacity>;
  }
  async function disconnect(forget:boolean){
    remember(null);
    if(current.current.session?.wifi || loading.current){await native.stopTabletGpu();current.current.onSession(null);}
    await command(forget?'forget':'stop');if(Platform.OS==='android')await command('browse');setState(await command('status'));
  }
  function close(){
    if(!preference.current)command('stop').catch(()=>{});
    props.onClose();
  }
  return <Modal visible={props.visible} transparent animationType="slide" onRequestClose={close}>
    <View style={s.overlay}><View style={s.card}><View style={s.header}><Text style={s.title}>Wi-Fi GPU</Text>
      {button('닫기',close)}</View><ScrollView keyboardShouldPersistTaps="handled">
      <Text style={s.detail}>{Platform.OS==='ios'?'같은 Wi-Fi의 갤럭시탭에 이 기기의 Metal GPU를 제공해요. 공유하는 동안 앱을 열어 두세요.':'같은 Wi-Fi에서 GPU 제공을 켠 Android, iPhone·iPad, Windows PC를 찾습니다.'}</Text>
      {state.pending && <View style={s.group}><Text style={s.title}>{state.pending.code.slice(0,4)} {state.pending.code.slice(4)}</Text>
        <Text style={s.detail}>연결할 두 기기에 같은 숫자가 보일 때 양쪽에서 승인하세요.</Text>
        {button('코드 일치 · 승인',()=>action(async()=>{await command('vote',{id:state.pending!.id,accept:true});}))}
        {button('거절',()=>action(async()=>{await command('vote',{id:state.pending!.id,accept:false});}))}</View>}
      {Platform.OS==='android' && !state.offering && <View style={s.group}>
        <Text style={s.heading}>주변 GPU</Text>
        {!state.peers.length && <Text style={s.detail}>기기를 찾는 중… 보조 기기에서 Wi-Fi GPU 제공을 켜 주세요.</Text>}
        {state.peers.map(p=><View key={p.ID+p.name} style={s.peer}><Text style={s.heading}>{p.name}</Text>
          <Text style={s.detail}>{p.platform || 'GPU'} · {state.trusted.includes(p.ID)?'승인한 기기':'처음 연결'}</Text>
          {state.trusted.includes(p.ID)?button(pref?.id===p.ID?(props.session?.wifi?'두 GPU로 연결됨':'자동 연결 대기 중'):'이 GPU로 대화 · 자동 재연결',()=>{if(props.filename)remember({id:p.ID,filename:props.filename});},!props.filename||!!busy||pref?.id===p.ID||!!props.session):
            button('이 기기와 연결',()=>action(async()=>{await command('pair',{id:p.ID});}),!!state.pending||!!busy||!!props.session)}</View>)}
        {!props.filename && <Text style={s.detail}>함께 실행할 GGUF를 주 기기에 설치하고 선택하세요.</Text>}
        {pref && button('자동 재연결 끄고 연결 해제',()=>action(()=>disconnect(false)))}
      </View>}
      {(!pref && !props.session) && button(state.offering?'Wi-Fi GPU 제공 중지':'이 기기의 Wi-Fi GPU 제공',()=>action(async()=>{
        if(state.offering){await command('stop');if(Platform.OS==='android')await command('browse');return;}
        if(Platform.OS==='ios')await native.startUsbGpuPeer();else await native.prepareWifiPeer();
        try{await command('offer');}catch(e){await native.stopUsbGpuPeer();throw e;}
      }),!!busy||!!state.pending)}
      {state.trusted.length>0 && button('저장한 Wi-Fi 기기 모두 잊기',()=>action(()=>disconnect(true)))}
      {!!busy && <Text style={s.detail}>{busy}</Text>}
      {!!(error||state.issue) && <Text style={s.error}>{error||state.issue}</Text>}
    </ScrollView></View></View>
  </Modal>;
}
const s=StyleSheet.create({overlay:{flex:1,backgroundColor:'#0009',justifyContent:'center',alignItems:'center',padding:18},card:{width:'100%',maxWidth:560,maxHeight:'90%',backgroundColor:'#222724',borderRadius:18,padding:18},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:22,color:'#fff',fontWeight:'700'},heading:{fontSize:16,color:'#F1F5F2',fontWeight:'600'},detail:{color:'#BAC8C0',fontSize:14,lineHeight:21,marginVertical:7},button:{padding:11,backgroundColor:'#33463E',alignItems:'center',borderRadius:10,marginVertical:4},label:{color:'#CAEFDE',fontWeight:'600'},peer:{marginTop:8,borderRadius:10,padding:10,backgroundColor:'#2A302D'},group:{marginVertical:10},dim:{opacity:.55},error:{color:'#F4C5A9',marginVertical:8}});

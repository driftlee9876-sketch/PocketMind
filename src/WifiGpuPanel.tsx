import React, {useEffect, useRef, useState} from 'react';
import {AppState, Modal, NativeModules, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {compareGpu,savedComparison} from './gpuComparison';
import type {WiredSession} from './wiredInference';

type Peer = {ID: string; name: string; platform?: string};
type Status = {peers: Peer[]; trusted: string[]; offering: boolean; searching?: boolean; invitation?:string; meshReady?:boolean; pending?: {id:string;code:string}; issue?:string};
type Preference = {ids:string[];filename:string};
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
  const [selected,setSelected]=useState<string[]>([]);
  const [invite,setInvite]=useState('');
  const [remoteOpen,setRemoteOpen]=useState(false);
  const measurement=useRef<AbortController|null>(null);
  const [report,setReport]=useState<Awaited<ReturnType<typeof savedComparison>>>(null);
  const names=useRef<Record<string,string>>({});
  const missing=pref?.ids.filter(id=>!state.peers.some(peer=>peer.ID===id)) || [];
  useEffect(()=>{
    let live=true;setReport(null);
    if(props.filename && selected.length) savedComparison(props.filename,selected).then(value=>{if(live)setReport(value);}).catch(()=>{});
    return ()=>{live=false;};
  },[props.filename,selected]);
  const [error,setError]=useState('');
  const [foreground,setForeground]=useState(AppState.currentState!=='background');
  const current=useRef(props);current.current=props;
  const preference=useRef<Preference|null>(null);
  const generation=useRef(0);
  const loading=useRef(false);
  const offerEpoch=useRef(0);
  const preparing=useRef(false);
  const nextTry=useRef(0);
  const failures=useRef(0);
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
      const saved=JSON.parse(raw);
      const ids=Array.isArray(saved.ids)?saved.ids:[saved.id];
      if (ids.length<=20 && new Set(ids).size===ids.length &&
          ids.every((id:unknown)=>typeof id==='string' && /^[A-Za-z0-9_-]{43}$/.test(id)) && typeof saved.filename==='string'){
        const value={ids,filename:saved.filename};
        setSelected(ids);
        preference.current=value;setPref(value);current.current.onMode(true);
      }
    }).catch(()=>{});
    const sub=AppState.addEventListener('change',s=>{if(s==='background')offerEpoch.current++;setForeground(s==='active');});
    return ()=>{mounted=false;generation.current++;offerEpoch.current++;sub.remove();};
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
        for(const peer of s.peers) names.current[peer.ID]=peer.name;
        const target=preference.current;
        if(target && !s.offering && !current.current.session && !loading.current && target.ids.every(id=>s.trusted.includes(id) && s.peers.some(p=>p.ID===id)) && Date.now()>=nextTry.current){
          const epoch=generation.current;loading.current=true;setBusy(`보조 GPU ${target.ids.length}대에 모델을 나눠 올리는 중…`);
          try{
            const previous=await savedComparison(target.filename,target.ids);
            const result=await native.calibratedGpuGroup(target.ids,target.filename,previous?.policy || 'memory');
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
    if(forget)setSelected([]);
    if(current.current.session?.wifi || loading.current){await native.stopTabletGpu();current.current.onSession(null);}
    await command(forget?'forget':'stop');if(Platform.OS==='android')await command('browse');setState(await command('status'));
  }
  async function toggleOffer(mesh=false){
    if(preparing.current)return;
    if(state.offering){await command('stop');if(Platform.OS==='android')await command('browse');return;}
    const epoch=++offerEpoch.current;
    preparing.current=true;setBusy('GPU 제공을 준비하는 중…');
    try {
      if(Platform.OS==='ios')await native.startUsbGpuPeer();else await native.prepareWifiPeer();
      if(epoch!==offerEpoch.current || !current.current.visible){await native.stopUsbGpuPeer();return;}
      await command('offer',{mesh});
      if(epoch!==offerEpoch.current || !current.current.visible)await command('stop');
    }catch(e){await native.stopUsbGpuPeer();throw e;}
    finally{preparing.current=false;setBusy('');}
  }
  async function benchmark(){
    if(!props.filename || !selected.length || loading.current || measurement.current)return;
    const ctl=new AbortController();
    measurement.current=ctl;loading.current=true;setError('');
    try {
      const result=await compareGpu(props.filename,selected,ctl.signal,
        (ids,file,policy)=>native.calibratedGpuGroup(ids,file,policy),()=>native.stopTabletGpu(),setBusy);
      setReport(result);
    }catch(e){if(!ctl.signal.aborted)setError(e instanceof Error?e.message:'측정 실패');}
    finally{measurement.current=null;loading.current=false;setBusy('');}
  }
  function close(){
    if(measurement.current){measurement.current.abort();native.stopTabletGpu().catch(()=>{});}

    offerEpoch.current++;
    if(!preference.current)command('stop').catch(()=>{});
    props.onClose();
  }
  return <Modal visible={props.visible} transparent animationType="slide" onRequestClose={close}>
    <View style={s.overlay}><View style={s.card}><View style={s.header}><Text style={s.title}>Wi-Fi GPU</Text>
      {button('닫기',close)}</View><ScrollView keyboardShouldPersistTaps="handled">
      <Text style={s.detail}>{Platform.OS==='ios'?'같은 Wi-Fi의 갤럭시탭에 이 기기의 Metal GPU를 제공해요. 공유하는 동안 앱을 열어 두세요.':'같은 Wi-Fi에서 GPU 제공을 켠 Android, iPhone·iPad, Windows PC를 찾습니다.'}</Text>
      {button(remoteOpen?'원격 연결 안내 접기':'다른 Wi-Fi에서 연결',()=>setRemoteOpen(!remoteOpen))}
      {remoteOpen && <View style={s.group}>
        <Text style={s.detail}>각 기기에서 Tailscale을 같은 개인 네트워크에 연결하세요. 보조 기기에서 원격 제공을 켜고, 초대를 갤럭시탭에 붙여넣으세요.</Text>
        <Text style={s.detail}>{state.meshReady?'Tailscale 주소 확인됨':'이 기기에서 Tailscale 연결을 기다리는 중'}</Text>
        {Platform.OS==='android' && !state.offering && <>
          <TextInput value={invite} onChangeText={setInvite} maxLength={128} autoCapitalize="none" autoCorrect={false} style={s.label} placeholderTextColor="#ABBAB0" placeholder="보조 기기의 초대 붙여넣기"/>
          {button('원격 기기 추가',()=>action(async()=>{await command('import',{invite:invite.trim()});setInvite('');}),!invite.trim()||!state.meshReady)}
        </>}
        {!state.offering && !pref && !props.session && button('원격 GPU 제공 시작',()=>action(()=>toggleOffer(true)),!state.meshReady||!!busy)}
      </View>}
      {!!state.invitation && <View style={s.group}><Text selectable style={s.detail}>{state.invitation}</Text>
        {button('원격 초대 복사',()=>Clipboard.setString(state.invitation!))}</View>}
      {state.pending && <View style={s.group}><Text style={s.title}>{state.pending.code.slice(0,4)} {state.pending.code.slice(4)}</Text>
        <Text style={s.detail}>연결할 두 기기에 같은 숫자가 보일 때 양쪽에서 승인하세요.</Text>
        {button('코드 일치 · 승인',()=>action(async()=>{await command('vote',{id:state.pending!.id,accept:true});}))}
        {button('거절',()=>action(async()=>{await command('vote',{id:state.pending!.id,accept:false});}))}</View>}
      {Platform.OS==='android' && !state.offering && <View style={s.group}>
        <Text style={s.heading}>주변 GPU</Text>
        {!state.peers.length && <Text style={s.detail}>{state.searching ? '기기를 찾는 중… 보조 기기에서 Wi-Fi GPU 제공을 켜 주세요.' : '검색을 준비하고 있어요. Wi-Fi 연결을 확인해 주세요.'}</Text>}
        {state.peers.map(p=><View key={p.ID+p.name} style={s.peer}><Text style={s.heading}>{p.name}</Text>
          <Text style={s.detail}>{p.platform || 'GPU'} · {state.trusted.includes(p.ID)?'승인한 기기':'처음 연결'}</Text>
          {state.trusted.includes(p.ID)?button(selected.includes(p.ID)?'선택 해제':'연산에 추가',()=>{
            setSelected(current=>current.includes(p.ID)?current.filter(id=>id!==p.ID):current.length<20?[...current,p.ID]:current);
          },!!pref||!!busy||!!props.session||(!selected.includes(p.ID)&&selected.length>=20)):
            button('이 기기와 연결',()=>action(async()=>{await command('pair',{id:p.ID});}),!!state.pending||!!busy||!!props.session)}</View>)}
        {!pref && selected.length>0 && button(`선택한 ${selected.length}/20대로 대화 · 자동 재연결`,()=>{
          if(props.filename)remember({ids:[...selected],filename:props.filename});
        },!props.filename||!!busy||!!props.session||!selected.every(id=>state.trusted.includes(id)&&state.peers.some(p=>p.ID===id)))}
        {!pref && !!selected.length && button('탭 단독과 속도 비교',benchmark,!props.filename||!!busy||!!props.session)}
        {report && <View style={s.group}>{report.samples.map(row=><Text key={row.label} style={s.detail}>{row.label} · 준비 {(row.loadMs/1000).toFixed(1)}초 · 첫 토큰 {(row.firstMs/1000).toFixed(2)}초 · {row.rate>0 ? row.rate.toFixed(1)+' tok/s' : '속도 미제공'}</Text>)}
          {report.unavailable.map(value=><Text key={value} style={s.detail}>{value}</Text>)}
          {!!report.samples.some(row=>row.rate>0 && row.label!=='탭 단독') && <Text style={s.detail}>선택된 분배 · {report.policy==='equal'?'균등':'여유 메모리 기준'}</Text>}</View>}
        {pref && !props.session && missing.length>0 && <View style={s.group}>
          <Text style={s.detail}>다시 연결 대기 · {missing.map(id=>names.current[id] || id.slice(0,8)).join(', ')}</Text>
          {button('현재 연결된 기기로 계속',()=>{const ids=pref.ids.filter(id=>!missing.includes(id));setSelected(ids);remember({...pref,ids});},missing.length===pref.ids.length||!!busy)}
          {button('탭 단독으로 전환',()=>{remember({...pref,ids:[]});setSelected([]);},!!busy)}
        </View>}
        {!pref && selected.length>0 && button('선택 초기화',()=>setSelected([]),!!busy)}
        {pref && <Text style={s.detail}>{`보조 GPU ${pref.ids.length}대 · ${props.session?.wifi?'모델 실행 중':'자동 연결 대기 중'}`}</Text>}
        {!props.filename && <Text style={s.detail}>함께 실행할 GGUF를 주 기기에 설치하고 선택하세요.</Text>}
        {pref && button('자동 재연결 끄고 연결 해제',()=>action(()=>disconnect(false)))}
      </View>}
      {(!pref && !props.session) && button(state.offering?'Wi-Fi GPU 제공 중지':'이 기기의 Wi-Fi GPU 제공',()=>action(()=>toggleOffer()),!!busy||!!state.pending)}
      {(state.trusted.length>0 || state.peers.some(p=>p.platform==='Tailscale')) && button('저장한 Wi-Fi 기기 모두 잊기',()=>action(()=>disconnect(true)))}
      {!!busy && <Text style={s.detail}>{busy}</Text>}
      {!!(error||state.issue) && <Text style={s.error}>{error||state.issue}</Text>}
    </ScrollView></View></View>
  </Modal>;
}
const s=StyleSheet.create({overlay:{flex:1,backgroundColor:'#0009',justifyContent:'center',alignItems:'center',padding:18},card:{width:'100%',maxWidth:560,maxHeight:'90%',backgroundColor:'#222724',borderRadius:18,padding:18},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:22,color:'#fff',fontWeight:'700'},heading:{fontSize:16,color:'#F1F5F2',fontWeight:'600'},detail:{color:'#BAC8C0',fontSize:14,lineHeight:21,marginVertical:7},button:{padding:11,backgroundColor:'#33463E',alignItems:'center',borderRadius:10,marginVertical:4},label:{color:'#CAEFDE',fontWeight:'600'},peer:{marginTop:8,borderRadius:10,padding:10,backgroundColor:'#2A302D'},group:{marginVertical:10},dim:{opacity:.55},error:{color:'#F4C5A9',marginVertical:8}});

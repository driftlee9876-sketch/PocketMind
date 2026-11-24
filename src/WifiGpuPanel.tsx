import React, {useEffect, useRef, useState} from 'react';
import {AppState, Modal, NativeModules, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {compareGpu,savedComparison} from './gpuComparison';
import type {WiredSession} from './wiredInference';

type Peer = {ID: string; name: string; platform?: string;Group?:string};
type Status = {group?:string;wantGPU?:boolean;attached?:boolean;peers: Peer[]; trusted: string[]; offering: boolean; searching?: boolean; invitation?:string; meshReady?:boolean; internetOffering?:boolean; pending?: {id:string;code:string}; issue?:string};
type Preference = {ids:string[];filename:string};
const storageKey = 'pocketmind.wifi-gpu.preferred.v1';
const native = Platform.OS === 'ios' ? NativeModules.PocketMindMetalPeer : NativeModules.PocketMindWorker;
const initial:Status = {peers:[],trusted:[],offering:false};
async function command(op:string,args:object={}):Promise<Status> {
  return JSON.parse(await native.wifiGpu(JSON.stringify({op,...args})));
}
type Props={running:boolean;visible:boolean;reset:number;filename?:string;session:WiredSession|null;onSession:(v:WiredSession|null)=>void;onMode:(v:boolean)=>void;onOpen:()=>void;onClose:()=>void};
export function WifiGpuPanel(props:Props) {
  const [state,setState]=useState<Status>(initial);
  const [pref,setPref]=useState<Preference|null>(null);
  const [busy,setBusy]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [invite,setInvite]=useState('');
  const [otp,setOtp]=useState('');
  useEffect(()=>{setOtp('');},[state.pending?.id]);
  const member=(p:Peer)=>Boolean(state.group && p.Group===state.group) || state.trusted.includes(p.ID);
  const groups=new Map<string,Peer[]>();
  for(const p of state.peers){const id=p.Group || '';groups.set(id,[...(groups.get(id)||[]),p]);}
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
      if(!mounted || !raw || epoch!==generation.current)return;
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
    command('stop').then(()=>command('browse')).catch(()=>{});
  },[props.reset]);
  const wakeAfter=useRef(0);
  useEffect(()=>{
    if(!foreground || !native) return;
    let live=true, polling=false;
    async function tick(start=false){
      if(polling || !live)return;polling=true;
      try{
        const s=await command(start?'browse':'status');
        if(!live)return;
        setState(s);
        if(s.wantGPU && !preparing.current && !current.current.running && !current.current.session && !preference.current && Date.now()>=wakeAfter.current){
          preparing.current=true;
          try{if(Platform.OS==='ios')await native.startUsbGpuPeer();else await native.prepareWifiPeer();
            if(live)await command('attach');
          }catch(e:any){wakeAfter.current=Date.now()+5000;if(live)setError(e?.message||'GPU를 준비하지 못했어요.');}
          finally{preparing.current=false;}
        }
        for(const peer of s.peers) names.current[peer.ID]=peer.name;
        const target=preference.current;
        if(target && !current.current.running && !s.offering && !current.current.session && !loading.current && target.ids.every(id=>s.peers.some(p=>p.ID===id && (s.trusted.includes(id) || (!!s.group && s.group===p.Group)))) && Date.now()>=nextTry.current){
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
    return ()=>{live=false;clearInterval(timer);};
  },[foreground]);
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
    await command(forget?'forget':'stop');await command('browse');setState(await command('status'));
  }
  async function toggleOffer(route:"lan"|"internet"|"mesh"="lan"){
    if(preparing.current)return;
    if(state.offering || state.attached){await command('stop');await command('browse');return;}
    const epoch=++offerEpoch.current;
    preparing.current=true;setBusy('GPU 제공을 준비하는 중…');
    try {
      if(Platform.OS==='ios')await native.startUsbGpuPeer();else await native.prepareWifiPeer();
      if(epoch!==offerEpoch.current || !current.current.visible){await native.stopUsbGpuPeer();return;}
      await command('offer',{mesh:route==='mesh', internet:route==='internet'});
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

    props.onClose();
  }
  return <>{!props.visible && foreground && (state.pending || state.peers.some(p=>p.Group!==undefined)) &&
    <TouchableOpacity accessibilityRole="button" style={s.nearby} onPress={props.onOpen}><Text style={s.label}>{state.pending?'기기 연결 요청 · 코드 입력':`주변 PocketMind · ${state.peers.filter(p=>p.Group!==undefined).length}대`}</Text></TouchableOpacity>}
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={close}>
    <View style={s.overlay}><View style={s.card}><View style={s.header}><Text style={s.title}>Wi-Fi GPU</Text>
      {button('닫기',close)}</View><ScrollView keyboardShouldPersistTaps="handled">
      <Text style={s.detail}>{'이 기기에 설치한 모델을 주변 GPU와 나눠 실행하거나, 이 기기의 GPU를 제공할 수 있어요. 공유 중에는 앱을 열어 두세요.'}</Text>
      {button(remoteOpen?'원격 연결 안내 접기':'다른 Wi-Fi에서 연결',()=>setRemoteOpen(!remoteOpen))}
      {remoteOpen && <View style={s.group}>
        <Text style={s.detail}>보조 기기에서 원격 GPU 제공을 켠 후 초대를 복사해 모델이 있는 기기에 붙여넣으세요. 두 기기는 인터넷에 연결되어 있어야 해요.</Text>
        {state.internetOffering && !state.invitation && <Text style={s.detail}>중계 서버를 연결하고 초대를 준비하고 있어요…</Text>}
        {!state.offering && <>
          <TextInput value={invite} onChangeText={setInvite} maxLength={128} autoCapitalize="none" autoCorrect={false} style={s.label} placeholderTextColor="#ABBAB0" placeholder="보조 기기의 초대 붙여넣기"/>
          {button('원격 기기 추가',()=>action(async()=>{await command('import',{invite:invite.trim()});setInvite('');}),!invite.trim())}
        </>}
        {!state.offering && !pref && !props.session && button('원격 GPU 제공 시작',()=>action(()=>toggleOffer('internet')),!!busy)}
        {state.meshReady && !state.offering && !pref && !props.session && button('기존 VPN으로 제공',()=>action(()=>toggleOffer('mesh')),!!busy)}
      </View>}
      {!!state.invitation && <View style={s.group}><Text selectable style={s.detail}>{state.invitation}</Text>
        {button('원격 초대 복사',()=>Clipboard.setString(state.invitation!))}</View>}
      {state.pending && <View style={s.group}><Text style={s.title}>{state.pending.code.slice(0,3)} {state.pending.code.slice(3)}</Text>
        <Text style={s.detail}>내 코드를 상대 기기에 입력하고, 아래에는 상대 화면의 6자리를 입력하세요. 코드는 1분 동안 유효해요.</Text>
        <TextInput style={s.input} value={otp} onChangeText={v=>setOtp(v.replace(/[^0-9]/g,''))} maxLength={6} keyboardType="number-pad" placeholder="상대 기기 코드 6자리" placeholderTextColor="#ABBAB0"/>
        {button('코드 입력 · 연결',()=>action(async()=>{await command('enter',{id:state.pending!.id,code:otp});setOtp('');}),otp.length!==6)}
        {button('거절',()=>action(async()=>{await command('vote',{id:state.pending!.id,accept:false});}))}</View>}
      {!state.offering && <View style={s.group}>
        <Text style={s.heading}>주변 기기와 그룹</Text>
        {!state.peers.length && <Text style={s.detail}>{state.searching ? '기기를 찾는 중… 같은 Wi-Fi의 다른 기기에서 PocketMind를 열어 주세요.' : '검색을 준비하고 있어요. Wi-Fi 연결을 확인해 주세요.'}</Text>}
        {Array.from(groups,([group,peers])=><View key={group || 'single'}>{!!group && <Text style={s.heading}>{state.group===group?'내 그룹':'주변 그룹'} · {group.slice(0,6)} · 주변 {peers.length}대</Text>}{peers.map(p=><View key={p.ID+p.name} style={s.peer}><Text style={s.heading}>{p.name}</Text>
          <Text style={s.detail}>{p.platform || 'GPU'} · {member(p)?'연결된 기기':'처음 연결'}</Text>
          {member(p)?button(selected.includes(p.ID)?'선택 해제':'연산에 추가',()=>{
            setSelected(current=>current.includes(p.ID)?current.filter(id=>id!==p.ID):current.length<20?[...current,p.ID]:current);
          },!!pref||!!busy||!!props.session||(!selected.includes(p.ID)&&selected.length>=20)):
            button(p.Group?'이 그룹에 연결':'이 기기와 연결',()=>action(async()=>{await command('pair',{id:p.ID});}),!!state.pending||!!busy||!!props.session)}</View>)}</View>)}
        {!pref && selected.length>0 && button(`선택한 ${selected.length}/20대로 대화 · 자동 재연결`,()=>{
          if(props.filename)remember({ids:[...selected],filename:props.filename});
        },!props.filename||!!busy||!!props.session||!selected.every(id=>state.peers.some(p=>p.ID===id && member(p))))}
        {Platform.OS==='android' && !pref && !!selected.length && button('탭 단독과 속도 비교',benchmark,props.running||!props.filename||!!busy||!!props.session)}
        {report && <View style={s.group}>{report.samples.map(row=><Text key={row.label} style={s.detail}>{row.label} · 준비 {(row.loadMs/1000).toFixed(1)}초 · 첫 토큰 {(row.firstMs/1000).toFixed(2)}초 · {row.rate>0 ? row.rate.toFixed(1)+' tok/s' : '속도 미제공'}</Text>)}
          {report.unavailable.map(value=><Text key={value} style={s.detail}>{value}</Text>)}
          {!!report.samples.some(row=>row.rate>0 && row.label!=='탭 단독') && <Text style={s.detail}>선택된 분배 · {report.policy==='equal'?'균등':'여유 메모리 기준'}</Text>}</View>}
        {pref && !props.session && pref.ids.length>0 && <View style={s.group}>
          <Text style={s.detail}>{missing.length?'다시 연결 대기 · '+missing.map(id=>names.current[id] || id.slice(0,8)).join(', '):'선택한 기기의 응답을 기다리는 중…'}</Text>
          {pref.ids.length>1 && pref.ids.map(id=>button((names.current[id]||id.slice(0,8))+' 제외',()=>{const ids=pref.ids.filter(peer=>peer!==id);setSelected(ids);remember({...pref,ids});},!!busy))}
          {button('현재 연결된 기기로 계속',()=>{const ids=pref.ids.filter(id=>!missing.includes(id));setSelected(ids);remember({...pref,ids});},!missing.length||missing.length===pref.ids.length||!!busy)}
          {Platform.OS==='android' && button('탭 단독으로 전환',()=>{remember({...pref,ids:[]});setSelected([]);},!!busy)}
        </View>}
        {!pref && selected.length>0 && button('선택 초기화',()=>setSelected([]),!!busy)}
        {pref && <Text style={s.detail}>{`보조 GPU ${pref.ids.length}대 · ${props.session?.wifi?'모델 실행 중':'자동 연결 대기 중'}`}</Text>}
        {!props.filename && <Text style={s.detail}>함께 실행할 GGUF를 주 기기에 설치하고 선택하세요.</Text>}
        {pref && button('자동 재연결 끄고 연결 해제',()=>action(()=>disconnect(false)))}
      </View>}
      {(!pref && !props.session) && button((state.offering || state.attached)?'Wi-Fi GPU 제공 중지':'이 기기의 Wi-Fi GPU 제공',()=>action(()=>toggleOffer()),!!busy||!!state.pending)}
      {(state.trusted.length>0 || state.peers.some(p=>p.platform==='Tailscale' || p.platform==='PocketMind')) && button('저장한 Wi-Fi 기기 모두 잊기',()=>action(()=>disconnect(true)))}
      {!!busy && <Text style={s.detail}>{busy}</Text>}
      {!!(error||state.issue) && <Text style={s.error}>{error||state.issue}</Text>}
    </ScrollView></View></View>
  </Modal></>;
}
const s=StyleSheet.create({input:{color:"#fff",padding:10},nearby:{position:"absolute",right:14,top:54,zIndex:12,padding:9,backgroundColor:"#33463E",borderRadius:14},overlay:{flex:1,backgroundColor:'#0009',justifyContent:'center',alignItems:'center',padding:18},card:{width:'100%',maxWidth:560,maxHeight:'90%',backgroundColor:'#222724',borderRadius:18,padding:18},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:22,color:'#fff',fontWeight:'700'},heading:{fontSize:16,color:'#F1F5F2',fontWeight:'600'},detail:{color:'#BAC8C0',fontSize:14,lineHeight:21,marginVertical:7},button:{padding:11,backgroundColor:'#33463E',alignItems:'center',borderRadius:10,marginVertical:4},label:{color:'#CAEFDE',fontWeight:'600'},peer:{marginTop:8,borderRadius:10,padding:10,backgroundColor:'#2A302D'},group:{marginVertical:10},dim:{opacity:.55},error:{color:'#F4C5A9',marginVertical:8}});

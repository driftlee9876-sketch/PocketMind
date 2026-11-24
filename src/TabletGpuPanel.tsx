import React, { useEffect, useRef, useState } from 'react';
import { Image, NativeModules, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { WiredSession } from './wiredInference';

const native = NativeModules.PocketMindWorker;
export function TabletGpuPanel({filename, modelName, onSession}: {filename?: string; modelName?: string; onSession: (session: WiredSession) => void}) {
  const [invite,setInvite] = useState('');
  const [qr,setQr] = useState('');
  const mounted = useRef(true);
  const handedOff = useRef(false);
  const donorInfo = useRef('');
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    let previous = '';
    async function refresh() {
      try {
        const state = await native.tabletGpuStatus();
        if (state.invitation === previous) return;
        previous = state.invitation; donorInfo.current = previous;
        const image = previous ? await native.showCableQr(previous) : '';
        if (mounted.current) setQr(image);
      } catch {}
    }
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      mounted.current = false; clearInterval(timer);
      if (!handedOff.current) native.stopTabletGpu().catch(() => {});
    };
  }, []);
  async function run(label: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await operation(); } catch (e: any) { if (mounted.current) setError(e?.message || '연결을 확인해 주세요.'); }
    finally { if (mounted.current) setBusy(''); }
  }
  function button(label: string, fn: () => Promise<void>, disabled = false) {
    return <TouchableOpacity accessibilityRole="button" disabled={Boolean(busy) || disabled} style={[s.button,(busy || disabled) ? s.dim : null]}
      onPress={() => run(label, fn)}><Text style={s.buttonText}>{label}</Text></TouchableOpacity>;
  }
  return <View style={s.panel}>
    <Text style={s.title}>두 Android 기기로 실행</Text>
    <Text style={s.detail}>데이터 케이블로 두 기기를 연결하고 한쪽에서 USB 테더링을 켜세요. 두 기기가 유선 네트워크를 지원해야 해요.</Text>
    {qr ? <>
      <Image accessibilityLabel="GPU 연결용 QR 코드" source={{uri:qr}} style={s.qr}/>
      <Text style={s.detail}>모델이 있는 기기로 이 QR을 스캔하세요. 공유하는 동안 이 화면을 열어 두세요.</Text>
      {button('연결 정보 복사', async () => { if (donorInfo.current) Clipboard.setString(donorInfo.current); })}
      {button('GPU 제공 중지', async () => { await native.stopTabletGpu(); setQr(''); })}
    </> : <>
      {button('이 기기의 GPU 제공하기', async () => {
        await native.prepareTabletPeer();
        try {
          if (!mounted.current) { await native.stopUsbGpuPeer(); return; }
          const info = await native.offerTabletGpu();
          if (!mounted.current) { await native.stopTabletGpu(); return; }
          donorInfo.current = info; setQr(await native.showCableQr(info));
        }
        catch (e) { await native.stopUsbGpuPeer(); throw e; }
      })}
      <Text style={s.detail}>{filename ? '실행할 모델 · ' + modelName : '주 기기에 GGUF 모델을 설치하고 모델 목록에서 선택하세요.'}</Text>
      {button(invite ? '보조 기기 QR 다시 스캔' : '보조 기기 QR 스캔', async () => { const value = await native.scanCableQr(); if (value) setInvite(value); }, !filename)}
      <TextInput accessibilityLabel="GPU 연결 정보" value={invite} onChangeText={setInvite} placeholder="또는 연결 정보 붙여넣기" placeholderTextColor="#939994"
        autoCorrect={false} autoCapitalize="none" secureTextEntry style={s.input}/>
      {button('두 GPU로 모델 열기', async () => { const session = await native.joinTabletGpu(invite.trim(), filename); if (mounted.current) { handedOff.current = true; onSession(session); } else await native.stopTabletGpu(); }, !filename || !invite.trim())}
    </>}
    {busy ? <Text accessibilityLiveRegion="polite" style={s.detail}>{busy} 진행 중…</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
  </View>;
}
const s=StyleSheet.create({
  panel:{backgroundColor:'#232A28',padding:14,borderRadius:16,gap:9,marginBottom:16},
  title:{fontSize:17,fontWeight:'700',color:'#F2F5F3'},detail:{fontSize:13,lineHeight:19,color:'#C1CCC6'},
  button:{padding:12,borderRadius:10,backgroundColor:'#33443E',alignItems:'center'},buttonText:{color:'#B0E8D3',fontWeight:'600'},
  input:{color:'#EEE',padding:9,backgroundColor:'#2C332F',borderRadius:8},qr:{width:188,height:188,alignSelf:'center'},
  dim:{opacity:0.5},error:{color:'#FFD2AA'},
});

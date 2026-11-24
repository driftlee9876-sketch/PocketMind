import React, {useEffect, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {submitIntegrationAction} from './integrationActions';

export interface DriveAttachment { name:string; text:string; truncated:boolean }
type FileRow = {id:string; name:string; mimeType:string};

export function DriveAttachmentSheet({endpoint, token, onClose, onAttach}:{
  endpoint:string; token:string; onClose:()=>void; onAttach:(file:DriveAttachment)=>void;
}) {
  const [query,setQuery] = useState('');
  const [rows,setRows] = useState<FileRow[]>([]);
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const epoch = useRef(0);
  async function load(file?:FileRow) {
    const current = ++epoch.current;
    setBusy(true); setStatus(file ? '본문을 읽는 중…' : '검색 중…');
    try {
      if (!token) throw Error('설정에서 개인 Coordinator 키를 입력하고 Google Drive를 연결하세요.');
      const reply = await submitIntegrationAction(endpoint,token,'google-drive', file ? 'read_content' : 'search_files',file ? {fileId:file.id} : {query});
      if (epoch.current !== current) return;
      if (reply.status !== 'completed') throw Error(reply.lastError || 'Google Drive 연결을 확인하세요.');
      const result = JSON.parse(reply.result || '{}');
      if (file) {
        if (typeof result.text !== 'string' || !result.text.trim()) throw Error('파일 본문을 읽을 수 없어요.');
        onAttach({name:file.name,text:result.text,truncated:result.truncated===true});
      } else {
        const files: FileRow[] = (result.files || []).filter((r:FileRow) => r.id && (r.mimeType==='application/pdf' || r.mimeType==='application/vnd.google-apps.document' || r.mimeType?.startsWith('text/')));
        setRows(files); setStatus(files.length ? '' : '첨부할 문서가 없어요. 다른 이름으로 검색해 보세요.');
      }
    } catch (error) { if (current===epoch.current) setStatus(error instanceof Error ? error.message : 'Drive를 열 수 없어요.'); }
    finally {if (current===epoch.current) setBusy(false);}
  }
  useEffect(()=>{load();return ()=>{epoch.current++;};},[endpoint,token]);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={s.overlay}><View style={s.sheet}>
    <View style={s.row}><Text style={s.title}>Drive에서 첨부</Text><Pressable onPress={onClose} accessibilityRole="button"><Text style={s.text}>닫기</Text></Pressable></View>
    <View style={s.row}><TextInput autoCapitalize="none" placeholder="파일 이름" placeholderTextColor="#aaa" style={[s.text,s.input]} value={query} onChangeText={setQuery} onSubmitEditing={()=>load()}/>
    <Pressable disabled={busy} onPress={()=>load()}><Text style={s.text}>검색</Text></Pressable></View>
    {!!status && <Text accessibilityLiveRegion="polite" style={s.text}>{status}</Text>}
    <ScrollView keyboardShouldPersistTaps="handled">{rows.map(row=><Pressable key={row.id} disabled={busy} style={s.file} onPress={()=>load(row)}><Text style={s.text}>{row.name}</Text></Pressable>)}</ScrollView>
  </View></View></Modal>;
}
const s=StyleSheet.create({
  overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#0008'},sheet:{backgroundColor:'#252525',borderTopLeftRadius:24,borderTopRightRadius:24,padding:22,gap:16,maxHeight:'80%'},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},title:{color:'white',fontSize:20,fontWeight:'600'},text:{color:'#ececec',fontSize:16},
  input:{flex:1,backgroundColor:'#383838',padding:12,borderRadius:12},file:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#555'},
});

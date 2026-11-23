import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ConnectedAppDefinition, IntegrationActionDefinition } from './connectedAppsCatalog';

export interface ActionSelection { app: ConnectedAppDefinition; action: IntegrationActionDefinition; prompt: string }

type Field = readonly [key: string, label: string, optional?: boolean];
const meeting: Field[] = [['subject', '제목'], ['start', '시작 시각 (예: 2026-11-25T10:00:00+09:00)'], ['end', '종료 시각 (시간대 포함)']];
const fieldsByAction: Record<string, Field[]> = {
  'google-gmail/search_messages': [['query', '검색어', true]],
  'google-drive/search_files': [['query', '파일 이름', true]],
  'google-calendar/list_events': [],
  'github/list_repositories': [],
  'github/search_issues': [['query', '검색어']],
  'github/create_issue': [['owner', '저장소 소유자'], ['repo', '저장소 이름'], ['title', '이슈 제목'], ['body', '본문', true]],
  'github/merge_pull_request': [['owner', '저장소 소유자'], ['repo', '저장소 이름'], ['number', 'PR 번호'], ['sha', '승인할 커밋 SHA']],
  'microsoft-outlook/search_messages': [['query', '검색어', true]],
  'microsoft-calendar/list_events': [],
  'microsoft-calendar/create_event': meeting,
  'microsoft-calendar/cancel_event': [['eventId', '취소할 일정 ID'], ['comment', '참석자에게 보낼 메모', true]],
  'microsoft-onedrive/list_files': [['folderId', '폴더 ID (비우면 최상위)', true]],
  'microsoft-onedrive/delete_file': [['fileId', '삭제할 파일 ID']],
  'microsoft-teams/create_meeting': meeting,
  'microsoft-teams/search_messages': [['query', '검색어']],
  'microsoft-teams/send_message': [['chatId', '받는 채팅 ID'], ['body', '메시지']],
};
export function IntegrationInputSheet({ selection, onCancel, onSubmit }: {
  selection: ActionSelection;
  onCancel: () => void;
  onSubmit: (input: Record<string, unknown>, preview: string) => void;
}) {
  const { app, action, prompt } = selection;
  const fields = fieldsByAction[app.id + '/' + action.id];
  const [values, setValues] = useState<Record<string, string>>((): Record<string, string> => fields?.some(([key]) => key === 'query') && prompt ? {query: prompt} : {});
  const mail = ['google-gmail', 'microsoft-outlook'].includes(app.id) && ['send_message', 'create_draft'].includes(action.id);
  const [to, setTo] = useState(prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '');
  const [subject, setSubject] = useState(prompt.match(/(?:^|\n)(?:제목|subject)\s*[:：]\s*([^\n]+)/i)?.[1] || '');
  const [body, setBody] = useState(mail ? prompt.match(/(?:^|\n)(?:본문|내용|body)\s*[:：]\s*([\s\S]+)/i)?.[1] || '' : prompt);
  const [error, setError] = useState('');
  function submit() {
    if (fields) {
      const missing = fields.find(([key, , optional]) => !optional && !values[key]?.trim());
      if (missing) { setError(missing[1] + ' 항목을 입력해 주세요.'); return; }
      const input = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
      const preview = fields.filter(([key]) => input[key]).map(([key, label]) => label + ' · ' + input[key]).join('\n');
      onSubmit(input, preview || action.label);
      return;
    }
    if (mail) {
      if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim()) || !subject.trim() || !body.trim()) {
        setError('받는 사람의 이메일, 제목, 본문을 입력해 주세요.');
        return;
      }
      onSubmit({ to: to.trim(), subject: subject.trim(), body: body.trim() }, `${to.trim()}\n${subject.trim()}\n\n${body.trim()}`);
      return;
    }
    if (!body.trim()) { setError('요청 내용을 입력해 주세요.'); return; }
    if (body.trim().startsWith('{')) {
      try {
        const fields = JSON.parse(body);
        if (!fields || Array.isArray(fields) || typeof fields !== 'object') throw Error();
        onSubmit(fields, body);
      } catch { setError('작업 필드의 JSON 형식을 확인해 주세요.'); }
    } else onSubmit({ prompt: body.trim() }, body.trim());
  }
  return <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onCancel}>
    <View style={s.overlay}><View style={s.sheet}>
      <Text style={s.title}>{app.name} · {action.label}</Text>
      <ScrollView keyboardShouldPersistTaps="handled">
        {mail && <>
          <Text style={s.label}>받는 사람</Text>
          <TextInput accessibilityLabel="받는 사람" style={s.input} autoCapitalize="none" keyboardType="email-address" value={to} onChangeText={setTo} />
          <Text style={s.label}>제목</Text>
          <TextInput accessibilityLabel="제목" style={s.input} value={subject} onChangeText={setSubject} />
        </>}
        {fields ? fields.map(([key, label, optional]) => <View key={key}>
          <Text style={s.label}>{label}{optional ? ' (선택)' : ''}</Text>
          <TextInput accessibilityLabel={label} style={s.input} value={values[key] || ''} multiline={key === 'body'}
            autoCapitalize="none" onChangeText={value => setValues(previous => ({...previous, [key]: value}))}/>
        </View>) : <>
        <Text style={s.label}>{mail ? '본문' : '요청 내용 또는 작업 필드(JSON)'}</Text>
        <TextInput accessibilityLabel={mail ? '본문' : '요청 내용'} multiline style={[s.input, s.body]} value={body} onChangeText={setBody} />
        </>}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <View style={s.footer}>
          <TouchableOpacity accessibilityRole="button" onPress={onCancel} style={s.button}><Text style={s.label}>취소</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={submit} style={s.button}><Text style={s.submit}>{action.risk === 'read' ? '조회하기' : '승인 내용 확인'}</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </View></View>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 640, maxHeight: '90%', padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#242625' },
  title: { color: '#F1F3F2', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { color: '#CED4D0', fontSize: 14, marginVertical: 6 },
  input: { borderRadius: 10, color: '#F1F3F2', backgroundColor: '#313633', padding: 10, fontSize: 16 },
  body: { minHeight: 80, textAlignVertical: 'top' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center', paddingTop: 12 },
  button: { padding: 9 }, submit: { color: '#83DDC7', fontSize: 15, fontWeight: '700' },
  error: { color: '#E9B588', marginTop: 8 },
});

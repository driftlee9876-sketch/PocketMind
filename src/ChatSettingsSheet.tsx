import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { ChatPreferences, EnterMode } from './chatPreferences';

const enterOptions: Array<{ mode: EnterMode; title: string; hint: string }> = [
  { mode: 'newline', title: '줄바꿈', hint: '보낼 때는 입력창의 화살표를 눌러요.' },
  { mode: 'send', title: '바로 전송', hint: '내용을 입력한 뒤 Enter를 누르면 보내요.' },
  { mode: 'blankLine', title: '빈 줄에서 전송', hint: '끝에서 줄을 바꾸고 Enter를 한 번 더 누르면 보내요.' },
];

export function ChatSettingsSheet({ visible, values, onChange, onClose }: {
  visible: boolean;
  values: ChatPreferences;
  onChange: (changes: Partial<ChatPreferences>) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="설정 닫기" />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>채팅 설정</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.done}>완료</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Enter 키 동작</Text>
            {enterOptions.map(option => {
              const selected = values.enterMode === option.mode;
              return (
                <Pressable key={option.mode} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                  onPress={() => onChange({ enterMode: option.mode })} style={styles.row}>
                  <View style={styles.copy}>
                    <Text style={styles.label}>{option.title}</Text>
                    <Text style={styles.hint}>{option.hint}</Text>
                  </View>
                  <View style={[styles.radio, selected && styles.selected]}>{selected && <View style={styles.dot} />}</View>
                </Pressable>
              );
            })}
            <Text style={styles.section}>대화 화면</Text>
            {([['autoScroll', '새 답변으로 자동 스크롤'], ['largeText', '대화 글자 크게'], ['showMetrics', '상단에 기기 상태 표시']] as const)
              .map(([key, label]) => (
                <View key={key} style={styles.row}>
                  <Text style={[styles.label, styles.copy]}>{label}</Text>
                  <Switch accessibilityLabel={label} value={values[key]} onValueChange={value => onChange({ [key]: value })}
                    trackColor={{ false: '#444846', true: '#16836D' }} />
                </View>
              ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: '#232524', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 18, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: '#F4F5F4', fontSize: 22, fontWeight: '700' },
  done: { color: '#83DDC7', fontWeight: '600', padding: 8, fontSize: 15 },
  section: { color: '#A5BBB3', fontWeight: '600', fontSize: 13, marginTop: 16, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#393D3A', gap: 16 },
  copy: { flex: 1 },
  label: { color: '#F1F2F1', fontSize: 16 },
  hint: { color: '#B6B9B7', fontSize: 13, lineHeight: 19, marginTop: 3 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#757C78', alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: '#83DDC7' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#83DDC7' },
});

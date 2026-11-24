import React from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

export function AssistantBody({text,large}:{text:string;large:boolean}) {
  const parts=text.split(/^\x60\x60\x60([^\n]*)\n?/m);
  const blocks:React.ReactNode[]=[];
  // The capture groups are the labels on opening fences and empty strings on closing fences.
  for(let index=0; index<parts.length; index+=2) {
    const content=parts[index];
    if(!content.trim()) continue;
    if(index%4===2) {
      blocks.push(<View key={index} style={s.code}><View style={s.bar}>
        <Text style={s.label}>{parts[index-1]?.trim() || '코드'}</Text>
        <Pressable accessibilityRole="button" onPress={()=>Clipboard.setString(content.trimEnd())}><Text style={s.label}>복사</Text></Pressable></View>
        <ScrollView horizontal><Text selectable style={[s.mono,large && s.large]}>{content.trimEnd()}</Text></ScrollView></View>);
    } else {
      blocks.push(<Text selectable key={index} style={[s.text,large && s.large]}>{content.trim().split('\n').map((line,n)=>{
        const heading=/^#{1,6}\s+/.test(line);
        return <Text key={n} style={heading?s.heading:undefined}>{n>0?'\n':''}{line.replace(/^#{1,6}\s+/,'').replace(/^\s*[-*]\s+/,'• ').split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith('**') && part.endsWith('**')?<Text key={j} style={s.bold}>{part.slice(2,-2)}</Text>:part)}</Text>;
      })}</Text>);
    }
  }
  return <View style={s.body}>{blocks}</View>;
}
const s=StyleSheet.create({body:{gap:12},text:{color:'#ececec',fontSize:16,lineHeight:25},large:{fontSize:19,lineHeight:29},heading:{fontSize:19,fontWeight:'700'},bold:{fontWeight:'700'},
  code:{backgroundColor:'#171717',borderRadius:14,padding:14,gap:12},bar:{flexDirection:'row',justifyContent:'space-between'},label:{fontSize:13,color:'#c4c4c4'},
  mono:{fontFamily:Platform.OS==='ios'?'Menlo':'monospace',fontSize:14,color:'#eee',lineHeight:21}});

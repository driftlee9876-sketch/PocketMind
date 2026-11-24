import React from 'react';
import {Image} from 'react-native';
const icons = {
  menu: require('./chat-icons/menu.png'),
  compose: require('./chat-icons/compose.png'),
  plus: require('./chat-icons/plus.png'),
  send: require('./chat-icons/send.png'),
  down: require('./chat-icons/down.png'),
  copy: require('./chat-icons/copy.png'),
  retry: require('./chat-icons/retry.png'),
  share: require('./chat-icons/share.png'),
  stop: require('./chat-icons/stop.png'),
};
export function ChatIcon({name,size=22,color='#ececec'}:{name:keyof typeof icons;size?:number;color?:string}) {
  return <Image accessible={false} source={icons[name]} style={{width:size,height:size,tintColor:color}}/>;
}

import {attachmentPrompt} from './attachmentPrompt';
import type {DriveAttachment} from './DriveAttachmentSheet';
export type Turn = {role:'user'|'assistant';content:string};
type Entry = {role:'user'|'assistant';text:string;attachment?:DriveAttachment;issue?:string};

export function conversationContext(entries:Entry[], compact:boolean):Turn[] {
  return entries.filter(entry=>entry.text.trim()).map(entry=>({
    role:entry.role, content:entry.attachment ? attachmentPrompt(entry.text,entry.attachment,compact) : entry.text,
  }));
}

// Keep recent, complete turns within the budget available to small local models.
export function recentTurns(history:Turn[], budget:number):Turn[] {
  const selected:Turn[]=[];
  for(let i=history.length-1;i>=0 && selected.length<20;i--){
    const turn=history[i];
    const cost=turn.content.length+12;
    if(cost>budget)break;
    selected.unshift(turn);budget-=cost;
  }
  if(selected[0]?.role==='assistant')selected.shift();
  return selected;
}

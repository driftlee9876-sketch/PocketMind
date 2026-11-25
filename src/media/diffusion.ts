import type * as Runtime from 'onnxruntime-react-native';
import {encode} from 'fast-png';
export type Ort=typeof Runtime;

// CLIP byte-level BPE. Use the vocabulary and merge ranks shipped with each checkpoint.
export function clipTokens(prompt:string,vocab:Record<string,number>,merges:string){
  const bytes:number[]=[];
  for(let i=0;i<256;i++)if((i>=33 && i<=126)||(i>=161 && i<=172)||(i>=174))bytes.push(i);
  const chars:Record<number,string>={};for(const b of bytes)chars[b]=String.fromCharCode(b);
  let extra=256;for(let i=0;i<256;i++)if(!chars[i])chars[i]=String.fromCharCode(extra++);
  const ranks=new Map(merges.trim().split(/\r?\n/).filter(l=>l && !l.startsWith('#version')).map((l,i)=>[l.trim(),i]));
  const ids=[vocab['<|startoftext|>']];
  for(const token of prompt.normalize('NFC').toLowerCase().match(/'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu)||[]){
    let parts=Array.from(encodeURIComponent(token).replace(/%([0-9A-F]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16))),c=>chars[c.charCodeAt(0)]);
    parts[parts.length-1]+='</w>';
    while(parts.length>1){
      let best=Infinity,pair='';
      for(let i=0;i<parts.length-1;i++){const k=parts[i]+' '+parts[i+1],rank=ranks.get(k);if(rank!==undefined && rank<best){best=rank;pair=k;}}
      if(!pair)break;
      const next:string[]=[];for(let i=0;i<parts.length;i++){if(i+1<parts.length && parts[i]+' '+parts[i+1]===pair){next.push(parts[i]+parts[++i]);}else next.push(parts[i]);}
      parts=next;
    }
    ids.push(...parts.map(p=>vocab[p]??vocab['<|endoftext|>']));if(ids.length>=76)break;
  }
  ids.length=Math.min(ids.length,76);while(ids.length<77)ids.push(vocab['<|endoftext|>']);return ids;
}

export async function generateImage(ort:Ort,dir:string,sdxs:boolean,prompt:string,
    vocab:Record<string,number>,merges:string,steps:number,signal:AbortSignal,status:(v:string)=>void){
  function check(){if(signal.aborted)throw Error('생성 취소');}
  const session=(file:string)=>ort.InferenceSession.create(dir+'/'+file+'.onnx',{
    executionProviders:['cpu'],intraOpNumThreads:3,enableCpuMemArena:false,enableMemPattern:false,
    graphOptimizationLevel:'basic',
  });
  const tensor=(values:Float32Array,dims:number[])=>new ort.Tensor('float32',values,dims);
  const ids=clipTokens(prompt,vocab,merges);
  check();status('프롬프트를 읽는 중…');
  const encoder=await session('text_encoder');
  let condition:Runtime.Tensor,unconditional:Runtime.Tensor|undefined;
  async function embed(tokens:number[]){
    const meta=encoder.inputMetadata[0];
    const input=meta.isTensor && meta.type==='int64'?new ort.Tensor('int64',BigInt64Array.from(tokens,BigInt),[1,77]):new ort.Tensor('int32',Int32Array.from(tokens),[1,77]);
    const outputs=await encoder.run({[encoder.inputNames[0]]:input},[encoder.outputNames[0]]);
    return outputs[encoder.outputNames[0]];
  }
  try{condition=await embed(ids);if(!sdxs)unconditional=await embed(clipTokens('',vocab,merges));}finally{await encoder.release();}
  const N=4*64*64,latent=new Float32Array(N);
  const sigmas:number[]=[];let alpha=1;
  for(let i=0;i<1000;i++){const b=Math.sqrt(.00085)+(Math.sqrt(.012)-Math.sqrt(.00085))*i/999;alpha*=1-b*b;sigmas.push(Math.sqrt((1-alpha)/alpha));}
  const count=sdxs?1:Math.max(2,Math.min(30,steps));
  for(let i=0;i<N;i+=2){const r=Math.sqrt(-2*Math.log(1-Math.random()))*sigmas[999],a=Math.random()*Math.PI*2;latent[i]=r*Math.cos(a);latent[i+1]=r*Math.sin(a);}
  check();const unet=await session('unet');
  try{
    for(let step=0;step<count;step++){
      check();status(`이미지 생성 중 · ${step+1}/${count}`);
      const t=count===1?999:Math.round(999*(1-step/(count-1)));
      const sigma=sigmas[t],next=step===count-1?0:sigmas[Math.round(999*(1-(step+1)/(count-1)))];
      const sample=tensor(latent.map(v=>v/Math.sqrt(sigma*sigma+1)),[1,4,64,64]);
      const tm=unet.inputMetadata.find(m=>m.name==='timestep');
      const time=tm?.isTensor && tm.type==='int64'?new ort.Tensor('int64',BigInt64Array.of(BigInt(t)),[1]):tensor(Float32Array.of(t),[1]);
      const predict=async(h:Runtime.Tensor)=>{const res=await unet.run({sample,timestep:time,encoder_hidden_states:h});return res[unet.outputNames[0]].data as Float32Array;};
      const pred=await predict(condition);
      const neg=unconditional?await predict(unconditional):undefined;
      for(let i=0;i<N;i++){const eps=neg?neg[i]+7*(pred[i]-neg[i]):pred[i];latent[i]+=(next-sigma)*eps;}
    }
  }finally{await unet.release();}
  check();status('이미지 저장 중…');const vae=await session('vae_decoder');
  try{
    const res=await vae.run({[vae.inputNames[0]]:tensor(sdxs?latent:latent.map(v=>v/.18215),[1,4,64,64])});
    const image=res[vae.outputNames[0]],planes=image.data as Float32Array;
    const [,channels,h,w]=image.dims;if(channels!==3 || !h || !w)throw Error('이미지 출력 형식을 읽지 못했어요.');
    const rgb=new Uint8Array(w*h*3);for(let i=0;i<w*h;i++)for(let c=0;c<3;c++)rgb[3*i+c]=Math.round(Math.max(0,Math.min(1,planes[c*w*h+i]/2+.5))*255);
    check();return encode({width:w,height:h,channels:3,data:rgb});
  }finally{await vae.release();}
}

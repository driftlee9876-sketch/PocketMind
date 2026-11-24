const fs=require('node:fs');
const {generateImage}=require('./diffusion.cjs');
const ort=require('onnxruntime-node');
(async()=>{
  let input='';process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin)input+=chunk;
  const {dir,mode,prompt,out}=JSON.parse(input);
  const vocab=JSON.parse(fs.readFileSync(dir+'/vocab.json','utf8'));
  const merges=fs.readFileSync(dir+'/merges.txt','utf8');
  const png=await generateImage(ort,dir,mode==='sdxs',prompt,vocab,merges,16,new AbortController().signal,
    message=>process.stdout.write(message+'\n'));
  fs.writeFileSync(out,png);
})().catch(e=>{console.error(e.message);process.exitCode=1});

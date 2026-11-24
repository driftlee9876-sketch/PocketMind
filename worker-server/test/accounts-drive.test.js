const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {readDriveContent} = require('../drive-content');

test('individual Drive sessions and action results survive restart and stay private', async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pm-account-'));
  const preload=path.join(dir,'provider.cjs');
  await fs.writeFile(preload,`
    const remote=fetch;
    global.fetch=(url,opts={})=>{
      if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'a1',refresh_token:'r1',expires_in:3600});
      if(url.includes('userinfo'))return Response.json({email:'alice@example.test'});
      if(url.includes('/drive/v3/files/doc?fields='))return Response.json({id:'doc',mimeType:'application/vnd.google-apps.document',name:'Study'});
      if(url.includes('/export?'))return new Response('Mock document body');
      return remote(url,opts);
    };`);
  const admin='admin-'+'a'.repeat(40), enrollment='enroll-'+'e'.repeat(40);
  let child,base;
  async function start() {
    child=spawn(process.execPath,['--require',preload,path.join(__dirname,'../server.js')],{
      env:{...process.env,DATABASE_URL:'',HOST:'127.0.0.1',PORT:'0',POCKETMIND_API_TOKEN:admin,
        POCKETMIND_ENROLLMENT_TOKEN:enrollment,POCKETMIND_DATA_FILE:path.join(dir,'state.json'),POCKETMIND_PUBLIC_BASE_URL:'https://example.test',
        POCKETMIND_TOKEN_ENCRYPTION_KEY:'z'.repeat(40),GOOGLE_OAUTH_CLIENT_ID:'test',GOOGLE_OAUTH_CLIENT_SECRET:'test'},stdio:['ignore','pipe','pipe']});
    const [msg]=await once(child.stdout,'data'); base='http://127.0.0.1:'+String(msg).match(/:(\d+)/)[1];
  }
  async function stop(){const exited=once(child,'exit');child.kill();await exited;}
  t.after(async()=>{if(child && child.exitCode===null && !child.signalCode)await stop();await fs.rm(dir,{recursive:true,force:true});});
  await start();
  const call=(route,key,body)=>fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const issue=async()=>{const r=await call('/v1/accounts',admin,{});assert.equal(r.status,201);return (await r.json()).token;};
  const alice=await issue(),bob=await issue();
  assert.equal((await call('/v1/accounts',alice,{})).status,403);
  const oauth=await (await call('/v1/integrations/google-drive/connect',alice,{})).json();
  const nonce=new URL(oauth.authorizationUrl).searchParams.get('state');
  assert.equal((await fetch(base+'/v1/oauth/google/callback?code=test&state='+nonce)).status,200);
  const body={integrationId:'google-drive',action:'read_content',risk:'read',input:{fileId:'doc'}};
  const action=await (await call('/v1/integrations/actions',alice,body)).json();
  assert.equal(JSON.parse(action.result).text,'Mock document body');
  await stop();await start();
  assert.equal((await call('/v1/integrations/actions/'+action.actionId,alice)).status,200);
  assert.equal((await call('/v1/integrations/actions/'+action.actionId,bob)).status,404);
  assert.equal((await call('/v1/integrations/actions',bob,body)).status,409);
  assert.equal((await call('/v1/integrations/actions/'+action.actionId,admin)).status,404);
  const disk=await fs.readFile(path.join(dir,'state.json'),'utf8');
  assert.ok(!disk.includes(alice) && !disk.includes('"refreshToken":"r1"'));
});

test('text PDFs retain page references',async()=>{
  const stream='BT /F1 12 Tf 20 120 Td (Example paragraph) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const start=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';
  const original=global.fetch;global.fetch=async()=>new Response(pdf);
  try {const result=await readDriveContent({id:'p',name:'fixture',mimeType:'application/pdf'},'fixture');assert.match(result.text,/\[1쪽\] Example paragraph/);}
  finally{global.fetch=original;}
});

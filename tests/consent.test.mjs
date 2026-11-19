import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const code=await readFile(new URL('../analytics.js',import.meta.url),'utf8');
const KEY='qingbao.analytics.consent.v2';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function boot({consent,age=0,enabled=true,gpc=false,dnt,storageBlocked=false,offline=false,fetchImpl,scriptError}={}){
  const calls=[],scripts=[],listeners={},cache=new Map(),dialogs=[];
  if(consent)cache.set(KEY,JSON.stringify({value:consent,at:Date.now()-age}));
  const storage={getItem:k=>{if(storageBlocked)throw Error('blocked');return cache.get(k)||null;},setItem:(k,v)=>{if(storageBlocked)throw Error('blocked');cache.set(k,v);}};
  const el=(tag='div')=>({tag,hidden:false,inert:false,disabled:false,children:[],textContent:'',append(child){this.children.push(child);},remove(){},focus(){this.focused=true;},querySelectorAll:()=>dialogs.filter(d=>d.open)});
  const ids=Object.fromEntries(['quoteWorkspace','accessGate','grantAccess','denyAccess','accessStatus'].map(id=>[id,el()]));
  ids.quoteWorkspace.hidden=ids.quoteWorkspace.inert=true;ids.grantAccess.disabled=ids.denyAccess.disabled=true;
  const footer=el(),body=el();body.append=script=>{scripts.push(script.src);queueMicrotask(()=>script.src===scriptError?script.onerror():script.onload());};
  const win={QINGBAO_ANALYTICS:{enabled,publishableKey:'sb_publishable_test',supabaseUrl:'https://testref.supabase.co',siteOrigin:'https://felicialiu14.github.io',sitePath:'/qingbao-quote/'},addEventListener:(type,fn)=>listeners[type]=fn};
  vm.runInNewContext(code,{window:win,location:{protocol:offline?'file:':'https:',origin:'https://felicialiu14.github.io',pathname:'/qingbao-quote/'},document:{getElementById:id=>ids[id],createElement:el,body,querySelector:()=>footer},navigator:{globalPrivacyControl:gpc,doNotTrack:dnt},localStorage:storage,sessionStorage:storage,crypto:webcrypto,URL,AbortController,Date,JSON,Set,Number,TypeError,setTimeout:()=>1,clearTimeout:()=>{},fetch:async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):{status:204};}});
  return {calls,scripts,listeners,ids,cache,dialogs,footer,choice(value){ids[value==='granted'?'grantAccess':'denyAccess'].onclick?.();}};
}
test('initial HTML fails closed without JavaScript and calculator scripts are not loaded eagerly',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<div id="quoteWorkspace" hidden inert>/);
  assert.doesNotMatch(html,/<script\s+src="(?:app|calc)\.js"/);
  const app=boot();assert.equal(app.ids.quoteWorkspace.hidden,true);assert.equal(app.ids.quoteWorkspace.inert,true);
  assert.equal(app.calls.length,0);assert.equal(app.scripts.length,0);
  app.choice('denied');app.listeners['qingbao:quote-generated']();
  assert.equal(app.calls.length,0);assert.equal(app.ids.accessGate.hidden,false);assert.equal(app.ids.quoteWorkspace.hidden,true);
});
test('successful collection unlocks the app, loads scripts in order, and excludes all quote fields',async()=>{
  let release;const app=boot({fetchImpl:()=>new Promise(resolve=>release=resolve)});
  app.choice('granted');assert.equal(app.ids.quoteWorkspace.hidden,true);assert.deepEqual(app.scripts,[]);
  release({status:204});await settle();
  assert.equal(app.ids.quoteWorkspace.hidden,false);assert.equal(app.ids.quoteWorkspace.inert,false);assert.equal(app.ids.accessGate.hidden,true);
  assert.deepEqual(app.scripts,['calc.js','app.js']);
  app.listeners['qingbao:quote-generated']({detail:{cost:1200,profit:18}});
  assert.equal(app.calls.length,2);
  for(const call of app.calls){assert.deepEqual(Object.keys(JSON.parse(call.options.body)).sort(),['eventId','eventType','sessionId']);assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');}
});
test('refusal during pending verification cannot be undone by a late successful response',async()=>{
  let release;const app=boot({fetchImpl:()=>new Promise(resolve=>release=resolve)});
  app.choice('granted');app.choice('denied');
  assert.equal(app.calls[0].options.signal.aborted,true);
  release({status:204});await settle();
  assert.equal(app.ids.quoteWorkspace.hidden,true);assert.deepEqual(app.scripts,[]);
  assert.equal(JSON.parse(app.cache.get(KEY)).value,'denied');
});
test('network failures and rate limits keep the app locked; retry reuses the page event ID',async()=>{
  let status=503;const app=boot({fetchImpl:async()=>({status})});
  app.choice('granted');await settle();assert.equal(app.ids.quoteWorkspace.hidden,true);assert.deepEqual(app.scripts,[]);assert.equal(app.ids.grantAccess.disabled,false);
  status=429;app.choice('granted');await settle();assert.equal(app.ids.quoteWorkspace.hidden,true);assert.match(app.ids.accessStatus.textContent,/稍后/);
  status=204;app.choice('granted');await settle();assert.equal(app.ids.quoteWorkspace.hidden,false);
  assert.equal(new Set(app.calls.map(c=>JSON.parse(c.options.body).eventId)).size,1);
});
test('withdrawal and cross-tab clearing immediately lock open dialogs and preserve the draft',async()=>{
  const app=boot();app.cache.set('qingbao.quote.v1','existing draft');app.choice('granted');await settle();
  const dialog={open:true,close(){this.open=false;}};app.dialogs.push(dialog);
  app.footer.children[0].onclick();app.choice('denied');
  assert.equal(dialog.open,false);assert.equal(app.ids.quoteWorkspace.hidden,true);assert.equal(app.cache.get('qingbao.quote.v1'),'existing draft');
  app.choice('granted');await settle();assert.equal(app.ids.quoteWorkspace.hidden,false);
  assert.deepEqual(app.scripts,['calc.js','app.js']);
  app.listeners.storage({key:null,newValue:null});assert.equal(app.ids.quoteWorkspace.hidden,true);
  const count=app.calls.length;app.listeners['qingbao:quote-generated']();assert.equal(app.calls.length,count);
});
test('privacy signals, expired consent and incomplete configuration never unlock the online tool',async()=>{
  for(const options of [{gpc:true},{dnt:'1'}]){const app=boot({consent:'granted',...options});app.choice('granted');await settle();assert.equal(app.ids.grantAccess.disabled,true);assert.equal(app.ids.quoteWorkspace.hidden,true);assert.equal(app.calls.length,0);assert.equal(app.scripts.length,0);}
  for(const age of [181*86400000,-86400000]){const app=boot({consent:'granted',age});await settle();assert.equal(app.calls.length,0);assert.equal(app.ids.quoteWorkspace.hidden,true);}
  const disabled=boot({enabled:false,consent:'granted'});await settle();assert.equal(disabled.ids.quoteWorkspace.hidden,true);assert.equal(disabled.calls.length,0);assert.equal(disabled.scripts.length,0);
});
test('remembered consent verifies again; blocked storage still requires explicit current-page consent',async()=>{
  const remembered=boot({consent:'granted'});assert.equal(remembered.ids.quoteWorkspace.hidden,true);await settle();assert.equal(remembered.ids.quoteWorkspace.hidden,false);assert.equal(remembered.calls.length,1);
  const app=boot({storageBlocked:true});await settle();assert.equal(app.ids.quoteWorkspace.hidden,true);
  app.choice('granted');await settle();assert.equal(app.ids.quoteWorkspace.hidden,false);
});
test('script download failure remains locked; offline file opens without collection',async()=>{
  const failed=boot({scriptError:'app.js'});failed.choice('granted');await settle();assert.equal(failed.ids.quoteWorkspace.hidden,true);assert.match(failed.ids.accessStatus.textContent,/未能载入/);
  const offline=boot({offline:true});await settle();assert.equal(offline.ids.quoteWorkspace.hidden,false);assert.equal(offline.calls.length,0);
});

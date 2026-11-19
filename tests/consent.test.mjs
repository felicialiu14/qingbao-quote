import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const code=await readFile(new URL('../analytics.js',import.meta.url),'utf8');
function boot({consent,enabled=true,gpc=false,dnt,storageBlocked=false}={}){
  const calls=[],elements=[],listeners={},controls={},cache=new Map();
  if(consent)cache.set('qingbao.analytics.consent.v1',JSON.stringify({value:consent,at:Date.now()}));
  const storage={getItem:k=>{if(storageBlocked)throw Error('blocked');return cache.get(k)||null;},setItem:(k,v)=>{if(storageBlocked)throw Error('blocked');cache.set(k,v);}};
  const el=()=>({hidden:false,dataset:{},setAttribute(){},append(){},querySelector(s){return controls[s]??=(el());},addEventListener(k,fn){this[k]=fn;}});
  const win={QINGBAO_ANALYTICS:{enabled,publishableKey:'sb_publishable_test',supabaseUrl:'https://testref.supabase.co',siteOrigin:'https://felicialiu14.github.io',sitePath:'/qingbao-quote/'},addEventListener:(type,fn)=>listeners[type]=fn};
  vm.runInNewContext(code,{window:win,location:{origin:'https://felicialiu14.github.io',pathname:'/qingbao-quote/'},document:{createElement(){const e=el();elements.push(e);return e;},body:el(),querySelector:()=>el()},navigator:{globalPrivacyControl:gpc,doNotTrack:dnt},localStorage:storage,sessionStorage:storage,crypto:webcrypto,URL,AbortController,Date,JSON,Set,setTimeout:()=>1,clearTimeout:()=>{},fetch:async(url,options)=>{calls.push({url,options});return {};}});
  return {calls,elements,listeners,choice(value){elements[0].click({target:{closest:()=>({dataset:{choice:value}})}});}};
}
test('no event is sent before consent or after refusal',()=>{
  const app=boot();assert.equal(app.calls.length,0);app.listeners['qingbao:quote-generated']();assert.equal(app.calls.length,0);
  app.choice('denied');app.listeners['qingbao:quote-generated']();assert.equal(app.calls.length,0);
});
test('consent permits a page view and success event but never quote values',()=>{
  const app=boot();app.choice('granted');app.listeners['qingbao:quote-generated']({detail:{cost:1200,profit:18}});
  assert.equal(app.calls.length,2);
  for(const call of app.calls){assert.deepEqual(Object.keys(JSON.parse(call.options.body)).sort(),['eventId','eventType','sessionId']);assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');}
  app.choice('denied');app.listeners['qingbao:quote-generated']();assert.equal(app.calls.length,2);
});
test('privacy signals and disabled configuration prevent collection',()=>{
  for(const option of [{gpc:true},{dnt:'1'}]){const app=boot({consent:'granted',...option});app.listeners['qingbao:quote-generated']();app.choice('granted');assert.equal(app.calls.length,0);}
  const disabled=boot({enabled:false,consent:'granted'});assert.equal(disabled.calls.length,0);assert.equal(disabled.elements.length,0);
});
test('blocked storage does not prevent quotation or require tracking',()=>{
  const app=boot({storageBlocked:true});assert.equal(app.calls.length,0);app.choice('denied');assert.equal(app.calls.length,0);
});

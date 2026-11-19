import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCollector,clientIp} from '../supabase/functions/quote-collect/handler.mjs';
const origin='https://felicialiu14.github.io';
const event={eventId:'11111111-1111-4111-8111-111111111111',sessionId:'22222222-2222-4222-8222-222222222222',eventType:'page_view'};
function request(body=event,extra={}){
  return new Request('https://project.supabase.co/functions/v1/quote-collect',{method:'POST',headers:{origin,'content-type':'application/json','apikey':'sb_publishable_test','cf-connecting-ip':'203.0.113.20',...extra},body:JSON.stringify(body)});
}
function collector(result='recorded'){
  const calls=[];
  return {calls,handle:createCollector({supabaseUrl:'https://project.supabase.co',serviceRoleKey:'sb_secret_test',publishableKey:'sb_publishable_test',allowedOrigin:origin,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(result);}})};
}
test('valid event stores edge IP and only approved event fields',async()=>{
  const {handle,calls}=collector();const res=await handle(request());assert.equal(res.status,204);assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(calls[0].options.body),{p_event_id:event.eventId,p_session_id:event.sessionId,p_event_type:'page_view',p_ip:'203.0.113.20'});
  assert.equal(res.headers.get('access-control-allow-origin'),origin);
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(await res.text(),'');assert.equal(res.headers.get('cache-control'),'no-store');
});
test('no read endpoint or cross-origin access is exposed',async()=>{
  const {handle,calls}=collector();
  assert.equal((await handle(request(event,{origin:'https://attacker.example'}))).status,403);
  assert.equal((await handle(new Request('https://project.supabase.co/functions/v1/quote-collect',{headers:{origin}}))).status,405);
  const preflight=await handle(new Request('https://project.supabase.co/functions/v1/quote-collect',{method:'OPTIONS',headers:{origin}}));
  assert.equal(preflight.status,204);assert.equal(calls.length,0);
});
test('IP body fields and quote contents are rejected rather than stored',async()=>{
  const {handle,calls}=collector();
  for(const extra of [{ip:'8.8.8.8'},{cost:600},{profit:18},{customer:'private'},{timestamp:0}])assert.equal((await handle(request({...event,...extra}))).status,400);
  assert.equal(calls.length,0);
});
test('project API key is checked before any write',async()=>{
  const {handle,calls}=collector();
  assert.equal((await handle(request(event,{apikey:''}))).status,401);
  assert.equal((await handle(request(event,{apikey:'wrong'}))).status,401);
  assert.equal(calls.length,0);
});
test('forwarded header spoofing cannot override edge IP; absent edge header fails closed',async()=>{
  assert.equal(clientIp(new Headers({'x-forwarded-for':'8.8.8.8','x-real-ip':'8.8.4.4'})),null);
  assert.equal(clientIp(new Headers({'cf-connecting-ip':'203.0.113.20','x-forwarded-for':'8.8.8.8'})),'203.0.113.20');
  for(const ip of ['','not-an-ip','1.1.1.1,8.8.8.8','2a06:98c0:3600::103'])assert.equal((await collector().handle(request(event,{'cf-connecting-ip':ip}))).status,503);
});
test('malformed, oversized and unsupported requests never reach database',async()=>{
  const {handle,calls}=collector();
  for(const body of [null,[],{}, {...event,eventType:'secret'}, {...event,eventId:'not-a-uuid'}])assert.equal((await handle(request(body))).status,400);
  assert.equal((await handle(request({...event,extra:'x'.repeat(2000)}))).status,413);
  assert.equal((await handle(request(event,{'content-type':'text/plain'}))).status,415);
  assert.equal(calls.length,0);
});
test('rate-limit and backend failures return no details or sensitive data',async()=>{
  assert.equal((await collector('limited').handle(request())).status,429);
  assert.equal((await collector('not_configured').handle(request())).status,503);
  assert.equal((await collector('duplicate').handle(request())).status,204);
  const bad=createCollector({supabaseUrl:'https://project.supabase.co',serviceRoleKey:'test',publishableKey:'sb_publishable_test',allowedOrigin:origin,fetchImpl:async()=>{throw Error('secret contents');}});
  const response=await bad(request());assert.equal(response.status,503);assert.equal(await response.text(),'');
});

import { isIP } from 'node:net';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['page_view', 'quote_generated']);
const LIMIT = 1024;

export async function limitedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body_required');
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMIT) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

export function validEvent(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === 3
    && UUID.test(body.eventId) && UUID.test(body.sessionId) && EVENTS.has(body.eventType)
    && Object.keys(body).every(key => ['eventId','sessionId','eventType'].includes(key));
}

export function clientIp(headers) {
  // Hosted Supabase requests pass through Cloudflare. Never trust client JSON,
  // X-Forwarded-For or X-Real-IP. Missing edge metadata fails closed.
  const ip = (headers.get('cf-connecting-ip') || '').trim();
  if (!isIP(ip) || ip.includes('%') || ip === '2a06:98c0:3600::103') return null;
  return ip;
}

export function createCollector({supabaseUrl, serviceRoleKey, publishableKey, allowedOrigin, fetchImpl = fetch}) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if (origin !== allowedOrigin) return new Response(null, {status:403, headers});
    Object.assign(headers, {
      'Access-Control-Allow-Origin':allowedOrigin,
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'content-type, apikey',
      'Access-Control-Max-Age':'600'
    });
    const reply = status => new Response(null, {status, headers});
    if (request.method === 'OPTIONS') return reply(204);
    if (request.method !== 'POST') return reply(405);
    if (!supabaseUrl || !serviceRoleKey || !publishableKey) return reply(503);
    if (request.headers.get('apikey') !== publishableKey) return reply(401);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415);
    if (Number(request.headers.get('content-length')) > LIMIT) return reply(413);
    const ip = clientIp(request.headers);
    if (!ip) return reply(503);
    let body;
    try { body = await limitedJson(request); }
    catch (error) { return reply(error.message === 'body_too_large' ? 413 : 400); }
    if (!validEvent(body)) return reply(400);
    try {
      const result = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/quote_analytics_record`, {
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':serviceRoleKey,...(serviceRoleKey.startsWith('sb_secret_')?{}:{'Authorization':`Bearer ${serviceRoleKey}`})},
        body:JSON.stringify({p_event_id:body.eventId,p_session_id:body.sessionId,p_event_type:body.eventType,p_ip:ip}),
        signal:AbortSignal.timeout(7000)
      });
      if (!result.ok) return reply(503);
      const outcome = await result.json();
      if (outcome === 'limited') return reply(429);
      if (!['recorded','duplicate'].includes(outcome)) return reply(503);
      return reply(204);
    } catch { return reply(503); }
  };
}

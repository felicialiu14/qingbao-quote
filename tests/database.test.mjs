import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const OWNER='00000000-0000-4000-8000-000000000001', OTHER='00000000-0000-4000-8000-000000000002';
const sid=randomUUID();
before(async()=>{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    insert into auth.users values('${OWNER}'),('${OTHER}');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202611190001_quote_analytics.sql',import.meta.url),'utf8'));
  await db.query('insert into public.quote_analytics_owner(user_id) values($1)',[OWNER]);
});
after(()=>db.close());
async function as(role,uid,fn){
  assert(['anon','authenticated','service_role'].includes(role));
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
  try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}
}
const record=(id=randomUUID(),ip='203.0.113.10',type='page_view')=>db.query('select public.quote_analytics_record($1,$2,$3,$4) as result',[id,sid,type,ip]);
const denied=promise=>assert.rejects(promise,error=>error.code==='42501');

test('anonymous cannot read records, owner mapping, report, limits or invoke privileged collection',async()=>{
  await as('anon',null,async()=>{
    for(const table of ['quote_analytics_events','quote_analytics_owner','quote_analytics_limits'])await denied(db.query(`select * from public.${table}`));
    await denied(db.query('select public.quote_analytics_report()'));
    await denied(record());
  });
});
test('another signed-in account cannot obtain records or grant itself ownership',async()=>{
  await as('authenticated',OTHER,async()=>{
    assert.equal((await db.query('select * from public.quote_analytics_events')).rows.length,0);
    assert.equal((await db.query('select * from public.quote_analytics_owner')).rows.length,0);
    await denied(db.query('select public.quote_analytics_report()'));
    await denied(db.query('insert into public.quote_analytics_owner(user_id) values($1)',[OTHER]));
    await denied(record());
    await denied(db.query('insert into public.quote_analytics_events values($1,$2,$3,$4,now())',[randomUUID(),sid,'page_view','198.51.100.5']));
  });
});
test('server collection is idempotent, owner receives correct aggregates',async()=>{
  const id=randomUUID();
  await as('service_role',null,async()=>{
    assert.equal((await record(id)).rows[0].result,'recorded');
    assert.equal((await record(id)).rows[0].result,'duplicate');
    await record(randomUUID(),'203.0.113.10','quote_generated');
    await record(randomUUID(),'2001:db8::1');
  });
  await as('authenticated',OWNER,async()=>{
    const report=(await db.query('select public.quote_analytics_report(1,1,\'\') as report')).rows[0].report;
    assert.deepEqual(report.metrics,{views:2,ips:2,quotes:1,active_ips:1});
    assert.equal(report.addresses.length,2);
    const filtered=(await db.query('select public.quote_analytics_report(7,1,$1) as report',['203.0.113.'])).rows[0].report;
    assert.equal(filtered.metrics.ips,1);assert.equal(filtered.metrics.quotes,1);
    assert.equal((await db.query('select public.quote_analytics_report(7,2,\'\') as report')).rows[0].report.addresses.length,0);
  });
});
test('even owner cannot insert, modify or delete visitor records through browser credentials',async()=>{
  await as('authenticated',OWNER,async()=>{
    await denied(record());
    await denied(db.query('update public.quote_analytics_events set ip=$1',['198.51.100.99']));
    await denied(db.query('delete from public.quote_analytics_events'));
    await denied(db.query('delete from public.quote_analytics_owner'));
  });
});
test('invalid filters and unsupported event data fail',async()=>{
  await as('authenticated',OWNER,async()=>{
    for(const args of [[0,1,''],[365,1,''],[7,0,''],[7,1,"' OR true --"],[7,1,null]]){
      await assert.rejects(db.query('select public.quote_analytics_report($1,$2,$3)',args),e=>e.code==='22023');
    }
  });
  await as('service_role',null,async()=>{
    await assert.rejects(record(randomUUID(),'203.0.113.0/24'),e=>e.code==='22023');
    await assert.rejects(record(randomUUID(),'203.0.113.10','cost'),e=>e.code==='22023');
  });
});
test('expired rows are invisible even if scheduled cleanup is temporarily delayed',async()=>{
  const id=randomUUID();
  await db.query("insert into public.quote_analytics_events values($1,$2,'page_view','198.51.100.50',now()-interval '31 days')",[id,sid]);
  await as('authenticated',OWNER,async()=>{
    assert.equal((await db.query('select * from public.quote_analytics_events where event_id=$1',[id])).rows.length,0);
    assert.equal((await db.query("select public.quote_analytics_report(30,1,'198.51.100.50') as report")).rows[0].report.metrics.ips,0);
  });
});
test('per-IP rate limits are enforced within the database',async()=>{
  await as('service_role',null,async()=>{
    for(let i=0;i<60;i++)assert.equal((await record(randomUUID(),'192.0.2.88')).rows[0].result,'recorded');
    assert.equal((await record(randomUUID(),'192.0.2.88')).rows[0].result,'limited');
  });
});
test('global cap and single owner constraint cannot be bypassed',async()=>{
  await assert.rejects(db.query('insert into public.quote_analytics_owner(user_id) values($1)',[OTHER]),e=>e.code==='23505');
  await db.query("update public.quote_analytics_limits set hits=20000 where bucket_key='global'");
  await as('service_role',null,async()=>assert.equal((await record(randomUUID(),'192.0.2.99')).rows[0].result,'limited'));
});

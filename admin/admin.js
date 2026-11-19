(() => {
  'use strict';
  const $ = id => document.getElementById(id), config = window.QINGBAO_ANALYTICS;
  const SESSION = 'qingbao.admin.session.v1';
  let backend, session = null, lastReport = null, page = 1, refreshPromise, requestId = 0;
  const count = n => Number(n || 0).toLocaleString('zh-CN');
  const dateTime = value => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const message = (id,text,error=false) => { $(id).textContent=text; $(id).classList.toggle('error',error); };
  function configured() {
    try {
      backend = new URL(config.supabaseUrl);
      if (!config.enabled || backend.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(backend.hostname)) return false;
      const key = config.publishableKey || '';
      if (key.startsWith('sb_publishable_')) return true;
      const claims = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      return claims.role === 'anon';
    } catch { return false; }
  }
  if (!configured()) { $('setupNotice').hidden=false; $('loginForm').hidden=true; return; }
  function saveSession(data, startedAt = Date.now()) {
    session = {access_token:data.access_token,refresh_token:data.refresh_token,
      expires_at:Date.now()+Number(data.expires_in || 3600)*1000,started_at:startedAt};
    if (!session.access_token || !session.refresh_token) throw new Error('登录未成功，请重试。');
    try { sessionStorage.setItem(SESSION,JSON.stringify(session)); } catch {}
  }
  function clearSession() {
    session=null; lastReport=null; requestId++;
    try { sessionStorage.removeItem(SESSION); } catch {}
    $('dashboard').hidden=true; $('loginPanel').hidden=false; $('logout').hidden=true;
    $('loginForm').hidden=false; $('records').replaceChildren(); $('trend').replaceChildren();
    for (const id of ['views','ips','quotes','activeIps']) $(id).textContent='—';
    $('password').value=''; $('export').disabled=true; $('refresh').disabled=false;
  }
  async function api(path, body, token) {
    let response;
    try {
      response=await fetch(`${backend.origin}${path}`,{
        method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json','apikey':config.publishableKey,...(token?{'Authorization':`Bearer ${token}`}:{})},
        body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
      });
    } catch { throw new Error('暂时无法连接后台，请检查网络后重试。'); }
    const data=await response.json().catch(()=>null);
    if (!response.ok) {
      const error=new Error(response.status===429?'操作过于频繁，请稍后重试。':response.status===403 || data?.code==='42501'?'此账号没有管理员查看权限。':'请求未完成，请稍后重试。');
      error.status=response.status; error.code=data?.code; throw error;
    }
    return data;
  }
  async function accessToken(force=false) {
    if (!session || Date.now()-session.started_at>8*3600000) { clearSession(); throw new Error('登录已过期，请重新登录。'); }
    if (!force && session.expires_at-Date.now()>60000) return session.access_token;
    if (!refreshPromise) {
      const previous=session;
      refreshPromise=api('/auth/v1/token?grant_type=refresh_token',{refresh_token:previous.refresh_token})
        .then(data=>{ if (session!==previous) throw new Error('登录已结束。'); saveSession(data,previous.started_at); return session.access_token; })
        .catch(error=>{ if (error.status===400 || error.status===401) clearSession(); throw error; })
        .finally(()=>{refreshPromise=null;});
    }
    return refreshPromise;
  }
  async function reportRequest(filters) {
    try { return await api('/rest/v1/rpc/quote_analytics_report',filters,await accessToken()); }
    catch(error) {
      if(error.status!==401) throw error;
      return api('/rest/v1/rpc/quote_analytics_report',filters,await accessToken(true));
    }
  }
  function cell(row,value) { const td=document.createElement('td'); td.textContent=value; row.append(td); return td; }
  function renderTrend(report) {
    const ns='http://www.w3.org/2000/svg';
    const make=(tag,attrs={},text)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;};
    const values=new Map(report.daily.map(day=>[day.day,day]));
    const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10), days=Number($('days').value), series=[];
    for(let i=days-1;i>=0;i--){const day=new Date(Date.parse(today+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);series.push({day,views:0,quotes:0,...values.get(day)});}
    const width=Math.max(560,days*28), group=width/days, max=Math.max(1,...series.flatMap(d=>[Number(d.views),Number(d.quotes)]));
    const svg=make('svg',{viewBox:`0 0 ${width} 175`,role:'img','aria-label':`${days} 天的访问与报价趋势`});
    series.forEach((d,i)=>{
      const x=i*group+group/2, barWidth=Math.min(20,group/3), v=Math.max(1,Number(d.views)/max*125), q=Math.max(1,Number(d.quotes)/max*125);
      const g=make('g');g.append(make('title',{},`${d.day}：访问 ${d.views} 次，生成报价 ${d.quotes} 次`));
      g.append(make('rect',{x:x-barWidth-1,y:140-v,width:barWidth,height:v,rx:3,fill:'#9ac8b1'}));
      g.append(make('rect',{x:x+1,y:140-q,width:barWidth,height:q,rx:3,fill:'#126b52'}));
      if(days<15 || i%3===0 || i===days-1)g.append(make('text',{x,y:162,'text-anchor':'middle',fill:'#62776d','font-size':12},d.day.slice(5)));
      svg.append(g);
    });
    $('trend').replaceChildren(svg);
  }
  function render(report) {
    lastReport=report;
    $('views').textContent=count(report.metrics.views);$('ips').textContent=count(report.metrics.ips);
    $('quotes').textContent=count(report.metrics.quotes);$('activeIps').textContent=count(report.metrics.active_ips);
    $('updatedAt').textContent=`更新于 ${dateTime(report.updated_at)} · 北京时间`;
    const fragment=document.createDocumentFragment();
    for(const item of report.addresses){
      const row=document.createElement('tr');cell(row,item.ip);cell(row,count(item.views));cell(row,count(item.quotes));
      cell(row,dateTime(item.first_seen));cell(row,dateTime(item.last_seen));
      const badge=document.createElement('span');badge.className='badge'+(item.quotes>0?'':' passive');badge.textContent=item.quotes>0?'已生成报价':'仅访问';cell(row,'').append(badge);fragment.append(row);
    }
    $('records').replaceChildren(fragment);$('empty').hidden=report.addresses.length!==0;
    $('empty').querySelector('p').textContent=report.addresses.length===0 && Number(report.metrics.ips)>0?'当前页已没有记录，请返回上一页。':'访客同意统计后，访问和生成报价单会显示在这里。';
    const totalPages=Math.max(1,Math.ceil(Number(report.metrics.ips)/50));
    $('pageInfo').textContent=`第 ${page} / ${totalPages} 页 · ${count(report.metrics.ips)} 个 IP`;
    $('previous').disabled=page<=1;$('next').disabled=page>=totalPages;$('export').disabled=!report.addresses.length;
    renderTrend(report);$('loginPanel').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;
  }
  async function loadReport() {
    const ip=$('ipSearch').value.trim();
    if(!/^[0-9a-fA-F:.]{0,45}$/.test(ip)){message('dashboardMessage','请输入 IP 地址或其前缀。',true);return;}
    const current=++requestId;
    $('refresh').disabled=true;$('export').disabled=true;message('dashboardMessage','正在获取最新记录…');
    try {
      const report=await reportRequest({p_days:Number($('days').value),p_page:page,p_ip:ip});
      if(current!==requestId)return;
      render(report);message('dashboardMessage','');message('loginMessage','');
    } catch(error) {
      if(current!==requestId && session)return;
      if(error.status===403 || error.code==='42501' || error.status===401){clearSession();message('loginMessage',error.message,true);}
      else message(session && !$('dashboard').hidden?'dashboardMessage':'loginMessage',error.message,true);
      throw error;
    } finally {if(current===requestId)$('refresh').disabled=false;}
  }
  $('loginForm').onsubmit=async event=>{
    event.preventDefault();$('loginButton').disabled=true;message('loginMessage','正在验证管理员身份…');
    try {const data=await api('/auth/v1/token?grant_type=password',{email:$('email').value.trim(),password:$('password').value});$('password').value='';saveSession(data);await loadReport();}
    catch(error){message('loginMessage',error.status===400?'邮箱或密码不正确，或账号尚未开通。':error.message,true);}
    finally{$('password').value='';$('loginButton').disabled=false;}
  };
  $('logout').onclick=()=>{const token=session?.access_token;clearSession();message('loginMessage','已退出登录。');if(token)api('/auth/v1/logout?scope=local',{},token).catch(()=>{});};
  $('days').onchange=()=>{page=1;loadReport().catch(()=>{});};
  $('refresh').onclick=()=>loadReport().catch(()=>{});
  $('searchForm').onsubmit=event=>{event.preventDefault();page=1;loadReport().catch(()=>{});};
  $('clearSearch').onclick=()=>{$('ipSearch').value='';page=1;loadReport().catch(()=>{});};
  $('previous').onclick=()=>{page=Math.max(1,page-1);loadReport().catch(()=>{});};
  $('next').onclick=()=>{page++;loadReport().catch(()=>{});};
  $('export').onclick=()=>{
    if(!lastReport)return;
    const csvCell=value=>'"'+String(value).replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const rows=[['公网 IP','访问次数','生成报价次数','首次记录（北京时间）','最近记录（北京时间）'],...lastReport.addresses.map(r=>[r.ip,r.views,r.quotes,dateTime(r.first_seen),dateTime(r.last_seen)])];
    const blob=new Blob(['\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`轻报访问统计-第${lastReport.page}页.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  try {const saved=JSON.parse(sessionStorage.getItem(SESSION));if(saved && typeof saved.access_token==='string' && typeof saved.refresh_token==='string' && Number.isFinite(saved.started_at) && Number.isFinite(saved.expires_at))session=saved;} catch {}
  if(session)loadReport().catch(()=>{});
  setInterval(()=>{if(session && Date.now()-session.started_at>8*3600000){clearSession();message('loginMessage','登录已过期，请重新登录。');}},60000);
})();

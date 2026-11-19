(() => {
  'use strict';
  const config = window.QINGBAO_ANALYTICS;
  const $ = id => document.getElementById(id);
  const workspace = $('quoteWorkspace'), gate = $('accessGate');
  const grant = $('grantAccess'), deny = $('denyAccess'), status = $('accessStatus');
  if (!workspace || !gate || !grant || !deny || !status) return;
  const KEY = 'qingbao.analytics.consent.v2', SESSION = 'qingbao.analytics.session.v1';
  const MAX_AGE = 180 * 86400000;
  const privacyBlocked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let consent = null, sessionId, pageViewId, backend, appPromise, confirmed = false, attempt = 0;
  const inFlight = new Set(), loadedScripts = new Set();
  const message = text => { status.textContent = text; };
  const readChoice = raw => {
    try {
      const value = JSON.parse(raw), age = Date.now() - value.at;
      return ['granted','denied'].includes(value.value) && Number.isFinite(value.at) && age >= 0 && age < MAX_AGE ? value.value : null;
    } catch { return null; }
  };
  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve,reject) => {
      const script = document.createElement('script'); script.src = src;
      script.onload = () => { loadedScripts.add(src); resolve(); };
      script.onerror = () => { script.remove(); reject(Error('报价工具暂时未能载入，请稍后重试。')); };
      document.body.append(script);
    });
  }
  function loadApp() {
    if (!appPromise) appPromise = loadScript('calc.js').then(() => loadScript('app.js')).catch(error => { appPromise = null; throw error; });
    return appPromise;
  }
  function lock(text, focus = false) {
    attempt++;
    for (const request of inFlight) request.abort();
    for (const dialog of workspace.querySelectorAll('dialog[open]')) dialog.close();
    workspace.hidden = true; workspace.inert = true; gate.hidden = false;
    grant.disabled = privacyBlocked(); deny.disabled = false;
    message(text);
    if (focus) status.focus();
  }
  function unlock() {
    gate.hidden = true; workspace.hidden = false; workspace.inert = false;
  }
  // The downloadable local copy remains a local calculator, with no collection.
  if (location.protocol === 'file:') {
    message('正在打开本地报价工具…');
    loadApp().then(unlock).catch(error => message(error.message));
    return;
  }
  try {
    backend = new URL(config.supabaseUrl);
    if (!config.enabled || !config.publishableKey?.startsWith('sb_publishable_')
      || location.origin !== config.siteOrigin
      || ![config.sitePath,config.sitePath+'index.html'].includes(location.pathname)
      || backend.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(backend.hostname)) throw Error('configuration');
  } catch { message('网站统计服务尚未完成配置，暂时无法进入报价工具。'); return; }
  try { consent = readChoice(localStorage.getItem(KEY)); } catch {}
  function remember(value) {
    consent = value;
    try { localStorage.setItem(KEY,JSON.stringify({value,at:Date.now()})); } catch {}
  }
  function ensureSession() {
    if (sessionId) return;
    try { sessionId = sessionStorage.getItem(SESSION); } catch {}
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId || '')) sessionId = crypto.randomUUID();
    try { sessionStorage.setItem(SESSION,sessionId); } catch {}
    pageViewId = crypto.randomUUID();
  }
  async function send(eventType,eventId) {
    if (consent !== 'granted' || privacyBlocked()) throw Error('尚未允许统计。');
    ensureSession();
    const controller = new AbortController(); inFlight.add(controller);
    const timeout = setTimeout(() => controller.abort(),8000);
    try {
      // Only these three fields leave the calculator. Never read quote inputs.
      const response = await fetch(`${backend.origin}/functions/v1/quote-collect`,{
        method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json',apikey:config.publishableKey},signal:controller.signal,
        body:JSON.stringify({eventId:eventId || crypto.randomUUID(),sessionId,eventType})
      });
      if (response.status !== 204) throw Error(response.status===429?'请求较多，请稍后重试。':'统计服务暂时无法连接，暂不能进入报价工具。请稍后重试。');
    } catch(error) {
      if (error.name==='AbortError' || error instanceof TypeError) throw Error('统计服务暂时无法连接，暂不能进入报价工具。请稍后重试。');
      throw error;
    } finally { clearTimeout(timeout); inFlight.delete(controller); }
  }
  async function enter() {
    if (privacyBlocked()) {
      confirmed = false;
      lock('浏览器当前限制使用统计，因此暂不能进入报价工具。你仍可查看统计说明。',true);
      return;
    }
    if (consent !== 'granted') return;
    const current = ++attempt;
    grant.disabled = true; message('正在确认统计连接…');
    try {
      if (!confirmed) { ensureSession(); await send('page_view',pageViewId); }
      if (current !== attempt || consent !== 'granted' || privacyBlocked()) return;
      confirmed = true;
      message('正在打开报价工具…'); await loadApp();
      if (current !== attempt || consent !== 'granted' || privacyBlocked()) return;
      unlock();
    } catch(error) {
      if (current === attempt) { confirmed = false; lock(error.message,true); }
    } finally { if (current === attempt) grant.disabled = false; }
  }
  grant.onclick = () => { if (privacyBlocked()) return; remember('granted'); enter(); };
  deny.onclick = () => {
    remember('denied'); confirmed = false;
    lock('你已选择不同意统计，暂不能进入报价工具。若之后愿意，可点击“同意统计并进入”。',true);
  };
  const preferences = document.createElement('button');
  preferences.type = 'button'; preferences.className = 'analytics-settings'; preferences.textContent = '统计权限设置';
  document.querySelector('.page-footer')?.append(preferences);
  preferences.onclick = () => lock('你可以撤回统计权限。撤回后，报价工具将立即锁定，本地草稿仍保留。',true);
  window.addEventListener('qingbao:quote-generated',() => {
    if (consent==='granted' && confirmed && !workspace.hidden && !privacyBlocked()) send('quote_generated').catch(()=>{});
  });
  window.addEventListener('storage',event => {
    if (event.key !== KEY && event.key !== null) return;
    consent = readChoice(event.newValue);
    if (consent !== 'granted') {
      confirmed = false;
      lock('统计权限已在其他页面撤回，报价工具已锁定。重新同意后可继续使用。',true);
    }
  });
  if (privacyBlocked()) {
    confirmed = false;
    lock('浏览器当前限制使用统计，因此暂不能进入报价工具。你仍可查看统计说明。');
  } else {
    lock(consent==='denied'?'你之前选择了不同意统计，暂不能进入报价工具。':'使用在线报价工具需要同意下方统计规则。不同意时，报价工具不会开放。');
    if (consent === 'granted') enter();
  }
})();

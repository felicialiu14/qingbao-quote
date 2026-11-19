(() => {
  'use strict';
  const config = window.QINGBAO_ANALYTICS;
  if (!config?.enabled || !config.publishableKey || location.origin !== config.siteOrigin || location.pathname !== config.sitePath && location.pathname !== config.sitePath + 'index.html') return;
  let backend;
  try { backend = new URL(config.supabaseUrl); if (backend.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(backend.hostname)) return; } catch { return; }
  const KEY = 'qingbao.analytics.consent.v1', SESSION = 'qingbao.analytics.session.v1';
  const respectingPreference = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let consent = null, viewed = false, sessionId, inFlight = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && ['granted','denied'].includes(saved.value) && Date.now() - saved.at < 180 * 86400000) consent = saved.value;
  } catch {}
  if (respectingPreference) consent = 'denied';
  try { sessionId = sessionStorage.getItem(SESSION); } catch {}
  if (!/^[0-9a-f-]{36}$/i.test(sessionId || '')) sessionId = crypto.randomUUID();
  try { sessionStorage.setItem(SESSION, sessionId); } catch {}
  const banner = document.createElement('section');
  banner.className = 'analytics-notice'; banner.setAttribute('aria-label','使用情况统计');
  banner.innerHTML = '<div><strong>帮助了解工具的使用情况</strong><p>同意后，记录公网 IP、访问时间和生成报价单次数，应用内记录保留 30 天，仅管理员可查看。不上传报价内容。<a href="privacy.html">查看说明</a></p><p class="analytics-preference" hidden>浏览器已请求不被追踪，统计保持关闭。</p></div><div class="analytics-actions"><button type="button" data-choice="denied">暂不统计</button><button type="button" data-choice="granted">允许统计</button></div>';
  document.body.append(banner);
  const preferences = document.createElement('button');
  preferences.type = 'button'; preferences.className = 'analytics-settings'; preferences.textContent = '隐私与统计设置';
  document.querySelector('.page-footer')?.append(preferences);
  const show = () => {
    banner.hidden = false;
    banner.querySelector('[data-choice="granted"]').disabled = respectingPreference;
    banner.querySelector('.analytics-preference').hidden = !respectingPreference;
  };
  preferences.onclick = show;
  function track(eventType) {
    if (consent !== 'granted' || respectingPreference || !['page_view','quote_generated'].includes(eventType)) return;
    const controller = new AbortController(); inFlight.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Never read form values, local quote drafts, page queries or referrers.
    fetch(`${backend.origin}/functions/v1/quote-collect`, {
      method:'POST', credentials:'omit', referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json','apikey':config.publishableKey}, signal:controller.signal,
      body:JSON.stringify({eventId:crypto.randomUUID(),sessionId,eventType})
    }).catch(() => {}).finally(() => { clearTimeout(timeout); inFlight.delete(controller); });
  }
  function trackView() { if (!viewed) { viewed = true; track('page_view'); } }
  banner.addEventListener('click', event => {
    const value = event.target.closest('[data-choice]')?.dataset.choice;
    if (!value || value === 'granted' && respectingPreference) return;
    consent = value;
    try { localStorage.setItem(KEY,JSON.stringify({value,at:Date.now()})); } catch {}
    banner.hidden = true;
    if (value === 'granted') trackView();
    else { for (const controller of inFlight) controller.abort(); }
  });
  window.addEventListener('qingbao:quote-generated', () => track('quote_generated'));
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    try { consent = JSON.parse(event.newValue)?.value || 'denied'; } catch { consent = 'denied'; }
    if (consent !== 'granted') for (const controller of inFlight) controller.abort();
  });
  banner.hidden = consent !== null;
  if (consent === 'granted') trackView();
})();

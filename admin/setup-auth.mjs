export function createPasswordSetup(config, fetchImpl = fetch) {
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
    || !config.publishableKey?.startsWith('sb_publishable_')) throw Error('后台尚未配置。');
  let access = null, authorized = false;
  async function api(path, method, body, authenticated = false) {
    const response = await fetchImpl(url.origin + path, {
      method, credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json',apikey:config.publishableKey,...(authenticated?{Authorization:`Bearer ${access}`}:{})},
      body:JSON.stringify(body), signal:AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      const error = new Error(response.status===429?'操作过于频繁，请稍后再试。':'操作未完成。');
      error.status = response.status; throw error;
    }
    return response.status===204 ? null : response.json();
  }
  return async (tokenHash, password) => {
    if (typeof password !== 'string' || password.length<12) throw Error('密码至少需要 12 位。');
    if (new TextEncoder().encode(password).length>72) throw Error('密码过长，请控制在 72 个英文字母或约 24 个汉字以内。');
    if (!access) {
      if (!/^[a-zA-Z0-9_-]{40,512}$/.test(tokenHash || '')) throw Error('请使用专属设置链接打开此页。');
      try {
        const data = await api('/auth/v1/verify','POST',{token_hash:tokenHash,type:'recovery'});
        if (!data?.access_token) throw Error('missing session');
        access = data.access_token;
      } catch(error) {
        throw Error(error.status===429?error.message:'设置链接已失效或无法验证。请重新获取专属链接后重试。');
      }
    }
    if (!authorized) {
      try { await api('/rest/v1/rpc/quote_analytics_report','POST',{p_days:1,p_page:1,p_ip:''},true); authorized = true; }
      catch {
        await api('/auth/v1/logout?scope=local','POST',{},true).catch(()=>{});
        access = null; throw Error('此账号没有管理员权限，无法设置后台密码。');
      }
    }
    try { await api('/auth/v1/user','PUT',{password},true); }
    catch(error) { throw Error(error.status===429?error.message:'密码未保存，请检查网络，或换一个更强的密码后重试。'); }
    await api('/auth/v1/logout?scope=global','POST',{},true).catch(()=>{});
    access = null; authorized = false;
  };
}

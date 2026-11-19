import {createPasswordSetup} from './setup-auth.mjs';
const $ = id => document.getElementById(id);
let tokenHash = new URLSearchParams(location.hash.slice(1)).get('token_hash');
// Fragments never reach GitHub; also remove the credential from browser history.
history.replaceState(null,'',location.pathname);
const status = (text,error=false) => { $('setupStatus').textContent=text; $('setupStatus').classList.toggle('error',error); };
let save;
try {
  save = createPasswordSetup(window.QINGBAO_ANALYTICS);
  if (!/^[a-zA-Z0-9_-]{40,512}$/.test(tokenHash || '')) throw Error('请使用专属设置链接打开此页。如已设置密码，可直接前往登录后台。');
  $('passwordForm').hidden=false;
} catch(error) { status(error.message,true); $('complete').hidden=false; }
$('passwordForm').onsubmit = async event => {
  event.preventDefault();
  const password = $('newPassword').value;
  if (password !== $('confirmPassword').value) { status('两次输入的密码不一致。',true); return; }
  $('savePassword').disabled=true; status('正在验证身份并保存密码…');
  try {
    await save(tokenHash,password); tokenHash=null;
    $('passwordForm').hidden=true; $('complete').hidden=false;
    status('密码设置成功。现在可以使用管理员邮箱登录。');
  } catch(error) { status(error.message || '暂时无法连接，请稍后重试。',true); }
  finally { $('newPassword').value=''; $('confirmPassword').value=''; $('savePassword').disabled=false; }
};

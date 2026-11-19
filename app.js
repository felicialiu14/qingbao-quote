(() => {
  'use strict';
  const M = window.QuoteMath, $ = id => document.getElementById(id);
  const KEY = 'qingbao.quote.v1';
  const presets = [
    {id:'solar',name:'组件',mode:'direct'}, {id:'battery',name:'锂电池',mode:'direct'},
    {id:'mount',name:'支架',mode:'tax'}, {id:'inverter',name:'逆变器',mode:'tax'},
    {id:'cable',name:'线缆',mode:'tax'}, {id:'accessory',name:'辅材',mode:'tax'}
  ];
  const currencies = ['USD','EUR','CNY','GBP','AUD','HKD','JPY'];
  const uid = () => globalThis.crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const newRow = (category='solar',profit='18') => ({id:uid(),category,name:'',cost:'',profit,solarWatts:'',inverterPower:'',batteryCapacity:''});
  const initial = () => ({version:1,currency:'USD',rate:'',defaultProfit:'18',custom:[],rows:presets.slice(0,5).map(c=>newRow(c.id))});
  let state = initial(), saved = false;
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data?.version === 1 && Array.isArray(data.rows) && Array.isArray(data.custom)) {
      state.currency = currencies.includes(data.currency) ? data.currency : 'USD';
      state.rate = typeof data.rate === 'string' ? data.rate : '';
      state.defaultProfit = typeof data.defaultProfit === 'string' ? data.defaultProfit : '18';
      const used = new Set(presets.map(c=>c.id));
      state.custom = data.custom.filter(c=>{
        if (!c || typeof c.id!=='string' || used.has(c.id) || typeof c.name!=='string' || !c.name.trim() || !['direct','tax'].includes(c.mode)) return false;
        used.add(c.id);return true;
      }).map(c=>({id:c.id,name:c.name.slice(0,40),mode:c.mode}));
      state.rows = data.rows.filter(r=>r && typeof r==='object').map(r=>({id:uid(),category:used.has(r.category)?r.category:'solar',name:String(r.name??'').slice(0,80),cost:String(r.cost??''),profit:String(r.profit??'18'),solarWatts:String(r.solarWatts??''),inverterPower:String(r.inverterPower??'').slice(0,40),batteryCapacity:String(r.batteryCapacity??'').slice(0,40)}));
      saved = true;
    }
  } catch { /* The app remains usable when browser storage is unavailable. */ }
  let saveTimer, toastTimer, confirmedAction, snapshot, submitted = false;
  const categories = () => [...presets,...state.custom];
  const category = id => categories().find(c=>c.id===id) || presets[0];
  function toast(message) { $('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500); }
  function persistNow() {
    try { localStorage.setItem(KEY,JSON.stringify(state));$('saveStatus').textContent='草稿已保存至本地'; }
    catch { $('saveStatus').textContent='本地保存不可用';toast('浏览器无法保存草稿，请及时导出报价'); }
  }
  function persist() { $('saveStatus').textContent='正在保存草稿';clearTimeout(saveTimer);saveTimer=setTimeout(persistNow,250); }
  function options(selected) { return categories().map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join(''); }
  function specMarkup(r) {
    if (r.category==='solar') return `<label class="spec-label" for="spec-${esc(r.id)}">功率瓦数</label><div class="spec-input-wrap"><input id="spec-${esc(r.id)}" data-field="solarWatts" aria-label="组件功率瓦数 W" inputmode="decimal" autocomplete="off" placeholder="例如 550" value="${esc(r.solarWatts)}"><span>W</span></div>`;
    if (r.category==='inverter') return `<label class="spec-label" for="spec-${esc(r.id)}">逆变器功率</label><input id="spec-${esc(r.id)}" data-field="inverterPower" aria-label="逆变器功率" maxlength="40" placeholder="例如 10 kW" value="${esc(r.inverterPower)}"><span class="spec-help">规格标识，选填</span>`;
    if (r.category==='battery') return `<label class="spec-label" for="spec-${esc(r.id)}">电池容量</label><input id="spec-${esc(r.id)}" data-field="batteryCapacity" aria-label="电池容量" maxlength="40" placeholder="例如 100 Ah" value="${esc(r.batteryCapacity)}"><span class="spec-help">可填 Ah / kWh，选填</span>`;
    return '<span class="spec-label">产品规格</span><span class="spec-empty">—</span>';
  }
  function specText(r) { return r.category==='solar'?(r.solarWatts.trim()?r.solarWatts.trim()+' W':''):r.category==='inverter'?r.inverterPower.trim():r.category==='battery'?r.batteryCapacity.trim():''; }
  function rowMarkup(r) {
    return `<div class="product-row ${r.category==='solar'?'solar-row':''}" data-id="${esc(r.id)}"><div class="category-cell"><span class="mobile-label">产品品类</span><select data-field="category" aria-label="产品品类">${options(r.category)}</select><input class="product-name" data-field="name" aria-label="产品名称或规格" maxlength="80" placeholder="名称 / 型号（选填）" value="${esc(r.name)}"></div><div class="spec-cell">${specMarkup(r)}</div><div class="cost-cell"><label class="mobile-label">报价成本 CNY</label><input class="cost-input" data-field="cost" aria-label="报价成本 CNY" inputmode="decimal" autocomplete="off" placeholder="输入金额" value="${esc(r.cost)}"><span class="mode-note"></span></div><div class="profit-cell"><label class="mobile-label">利润点 %</label><div class="row-profit"><span>%</span><input data-field="profit" aria-label="利润点 百分数" inputmode="decimal" autocomplete="off" value="${esc(r.profit)}" placeholder="18"></div><span class="factor-note"></span></div><div class="quote-cell"><span class="mobile-label unit-quote-label">最终报价</span><div class="quote-value empty">—</div><span class="quote-unit"></span></div><div class="panel-cell"><span class="mobile-label">单片组件金额</span><div class="panel-value empty">—</div><span class="panel-formula"></span></div><button class="icon-button remove-row" aria-label="删除${esc(category(r.category).name)}产品" data-remove="${esc(r.id)}">×</button><div class="row-error" role="status" hidden></div></div>`;
  }
  function renderRows() { $('rows').innerHTML=state.rows.map(rowMarkup).join('');recalculate(); }
  function hydrate() { $('currency').value=state.currency;$('rate').value=state.rate;$('defaultProfit').value=state.defaultProfit;renderRows(); }
  function evaluate() {
    return state.rows.map(r=>{
      const c = category(r.category), hasCost=r.cost.trim()!=='';
      const errors=[];
      if (hasCost && !M.decimal(r.cost)) errors.push('成本须为非负数字，最多 12 位整数、6 位小数');
      if (r.profit.trim()==='' || !M.decimal(r.profit)) errors.push('请输入非负利润点，例如 18');
      const solar=r.category==='solar', precision=M.precisionFor(r.category);
      const quoteUnits=errors.length?null:M.calculate(r.cost,state.rate,r.profit,c.mode,precision);
      if (solar && r.solarWatts.trim()!=='' && !M.positive(r.solarWatts)) errors.push('组件功率须大于 0，最多 12 位整数、6 位小数');
      if (submitted && solar && hasCost && !r.solarWatts.trim()) errors.push('请填写组件功率瓦数，以计算单片金额');
      if (submitted && !hasCost && (r.name.trim()||specText(r))) errors.push('请补充此产品的成本');
      const panelUnits=solar?M.panelAmount(quoteUnits,r.solarWatts):null;
      const amountMills=solar?panelUnits:(quoteUnits===null?null:quoteUnits*(10n ** BigInt(3-precision)));
      return {row:r,cat:c,hasCost,errors,quoteUnits,panelUnits,amountMills,precision};
    });
  }
  function recalculate() {
    const validRate=M.positive(state.rate), results=evaluate(), complete=results.filter(x=>x.amountMills!==null && !x.errors.length);
    const rowsEl=$('rows');
    results.forEach((result,i)=>{
      const el=rowsEl.children[i];if(!el)return;
      const value=el.querySelector('.quote-value');
      value.textContent=result.quoteUnits===null?'—':M.money(result.quoteUnits,true,result.precision);value.classList.toggle('empty',result.quoteUnits===null);
      const solar=result.row.category==='solar';
      el.classList.toggle('solar-row',solar);
      el.querySelector('.mode-note').textContent=solar?'单瓦成本 · CNY/W':result.cat.mode==='tax'?'含 ÷ 1.13':'标准公式';
      el.querySelector('.cost-cell .mobile-label').textContent=solar?'单瓦成本 CNY/W':'报价成本 CNY';
      el.querySelector('.unit-quote-label').textContent=solar?'单瓦报价':'最终报价';
      el.querySelector('.quote-unit').textContent=solar?state.currency+'/W':state.currency;
      const panel=el.querySelector('.panel-value');panel.textContent=result.panelUnits===null?'—':M.money(result.panelUnits,true,3);panel.classList.toggle('empty',result.panelUnits===null);
      el.querySelector('.panel-formula').textContent=solar?(result.panelUnits===null?'功率 W × 单瓦报价':`${result.row.solarWatts.trim()} W × ${M.money(result.quoteUnits,true,result.precision)} ${state.currency}/W`):'';
      const watts=el.querySelector('[data-field="solarWatts"]');if(watts)watts.setAttribute('aria-invalid',String((result.row.solarWatts.trim()!==''||submitted&&result.hasCost)&&!M.positive(result.row.solarWatts)));
      const f=M.factor(result.row.profit);el.querySelector('.factor-note').textContent=f?'实际 ×'+f:'待填写';
      el.querySelector('[data-field="cost"]').setAttribute('aria-invalid',String(result.hasCost&&!M.decimal(result.row.cost)));
      el.querySelector('[data-field="profit"]').setAttribute('aria-invalid',String(!M.decimal(result.row.profit)));
      el.querySelector('.remove-row').setAttribute('aria-label','删除'+result.cat.name+'产品');
      el.querySelector('.row-error').textContent=result.errors.join('；');el.querySelector('.row-error').hidden=!result.errors.length;
    });
    $('rate').setAttribute('aria-invalid',String(!validRate && (state.rate!==''||submitted)));
    $('defaultProfit').setAttribute('aria-invalid',String(!M.decimal(state.defaultProfit)));
    $('rateError').textContent=(!validRate && (state.rate!==''||submitted))?'请填写大于 0 的汇率（最多 12 位整数、6 位小数）':'';
    $('profitHelp').textContent=M.factor(state.defaultProfit)?`输入 ${state.defaultProfit} → ×${M.factor(state.defaultProfit)}，用于新增行`:'请输入非负利润点，例如 18';
    $('rateHelp').textContent=`1 ${state.currency} = 所填金额 CNY`;
    $('rowCount').textContent=state.rows.length+' 项';$('tableCurrency').textContent=state.currency;$('summaryCurrency').textContent=state.currency;
    const precision=complete.reduce((max,x)=>Math.max(max,x.precision),complete.length?0:2);
    const sum=complete.reduce((n,x)=>n+x.amountMills,0n)/(10n ** BigInt(3-precision));
    $('total').textContent=M.money(sum,true,precision);$('summaryCount').textContent=`${complete.length} / ${state.rows.length} 项`;
    $('completeCount').textContent=complete.length+' 项已完成报价';$('costTotal').textContent='¥ '+M.money(complete.reduce((n,x)=>n+M.lineCost(x.row.cost,x.row.category==='solar'?x.row.solarWatts:'1'),0n));
    const invalid=results.filter(x=>(x.hasCost||x.row.name.trim()||specText(x.row))&&(x.errors.length||x.amountMills===null)).length;
    $('summaryHint').textContent=!validRate?'填写有效汇率后，自动计算所有产品':invalid?`${invalid} 项信息待完善，组件需填写功率瓦数`:complete.length?'组件按单片金额计入合计，其余按最终报价计入':'填写产品成本，组件另需填写功率瓦数';
    return {results,complete,sum,validRate,precision};
  }
  function confirm(title,message,fn) { $('confirmTitle').textContent=title;$('confirmMessage').textContent=message;confirmedAction=fn;$('confirmDialog').showModal(); }
  $('confirmCancel').onclick=()=>$('confirmDialog').close();
  $('confirmOk').onclick=()=>{const fn=confirmedAction;$('confirmDialog').close();confirmedAction=null;fn?.();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('rows').addEventListener('input',event=>{
    const field=event.target.dataset.field;if(!field||field==='category')return;
    const row=state.rows.find(r=>r.id===event.target.closest('.product-row').dataset.id);if(!row)return;
    row[field]=event.target.value;recalculate();persist();
  });
  $('rows').addEventListener('change',event=>{
    if(event.target.dataset.field!=='category')return;
    const el=event.target.closest('.product-row');const row=state.rows.find(r=>r.id===el.dataset.id);row.category=event.target.value;el.querySelector('.spec-cell').innerHTML=specMarkup(row);recalculate();persist();
  });
  $('rows').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove]');if(!button)return;
    state.rows=state.rows.filter(r=>r.id!==button.dataset.remove);button.closest('.product-row').remove();recalculate();persist();
  });
  $('rate').addEventListener('input',event=>{state.rate=event.target.value;recalculate();persist();});
  $('defaultProfit').addEventListener('input',event=>{state.defaultProfit=event.target.value;recalculate();persist();});
  $('currency').addEventListener('change',event=>{state.currency=event.target.value;state.rate=state.currency==='CNY'?'1':'';$('rate').value=state.rate;submitted=false;recalculate();persist();toast(state.currency==='CNY'?'人民币报价，汇率已设为 1':'已切换币种，请填写对应汇率');});
  $('applyProfit').onclick=()=>{
    if(!M.decimal(state.defaultProfit)){toast('请先填写有效的默认利润点');$('defaultProfit').focus();return;}
    if(!state.rows.length){toast('请先添加产品');return;}
    confirm('统一应用利润点',`将全部 ${state.rows.length} 项的利润点设为 ${state.defaultProfit}（×${M.factor(state.defaultProfit)}）。`,()=>{state.rows.forEach(r=>r.profit=state.defaultProfit);renderRows();persist();toast('已更新全部产品的利润点');});
  };
  $('addBtn').onclick=()=>{
    if(!M.decimal(state.defaultProfit)){toast('请先填写有效的默认利润点');$('defaultProfit').focus();return;}
    const r=newRow('solar',state.defaultProfit);state.rows.push(r);$('rows').insertAdjacentHTML('beforeend',rowMarkup(r));recalculate();persist();
    const el=$('rows').lastElementChild;el.scrollIntoView({behavior:'smooth',block:'nearest'});el.querySelector('select').focus({preventScroll:true});
  };
  $('resetBtn').onclick=()=>confirm('新建一份报价', '当前产品和金额将被清空。保留币种、汇率、默认利润点及自定义品类。',()=>{
    state.rows=presets.slice(0,5).map(c=>newRow(c.id,M.decimal(state.defaultProfit)?state.defaultProfit:'18'));submitted=false;renderRows();persist();toast('已新建报价，默认显示 5 项产品');
  });
  function renderCategories() {
    $('categoryList').innerHTML=categories().map(c=>`<div class="category-item"><span>${esc(c.name)}</span><div><small>${c.mode==='tax'?'成本 ÷ 汇率 ÷ 1.13 × 乘数':'成本 ÷ 汇率 × 乘数'}</small>${state.custom.some(x=>x.id===c.id)?`<button class="icon-button" data-delete-category="${esc(c.id)}" aria-label="删除${esc(c.name)}品类">×</button>`:''}</div></div>`).join('');
  }
  $('categoryBtn').onclick=()=>{renderCategories();$('categoryError').textContent='';$('categoryDialog').showModal();};
  $('categoryForm').onsubmit=event=>{
    event.preventDefault();const name=$('categoryName').value.trim();
    if(!name){$('categoryError').textContent='请输入品类名称';return;}
    if(categories().some(c=>c.name.toLocaleLowerCase()===name.toLocaleLowerCase())){$('categoryError').textContent='这个品类已存在，请使用其他名称';return;}
    state.custom.push({id:uid(),name,mode:$('categoryMode').value});renderCategories();renderRows();persist();$('categoryName').value='';$('categoryError').textContent='';toast('品类已添加，可在产品下拉列表中选择');
  };
  $('categoryList').onclick=event=>{
    const b=event.target.closest('[data-delete-category]');if(!b)return;const id=b.dataset.deleteCategory;
    if(state.rows.some(r=>r.category===id)){$('categoryError').textContent='此品类正在使用，请先修改或删除对应产品行';return;}
    state.custom=state.custom.filter(c=>c.id!==id);renderCategories();renderRows();persist();$('categoryError').textContent='';
  };
  $('generateBtn').onclick=()=>{
    submitted=true;const data=recalculate();
    if(!data.validRate){toast('请先填写大于 0 的汇率');$('rate').focus();return;}
    const invalid=data.results.find(x=>(x.hasCost||x.row.name.trim()||specText(x.row))&&(x.errors.length||x.amountMills===null));
    if(invalid){toast('请完善已填写产品的成本、利润点及组件功率');const i=state.rows.indexOf(invalid.row);const field=!invalid.hasCost||!M.decimal(invalid.row.cost)?'cost':!M.decimal(invalid.row.profit)?'profit':'solarWatts';$('rows').children[i].querySelector(`[data-field="${field}"]`)?.focus();return;}
    if(!data.complete.length){toast('至少填写一项产品成本后再生成报价');$('rows').querySelector('[data-field="cost"]')?.focus();return;}
    snapshot={currency:state.currency,sum:data.sum,precision:data.precision,date:new Date().toLocaleDateString('zh-CN'),items:data.complete.map(x=>({category:x.cat.name,name:x.row.name.trim(),spec:specText(x.row),solar:x.row.category==='solar',quoteUnits:x.quoteUnits,panelUnits:x.panelUnits,amountMills:x.amountMills,precision:x.precision}))};
    $('quoteContent').innerHTML=`<article class="quote-sheet"><div class="quote-sheet-heading"><div><h3>产品报价单</h3><p>光伏 · 储能产品</p></div><div><small>${esc(snapshot.date)}<br>报价币种：${snapshot.currency}</small></div></div><table class="quote-table"><thead><tr><th>品类 / 名称</th><th>功率 / 容量</th><th>报价 (${snapshot.currency})</th><th>单片金额 (${snapshot.currency})</th></tr></thead><tbody>${snapshot.items.map(x=>`<tr><td>${esc(x.category)}${x.name?'<small class="quote-product-name">'+esc(x.name)+'</small>':''}</td><td>${esc(x.spec||'—')}</td><td>${M.money(x.quoteUnits,true,x.precision)}${x.solar?' /W':''}</td><td>${x.panelUnits===null?'—':M.money(x.panelUnits,true,3)}</td></tr>`).join('')}</tbody></table><div class="quote-sheet-total"><span>报价合计</span><strong>${snapshot.currency} ${M.money(snapshot.sum,true,snapshot.precision)}</strong></div><p class="quote-detail">共 ${snapshot.items.length} 项产品 · 组件按单片金额计入合计，其余按最终报价计入。<br>单片组件金额 = 功率瓦数 × 显示的单瓦报价，组件单瓦报价和单片金额保留 3 位小数；锂电池、逆变器、辅材保留 0 位；支架、线缆及自定义品类保留 2 位。</p></article>`;
    $('quoteDialog').showModal();
    window.dispatchEvent(new Event('qingbao:quote-generated'));
  };
  function quoteText() { return `产品报价单\n日期：${snapshot.date}\n币种：${snapshot.currency}\n\n`+snapshot.items.map(x=>`${x.category}${x.name?' · '+x.name:''}${x.spec?' · '+x.spec:''}：${M.money(x.quoteUnits,true,x.precision)} ${snapshot.currency}${x.solar?'/W；单片金额 '+M.money(x.panelUnits,true,3)+' '+snapshot.currency:''}`).join('\n')+`\n\n报价合计：${M.money(snapshot.sum,true,snapshot.precision)} ${snapshot.currency}\n组件按单片金额计入合计，其余按最终报价计入。`; }
  $('copyBtn').onclick=async()=>{
    try {await navigator.clipboard.writeText(quoteText());toast('报价已复制，可粘贴发送给客户');}
    catch {const area=document.createElement('textarea');area.value=quoteText();$('quoteDialog').append(area);area.select();const copied=document.execCommand('copy');area.remove();toast(copied?'报价已复制':'复制受浏览器限制，请导出 CSV');}
  };
  $('downloadBtn').onclick=()=>{
    const cell=v=>{let text=String(v);if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
    const rows=[['品类','名称 / 型号','功率 / 容量',`最终报价 (${snapshot.currency})`,'报价单位',`单片组件金额 (${snapshot.currency})`,`计入合计 (${snapshot.currency})`],...snapshot.items.map(x=>[x.category,x.name,x.spec,M.money(x.quoteUnits,false,x.precision),x.solar?snapshot.currency+'/W':snapshot.currency,x.panelUnits===null?'':M.money(x.panelUnits,false,3),M.money(x.panelUnits??x.quoteUnits,false,x.precision)]),['报价合计','','','','','',M.money(snapshot.sum,false,snapshot.precision)]];
    const blob=new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`产品报价单-${snapshot.date.replaceAll('/','-')}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('报价单已导出');
  };
  $('printBtn').onclick=()=>window.print();
  window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}});
  hydrate();if(saved)$('saveStatus').textContent='已恢复本地草稿';
})();

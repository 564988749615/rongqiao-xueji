'use strict';
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeCell = value => typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  const cellText = value => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const num = (value, digits = 1) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits: digits});
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let result;
    try { result = await response.json(); } catch (_) { throw new Error(response.ok ? '返回内容无法读取，请重新操作。' : '服务暂时不可用，请检查启动窗口。'); }
    if (!response.ok) throw new Error(result.error || `操作未完成（${response.status}）。`);
    return result;
  }
  async function upload(file, metadata = {}) {
    const content = await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('文件读取失败，请重新选择。')); reader.readAsDataURL(file);
    });
    return api('/api/import', {filename:file.name, content, metadata});
  }
  function tableHTML(table) {
    return `<div class="table-wrap"><table><thead><tr>${table.columns.map(c=>`<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${table.rows.length ? table.rows.map(row=>`<tr>${row.map(v=>`<td>${escape(cellText(v))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${table.columns.length}" class="empty">当前条件下没有记录。</td></tr>`}</tbody></table></div>`;
  }
  async function copyTable(table) {
    const text = [table.columns,...table.rows].map(r=>r.map(v=>cellText(safeCell(v)).replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const area=document.createElement('textarea'); area.value=text; area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
      const ok=document.execCommand('copy');area.remove();if(!ok) throw new Error('浏览器未允许复制。请下载 CSV 后在 Excel 中复制。');
    }
    notice(`已复制 ${table.rows.length} 行，可粘贴到 Excel。`);
  }
  function downloadBlob(blob, filename) {
    const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadTable(table, filename) {
    const content=[table.columns,...table.rows].map(r=>r.map(v=>'"'+cellText(safeCell(v)).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    downloadBlob(new Blob(['\ufeff'+content],{type:'text/csv;charset=utf-8'}),filename||`${table.title}.csv`);
    notice(`已下载 ${table.rows.length} 行数据。`);
  }
  function printTables(tables,title,subtitle='') {
    const win=window.open('','_blank');
    if(!win) {notice('打印窗口被浏览器拦截，请允许此页面打开新窗口后重试。',true); return null;}
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
      *{box-sizing:border-box}body{margin:30px;color:#241c36;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}h1{font-size:23px}h2{font-size:17px;margin-top:26px}p{color:#5d536c}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #ddd6e8;padding:5px 7px;white-space:normal;overflow-wrap:anywhere;text-align:left}th{background:#eee7f8;font-weight:600}thead{display:table-header-group}tr{break-inside:avoid}section{break-before:page}section:first-of-type{break-before:auto}.controls{position:sticky;top:0;background:white;padding:12px 0}button{font:inherit;padding:9px 20px;border:1px solid #8061b5;border-radius:6px;background:#8061b5;color:white;cursor:pointer}small{color:#70667c}.table-wrap{overflow:visible}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0;font-size:9px}.controls{display:none}h1{font-size:18px}h2{font-size:14px}th,td{padding:3px 4px}a{color:inherit;text-decoration:none}}
      </style></head><body><div class="controls"><button onclick="window.print()">打印 / 存为 PDF</button> <small>打印范围为当前所选报表，共 ${tables.length} 张；可在打印窗口选择页码。</small></div><h1>${escape(title)}</h1><p>${escape(subtitle)}</p>${tables.map(t=>`<section><h2>${escape(t.title)}</h2>${t.note?`<p>${escape(t.note)}</p>`:''}${tableHTML(t)}<p>记录数：${t.rows.length}</p></section>`).join('')}</body></html>`);
    win.document.close(); return win;
  }
  async function downloadWorkbook(analysis) {
    const response=await fetch('/api/export/xlsx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({analysis})});
    if(!response.ok){let data={};try{data=await response.json();}catch(_){}throw new Error(data.error||'工作簿导出失败。');}
    downloadBlob(await response.blob(),`${analysis.metadata.name||'成绩分析'}_分析结果.xlsx`);notice('多工作表 Excel 已下载。');
  }
  let timer;
  function notice(text,error=false) {
    let node=document.getElementById('z-notice');if(!node){node=document.createElement('div');node.id='z-notice';node.className='notice';node.setAttribute('role','status');document.body.append(node);}
    node.textContent=text;node.classList.toggle('is-error',error);node.hidden=false;clearTimeout(timer);timer=setTimeout(()=>node.hidden=true,error?10000:4500);
  }
  const paths={upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',school:'<path d="m3 10 9-6 9 6v11H3Zm6 11v-7h6v7M6 11v4m12-4v4"/>',chart:'<path d="M4 3v17h17M8 15v-4m5 4V6m5 9v-7"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',file:'<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',settings:'<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',print:'<path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7Z"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',present:'<path d="M3 3h18v13H3ZM12 16v5m-4 0h8"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',book:'<path d="M3 4c4-1 6-1 9 1 3-2 5-2 9-1v16c-4-1-6-1-9 1-3-2-5-2-9-1Zm9 1v16"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>'};
  const FULL_MARK_KEY='rongqiao.fullmarks.template.v1';
  const fullMarkPresets=[
    {id:'cq-mid',label:'重庆中考参考',marks:{语文:150,数学:150,英语:150,物理:80,化学:70,政治:50,历史:50,体育:50}},
    {id:'hundred',label:'全科百分制',all:100}
  ];
  function getFullMarkTemplate(){try{const raw=JSON.parse(localStorage.getItem(FULL_MARK_KEY)||'null');return raw&&typeof raw==='object'&&Object.keys(raw).length?raw:null;}catch(_){return null;}}
  function setFullMarkTemplate(marks){const clean={};Object.entries(marks||{}).forEach(([k,v])=>{const numVal=Number(v);if(k&&Number.isFinite(numVal)&&numVal>0)clean[k]=numVal;});if(!Object.keys(clean).length)throw new Error('请先填写至少一门科目的有效满分，再保存模板。');localStorage.setItem(FULL_MARK_KEY,JSON.stringify(clean));return clean;}
  function bindShutdown(button,statusEl){
    if(!button)return;
    let armed=false, resetTimer=null;
    const label=button.textContent;
    button.addEventListener('click',async()=>{
      if(!armed){
        armed=true;
        button.textContent='确认关闭本机服务';
        notice('再次点击将停止本机服务，未保存的页面数据请先下载或保存。');
        clearTimeout(resetTimer);
        resetTimer=setTimeout(()=>{armed=false;if(button.isConnected&&!button.disabled)button.textContent=label;},6000);
        return;
      }
      clearTimeout(resetTimer);
      button.disabled=true;
      button.textContent='正在关闭…';
      try{
        await api('/api/shutdown',{});
        button.textContent='本机服务已关闭';
        if(statusEl)statusEl.textContent='本机服务已安全停止，可关闭此页面';
        notice('本机服务已安全关闭，下次使用请重新打开融侨学迹。');
      }catch(err){
        armed=false;button.disabled=false;button.textContent=label;
        notice(err.message,true);
      }
    });
  }
  const icons=name=>`<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.file}</svg>`;
  window.Z={api,upload,escape,num,tableHTML,copyTable,downloadTable,printTables,downloadWorkbook,notice,icons,downloadBlob,fullMarkPresets,getFullMarkTemplate,setFullMarkTemplate,bindShutdown};
})();

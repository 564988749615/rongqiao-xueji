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
    const list=Array.isArray(tables)?tables:[tables];
    const maxCols=Math.max(0,...list.map(t=>(t.columns||[]).length));
    const landscape=maxCols>7;
    const nowText=new Date().toLocaleDateString('zh-CN');
    const numericCol=(t,ci)=>{
      const name=String(t.columns[ci]||'');
      if(/分|名|人|数|率|差|均|高|低|总|前|比例|次数|权重|占比|位置/u.test(name))return true;
      const sample=t.rows.slice(0,8).map(r=>r[ci]).filter(v=>v!==null&&v!==undefined&&v!=='');
      return sample.length>0&&sample.every(v=>typeof v==='number'||/^[+-]?\d+(\.\d+)?%?$/.test(String(v).trim()));
    };
    const renderPrintTable=t=>{
      const numFlags=t.columns.map((_,i)=>numericCol(t,i));
      const groupStart=ci=>ci>=3&&/达标$/u.test(String(t.columns[ci]||''))&&/集中$/u.test(String(t.columns[ci+1]||''));
      const colCls=(i)=>[numFlags[i]?'num':'',groupStart(i)?'grp-start':''].filter(Boolean).join(' ');
      const head=`<thead><tr>${t.columns.map((c,i)=>`<th scope="col" class="${colCls(i)}">${escape(c)}</th>`).join('')}</tr></thead>`;
      const body=t.rows.length
        ? t.rows.map(row=>{
            const isSum=/^(合计|汇总|总计|全年级)$/u.test(String(row[0]??'').trim());
            return `<tr${isSum?' class="summary-row"':''}>${row.map((v,i)=>`<td class="${colCls(i)}">${escape(cellText(v)===''?'—':cellText(v))}</td>`).join('')}</tr>`;
          }).join('')
        : `<tr><td colspan="${t.columns.length}" class="empty-cell">当前条件下没有记录。</td></tr>`;
      return `<table>${head}<tbody>${body}</tbody></table>`;
    };
    const cleanNote=t=>{
      let raw=String(t.note||'').trim();
      if(!raw)return '';
      if(subtitle){
        const idx=raw.indexOf('。');
        const headPart=idx>0?raw.slice(0,idx):'';
        if(headPart&&headPart.includes('总分科目：')&&subtitle.includes('总分科目：')){
          raw=raw.slice(idx+1).trim();
        }
      }
      return raw;
    };
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(title)} · 融侨学迹</title><style>
      *{box-sizing:border-box}
      body{margin:0;background:#eae8f2;color:#1e1b2e;font:11.5px/1.48 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .controls{position:sticky;top:0;z-index:20;background:#ffffff;border-bottom:1px solid #d9d4e5;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;gap:14px;box-shadow:0 2px 10px rgba(30,27,46,.06)}
      .controls-left{display:flex;align-items:center;gap:12px}
      .controls button{font:inherit;padding:7px 18px;border:1px solid #6f4eb8;border-radius:6px;background:#6f4eb8;color:#fff;cursor:pointer;font-weight:600}
      .controls button:hover{background:#573a9b}
      .controls small{color:#69627e;font-size:12px}
      .sheet-stack{padding:20px;display:grid;gap:20px;justify-items:center}
      .sheet{width:${landscape?'277mm':'190mm'};max-width:100%;background:#ffffff;padding:12mm 13mm;border-radius:4px;box-shadow:0 4px 20px rgba(30,27,46,.10);break-before:page;page-break-before:always}
      .sheet:first-of-type{break-before:auto;page-break-before:auto}
      .masthead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:8px;border-bottom:2px solid #573a9b;margin-bottom:10px}
      .brand-tag{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:650;color:#6f4eb8;letter-spacing:.4px;margin-bottom:3px}
      .brand-dot{display:inline-block;width:7px;height:7px;border-radius:2px;background:#6f4eb8}
      .masthead h1{margin:0;font-size:17px;line-height:1.25;color:#1e1b2e;font-weight:700}
      .masthead-sub{margin:3px 0 0;font-size:10.5px;color:#5a536e}
      .masthead-meta{text-align:right;font-size:10px;color:#69627e;white-space:nowrap}
      .section-note{margin:0 0 8px;padding:6px 9px;background:#f7f5fc;border-left:3px solid #6f4eb8;border-radius:3px;font-size:10.5px;color:#4c4660;line-height:1.5}
      table{border-collapse:collapse;width:100%;font-size:${maxCols>12?'9.5px':maxCols>8?'10.5px':'11px'};table-layout:auto}
      thead{display:table-header-group}
      tr{break-inside:avoid;page-break-inside:avoid}
      th,td{border:1px solid #cbc4da;padding:${maxCols>12?'3.5px 4px':'4.5px 6px'};white-space:normal;overflow-wrap:anywhere;text-align:left;vertical-align:middle}
      th{background:#eeeaf8;color:#2e2545;font-weight:650;border-bottom:1.5px solid #9c8ec0}
      th.grp-start,td.grp-start{border-left:1.5px solid #8a7dad}
      tbody tr:nth-child(even) td{background:#faf9fd}
      tbody tr.summary-row td{background:#ece6f8!important;font-weight:700;border-top:1.5px solid #6f4eb8;color:#1e1b2e}
      th.num,td.num{text-align:right;white-space:nowrap}
      .empty-cell{text-align:center;color:#69627e;padding:16px}
      .sheet-foot{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:6px;border-top:1px solid #e4e1ee;font-size:10px;color:#69627e}
      @page{size:A4 ${landscape?'landscape':'portrait'};margin:10mm 11mm}
      @media print{
        body{background:#fff}
        .controls{display:none!important}
        .sheet-stack{padding:0;display:block}
        .sheet{width:auto;padding:0;margin:0;border-radius:0;box-shadow:none}
      }
    </style></head><body>
      <div class="controls">
        <div class="controls-left"><button onclick="window.print()">打印 / 存为 PDF</button><small>${escape(title)} · 共 ${list.length} 张报表（建议 A4 ${landscape?'横向':'纵向'}，已自动设置分页与重复表头）</small></div>
        <small>融侨学迹 · 纸面打印预览</small>
      </div>
      <div class="sheet-stack">
        ${list.map((t,idx)=>{const noteText=cleanNote(t);return `<section class="sheet">
          <header class="masthead">
            <div>
              <div class="brand-tag"><span class="brand-dot"></span>融侨学迹 · 教研学业报表</div>
              <h1>${escape(t.title || title)}</h1>
              ${subtitle?`<p class="masthead-sub">${escape(subtitle)}</p>`:''}
            </div>
            <div class="masthead-meta">第 ${idx+1} / ${list.length} 表<br>制表日期：${nowText}</div>
          </header>
          ${noteText?`<p class="section-note">口径说明：${escape(noteText)}</p>`:''}
          ${renderPrintTable(t)}
          <footer class="sheet-foot"><span>共 ${t.rows.length} 条记录 · 同批计算口径</span><span>融侨学迹 · 教研分析存档用</span></footer>
        </section>`;}).join('')}
      </div>
    </body></html>`);
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

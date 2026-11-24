'use strict';
(() => {
  const $ = id => document.getElementById(id), e = Z.escape, n = Z.num;
  const nav = [
    ['overview','全校总览','school','全校学情总览','各年级独立统计，每个结果都能查看依据。'],
    ['compare','班级与学科','chart','班级与学科','从群体差异进入班级，再回到学生成绩。'],
    ['brief','班情分析','users','20% / 40% 双线班情分析','面向班情会的一页纸诊断、谈话要点、包干名单与领导/教师分版套打。'],
    ['trends','历次趋势','calendar','历次考试与综合表现','在同一年级内查看变化，并保留每次考试的统计口径。'],
    ['notes','教研记录','book','教研与跟进记录','把数据发现、核实结果和后续安排放在一起。'],
    ['reports','报表中心','file','分析报表中心','复制、下载和打印同一计算批次的分析结果。'],
    ['data','数据管理','database','考试与数据管理','导入真实成绩、确认口径，保存为可持续使用的考试档案。']
  ];
  let saved={}; try {saved=JSON.parse(localStorage.getItem('zhixu-leader-ui')||'{}');} catch (_) {}
  const queryParams=new URLSearchParams(location.search),queryExam=queryParams.get('exam'),queryView=queryParams.get('view'),today=new Date(),todayText=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  const S={view:nav.some(x=>x[0]===queryView)?queryView:queryExam?'compare':nav.some(x=>x[0]===saved.view)?saved.view:'overview',examId:queryExam||saved.examId||'',presentation:!!saved.presentation,exams:[],school:null,analysis:null,brief:null,briefClass:'',briefHighRatio:0.20,briefMainRatio:0.40,briefRatioOverride:false,briefListTab:'high',briefTemplateTab:'tpl1-leader',briefTpl2Ratio:'main',teacherFile:null,trends:null,trendsGrade:'',classTrendMetric:'mean',classTrendScale:'raw',history:null,historySelection:[],historySelectionInitialized:false,notes:[],archives:[],s3:null,s3Snapshots:[],s3Diff:null,confirmDeleteS3:'',pending:null,pendingHygiene:null,multiFile:null,multiInspect:null,multiGrade:'初三',multiDate:todayText,subject:'总分',classSearch:'',studentSearch:'',studentClass:'',compareTab:'classes',tableId:'',reportSearch:'',page:0,historySearch:'',historyPage:0,weights:{},importMeta:{name:'',grade:'初三',date:todayText},importError:'',noteDraft:'',confirmDeleteNote:'',confirmDeleteExam:'',drawerTable:null,drawerType:'',drawerFile:null,request:0};
  let lastFocus=null, inputTimer=null, composing=false;
  const option=(value,label,chosen)=>`<option value="${e(value)}"${value===chosen?' selected':''}>${e(label)}</option>`;
  const btn=(label,action,attrs='',style='secondary')=>`<button class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
  const warnings=items=>(items||[]).map(x=>typeof x==='string'?x:x.message).filter(Boolean);
  const {identityCell,identityLabel,trendSVG,growthChartSVG,subjectTrendSummary}=window.LeaderCharts;
  const classTrendTable=exams=>window.LeaderCharts.classTrendTable(exams,S.classTrendMetric,S.analysis?.metadata?.grade||'',S.classTrendScale);
  const classTrendSection=exams=>{const result=window.LeaderCharts.classTrendSection(exams,S.classTrendMetric,S.analysis?.metadata?.grade||'',S.classTrendScale);if(exams.length>=2){const current=window.LeaderCharts.classTrendMetrics(exams,S.classTrendScale);if(!current.some(m=>m.id===S.classTrendMetric))S.classTrendMetric=current[0].id;}return result;};
  function persist(){try{localStorage.setItem('zhixu-leader-ui',JSON.stringify({view:S.view,examId:S.examId,presentation:S.presentation}));}catch(_){}}
  function fail(message){$('global-error').textContent=message;$('global-error').hidden=false;}
  function clearError(){$('global-error').hidden=true;}
  function paint(html){const focused=document.activeElement,id=focused?.id,start=focused?.selectionStart,end=focused?.selectionEnd;$('view-content').innerHTML=html;$('view-content').querySelectorAll('tr[data-action]').forEach(row=>row.tabIndex=0);if(id){const target=$(id);if(target){target.focus({preventScroll:true});try{if(start!==undefined&&start!==null)target.setSelectionRange(start,end);}catch(_){}}}}
  function empty(title,text,action='data'){return `<div class="empty"><div class="empty-symbol">${Z.icons('database')}</div><h2>${e(title)}</h2><p>${e(text)}</p><div class="actions">${btn('导入一场考试','navigate',`data-view="${action}"`,'primary')}${btn('载入已提供的原始表','example')}</div></div>`;}
  function metadata(){return S.exams.find(x=>x.id===S.examId)||{};}
  function subtitle(){const a=S.analysis;return a?`${a.metadata.grade} · ${a.metadata.name} · ${a.metadata.date} · ${a.classes.length}个班 · 总分科目：${a.rules.total_subjects.join('、')}`:'';}
  function header(){const current=nav.find(x=>x[0]===S.view);const showExamBar=!(S.view==='overview'||S.view==='data'||!S.exams.length);$('breadcrumb').textContent=current[1];$('page-title').textContent=current[1];$('page-subtitle').textContent=current[4];$('page-subtitle').hidden=showExamBar;const coreNav=nav.slice(0,4),mgmtNav=nav.slice(4);const navBtn=x=>`<button class="nav-button${x[0]===S.view?' active':''}" data-action="navigate" data-view="${x[0]}" ${x[0]===S.view?'aria-current="page"':''}>${Z.icons(x[2])}<span>${x[1]}</span></button>`;$('navigation').innerHTML=`<div class="nav-group-label">核心分析</div>${coreNav.map(navBtn).join('')}<div class="nav-group-label">记录与档案</div>${mgmtNav.map(navBtn).join('')}`;$('exam-toolbar').hidden=!showExamBar;$('exam-select').innerHTML=S.exams.map(x=>option(x.id,`${x.grade} · ${x.name} · ${x.date}`,S.examId)).join('');$('scope-description').textContent=S.analysis?`${S.analysis.classes.length}个班 · ${n(S.analysis.summary.participants,0)}人`:'';$('heading-action').innerHTML=S.view==='overview'&&S.exams.length?btn('打印概况','print-school','','secondary small'):S.view==='reports'&&S.analysis?btn('导出 Excel','xlsx','','secondary small'):'';document.body.classList.toggle('presenting',S.presentation);$('present-button').textContent=S.presentation?'退出汇报':'汇报模式';}
  async function loadExams(){S.exams=(await Z.api('/api/exams')).exams||[];if(!S.exams.some(x=>x.id===S.examId)){S.examId=S.exams[0]?.id||'';S.analysis=null;}persist();}
  async function ensureAnalysis(){if(!S.examId){S.analysis=null;return;}if(S.analysis?.dataset_id===S.examId)return;const id=S.examId,result=await Z.api('/api/analyze',{exam_id:id});if(id!==S.examId)return;S.analysis=result;if(!S.analysis.subjects.includes(S.subject)&&S.subject!=='总分')S.subject='总分';}
  async function loadBrief(){if(!S.examId||!S.analysis){S.brief=null;return;}if(!S.briefClass||!S.analysis.classes.includes(S.briefClass))S.briefClass=S.analysis.classes[0]||'';if(!S.briefClass){S.brief=null;return;}const r=S.analysis.rules||{};const hr=S.briefRatioOverride?S.briefHighRatio:(r.high_ratio??S.briefHighRatio);const mr=S.briefRatioOverride?S.briefMainRatio:(r.main_ratio??S.briefMainRatio);S.briefHighRatio=hr;S.briefMainRatio=mr;S.brief=await Z.api('/api/class-brief',{exam_id:S.examId,class:S.briefClass,high_ratio:hr,main_ratio:mr});}
  async function loadView(){const request=++S.request;clearError();header();paint('<div class="loading-line" role="status">正在读取已保存的数据…</div>');try{if(S.view==='overview')S.school=await Z.api('/api/school');else if(S.view==='data'){const [archRes,s3Res]=await Promise.all([Z.api('/api/exams?archived=1'),Z.api('/api/s3/config')]);S.archives=archRes.exams||[];S.s3=s3Res;}else{await ensureAnalysis();if(S.examId&&S.view==='brief')await loadBrief();if(S.examId&&S.view==='trends'){const grade=metadata().grade||'';if(S.trendsGrade!==grade){S.weights={};S.trendsGrade=grade;}S.trends=await Z.api('/api/trends?grade='+encodeURIComponent(grade));S.history=null;S.historySelection=[];S.historySelectionInitialized=false;const trendExams=S.trends?.exams||[];if(trendExams.length>=2){const ids=selectedHistoryIds(trendExams);try{S.history=await Z.api('/api/history',{grade,exam_ids:ids,weights:{}});S.historyPage=0;}catch(_){S.history=null;}}}if(S.examId&&S.view==='notes')S.notes=(await Z.api('/api/notes?exam_id='+encodeURIComponent(S.examId))).notes||[];}if(request!==S.request)return;header();render();}catch(err){if(request!==S.request)return;fail(err.message);paint(`<div class="empty"><h2>这次读取没有完成</h2><p>已保留当前选择，可以重试。</p>${btn('重新读取','reload','','primary')}</div>`);}}
  async function go(view){if(!nav.some(x=>x[0]===view))return;closeDrawer();S.view=view;S.page=0;persist();await loadView();}
  function renderBrief(){if(!S.brief){paint(empty('暂无可展示的班情分析','请先导入并保存一场考试成绩。'));return;}paint(window.LeaderBrief.renderBriefView(S.brief,S));}
  function render(){if(S.view==='overview')renderOverview();else if(S.view==='data')renderData();else if(!S.analysis)paint(empty('先保存一场考试','从原始 Excel 开始，分析结果会在这里形成可查阅的考试档案。'));else if(S.view==='compare')renderCompare();else if(S.view==='brief')renderBrief();else if(S.view==='trends')renderTrends();else if(S.view==='notes')renderNotes();else if(S.view==='reports')renderReports();}
  function renderOverview(){const data=S.school;if(!data?.grades?.length){paint(empty('让第一份成绩成为全校分析的起点','导入后，平台会按年级建立考试档案。未导入的年级不显示推测数据。'));return;}const total=data.totals,rate=total.registered?100*total.participants/total.registered:0;const issues=data.grades.flatMap(g=>warnings(g.analysis.warnings).slice(0,2).map(message=>({grade:g.grade,id:g.exam.id,message})));paint(`<section class="overview-summary"><div><div class="main-number">${n(total.participants,0)}<small>人</small></div><p>当前各年级最新考试 · 参与总分排名</p></div><div class="summary-stat"><span>纳入记录</span><strong>${n(total.registered,0)}</strong><small>保留全零与缺失记录</small></div><div class="summary-stat"><span>已接入年级 / 班级</span><strong>${n(total.grades,0)} / ${n(total.classes,0)}</strong><small>${n(data.exam_count,0)}场考试已保存</small></div><div class="summary-stat"><span>总分有效比例</span><strong>${n(rate)}<small>%</small></strong><small>按各考试规则独立判断</small></div></section><div class="overview-grid"><section class="panel"><div class="section-title"><div><h2>年级概况</h2><p>每个年级取最新一场已保存考试</p></div><small>点击进入班级与学科</small></div>${data.grades.map(g=>{const a=g.analysis,coverage=a.summary.registered?100*a.summary.participants/a.summary.registered:0;return `<div class="grade-row"><div class="grade-emblem">${e(g.grade)}</div><div><h3>${e(g.exam.name)}</h3><p>${e(g.exam.date)} · ${a.classes.length}个班 · ${a.rules.total_subjects.length}科计入总分</p><div class="grade-summary-numbers"><div><b>${n(a.summary.participants,0)}</b><span>有效人数</span></div><div><b>${n(a.summary.mean)}</b><span>总分均分</span></div><div><b>${n(a.summary.cutoff)}</b><span>前${n(a.rules.cutoff_ratio*100,0)}%分界</span></div></div><div class="grade-coverage-row"><div class="coverage"><span style="width:${Math.max(0,Math.min(100,coverage))}%"></span></div><small>有效参与率 ${n(coverage,1)}%</small></div></div>${btn('查看年级 →','open-exam',`data-id="${e(g.exam.id)}"`)}</div>`;}).join('')}<p class="line-note">跨年级汇总人数与覆盖情况；各年级的总分、均分和名次分别查看。</p></section><section class="panel"><div class="section-title"><div><h2>值得先核对的事项</h2><p>来自本次导入与统计规则的检查</p></div></div><ul class="quality-list">${issues.length?issues.slice(0,5).map(x=>`<li><span class="quality-dot"></span><div><h3>${e(x.grade)} · 数据核验</h3><p>${e(x.message)}</p><button class="text-button" data-action="open-quality" data-id="${e(x.id)}">查看完整核验 →</button></div></li>`).join(''):`<li><span class="quality-dot"></span><div><h3>当前没有导入校验提示</h3><p>仍可在报表中心查看统计范围、总分科目与边界规则。</p></div></li>`}</ul></section></div><section class="panel"><div class="section-title"><div><h2>各年级学科概览</h2><p>按各年级最新考试计算；均分使用实际分值</p></div></div><div class="table-wrap"><table><thead><tr><th>年级</th><th>学科</th><th class="number">实考人数</th><th class="number">均分</th><th class="number">有效分界</th><th class="number">达标人数</th><th class="number">集中人数</th><th></th></tr></thead><tbody>${data.grades.flatMap(g=>g.analysis.subject_stats.map(x=>`<tr data-action="open-subject" data-id="${e(g.exam.id)}" data-subject="${e(x.subject)}"><td>${e(g.grade)}</td><td>${e(x.subject)}</td><td class="number">${n(x.count,0)}</td><td class="number">${n(x.mean)}</td><td class="number">${n(x.cutoff)}</td><td class="number">${n(x.achievers,0)}</td><td class="number">${n(x.concentrated,0)}</td><td class="table-action">查看 →</td></tr>`)).join('')}</tbody></table></div></section>`);}
  function classRows(){const a=S.analysis,needle=S.classSearch.trim();return a.class_stats.filter(c=>!needle||String(c.class).includes(needle)).slice().sort((a,b)=>{const av=S.subject==='总分'?a.mean:a.subjects[S.subject]?.mean,bv=S.subject==='总分'?b.mean:b.subjects[S.subject]?.mean;return (bv??-Infinity)-(av??-Infinity)||String(a.class).localeCompare(String(b.class));});}
  function classTable(){const sub=S.subject;return {id:'class_filtered',title:`${sub}班级对比`,columns:['班级','实考人数','平均分','最高分','最低分','达标人数','集中人数','总分前100','总分前200','得分率（%）'],rows:classRows().map(c=>{const q=sub==='总分'?c:c.subjects[sub]||{};return [c.class,sub==='总分'?c.participants:q.count,q.mean,q.max,q.min,sub==='总分'?c.elite_count:q.achievers,sub==='总分'?c.elite_count:q.concentrated,c.top?.['100']??0,c.top?.['200']??0,q.score_rate??null];}),note:subtitle()};}
  function studentRows(){const needle=S.studentSearch.trim().toLowerCase();return S.analysis.students.filter(s=>(!S.studentClass||s.class===S.studentClass)&&(!needle||[s.name,s.class,s.id,String(s.source_row)].some(x=>String(x).toLowerCase().includes(needle))));}
  function studentTable(rows=studentRows()){const subjects=S.analysis.subjects;return {id:'students_filtered',title:'学生成绩与薄弱学科',columns:['班级','姓名 / 来源行','总分','年级名次','班级名次',...subjects,'薄弱学科'],rows:rows.map(s=>[s.class,s.name,s.total,s.rank,s.class_rank,...subjects.map(x=>s.scores[x]),s.weak.map(x=>x.subject).join('、')]),note:subtitle()};}
  function scoreBinsSection(a){const bins=a.score_bins||[];if(!bins.length||S.subject!=='总分')return '';const peak=Math.max(...bins.map(b=>b.count),1);return `<section class="panel"><div class="section-title"><div><h2>总分分数段分布</h2><p>按口径设置的分数段间隔（每段 ${n(a.rules.score_bin_step,0)} 分）统计总分有效人群</p></div>${btn('调整间隔','rules','','secondary small')}</div><div class="score-bins-grid">${bins.map(b=>`<div class="score-bin-row"><span class="score-bin-label">${e(b.label)}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(0,100*b.count/peak)}%"></span></span><span class="score-bin-count">${n(b.count,0)}人</span></div>`).join('')}</div></section>`;}
  function renderCompare(){const a=S.analysis,stats=S.subject==='总分'?a.summary:a.subject_stats.find(x=>x.subject===S.subject)||{},classes=classRows();const max=Math.max(...classes.map(c=>S.subject==='总分'?c.mean||0:c.subjects[S.subject]?.mean||0),1);const meanVal=stats.mean??null,meanPct=meanVal!=null&&max>0?Math.max(0,Math.min(100,100*meanVal/max)):null;const rows=studentRows(),pageSize=40;S.page=Math.min(S.page,Math.max(0,Math.ceil(rows.length/pageSize)-1));paint(`<div class="tab-strip"><button data-action="compare-tab" data-tab="classes" class="${S.compareTab==='classes'?'active':''}">班级与学科对比</button><button data-action="compare-tab" data-tab="students" class="${S.compareTab==='students'?'active':''}">学生明细与薄弱学科</button></div>${S.compareTab==='classes'?`<section class="panel"><div class="toolbar"><label>比较指标<select id="subject-select">${['总分',...a.subjects].map(x=>option(x,x,S.subject)).join('')}</select></label><input id="class-search" type="search" placeholder="搜索班号" value="${e(S.classSearch)}" aria-label="搜索班号"><div class="spacer"></div>${btn('复制班级表','copy-classes','','secondary small')}${btn('下载 CSV','csv-classes','','secondary small')}</div><div class="metric-strip"><div><small>${S.subject==='总分'?'总分有效人数':'学科实考人数'}</small><strong>${n(S.subject==='总分'?stats.participants:stats.count,0)}<em>人</em></strong></div><div><small>${e(S.subject)}均分</small><strong>${n(stats.mean)}<em>分</em></strong></div><div><small>前${n(a.rules.cutoff_ratio*100,0)}%分界</small><strong>${n(stats.cutoff)}<em>分</em></strong></div><div><small>达标人数</small><strong>${n(S.subject==='总分'?stats.elite_count:stats.achievers,0)}<em>人</em></strong></div>${S.subject!=='总分'?`<div><small>集中人数</small><strong>${n(stats.concentrated,0)}<em>人</em></strong></div>`:''}</div><div class="section-title"><div><h2>${e(S.subject)}班级表现</h2><p>按均分排列 · 点击任意班进入明细与达标名单</p></div><div class="bar-chart-legend"><span><i style="background:var(--primary)"></i>前3名</span><span><i style="background:#8f74c9"></i>均分以上</span><span><i style="background:#b7b1c8"></i>低于均分</span>${meanPct!=null?`<span><i class="dash"></i>年级均分 ${n(meanVal)}</span>`:''}</div></div><div class="bar-chart">${classes.map((c,idx)=>{const value=S.subject==='总分'?c.mean:c.subjects[S.subject]?.mean;const rowCls=idx<3?'is-top':(meanVal!=null&&value!=null&&value<meanVal?'is-below':'');return `<button class="bar-row ${rowCls}" data-action="class-detail" data-class="${e(c.class)}"><span class="bar-rank">${idx+1}</span><span class="bar-label">${e(c.class)}班</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(0,100*(value||0)/max)}%"></span>${meanPct!=null?`<span class="bar-mean-mark" style="left:${meanPct}%" title="年级均分 ${n(meanVal)}"></span>`:''}</span><span class="bar-number">${n(value)}</span></button>`;}).join('')||'<p class="muted">没有匹配的班级，试试清空搜索。</p>'}</div></section><section class="panel"><div class="section-title"><h2>班级统计明细</h2><small>达标：单科达线；集中：单科与总分同时达线</small></div><div class="table-wrap"><table><thead><tr>${classTable().columns.map((x,i)=>`<th class="${i?'number':''}">${e(x)}</th>`).join('')}<th></th></tr></thead><tbody>${classTable().rows.map(r=>`<tr data-action="class-detail" data-class="${e(r[0])}">${r.map((v,i)=>`<td class="${i?'number':''}">${i?n(v):e(v)+'班'}</td>`).join('')}<td class="table-action">查看 →</td></tr>`).join('')}</tbody></table></div><p class="table-note">前100、前200始终按总分名次统计；切换学科不会改变这两列的含义。各科满分未确认时不展示得分率。</p></section>${scoreBinsSection(a)}`:`<section class="panel"><div class="toolbar"><label>班级<select id="student-class">${option('','全部班级',S.studentClass)}${a.classes.map(x=>option(x,x+'班',S.studentClass)).join('')}</select></label><input id="student-search" type="search" placeholder="姓名、班号或来源行" value="${e(S.studentSearch)}" aria-label="搜索学生"><div class="spacer"></div><span class="small-text">${n(rows.length,0)}条记录</span>${btn('复制筛选结果','copy-students','','secondary small')}${btn('打印名单','print-students','','secondary small')}</div><div class="table-wrap"><table><thead><tr><th>班级</th><th>姓名 / 来源行</th><th class="number">总分</th><th class="number">年级名次</th><th class="number">班级名次</th><th>薄弱学科</th><th></th></tr></thead><tbody>${rows.slice(S.page*pageSize,(S.page+1)*pageSize).map(s=>`<tr data-action="student-detail" data-index="${a.students.indexOf(s)}"><td>${e(s.class)}</td><td>${e(s.name)}</td><td class="number">${n(s.total)}</td><td class="number">${n(s.rank,0)}</td><td class="number">${n(s.class_rank,0)}</td><td>${e(s.weak.map(x=>x.subject).join('、')||'未参与排名')}</td><td class="table-action">查看 →</td></tr>`).join('')||'<tr><td colspan="7">当前筛选没有学生记录。</td></tr>'}</tbody></table></div>${pager(rows.length,pageSize,S.page,'students')}<p class="table-note">匿名原始表按来源行识别。薄弱学科按本次总分名次与单科名次差排序，不代表具体知识点诊断。</p></section>`}`);}
  function pager(count,size,page,type){return `<div class="table-pager"><span>共 ${n(count,0)} 条 · 第 ${page+1} / ${Math.max(1,Math.ceil(count/size))} 页</span><div>${btn('上一页','page',`data-type="${type}" data-direction="-1" ${page===0?'disabled':''}`,'small')}${btn('下一页','page',`data-type="${type}" data-direction="1" ${(page+1)*size>=count?'disabled':''}`,'small')}</div></div>`;}
  function openDrawer(title,label,html,type='detail'){lastFocus=document.activeElement;S.drawerType=type;$('drawer-title').textContent=title;$('drawer-label').textContent=label;$('drawer-content').innerHTML=html;$('drawer-content').querySelectorAll('tr[data-action]').forEach(row=>row.tabIndex=0);$('drawer-overlay').hidden=false;document.body.style.overflow='hidden';$('drawer-overlay').querySelector('button').focus();}
  function closeDrawer(){if($('drawer-overlay').hidden)return;$('drawer-overlay').hidden=true;document.body.style.overflow='';S.drawerType='';S.drawerFile=null;if(lastFocus?.isConnected)lastFocus.focus();}
  function classDetail(cls){const a=S.analysis,c=a.class_stats.find(x=>x.class===cls);if(!c)return;const rows=a.students.filter(x=>x.class===cls);S.drawerTable=studentTable(rows);openDrawer(`${cls}班 · ${S.subject}`,`${a.metadata.grade} · ${a.metadata.name}`,`<div class="metric-strip compact"><div><small>总分有效人数</small><strong>${n(c.participants,0)}</strong></div><div><small>总分均分</small><strong>${n(c.mean)}</strong></div><div><small>总分达标</small><strong>${n(c.elite_count,0)}</strong></div></div><div class="drawer-actions">${btn('进入班情分析','open-class-brief',`data-class="${e(cls)}"`,'primary')}${btn('复制本班成绩','copy-drawer')}${btn('打印本班成绩','print-drawer')}${btn('记录教研事项','note-class',`data-class="${e(cls)}"`)}</div><h3>各科表现与入选人数</h3><div class="table-wrap"><table><thead><tr><th>学科</th><th class="number">均分</th><th class="number">达标</th><th class="number">集中</th><th></th></tr></thead><tbody>${a.subjects.map(sub=>{const q=c.subjects[sub]||{};return `<tr><td>${e(sub)}</td><td class="number">${n(q.mean)}</td><td class="number">${n(q.achievers,0)}</td><td class="number">${n(q.concentrated,0)}</td><td><button class="table-action" data-action="achiever-detail" data-class="${e(cls)}" data-subject="${e(sub)}">看名单 →</button></td></tr>`;}).join('')}</tbody></table></div><h3>学生明细</h3><div class="table-wrap"><table><thead><tr><th>姓名 / 来源行</th><th>总分</th><th>年级名次</th><th>薄弱学科</th></tr></thead><tbody>${rows.map(s=>`<tr data-action="student-detail" data-index="${a.students.indexOf(s)}"><td>${e(s.name)}</td><td>${n(s.total)}</td><td>${n(s.rank,0)}</td><td>${e(s.weak.map(x=>x.subject).join('、')||'—')}</td></tr>`).join('')}</tbody></table></div><p class="table-note">${e(subtitle())}</p>`);}
  function achieverDetail(cls,subject){const a=S.analysis,line=a.cutoffs[subject]?.score,totalLine=a.cutoffs['总分']?.score;const rows=a.students.filter(s=>s.class===cls&&s.rank!==null&&s.rank!==undefined&&s.scores[subject]!==null&&s.scores[subject]!==undefined&&line!==null&&s.scores[subject]>=line);S.drawerTable={title:`${cls}班${subject}达标名单`,columns:['班级','姓名 / 来源行',subject+'分数','总分','年级名次','是否集中'],rows:rows.map(s=>[s.class,s.name,s.scores[subject],s.total,s.rank,s.total>=totalLine?'是':'否']),note:`${subject}分界 ${line}；总分分界 ${totalLine}。${subtitle()}`};openDrawer(`${cls}班 · ${subject}达标名单`,'从人数回到依据',`<p class="history-explain">${e(subject)} ≥ <b>${n(line)}</b> 分纳入学科达标；同时总分 ≥ <b>${n(totalLine)}</b> 分，计入集中人数。</p><div class="drawer-actions">${btn('复制名单','copy-drawer')}${btn('打印名单','print-drawer')}</div>${Z.tableHTML(S.drawerTable)}<p class="table-note">${e(subtitle())}</p>`);}
  function studentDetail(index){const a=S.analysis,s=a.students[index];if(!s)return;const table={title:`${s.name} · 学科分析`,columns:['学科','分数','单科名次','ABC','六等级','总分名次−单科名次'],rows:a.subjects.map(x=>[x,s.scores[x],s.ranks[x],s.grades[x],s.levels[x],s.rank!=null&&s.ranks[x]!=null?s.rank-s.ranks[x]:null]),note:subtitle()};S.drawerTable=table;openDrawer(s.name,`${s.class}班 · 来源第${s.source_row}行`,`<div class="metric-strip compact"><div><small>总分</small><strong>${n(s.total)}</strong></div><div><small>年级名次</small><strong>${n(s.rank,0)}</strong></div><div><small>班级名次</small><strong>${n(s.class_rank,0)}</strong></div></div><div class="drawer-actions">${btn('打印个人诊断卡（发家长）','print-single-card',`data-student-id="${e(s.id)}"`,'primary')}${btn('复制学科表','copy-drawer')}${btn('打印学科表','print-drawer')}</div>${Z.tableHTML(table)}<div class="support-note"><b>本次优先关注：</b>${e(s.weak.map(x=>x.subject).join('、')||'未生成薄弱科结果')}<br>按名次差从小到大选取不同学科；与历次表现、课堂证据结合后再确定支持安排。</div>${!s.identity_reliable?'<p class="table-note">原表未提供可用于跨考试匹配的身份信息，该来源行不会被自动当作同一个人的历史记录。</p>':''}`);}
  function selectedHistoryIds(exams){const ids=exams.map(x=>x.id);if(!S.historySelectionInitialized){S.historySelection=ids.slice();S.historySelectionInitialized=true;}else{S.historySelection=S.historySelection.filter(id=>ids.includes(id));}return S.historySelection;}
  function historyStudents(){const needle=S.historySearch.trim().toLowerCase();return (S.history?.students||[]).filter(s=>!needle||[s.name,s.class,s.id].some(x=>String(x).toLowerCase().includes(needle)));}
  function historyTable(){const rows=historyStudents();return {title:'历次综合名次',columns:['班级','姓名','有效次数','普通平均','去极值平均','加权平均','平均PR','PR首末变化','综合指标','综合名次'],rows:rows.map(s=>[s.class,s.name,s.attempts,s.mean,s.trimmed,s.weighted,s.mean_pr,s.pr_delta,s.composite,s.rank]),note:'综合指标为三个平均名次的均值，越小越靠前；年级百分位 PR（0–100，越高越靠前）可消除试卷难度波动。'};}
  function historyTableHTML(){const rows=historyStudents(),start=S.historyPage*50,visible=rows.slice(start,start+50);return `<div class="table-wrap history-result-table"><table><thead><tr><th>班级</th><th>姓名</th><th class="number">有效次数</th><th class="number">普通平均</th><th class="number">去极值平均</th><th class="number">加权平均</th><th class="number">平均 PR</th><th class="number">PR 变化</th><th class="number">综合名次</th><th></th></tr></thead><tbody>${visible.length?visible.map(s=>{const d=s.pr_delta;const dCls=d==null||d===0?'':d>0?'delta-positive':'delta-negative';const dTxt=d==null?'—':d===0?'0':`${d>0?'+':''}${n(d,1)}`;return `<tr data-action="growth-detail" data-id="${e(s.id)}"><td>${e(s.class)}</td><td>${e(s.name)}</td><td class="number">${n(s.attempts,0)}</td><td class="number">${n(s.mean)}</td><td class="number">${n(s.trimmed)}</td><td class="number">${n(s.weighted)}</td><td class="number">${n(s.mean_pr,1)}</td><td class="number ${dCls}">${dTxt}</td><td class="number">${n(s.rank,0)}</td><td class="table-action">看成长 →</td></tr>`;}).join(''):'<tr><td colspan="10">没有可关联的学生历史记录。请导入包含稳定学号或班级姓名的考试表。</td></tr>'}</tbody></table></div>`;}
  function historySelectionHTML(exams){const selected=selectedHistoryIds(exams);return `<div class="history-select-grid">${exams.map(x=>`<label class="history-exam-card"><input type="checkbox" data-history-exam value="${e(x.id)}" ${selected.includes(x.id)?'checked':''}><span><b>${e(x.name)}</b><small>${e(x.date)} · ${n(x.summary?.participants,0)}人 · ${n(x.summary?.mean)}分均分</small></span><em>${selected.includes(x.id)?'已选':'未选'}</em></label>`).join('')}</div><p class="history-selection-count">已选择 <strong>${selected.length}</strong> 场考试，至少选择两场才能解释成长变化。</p>`;}
  function growthDetail(id){const student=(S.history?.students||[]).find(item=>item.id===id);if(!student)return;const ordered=(student.history||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.exam_id).localeCompare(String(b.exam_id)));const subjects=[...new Set(ordered.flatMap(item=>Object.keys(item.scores||{})))];const first=ordered[0],last=ordered[ordered.length-1],prDelta=first&&last&&first.pr!=null&&last.pr!=null?Number((last.pr-first.pr).toFixed(1)):null;const growthRows=ordered.map((item,index)=>{const previous=ordered[index-1],change=previous&&previous.pr!=null&&item.pr!=null?Number((item.pr-previous.pr).toFixed(1)):null;return [item.name,item.date,`${item.class}班`,item.total,item.rank,item.pr,item.t_score,change,item.weak?.map(x=>x.subject).join('、')||'—'];});const scoreRows=subjects.map(subject=>[subject,...ordered.map(item=>item.scores?.[subject]??null)]);const idInfo=identityLabel(student.id);const charts=ordered.length>=2?`<div class="growth-charts">${growthChartSVG(ordered,'pr',{title:'年级百分位（PR）走势',hint:'0–100，越高越强，已消除难度波动',invert:false,digits:1,lineClass:'line-rank',dotClass:'dot-rank'})}${growthChartSVG(ordered,'t_score',{title:'标准分（T分）走势',hint:'年级均值为50，高于50即高于均分',invert:false,digits:1})}</div>`:'';S.drawerTable={title:`${student.name} · 成长轨迹`,columns:['考试','日期','班级','总分','年级名次','百分位PR','标准分T','较上次PR','优先关注'],rows:growthRows,note:`${idInfo} · ${ordered.length}场考试 · ${subtitle()}`};openDrawer(`${student.name} · 成长轨迹`,`${idInfo} · ${student.class}班`,`<div class="metric-strip compact growth-metrics"><div><small>已关联考试</small><strong>${n(ordered.length,0)}<em>场</em></strong></div><div><small>最近百分位 PR</small><strong>${n(last?.pr,1)}</strong></div><div><small>最近标准分 T</small><strong>${n(last?.t_score,1)}</strong></div><div><small>PR 首末变化</small><strong class="${prDelta!=null&&prDelta>=0?'growth-positive':prDelta!=null?'growth-negative':''}">${prDelta==null?'—':`${prDelta>=0?'+':''}${n(prDelta,1)}`}</strong></div></div>${charts}<p class="history-explain">年级百分位（PR）与标准分（T分）可消除各次试卷难易波动，更客观反映学业增值。每一行均来自选中的真实考试。</p><div class="drawer-actions">${btn('打印个人诊断卡','print-single-card',`data-student-id="${e(student.id)}"`,'primary')}${btn('复制成长表','copy-drawer')}${btn('打印成长表','print-drawer')}</div><h3>历次成绩与增值轨迹</h3>${Z.tableHTML(S.drawerTable)}<h3>各学科分数变化</h3>${Z.tableHTML({title:`${student.name} · 学科分数变化`,columns:['学科',...ordered.map(item=>`${item.name}（${item.date}）`)],rows:scoreRows,note:'空白表示该场考试没有可用分数。'})}<p class="table-note">同一学生的综合名次用于排序线索，试卷难度和科目满分变化仍需结合教研判断。</p>`,'growth');}
  function historyResultHTML(exams,students){
    if(!S.history)return `<div class="history-empty"><span class="empty-symbol">${Z.icons('chart')}</span><div><h3>还没有生成多次分析</h3><p>先选择至少两场考试，再生成学生成长轨迹。</p></div></div>`;
    const warningHtml=warnings(S.history.warnings).length?`<div class="support-note">${warnings(S.history.warnings).map(e).join('<br>')}</div>`:'';
    return `<div class="history-result-summary"><div><span>已生成</span><strong>${n(exams.filter(x=>selectedHistoryIds(exams).includes(x.id)).length,0)}<em>场考试</em></strong></div><div><span>已关联学生</span><strong>${n(students.length,0)}<em>人</em></strong></div><div><span>最高综合名次</span><strong>${students.length?n(students[0].rank,0):'—'}${students.length?'<em>名</em>':''}</strong></div></div><div class="section-title history-subhead"><div><h3>综合名次</h3><p>点击一行进入学生成长轨迹</p></div><div class="toolbar-inline"><input id="history-search" type="search" value="${e(S.historySearch)}" placeholder="搜索姓名、班级或编码" aria-label="搜索历史学生">${btn('复制综合表','copy-history')}${btn('下载 CSV','csv-history')}</div></div>${warningHtml}${historyTableHTML()}${pager(students.length,50,S.historyPage,'history')}<div class="section-title history-subhead"><div><h3>学科变化</h3><p>首场与末场的实际均分差，辅助定位教研线索</p></div></div>${subjectTrendSummary(S.history)}`;
  }
  function renderTrends(){
    const exams=S.trends?.exams||[],a=S.analysis,selected=selectedHistoryIds(exams),selectedExams=exams.filter(x=>selected.includes(x.id)),students=historyStudents();
    const trendBody=exams.length>1?`<div class="table-wrap">${trendSVG(exams)}</div>`:'<div class="support-note">已保存1场考试。导入同年级的下一场后，可在这里查看连续变化。</div>';
    const weightsBody=selectedExams.length?`<div class="weights">${selectedExams.map((x,i)=>`<label class="field weight-field">${e(x.name)}<input type="number" min="0.1" max="1000" step="any" value="${S.weights[x.id]??S.history?.exams.find(y=>y.id===x.id)?.weight??i+1}" data-weight="${e(x.id)}" aria-label="${e(x.name)}权重"></label>`).join('')}</div>`:'<p class="small-text">勾选需要纳入计算的考试后，可在这里调整各场权重。</p>';
    const historyResult=historyResultHTML(exams,students);
    paint(`<section class="panel"><div class="section-title"><div><h2>${e(a.metadata.grade)} · 历次总分均分</h2><p>每次考试按其保存的范围与科目配置计算</p></div>${btn('导入下一场考试','navigate','data-view="data"')}</div>${trendBody}<div class="table-wrap"><table><thead><tr><th>考试</th><th>日期</th><th class="number">有效人数</th><th class="number">总分均分</th><th class="number">总分分界</th><th></th></tr></thead><tbody>${exams.map(x=>`<tr data-action="open-exam" data-id="${e(x.id)}"><td>${e(x.name)}</td><td>${e(x.date)}</td><td class="number">${n(x.summary.participants,0)}</td><td class="number">${n(x.summary.mean)}</td><td class="number">${n(x.summary.cutoff)}</td><td class="table-action">查看 →</td></tr>`).join('')}</tbody></table></div><p class="table-note">不同考试的试卷难度、满分与科目可能变化；均分变化用于复盘线索，不能直接解释为教学增值。</p></section>${classTrendSection(exams)}<section class="panel history-panel"><div class="section-title"><div><h2>学生成长轨迹</h2><p>选择同一届的考试，再生成学生、班级和学科变化</p></div><span class="badge">${selected.length}场已选</span></div>${historySelectionHTML(exams)}<p class="history-explain">稳定编码优先用于跨次匹配。姓名或班级变化不会打断同一学生的轨迹；没有可靠身份的记录只参与本次统计。</p>${weightsBody}<div id="history-error" class="error" hidden></div><div class="form-actions"><button class="btn primary" data-action="history">生成已选考试结果</button><span class="small-text">生成后点击学生行，可查看总分、名次、百分位 PR、标准分 T 分与各学科变化。</span></div>${historyResult}</section>`);
  }
  function renderNotes(){const a=S.analysis;paint(`<section class="panel"><div class="section-title"><div><h2>记录一次教研判断</h2><p>${e(a.metadata.name)} · 记录会随这场考试保存</p></div></div><form id="note-form"><label class="field" style="max-width:240px">关联班级<select name="class" id="note-class">${option('','年级整体','')}${a.classes.map(x=>option(x,x+'班',S.noteClass||'')).join('')}</select></label><label class="field" style="margin-top:16px">发现、核实结果与后续安排<textarea id="note-text" name="text" required maxlength="5000" placeholder="例如：先核实本次缺考情况，再与学科组确认需要重点支持的学生。">${e(S.noteDraft)}</textarea></label><div id="note-error" class="error" hidden></div><div class="form-actions"><button class="btn primary" type="submit">保存教研记录</button><span class="small-text">保存后可重新打开查阅，数据随备份一并保留。</span></div></form></section><section class="panel"><div class="section-title"><h2>已保存的记录</h2><small>${S.notes.length}条</small></div>${S.notes.length?S.notes.map(x=>`<article class="note-card"><header><div class="note-meta"><span class="badge">${e(x.class?x.class+'班':'年级整体')}</span><time>${e(x.created_at?new Date(x.created_at).toLocaleString('zh-CN',{hour12:false}):'')}</time></div><div class="note-actions"><button class="text-button" data-action="edit-note" data-id="${e(x.id)}">编辑</button><button class="text-button danger" data-action="delete-note" data-id="${e(x.id)}">${S.confirmDeleteNote===x.id?'确认删除':'删除'}</button></div></header><p>${e(x.text)}</p></article>`).join(''):'<p class="muted">这场考试还没有教研记录。保存第一条后会出现在这里。</p>'}</section>`);}
  function reportTable(){const a=S.analysis;let t=a.tables.find(x=>x.id===S.tableId)||a.tables[0];if(!t)return {title:'分析结果',columns:[],rows:[]};const needle=S.reportSearch.trim().toLowerCase();return {...t,rows:needle?t.rows.filter(r=>r.some(v=>String(v??'').toLowerCase().includes(needle))):t.rows};}
  function renderReports(){const a=S.analysis;const t=reportTable(),count=t.rows.length;S.page=Math.min(S.page,Math.max(0,Math.ceil(count/60)-1));paint(`<section class="panel dist-bar-panel"><div class="dist-bar"><div><h2>分级安全分发（按角色防泄密）</h2><p>按班主任与家长/学生的不同隐私边界一键生成分发材料，无需手工拆表</p></div><div class="dist-bar-actions">${btn('一键按班拆包 ZIP（发班主任）','download-class-zip','','secondary small')}${btn('学生个人诊断卡（发家长/学生）','open-student-cards','','primary small')}</div></div></section><div class="report-tab-list">${a.tables.map(x=>`<button data-action="report-tab" data-table="${e(x.id)}" class="${x.id===t.id?'active':''}">${e(x.title)}</button>`).join('')}</div><section class="panel"><div class="section-title"><div><h2>${e(t.title)}</h2><p>${e(a.metadata.name)} · ${n(count,0)}条记录</p></div><div class="panel-heading-actions">${btn('复制当前表','copy-report')}${btn('打印当前表','print-report','','primary')}</div></div><div class="toolbar"><input id="report-search" type="search" value="${e(S.reportSearch)}" placeholder="在当前报表中查找" aria-label="在报表中搜索"><div class="spacer"></div>${btn('下载当前 CSV','csv-report')}${btn('打印全部分析表','print-all')}</div>${t.note?`<p class="table-note" style="margin:0 0 15px">${e(t.note)}</p>`:''}<div class="report-table">${Z.tableHTML({...t,rows:t.rows.slice(S.page*60,(S.page+1)*60)})}</div>${pager(count,60,S.page,'report')}<p class="table-note">复制、CSV与打印当前表包含全部筛选结果，不限于当前页。导出全部Excel会保留各分析表与统计口径。</p></section>`);}
  function importFields(prefix=''){const id=name=>`${prefix}${name}`;return `<div class="form-grid"><label class="field">考试名称<input id="${id('import-name')}" name="name" required value="${e(S.importMeta.name)}" placeholder="如：初三定时练习（三）"></label><label class="field">年级<input id="${id('import-grade')}" name="grade" required value="${e(S.importMeta.grade)}" placeholder="如：初三"></label><label class="field">考试日期<input id="${id('import-date')}" name="date" required type="date" value="${e(S.importMeta.date)}"></label></div>`;}
  function renderData(){paint(`<section class="panel"><div class="section-title"><div><h2>导入考试成绩</h2><p>支持单场导入或「一张总表多场考试」增量批量导入，自动核对错别字与重名</p></div><div class="panel-heading-actions">${btn('多考总表批量导入','open-multi-import','','primary small')}<a class="btn quiet small" href="/api/templates/scores.xlsx" download>成绩模板</a><a class="btn quiet small" href="/api/templates/teachers.xlsx" download>教师模板</a>${btn('使用原始样例','example','','secondary small')}</div></div><form id="import-form">${importFields()}<div class="upload-area"><div><strong>选择单场 Excel 或 CSV 成绩表</strong><p>支持班级、姓名 / 学号与各科成绩；如工作簿包含历次多场考试，请点击右上角「多考总表批量导入」。</p></div><input id="import-file" type="file" accept=".xlsx,.xlsm,.csv" aria-label="选择成绩文件"></div><div class="form-actions"><button class="btn primary" type="submit">读取并检查文件</button><label class="field" style="flex-direction:row;align-items:center">文件密码（如有）<input id="import-password" type="password" autocomplete="off" style="width:150px" aria-label="Excel文件密码"></label></div><div id="import-error" class="error" ${S.importError?'':'hidden'}>${e(S.importError)}</div></form>${S.pending?`<div class="import-preview" id="inline-import-preview"><div class="section-title"><div><h2>检查完成，等待保存</h2><p>${e(S.pending.filename)} · ${n(S.pending.rows.length,0)}条记录 · ${S.pending.classes.length}个班 · ${S.pending.subjects.length}科</p></div><span class="badge">尚未写入档案</span></div><p class="inline-help">识别学科：${e(S.pending.subjects.join('、'))}。默认纳入全部班级与现有科目，保存后可调整统计口径。</p>${window.LeaderMulti.hygienePanelHTML(S.pendingHygiene,'single')}${warnings(S.pending.warnings).length?`<ul class="validation-list">${warnings(S.pending.warnings).slice(0,20).map(x=>`<li>${e(x)}</li>`).join('')}</ul>`:'<p class="inline-help">未发现导入校验提示。</p>'}<div class="table-wrap"><table><thead><tr><th>来源行</th><th>班级</th><th>姓名 / 来源行</th>${S.pending.subjects.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${S.pending.rows.slice(0,5).map(x=>`<tr><td>${n(x.source_row,0)}</td><td>${e(x.class)}</td><td>${e(x.name)}</td>${S.pending.subjects.map(sub=>`<td>${n(x.scores[sub])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="form-actions">${btn('保存考试并查看分析','save-import','','primary')}${btn('放弃本次待存数据','discard-import')}<span class="small-text">保存使用上方填写的考试名称、年级和日期（已勾选的错别字将自动修正）。</span></div></div>`:''}</section><section class="panel"><div class="section-title"><div><h2>已保存的考试</h2><p>可随时修改名称/届别/日期与统计口径；归档后可恢复。</p></div><small>${S.exams.length}场</small></div>${S.exams.length?`<div class="table-wrap"><table><thead><tr><th>考试</th><th>年级</th><th>日期</th><th class="number">原始记录</th><th>数据来源</th><th>操作</th></tr></thead><tbody>${S.exams.map(x=>`<tr><td><button class="table-action" data-action="open-exam" data-id="${e(x.id)}">${e(x.name)}</button></td><td>${e(x.grade)}</td><td>${e(x.date)}</td><td class="number">${n(x.row_count,0)}</td><td>${e(x.filename)}</td><td><button class="text-button" data-action="edit-exam" data-id="${e(x.id)}">信息</button><button class="text-button" data-action="rules" data-id="${e(x.id)}">口径</button><button class="text-button" data-action="archive" data-id="${e(x.id)}">归档</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">尚未保存考试。上方导入并检查后，点击“保存考试”。</p>'}</section><div class="two-col"><section class="panel"><div class="section-title"><div><h2>本地备份与恢复</h2><p>包含考试、统计规则、教师与教研记录</p></div></div><div class="storage-actions"><a class="btn primary" href="/api/backup" download>下载完整备份</a><button class="btn secondary" data-action="choose-backup">从备份恢复</button><input id="backup-file" type="file" accept=".json" hidden></div><p class="inline-help">恢复支持按时间戳智能增量合并，不清空本机独有考试。备份文件不包含 S3 密钥。</p><div id="backup-result" role="status"></div></section>${window.LeaderS3.renderS3CardHTML(S.s3)}</div><section class="panel"><div class="section-title"><div><h2>已归档考试</h2><p>不参与总览和趋势，恢复后重新纳入；确认无需保留可彻底删除。</p></div><small>${S.archives.length}场</small></div>${S.archives.length?S.archives.map(x=>`<div class="grade-row" style="grid-template-columns:1fr auto"><div><h3>${e(x.name)}</h3><p>${e(x.grade)} · ${e(x.date)}</p></div><div class="archive-actions">${btn('恢复','restore-exam',`data-id="${e(x.id)}"`,'small')}${btn(S.confirmDeleteExam===x.id?'确认删除':'彻底删除','delete-exam',`data-id="${e(x.id)}"`,'small danger')}</div></div>`).join(''):'<p class="muted">当前没有已归档考试。</p>'}</section>`);}
  function importMapping(pending){const mapping=pending?.mapping||{},columns=Object.entries(mapping.subjects||{}).map(([subject,column])=>`${subject}（第${column}列）`).join('、');const unrecognized=(mapping.unrecognized||[]).join('、');return `<div class="import-mapping"><div class="section-title"><div><h3>字段识别</h3><p>导入前先确认系统读到的工作表和身份字段</p></div><span class="badge">${e(mapping.identity||'待识别')}</span></div><dl><div><dt>成绩页</dt><dd>${e(mapping.sheet||'—')}</dd></div><div><dt>表头行</dt><dd>第${n(mapping.header_row,0)}行</dd></div><div><dt>班级</dt><dd>第${n(mapping.class,0)}列</dd></div><div><dt>姓名</dt><dd>${mapping.name?`第${n(mapping.name,0)}列`:'未提供'}</dd></div><div><dt>稳定编码</dt><dd>${mapping.id?`第${n(mapping.id,0)}列`:'未提供'}</dd></div>${mapping.exam_id?`<div><dt>考号列</dt><dd>第${n(mapping.exam_id,0)}列（不作跨次学号）</dd></div>`:''}<div class="wide"><dt>学科列</dt><dd>${e(columns||'—')}</dd></div>${unrecognized?`<div class="wide"><dt>已跳过列</dt><dd>${e(unrecognized)}</dd></div>`:''}</dl></div>`;}
  function importDrawerHTML(){const p=S.pending,fileName=S.drawerFile?.name||'尚未选择文件';return `<form id="drawer-import-form" class="import-drawer-form"><div class="drawer-intro"><p>原始成绩只在你点击保存前停留在内存中。先读取文件，再核对字段、跨考错别字与身份编码。若一份 Excel 包含多场考试，可点击 <button type="button" class="text-button" data-action="open-multi-import">多考总表批量导入 →</button></p></div>${importFields('drawer-')}<div class="drawer-upload" id="drawer-dropzone"><div class="drawer-upload-symbol">${Z.icons('upload')}</div><div><strong id="drawer-file-name">${e(fileName)}</strong><p>${S.drawerFile?'已选择文件，可以开始读取。':'拖入成绩表，或点击右侧选择文件。支持 .xlsx、.xlsm、.csv。'}</p></div><label class="btn secondary">选择文件<input id="drawer-import-file" type="file" accept=".xlsx,.xlsm,.csv" hidden></label></div><details class="drawer-password"><summary>文件有密码？</summary><label class="field">本次读取密码<input id="drawer-import-password" type="password" autocomplete="off" placeholder="只用于本次读取"></label></details><div class="form-actions"><button class="btn primary" type="submit" ${S.drawerFile?'':'disabled'}>读取并检查文件</button><a class="btn quiet small" href="/api/templates/scores.xlsx" download>下载标准模板</a></div><div id="drawer-import-error" class="error" ${S.importError?'':'hidden'}>${e(S.importError)}</div></form>${p?`<section class="import-drawer-preview" id="drawer-import-preview"><div class="section-title"><div><h3>核验结果</h3><p>${e(p.filename)} · ${n(p.rows.length,0)}条记录 · ${n(p.classes.length,0)}个班 · ${n(p.subjects.length,0)}科</p></div><span class="badge success">等待保存</span></div>${importMapping(p)}${window.LeaderMulti.hygienePanelHTML(S.pendingHygiene,'single')}${warnings(p.warnings).length?`<div class="import-validation"><strong>需要留意的事项</strong><ul class="validation-list">${warnings(p.warnings).slice(0,24).map(x=>`<li>${e(x)}</li>`).join('')}</ul></div>`:'<p class="inline-help">未发现导入核验提示。</p>'}<div class="table-wrap"><table><thead><tr><th>来源行</th><th>班级</th><th>稳定编码</th><th>姓名</th>${p.subjects.map(x=>`<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${p.rows.slice(0,6).map(x=>`<tr><td>${n(x.source_row,0)}</td><td>${e(x.class)}</td><td>${e(identityCell(x.id))}</td><td>${e(x.name)}</td>${p.subjects.map(sub=>`<td>${n(x.scores[sub])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="form-actions">${btn('保存并查看本次分析','save-drawer-import','type="button"','primary')}${btn('放弃待存数据','discard-drawer-import','type="button"')}<span class="small-text">确认保存后，考试才会进入长期档案。</span></div></section>`:''}`;}
  function bindImportDrawer(){const dz=$('drawer-dropzone'),input=$('drawer-import-file');if(!dz||!input)return;const show=file=>{if(!file)return;S.drawerFile=file;const name=$('drawer-file-name');if(name)name.textContent=file.name;const note=dz.querySelector('p');if(note)note.textContent='已选择文件，可以开始读取。';const submit=$('drawer-import-form')?.querySelector('[type="submit"]');if(submit)submit.disabled=false;};input.addEventListener('change',()=>show(input.files[0]));dz.addEventListener('dragover',event=>{event.preventDefault();dz.classList.add('drag-over')});dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));dz.addEventListener('drop',event=>{event.preventDefault();dz.classList.remove('drag-over');show(event.dataTransfer.files[0])});}
  function refreshImportDrawer(){const content=$('drawer-content');if(!content)return;content.innerHTML=importDrawerHTML();bindImportDrawer();}
  function openImportDrawer(){S.pending=null;S.pendingHygiene=null;S.importError='';S.drawerFile=null;openDrawer('导入一次成绩','快速导入 / 新建考试档案',importDrawerHTML(),'import');bindImportDrawer();}
  function readImportMeta(prefix=''){const id=name=>`${prefix}${name}`;S.importMeta={name:$(id('import-name'))?.value.trim()||'',grade:$(id('import-grade'))?.value.trim()||'',date:$(id('import-date'))?.value||''};return S.importMeta;}
  async function example(){if(S.view==='data')readImportMeta();const dataset=await Z.api('/api/example');S.pending=dataset;S.pendingHygiene=null;S.importMeta={name:dataset.name||'初三定时练习（二）',grade:dataset.grade||'初三',date:dataset.date||'2026-10-19'};S.importError='';S.view='data';S.archives=(await Z.api('/api/exams?archived=1')).exams||[];persist();header();renderData();Z.notice('已读取提供的原始表，检查后可保存为考试档案。');}
  function applyRuleMarkPreset(presetId) {
    const form = $('rules-form');
    if (!form) return;
    const inputs = [...form.querySelectorAll('[name="fullmark"]')];
    if (presetId === 'clear') {
      inputs.forEach(input => { input.value = ''; });
      Z.notice('已清空各科满分。');
      return;
    }
    if (presetId === 'save') {
      const current = {};
      inputs.forEach(input => { if (input.value.trim() !== '') current[input.dataset.subject] = Number(input.value); });
      const saved = Z.setFullMarkTemplate(current);
      const bar = $('rule-mark-presets');
      if (bar) bar.outerHTML = window.LeaderRules.ruleMarkPresetsHTML();
      Z.notice(`已保存 ${Object.keys(saved).length} 科常用满分模板。`);
      return;
    }
    const preset = presetId === 'saved' ? { marks: Z.getFullMarkTemplate() } : Z.fullMarkPresets.find(p => p.id === presetId);
    if (!preset) return;
    let filled = 0;
    inputs.forEach(input => {
      const val = preset.all ?? preset.marks?.[input.dataset.subject];
      if (val != null) { input.value = val; filled += 1; }
    });
    Z.notice(filled ? `已按模板填入 ${filled} 科满分，请核对后保存口径。` : '当前考试没有与模板匹配的学科。');
  }
  function editExam(id) {
    const exam = S.exams.find(x => x.id === id);
    if (!exam) return;
    openDrawer('编辑考试信息', `${exam.filename || '本机考试档案'}`, `<form id="exam-meta-form" data-id="${e(exam.id)}"><div class="rules-section"><label class="field">考试名称<input name="name" required maxlength="100" value="${e(exam.name)}"></label></div><div class="form-grid two rules-section"><label class="field">年级 / 届别<input name="grade" required maxlength="30" value="${e(exam.grade)}" placeholder="如：初2027届"></label><label class="field">考试日期<input name="date" type="date" required value="${e(exam.date)}"></label></div><p class="inline-help">历次趋势按相同的“年级 / 届别”归组。如需跨学年连续追踪同一届学生，建议统一改为“初2027届”等固定届别名称。</p><div id="exam-meta-error" class="error" hidden></div><div class="form-actions"><button type="submit" class="btn primary">保存信息</button><button type="button" class="btn secondary" data-action="close-drawer">取消</button></div></form>`, 'edit-exam');
  }
  async function saveExamMeta(form) {
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim(), grade = String(data.get('grade') || '').trim(), date = String(data.get('date') || '').trim();
    if (!name || !grade || !date) throw new Error('考试名称、年级和日期均不能为空。');
    await Z.api('/api/exams/' + encodeURIComponent(form.dataset.id) + '/meta', { name, grade, date });
    S.analysis = null;
    await loadExams();
    closeDrawer();
    await loadView();
    Z.notice('考试信息已更新。');
  }
  function editNote(id) {
    const note = S.notes.find(x => x.id === id);
    if (!note || !S.analysis) return;
    openDrawer('编辑教研记录', `${S.analysis.metadata.name}`, `<form id="edit-note-form" data-id="${e(note.id)}"><div class="rules-section"><label class="field" style="max-width:240px">关联班级<select name="class">${option('', '年级整体', note.class || '')}${S.analysis.classes.map(x => option(x, x + '班', note.class || '')).join('')}</select></label></div><div class="rules-section"><label class="field">发现、核实结果与后续安排<textarea name="text" required maxlength="5000">${e(note.text)}</textarea></label></div><div id="edit-note-error" class="error" hidden></div><div class="form-actions"><button type="submit" class="btn primary">保存修改</button><button type="button" class="btn secondary" data-action="close-drawer">取消</button></div></form>`, 'edit-note');
  }
  async function updateNote(form) {
    const data = new FormData(form);
    const text = String(data.get('text') || '').trim(), cls = String(data.get('class') || '');
    if (!text) throw new Error('教研记录内容不能为空。');
    await Z.api('/api/notes/' + encodeURIComponent(form.dataset.id) + '/update', { class: cls, text });
    S.notes = (await Z.api('/api/notes?exam_id=' + encodeURIComponent(S.examId))).notes || [];
    closeDrawer();
    renderNotes();
    Z.notice('教研记录已更新。');
  }
  async function rules(id=S.examId){
    if(!id)return;
    const item=await Z.api('/api/exams/'+encodeURIComponent(id)),d=item.dataset;
    const paintRules=(ruleObj,activeTab='common')=>{
      openDrawer('口径设置',`${d.grade} · ${d.name}`,window.LeaderRules.buildFormHTML(id,d,ruleObj,{activeTab,showScopeActions:true}),'rules');
      window.LeaderRules.bindRulesForm($('rules-form'),d,(nextRules,tab)=>paintRules(nextRules,tab));
    };
    paintRules(item.rules||{});
  }
  async function saveRules(form){
    const rulesObj=window.LeaderRules.readFormRules(form);
    const saveAsDefault=!!form.querySelector('[name="save_as_default"]')?.checked;
    const applyToGrade=!!form.querySelector('[name="apply_to_grade"]')?.checked;
    const res=await Z.api('/api/exams/'+encodeURIComponent(form.dataset.id)+'/rules',{
      rules:rulesObj,
      save_as_default:saveAsDefault,
      apply_to_grade:applyToGrade,
    });
    S.examId=form.dataset.id;
    S.analysis=null;
    S.brief=null;
    if(applyToGrade){S.trends=null;S.history=null;}
    S.briefRatioOverride=false;
    await loadExams();
    closeDrawer();
    await loadView();
    const extras=[];
    if(applyToGrade&&res.synced_exams>1)extras.push(`已同步同年级 ${res.synced_exams} 场考试`);
    if(res.saved_default)extras.push('已更新为新建考试默认口径');
    Z.notice(`口径设置已保存，报表与班情分析已重新计算${extras.length?'（'+extras.join('，')+'）':''}。`);
  }
  async function checkPendingHygiene(dataset, grade) {
    try {
      S.pendingHygiene = await Z.api('/api/roster-check', { grade: grade || dataset.grade || '', rows: dataset.rows || [] });
    } catch (_) {
      S.pendingHygiene = null;
    }
  }
  async function importFile(form,prefix=''){const meta=readImportMeta(prefix),file=prefix?S.drawerFile:$(prefix+'import-file')?.files[0];if(!file)throw new Error('请先选择 Excel 或 CSV 文件。');if(!meta.name||!meta.grade||!meta.date)throw new Error('请填写考试名称、年级和日期。');const password=$(prefix+'import-password')?.value||'';let dataset;if(password){const content=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('文件读取失败。'));r.readAsDataURL(file);});dataset=await Z.api('/api/import',{filename:file.name,content,metadata:meta,password});}else dataset=await Z.upload(file,meta);S.pending=dataset;await checkPendingHygiene(dataset,meta.grade);S.importError='';if(prefix){refreshImportDrawer();Z.notice('文件已读取，请核对字段、跨考人物与核验提示。');}else{renderData();Z.notice('文件已读取，检查结果后可保存。');}}
  async function saveImport(prefix=''){const meta=readImportMeta(prefix);if(!S.pending)throw new Error('请先读取文件。');if(!meta.name||!meta.grade||!meta.date)throw new Error('请填写考试名称、年级和日期。');const container=prefix?$('drawer-import-preview'):$('inline-import-preview');const nameFixes=window.LeaderMulti.collectTypoFixes(container,'single');const dataset={...S.pending,...meta};const exam=await Z.api('/api/exams',{dataset,name_fixes:nameFixes});S.pending=null;S.pendingHygiene=null;S.examId=exam.id;S.analysis=null;await loadExams();S.view='compare';S.compareTab='classes';persist();if(prefix)closeDrawer();await loadView();Z.notice(nameFixes.length?`考试已保存（已自动修正 ${nameFixes.length} 处姓名错别字）。`:'考试已保存到本机档案。');}
  function openMultiImportDrawer() {
    S.multiFile = null;
    S.multiInspect = null;
    S.multiGrade = S.importMeta?.grade || metadata().grade || '初三';
    S.multiDate = S.importMeta?.date || todayText;
    openDrawer('多考总表批量导入', '一表多考增量建档 · 同簿教师识别 · 错别字核对', window.LeaderMulti.multiDrawerHTML(S), 'multi-import');
    window.LeaderMulti.bindMultiDrawer(S);
  }
  async function inspectMultiFile() {
    if (!S.multiFile) throw new Error('请先选择多考总表 Excel 文件。');
    S.multiGrade = ($('multi-grade')?.value || S.multiGrade || '').trim();
    S.multiDate = ($('multi-date')?.value || S.multiDate || todayText).trim();
    const password = $('multi-password')?.value || '';
    const content = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
      r.readAsDataURL(S.multiFile);
    });
    S.multiInspect = await Z.api('/api/workbook/inspect', {
      filename: S.multiFile.name,
      content,
      grade: S.multiGrade,
      default_date: S.multiDate,
      password,
    });
    $('drawer-content').innerHTML = window.LeaderMulti.multiDrawerHTML(S);
    window.LeaderMulti.bindMultiDrawer(S);
    Z.notice(`扫描完成：识别 ${S.multiInspect.score_sheets.length} 张成绩页、${S.multiInspect.teacher_sheets.length} 张教师表。`);
  }
  async function commitMultiImport() {
    const payload = window.LeaderMulti.readMultiCommitPayload(S);
    const res = await Z.api('/api/exams/batch-import', payload);
    S.multiInspect = null;
    S.multiFile = null;
    S.analysis = null;
    S.brief = null;
    await loadExams();
    if (res.exam_ids?.length) S.examId = res.exam_ids[res.exam_ids.length - 1];
    closeDrawer();
    await loadView();
    const parts = [];
    if (res.imported) parts.push(`新增 ${res.imported} 场`);
    if (res.overwritten) parts.push(`覆盖更新 ${res.overwritten} 场`);
    if (res.fixes_applied) parts.push(`修正错别字 ${res.fixes_applied} 处`);
    if (res.teachers_updated) parts.push(`关联教师 ${res.teachers_updated} 班次`);
    Z.notice(`批量导入完成：${parts.join('，') || '处理成功'}。`);
  }
  function openStudentCardsDrawer(defaultClass = '') {
    if (!S.examId || !S.analysis) return;
    const cls = defaultClass || S.briefClass || S.studentClass || S.analysis.classes?.[0] || '';
    openDrawer('学生个人学业诊断卡', `${S.analysis.metadata.grade} · ${S.analysis.metadata.name}`, window.LeaderCards.cardsDrawerHTML(S.analysis, cls), 'student-cards');
  }
  async function generateStudentCards(form) {
    const fd = new FormData(form);
    const cls = String(fd.get('class_name') || '');
    const layout = String(fd.get('layout') || 'two-up');
    const hideRank = !!form.querySelector('[name="hide_rank"]')?.checked;
    const res = await Z.api('/api/student-cards', { exam_id: S.examId, class: cls });
    closeDrawer();
    window.LeaderCards.printStudentCards(res, { layout, hideRank });
  }
  async function printSingleStudentCard(studentId) {
    if (!S.examId || !studentId) return;
    const res = await Z.api('/api/student-cards', { exam_id: S.examId, student_id: studentId });
    window.LeaderCards.printStudentCards(res, { layout: 'one-up', hideRank: true });
  }
  function downloadClassPackagesZip() {
    if (!S.examId) return;
    const qs = new URLSearchParams();
    if (S.briefRatioOverride) {
      qs.set('high_ratio', String(S.briefHighRatio));
      qs.set('main_ratio', String(S.briefMainRatio));
    }
    const url = `/api/exams/${encodeURIComponent(S.examId)}/class-packages.zip${qs.toString() ? '?' + qs.toString() : ''}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    Z.notice('正在打包各班独立分发 ZIP（每班仅含本班明细与打印版）…');
  }
  async function openTeachersDrawer() {
    if (!S.examId || !S.analysis) return;
    S.teacherFile = null;
    const data = await Z.api('/api/teachers?exam_id=' + encodeURIComponent(S.examId));
    openDrawer('任课教师管理', `${S.analysis.metadata.grade} · ${S.analysis.metadata.name}`, window.LeaderBrief.teachersDrawerHTML(S.analysis, data.teachers || []), 'teachers');
    const fileInput = $('teacher-import-file');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        S.teacherFile = f;
        const nameEl = $('teacher-file-name');
        if (nameEl) nameEl.textContent = f.name;
        const submitEl = $('teacher-import-submit');
        if (submitEl) submitEl.disabled = false;
      });
    }
  }
  async function importTeachersFile() {
    if (!S.teacherFile) throw new Error('请先选择任课教师 Excel 或 CSV 文件。');
    const content = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
      r.readAsDataURL(S.teacherFile);
    });
    const res = await Z.api('/api/teachers/import', {
      filename: S.teacherFile.name,
      content,
      exam_id: S.examId,
      grade: S.analysis?.metadata?.grade || '',
    });
    closeDrawer();
    if (S.view === 'brief') { await loadBrief(); renderBrief(); }
    const warnMsg = (res.warnings || []).length ? `（${res.warnings[0]}）` : '';
    Z.notice(`已导入并匹配 ${res.matched_exams} 场考试、${res.updated} 条班级教师记录。${warnMsg}`);
  }
  async function saveTeachersEdit(form) {
    const byClass = new Map();
    form.querySelectorAll('[data-t-class]').forEach(input => {
      const cls = input.dataset.tClass;
      const entry = byClass.get(cls) || { class: cls, homeroom: '', subjects: {} };
      if (input.dataset.tField === 'homeroom') entry.homeroom = input.value.trim();
      else if (input.dataset.tSub && input.value.trim()) entry.subjects[input.dataset.tSub] = input.value.trim();
      byClass.set(cls, entry);
    });
    await Z.api('/api/teachers', { exam_id: S.examId, rows: Array.from(byClass.values()) });
    closeDrawer();
    if (S.view === 'brief') { await loadBrief(); renderBrief(); }
    Z.notice('当前考试任课教师配置已保存。');
  }
  async function openS3ConfigDrawer() {
    S.s3 = await Z.api('/api/s3/config');
    openDrawer('S3 云端存储设置', '支持缤纷云 Bitiful S4 与任意 S3 兼容服务', window.LeaderS3.configDrawerHTML(S.s3.config), 's3-config');
    window.LeaderS3.bindConfigForm($('s3-config-form'));
  }
  async function saveS3Config(form) {
    const config = window.LeaderS3.readConfigForm(form);
    const res = await Z.api('/api/s3/config', { config });
    S.s3 = { config: res.config, status: res.status };
    closeDrawer();
    if (S.view === 'data') renderData();
    Z.notice('S3 云端存储配置已保存，可点击「立即同步到云端」备份数据。');
  }
  async function testS3Config() {
    const form = $('s3-config-form');
    const errEl = $('s3-config-error');
    const outEl = $('s3-test-result');
    if (errEl) errEl.hidden = true;
    if (outEl) { outEl.textContent = '正在连接测试…'; outEl.hidden = false; }
    const config = form ? window.LeaderS3.readConfigForm(form) : undefined;
    try {
      const res = await Z.api('/api/s3/test', config ? { config } : {});
      if (outEl) { outEl.textContent = res.message || '连接测试成功。'; outEl.hidden = false; }
      Z.notice('S3 连接测试成功。');
    } catch (err) {
      if (outEl) outEl.hidden = true;
      throw err;
    }
  }
  async function openS3SnapshotsDrawer() {
    S.confirmDeleteS3 = '';
    S.s3Diff = null;
    S.s3 = await Z.api('/api/s3/config');
    const res = await Z.api('/api/s3/backups');
    S.s3Snapshots = res.snapshots || [];
    openDrawer('云端快照与恢复', `${S.s3.config?.bucket || 'S3 存储'}`, window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots, S.s3.config, S.confirmDeleteS3, null), 's3-snapshots');
  }
  async function previewS3Diff(key) {
    const diff = await Z.api('/api/s3/diff', { key });
    S.s3Diff = diff;
    $('drawer-content').innerHTML = window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots, S.s3?.config, S.confirmDeleteS3, S.s3Diff);
  }
  async function backupToS3(refreshSnapshots = false) {
    const res = await Z.api('/api/s3/backup', {});
    S.s3 = await Z.api('/api/s3/config');
    if (refreshSnapshots) {
      const listRes = await Z.api('/api/s3/backups');
      S.s3Snapshots = listRes.snapshots || [];
      S.s3Diff = null;
      $('drawer-content').innerHTML = window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots, S.s3.config, '', null);
    } else if (S.view === 'data') {
      renderData();
    }
    Z.notice(`已同步 ${res.exam_count} 场考试到云端（${(res.size / 1024).toFixed(1)} KB）。`);
  }
  async function restoreFromS3(key, mode = 'smart_merge') {
    const res = await Z.api('/api/s3/restore', { key, mode });
    S.analysis = null;
    S.brief = null;
    S.s3Diff = null;
    await loadExams();
    closeDrawer();
    await loadView();
    const parts = [];
    if (res.exams_added) parts.push(`新增 ${res.exams_added} 场考试`);
    if (res.exams_updated) parts.push(`更新 ${res.exams_updated} 场考试`);
    if (res.notes_added || res.notes_updated) parts.push(`合并教研 ${(res.notes_added || 0) + (res.notes_updated || 0)} 条`);
    if (res.teachers_added || res.teachers_updated) parts.push(`合并教师 ${(res.teachers_added || 0) + (res.teachers_updated || 0)} 条`);
    Z.notice(`云端合并完成：${parts.join('，') || '本机已是最新'}。`);
  }
  async function runBatchPrint(kind, ratioMode) {
    const res = await Z.api('/api/class-brief', {
      exam_id: S.examId,
      all_classes: true,
      high_ratio: S.briefHighRatio,
      main_ratio: S.briefMainRatio,
    });
    closeDrawer();
    window.LeaderBrief.printBriefs(res.briefs || [], kind, ratioMode || S.briefTpl2Ratio || 'main');
  }
  async function saveNote(form){S.noteDraft=$('note-text').value;const text=S.noteDraft.trim();if(!text)throw new Error('请填写需要保存的教研记录。');const cls=$('note-class').value;await Z.api('/api/notes',{exam_id:S.examId,class:cls,text});S.notes=(await Z.api('/api/notes?exam_id='+encodeURIComponent(S.examId))).notes||[];S.noteDraft='';S.noteClass='';renderNotes();Z.notice('教研记录已保存并重新读取。');}
  function printSchool(){if(!S.school?.grades?.length)return;const t={title:'全校年级概况',columns:['年级','最新考试','日期','班级数','纳入记录','总分有效人数','均分','总分分界'],rows:S.school.grades.map(g=>[g.grade,g.exam.name,g.exam.date,g.analysis.classes.length,g.analysis.summary.registered,g.analysis.summary.participants,g.analysis.summary.mean,g.analysis.summary.cutoff]),note:'各年级独立统计；不同科目组合与试卷难度的均分不直接横向排名。'};Z.printTables([t],'全校学情概况','各年级最新一场已保存考试 · 数据来源与规则随考试档案保留');}
  async function run(button,task,target){const label=button?.textContent;if(button){button.disabled=true;button.setAttribute('aria-busy','true');}try{clearError();await task();}catch(err){const el=target&&$(target);if(el){el.textContent=err.message;el.hidden=false;}else fail(err.message);}finally{if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');if(label&&button.textContent==='处理中…')button.textContent=label;}}}
  async function action(name,target){switch(name){case'navigate':return go(target.dataset.view);case'reload':return loadView();case'presentation':S.presentation=!S.presentation;persist();header();return;case'open-import':return openImportDrawer();case'open-multi-import':return openMultiImportDrawer();case'multi-commit':return commitMultiImport();case'open-student-cards':return openStudentCardsDrawer(target.dataset.class||'');case'print-single-card':return printSingleStudentCard(target.dataset.studentId);case'download-class-zip':return downloadClassPackagesZip();case'trend-scale':S.classTrendScale=target.dataset.scale||'raw';return renderTrends();case'example':return example();case'open-exam':S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.subject='总分';S.compareTab='classes';return go('compare');case'open-subject':S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.subject=target.dataset.subject;S.compareTab='classes';return go('compare');case'open-quality':S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.tableId='quality';S.reportSearch='';return go('reports');case'compare-tab':S.compareTab=target.dataset.tab;S.page=0;return renderCompare();case'class-detail':return classDetail(target.dataset.class);case'achiever-detail':return achieverDetail(target.dataset.class,target.dataset.subject);case'student-detail':return studentDetail(Number(target.dataset.index));case'growth-detail':return growthDetail(target.dataset.id);case'close-drawer':return closeDrawer();case'copy-classes':return Z.copyTable(classTable());case'csv-classes':{const table=classTable();return Z.downloadTable(table,`${S.analysis.metadata.name}_${table.title}.csv`);}case'copy-class-trends':{const exams=S.trends?.exams||[];if(exams.length<2)return;return Z.copyTable(classTrendTable(exams).table);}case'csv-class-trends':{const exams=S.trends?.exams||[];if(exams.length<2)return;const {table}=classTrendTable(exams);return Z.downloadTable(table,`${table.title}.csv`);}case'copy-students':return Z.copyTable(studentTable());case'print-students':return Z.printTables([studentTable()],S.analysis.metadata.name,subtitle());case'copy-drawer':return Z.copyTable(S.drawerTable);case'print-drawer':return Z.printTables([S.drawerTable],S.analysis.metadata.name,subtitle());case'note-class':S.noteClass=target.dataset.class;return go('notes');case'edit-note':S.confirmDeleteNote='';return editNote(target.dataset.id);case'delete-note':{const id=target.dataset.id;if(S.confirmDeleteNote!==id){S.confirmDeleteNote=id;renderNotes();Z.notice('再次点击“确认删除”将永久删除该条教研记录。');return;}await Z.api('/api/notes/'+encodeURIComponent(id)+'/delete',{});S.confirmDeleteNote='';S.notes=(await Z.api('/api/notes?exam_id='+encodeURIComponent(S.examId))).notes||[];renderNotes();Z.notice('教研记录已删除。');return;}case'report-tab':S.tableId=target.dataset.table;S.reportSearch='';S.page=0;return renderReports();case'copy-report':return Z.copyTable(reportTable());case'csv-report':{const table=reportTable();return Z.downloadTable(table,`${S.analysis.metadata.name}_${table.title}.csv`);}case'print-report':return Z.printTables([reportTable()],S.analysis.metadata.name,subtitle());case'print-all':return Z.printTables(S.analysis.tables,S.analysis.metadata.name,subtitle());case'xlsx':return Z.downloadWorkbook(S.analysis);case'save-import':return saveImport();case'save-drawer-import':return saveImport('drawer-');case'discard-import':readImportMeta();S.pending=null;S.pendingHygiene=null;return renderData();case'discard-drawer-import':readImportMeta('drawer-');S.pending=null;S.pendingHygiene=null;return refreshImportDrawer();case'edit-exam':return editExam(target.dataset.id);case'rules':return rules(target.dataset.id||S.examId);case'rule-mark-preset':return applyRuleMarkPreset(target.dataset.preset);case'all-classes':$('rules-form')?.querySelectorAll('[name="classes"]').forEach(x=>x.checked=true);return;case'twenty-classes':$('rules-form')?.querySelectorAll('[name="classes"]').forEach(x=>x.checked=Number(x.value)>=1&&Number(x.value)<=20);return;case'archive':await Z.api('/api/exams/'+encodeURIComponent(target.dataset.id)+'/archive',{});S.analysis=null;S.confirmDeleteExam='';await loadExams();await loadView();Z.notice('考试已归档，可在下方恢复。');return;case'restore-exam':await Z.api('/api/exams/'+encodeURIComponent(target.dataset.id)+'/restore',{});S.confirmDeleteExam='';await loadExams();await loadView();Z.notice('考试已恢复。');return;case'delete-exam':{const id=target.dataset.id;if(S.confirmDeleteExam!==id){S.confirmDeleteExam=id;renderData();Z.notice('再次点击“确认删除”将永久删除该已归档考试及其教研记录。');return;}await Z.api('/api/exams/'+encodeURIComponent(id)+'/delete',{});S.confirmDeleteExam='';await loadExams();await loadView();Z.notice('已归档考试已彻底删除。');return;}case'choose-backup':$('backup-file').click();return;case's3-config':return openS3ConfigDrawer();case's3-test':return testS3Config();case's3-clear':{const res=await Z.api('/api/s3/config',{clear:true});S.s3={config:res.config,status:res.status};closeDrawer();if(S.view==='data')renderData();Z.notice('已清除本机 S3 连接配置。');return;}case's3-backup':return backupToS3(false);case's3-backup-drawer':return backupToS3(true);case's3-snapshots':return openS3SnapshotsDrawer();case's3-diff':return previewS3Diff(target.dataset.key);case's3-diff-close':S.s3Diff=null;$('drawer-content').innerHTML=window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots,S.s3?.config,S.confirmDeleteS3,null);return;case's3-restore':return restoreFromS3(target.dataset.key,target.dataset.mode||'smart_merge');case's3-delete':{const key=target.dataset.key;if(S.confirmDeleteS3!==key){S.confirmDeleteS3=key;$('drawer-content').innerHTML=window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots,S.s3?.config,S.confirmDeleteS3,S.s3Diff);Z.notice('再次点击“确认删除”将从云端永久删除该快照。');return;}await Z.api('/api/s3/delete',{key});S.confirmDeleteS3='';const listRes=await Z.api('/api/s3/backups');S.s3Snapshots=listRes.snapshots||[];$('drawer-content').innerHTML=window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots,S.s3?.config,'',S.s3Diff);Z.notice('云端快照已删除。');return;}case'history':{const error=$('history-error');if(error)error.hidden=true;if(!S.historySelection.length){if(error){error.textContent='请至少选择一场考试。';error.hidden=false;}return;}if(S.historySelection.length<2&&S.trends?.exams?.length>1){if(error){error.textContent='请至少选择两场考试，再生成成长轨迹。';error.hidden=false;}return;}const selectedWeights={};for(const id of S.historySelection){if(S.weights[id]!==undefined){const value=Number(S.weights[id]);if(!Number.isFinite(value)||value<=0||value>1000){if(error){error.textContent='考试权重必须大于0且不超过1000。';error.hidden=false;}return;}selectedWeights[id]=value;}}S.history=await Z.api('/api/history',{grade:metadata().grade,exam_ids:S.historySelection,weights:selectedWeights});S.historyPage=0;return renderTrends();}case'copy-history':return Z.copyTable(historyTable());case'csv-history':return Z.downloadTable(historyTable(),`${metadata().grade||'历次'}_综合名次.csv`);case'open-teachers':return openTeachersDrawer();case'open-batch-print':if(!S.brief)return;return openDrawer('批量打印全年级班情报告',`${S.brief.meta.grade} · ${S.brief.meta.exam_name}`,window.LeaderBrief.batchPrintDrawerHTML(S.brief),'batch-print');case'batch-print-run':return runBatchPrint(target.dataset.kind,target.dataset.ratio);case'print-brief-card':if(S.brief)return window.LeaderBrief.printBriefs(S.brief,'card');return;case'print-tpl1-leader':if(S.brief)return window.LeaderBrief.printBriefs(S.brief,'tpl1-leader');return;case'print-tpl1-teacher':if(S.brief)return window.LeaderBrief.printBriefs(S.brief,'tpl1-teacher');return;case'print-tpl2':if(S.brief)return window.LeaderBrief.printBriefs(S.brief,'tpl2',S.briefTpl2Ratio);return;case'brief-prev-class':case'brief-next-class':{if(!S.brief)return;const list=S.brief.meta.classes||[],idx=list.indexOf(S.brief.meta.class);const next=name==='brief-prev-class'?list[idx-1]:list[idx+1];if(!next)return;S.briefClass=next;await loadBrief();renderBrief();return;}case'save-brief-ratios':{if(!S.examId||!S.analysis)return;const nextRules={...(S.analysis.rules||{}),high_ratio:S.briefHighRatio,main_ratio:S.briefMainRatio};await Z.api('/api/exams/'+encodeURIComponent(S.examId)+'/rules',{rules:nextRules});S.analysis=null;S.briefRatioOverride=false;await ensureAnalysis();await loadBrief();renderBrief();Z.notice('已将当前双线比例保存为本场考试口径。');return;}case'brief-list-tab':S.briefListTab=target.dataset.tab;return renderBrief();case'brief-tpl-tab':S.briefTemplateTab=target.dataset.tab;return renderBrief();case'copy-brief-list':if(S.brief)return Z.copyTable(window.LeaderBrief.actionListTable(S.brief,S.briefListTab));return;case'csv-brief-list':if(S.brief){const t=window.LeaderBrief.actionListTable(S.brief,S.briefListTab);return Z.downloadTable(t,`${t.title}.csv`);}return;case'open-class-brief':S.briefClass=target.dataset.class;return go('brief');case'page':if(target.dataset.type==='history'){S.historyPage=Math.max(0,S.historyPage+Number(target.dataset.direction));renderTrends();}else{S.page=Math.max(0,S.page+Number(target.dataset.direction));render();}return;}}
  document.addEventListener('click',event=>{document.querySelectorAll('.print-menu[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('[data-action]'))menu.open=false;});const target=event.target.closest('[data-action]');if(!target)return;event.preventDefault();const name=target.dataset.action;run(target,()=>action(name,target),name==='save-import'?'import-error':name==='history'?'history-error':name==='rule-mark-preset'?'rules-error':name==='multi-commit'?'multi-commit-error':name==='s3-test'||name==='s3-clear'?'s3-config-error':name==='s3-restore'||name==='s3-diff'||name==='s3-delete'||name==='s3-backup-drawer'?'s3-snap-error':null);});
  document.addEventListener('submit',event=>{if(!['import-form','drawer-import-form','multi-inspect-form','student-cards-form','rules-form','note-form','exam-meta-form','edit-note-form','teacher-import-form','teacher-edit-form','s3-config-form'].includes(event.target.id))return;event.preventDefault();const form=event.target,submit=form.querySelector('[type="submit"]');const target=form.id==='import-form'?'import-error':form.id==='drawer-import-form'?'drawer-import-error':form.id==='multi-inspect-form'?'multi-inspect-error':form.id==='student-cards-form'?'cards-error':form.id==='rules-form'?'rules-error':form.id==='exam-meta-form'?'exam-meta-error':form.id==='edit-note-form'?'edit-note-error':form.id==='teacher-import-form'?'teacher-import-error':form.id==='teacher-edit-form'?'teacher-edit-error':form.id==='s3-config-form'?'s3-config-error':'note-error';$(target).hidden=true;run(submit,()=>form.id==='import-form'?importFile(form):form.id==='drawer-import-form'?importFile(form,'drawer-'):form.id==='multi-inspect-form'?inspectMultiFile():form.id==='student-cards-form'?generateStudentCards(form):form.id==='rules-form'?saveRules(form):form.id==='exam-meta-form'?saveExamMeta(form):form.id==='edit-note-form'?updateNote(form):form.id==='teacher-import-form'?importTeachersFile():form.id==='teacher-edit-form'?saveTeachersEdit(form):form.id==='s3-config-form'?saveS3Config(form):saveNote(form),target);});
  document.addEventListener('change',event=>{const t=event.target;if(t.id==='exam-select'){S.examId=t.value;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.page=0;S.studentClass='';persist();run(null,loadView);}else if(t.id==='subject-select'){S.subject=t.value;S.page=0;renderCompare();}else if(t.id==='student-class'){S.studentClass=t.value;S.page=0;renderCompare();}else if(t.id==='brief-class'){S.briefClass=t.value;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-high-ratio'){S.briefHighRatio=Number(t.value);S.briefRatioOverride=true;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-main-ratio'){S.briefMainRatio=Number(t.value);S.briefRatioOverride=true;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-tpl2-ratio'){S.briefTpl2Ratio=t.value;renderBrief();}else if(t.id==='class-trend-metric'){S.classTrendMetric=t.value;renderTrends();}else if(t.dataset.historyExam!==undefined){S.historySelection=[...document.querySelectorAll('[data-history-exam]:checked')].map(x=>x.value);S.history=null;S.historyPage=0;renderTrends();}else if(t.dataset.weight!==undefined){if(t.value.trim()==='')delete S.weights[t.dataset.weight];else S.weights[t.dataset.weight]=Number(t.value);}else if(t.id==='backup-file'&&t.files[0]){run(null,async()=>{let backup;try{backup=JSON.parse(await t.files[0].text());}catch(_){throw new Error('备份文件不是有效的 JSON，请选择由本软件导出的备份。');}const result=await Z.api('/api/restore',{backup});S.analysis=null;await loadExams();await loadView();Z.notice(`备份恢复完成，处理 ${result.count} 场考试。`);},'backup-result');}});
  const searchFields={'class-search':'classSearch','student-search':'studentSearch','report-search':'reportSearch','history-search':'historySearch'};
  document.addEventListener('compositionstart',event=>{if(searchFields[event.target.id])composing=true;});
  document.addEventListener('compositionend',event=>{const key=searchFields[event.target.id];if(!key)return;composing=false;S[key]=event.target.value;S.page=0;S.historyPage=0;clearTimeout(inputTimer);render();});
  document.addEventListener('input',event=>{const t=event.target;if(t.id==='note-text'){S.noteDraft=t.value;return;}if(['import-name','import-grade','import-date'].includes(t.id)){readImportMeta();return;}if(['drawer-import-name','drawer-import-grade','drawer-import-date'].includes(t.id)){readImportMeta('drawer-');return;}if(searchFields[t.id]){if(composing)return;S[searchFields[t.id]]=t.value;S.page=0;S.historyPage=0;clearTimeout(inputTimer);inputTimer=setTimeout(render,170);}});
  $('drawer-overlay').addEventListener('click',event=>{if(event.target===$('drawer-overlay'))closeDrawer();});
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('tr[data-action]')){event.preventDefault();run(null,()=>action(event.target.dataset.action,event.target));}if(event.key==='Escape'){if(!$('drawer-overlay').hidden)closeDrawer();else if(S.presentation){S.presentation=false;persist();header();}}if(event.key==='Tab'&&!$('drawer-overlay').hidden){const list=[...$('drawer-overlay').querySelectorAll('button:not([disabled]),input,select,textarea,a[href],tr[tabindex]')].filter(x=>!x.hidden&&x.offsetParent!==null);const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  Z.bindShutdown($('shutdown-button'));
  header();run(null,async()=>{await loadExams();await loadView();if(queryExam||queryView){history.replaceState(null,'',location.pathname);if(queryExam&&!S.exams.some(x=>x.id===queryExam))Z.notice('链接中的考试未在当前档案中找到，请在数据管理中查看是否已归档。',true);}});
})();

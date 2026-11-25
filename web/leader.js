'use strict';
(() => {
  const $ = id => document.getElementById(id), e = Z.escape, n = Z.num;
  const fix = (v, d = 1) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
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
  const queryParams=new URLSearchParams(location.search),queryExam=queryParams.get('exam'),queryView=queryParams.get('view'),queryAction=queryParams.get('action'),today=new Date(),todayText=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  const S={view:nav.some(x=>x[0]===queryView)?queryView:queryExam?'compare':nav.some(x=>x[0]===saved.view)?saved.view:'overview',examId:queryExam||saved.examId||'',presentation:!!saved.presentation,exams:[],school:null,analysis:null,brief:null,briefClass:'',briefSection:saved.briefSection||'overview',briefDivergeMode:'main',overviewGrade:'',overviewHeatmapAll:false,abcExportMode:saved.abcExportMode||'six',promptOpts:{scenario:'meeting',anonStudents:true,anonTeachers:false,includeLists:true},studentPromptOpts:{scenario:'talk',anonStudent:true},lastProfileData:null,stagedEdits:{},pendingImportEdits:null,lastEditedCellKey:'',scoreEditsList:[],briefHighRatio:0.20,briefMainRatio:0.40,briefRatioOverride:false,briefCompareExamId:'',briefCompFilter:'all',briefCompSort:'rank',briefLevelTab:'dist',briefLevelFilter:'all',briefLevelSubject:'',printStudio:window.LeaderPrintStudio?window.LeaderPrintStudio.loadConfig():null,briefListTab:'high',briefTemplateTab:'tpl1-leader',briefTpl2Ratio:'main',teacherFile:null,trends:null,trendsGrade:'',classTrendMetric:'mean',classTrendScale:'raw',history:null,historySelection:[],historySelectionInitialized:false,notes:[],archives:[],s3:null,s3Snapshots:[],s3Diff:null,confirmDeleteS3:'',pending:null,pendingHygiene:null,multiFile:null,multiInspect:null,multiGrade:'初三',multiDate:todayText,subject:'总分',classSearch:'',studentSearch:'',studentClass:'',compareTab:'classes',tableId:'',reportSearch:'',page:0,historySearch:'',historyPage:0,weights:{},importMeta:{name:'',grade:'初三',date:todayText},importError:'',noteDraft:'',confirmDeleteNote:'',confirmDeleteExam:'',drawerTable:null,drawerType:'',drawerFile:null,request:0};
  let lastFocus=null, inputTimer=null, composing=false;
  const option=(value,label,chosen)=>`<option value="${e(value)}"${value===chosen?' selected':''}>${e(label)}</option>`;
  const btn=(label,action,attrs='',style='secondary')=>`<button class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
  const warnings=items=>(items||[]).map(x=>typeof x==='string'?x:x.message).filter(Boolean);
  const {identityCell,identityLabel,trendSVG,growthChartSVG,subjectTrendSummary}=window.LeaderCharts;
  const classTrendTable=exams=>window.LeaderCharts.classTrendTable(exams,S.classTrendMetric,S.analysis?.metadata?.grade||'',S.classTrendScale);
  const classTrendSection=exams=>{const result=window.LeaderCharts.classTrendSection(exams,S.classTrendMetric,S.analysis?.metadata?.grade||'',S.classTrendScale);if(exams.length>=2){const current=window.LeaderCharts.classTrendMetrics(exams,S.classTrendScale);if(!current.some(m=>m.id===S.classTrendMetric))S.classTrendMetric=current[0].id;}return result;};
  function persist(){try{localStorage.setItem('zhixu-leader-ui',JSON.stringify({view:S.view,examId:S.examId,presentation:S.presentation,briefSection:S.briefSection,abcExportMode:S.abcExportMode}));}catch(_){}}
  function fail(message){$('global-error').textContent=message;$('global-error').hidden=false;}
  function clearError(){$('global-error').hidden=true;}
  function paint(html){const focused=document.activeElement,id=focused?.id,start=focused?.selectionStart,end=focused?.selectionEnd;$('view-content').innerHTML=html;$('view-content').querySelectorAll('tr[data-action]').forEach(row=>row.tabIndex=0);if(id){const target=$(id);if(target){target.focus({preventScroll:true});try{if(start!==undefined&&start!==null)target.setSelectionRange(start,end);}catch(_){}}}}
  function empty(title,text,action='data'){return `<div class="empty"><div class="empty-symbol">${Z.icons('database')}</div><h2>${e(title)}</h2><p>${e(text)}</p><div class="actions">${btn('导入一场考试','navigate',`data-view="${action}"`,'primary')}${btn('载入已提供的原始表','example')}</div></div>`;}
  function metadata(){return S.exams.find(x=>x.id===S.examId)||{};}
  function subtitle(){const a=S.analysis;if(!a)return '';const v=a.metadata.data_version||1,ec=a.metadata.edit_count||0;const vt=ec?`数据版本 v${v} · 含 ${ec} 处更正`:`数据版本 v${v} · 原始导入`;return `${a.metadata.grade} · ${a.metadata.name} · ${a.metadata.date} · ${a.classes.length}个班 · 总分科目：${a.rules.total_subjects.join('、')} · ${vt}`;}
  function header(){const current=nav.find(x=>x[0]===S.view);const showExamBar=!(S.view==='data'||!S.exams.length);$('breadcrumb').textContent=current[1];$('page-title').textContent=current[1];$('page-subtitle').textContent=current[4];$('page-subtitle').hidden=showExamBar;const coreNav=nav.slice(0,4),mgmtNav=nav.slice(4);const navBtn=x=>`<button class="nav-button${x[0]===S.view?' active':''}" data-action="navigate" data-view="${x[0]}" ${x[0]===S.view?'aria-current="page"':''}>${Z.icons(x[2])}<span>${x[1]}</span></button>`;$('navigation').innerHTML=`<div class="nav-group-label">核心分析</div>${coreNav.map(navBtn).join('')}<div class="nav-group-label">记录与档案</div>${mgmtNav.map(navBtn).join('')}`;$('exam-toolbar').hidden=!showExamBar;$('exam-select').innerHTML=S.exams.map(x=>option(x.id,`${x.grade} · ${x.name} · ${x.date}`,S.examId)).join('');const ovGrade=S.school?.grades?.find(x=>x.grade===S.overviewGrade)||S.school?.grades?.[0];const scopeAna=S.view==='overview'?ovGrade?.analysis:S.analysis;$('scope-description').textContent=scopeAna?`${scopeAna.classes.length}个班 · ${n(scopeAna.summary.participants,0)}人`:'';const eb=$('exam-edits-badge');if(eb){const metaExam=metadata();const ec=S.analysis?.metadata?.edit_count??metaExam.edit_count??0;const pub=S.analysis?.metadata?.published_at??metaExam.published_at??'';if(showExamBar&&S.examId){eb.hidden=false;eb.className=`exam-edits-badge${ec>0?' has-edits':''}${pub?' is-published':''}`;eb.textContent=pub?`已发布 🔒${ec>0?` · 已更正 ${ec} 处`:''}`:ec>0?`已更正 ${ec} 处`:'更正记录';}else{eb.hidden=true;}}$('heading-action').innerHTML=S.view==='overview'&&S.exams.length?btn('打印概况','print-school','','secondary small'):S.view==='reports'&&S.analysis?btn('导出 Excel','xlsx','','secondary small'):'';document.body.classList.toggle('presenting',S.presentation);$('present-button').textContent=S.presentation?'退出汇报':'汇报模式';}
  async function loadExams(){S.exams=(await Z.api('/api/exams')).exams||[];if(!S.exams.some(x=>x.id===S.examId)){S.examId=S.exams[0]?.id||'';S.analysis=null;}persist();}
  async function ensureAnalysis(){if(!S.examId){S.analysis=null;return;}if(S.analysis?.dataset_id===S.examId)return;const id=S.examId,result=await Z.api('/api/analyze',{exam_id:id});if(id!==S.examId)return;S.analysis=result;if(!S.analysis.subjects.includes(S.subject)&&S.subject!=='总分')S.subject='总分';}
  async function loadBrief(){if(!S.examId||!S.analysis){S.brief=null;return;}if(!S.briefClass||!S.analysis.classes.includes(S.briefClass))S.briefClass=S.analysis.classes[0]||'';if(!S.briefClass){S.brief=null;return;}const r=S.analysis.rules||{};const hr=S.briefRatioOverride?S.briefHighRatio:(r.high_ratio??S.briefHighRatio);const mr=S.briefRatioOverride?S.briefMainRatio:(r.main_ratio??S.briefMainRatio);S.briefHighRatio=hr;S.briefMainRatio=mr;const reqPayload={exam_id:S.examId,class:S.briefClass,high_ratio:hr,main_ratio:mr};if(S.briefCompareExamId&&S.briefCompareExamId!==S.examId)reqPayload.compare_exam_id=S.briefCompareExamId;S.brief=await Z.api('/api/class-brief',reqPayload);}
  async function loadView(){const request=++S.request;clearError();header();paint('<div class="loading-line" role="status">正在读取已保存的数据…</div>');try{if(S.view==='overview')S.school=await Z.api('/api/school');else if(S.view==='data'){const [archRes,s3Res]=await Promise.all([Z.api('/api/exams?archived=1'),Z.api('/api/s3/config')]);S.archives=archRes.exams||[];S.s3=s3Res;}else{await ensureAnalysis();if(S.examId&&S.view==='brief')await loadBrief();if(S.examId&&S.view==='trends'){const grade=metadata().grade||'';if(S.trendsGrade!==grade){S.weights={};S.trendsGrade=grade;}S.trends=await Z.api('/api/trends?grade='+encodeURIComponent(grade));S.history=null;S.historySelection=[];S.historySelectionInitialized=false;const trendExams=S.trends?.exams||[];if(trendExams.length>=2){const ids=selectedHistoryIds(trendExams);try{S.history=await Z.api('/api/history',{grade,exam_ids:ids,weights:{}});S.historyPage=0;}catch(_){S.history=null;}}}if(S.examId&&S.view==='notes')S.notes=(await Z.api('/api/notes?exam_id='+encodeURIComponent(S.examId))).notes||[];}if(request!==S.request)return;header();render();}catch(err){if(request!==S.request)return;fail(err.message);paint(`<div class="empty"><h2>这次读取没有完成</h2><p>已保留当前选择，可以重试。</p>${btn('重新读取','reload','','primary')}</div>`);}}
  async function go(view){if(!nav.some(x=>x[0]===view))return;closeDrawer();S.view=view;S.page=0;persist();await loadView();}
  function renderBrief(){if(!S.brief){paint(empty('暂无可展示的班情分析','请先导入并保存一场考试成绩。'));return;}const stale=window.LeaderEdits?window.LeaderEdits.staleExportNoticeHTML(S.examId,S.analysis?.metadata?.data_version):'';paint(`${stale}${window.LeaderBrief.renderBriefView(S.brief,S)}`);}
  function render(){if(S.view==='overview')renderOverview();else if(S.view==='data')renderData();else if(!S.analysis)paint(empty('先保存一场考试','从原始 Excel 开始，分析结果会在这里形成可查阅的考试档案。'));else if(S.view==='compare')renderCompare();else if(S.view==='brief')renderBrief();else if(S.view==='trends')renderTrends();else if(S.view==='notes')renderNotes();else if(S.view==='reports')renderReports();}
  function buildOverviewHeatmapHTML(g) {
    const a = g.analysis, subs = (a.subjects || []).slice(0, 7);
    const sa = g.grade_brief?.subject_alert;
    const alertWeakSet = new Set(sa?.weak_classes || []);
    const sortedClasses = (a.class_stats || []).slice().sort((x, y) => (y.mean ?? -Infinity) - (x.mean ?? -Infinity));
    if (!sortedClasses.length || !subs.length) return '<p class="muted">暂无班级学科对比数据。</p>';
    const showAll = S.overviewHeatmapAll || sortedClasses.length <= 7;
    const shown = showAll
      ? sortedClasses
      : [...sortedClasses.slice(0, 4), null, ...sortedClasses.slice(-3)];
    const subStats = {};
    const peakCandidates = [];
    subs.forEach(sub => {
      const vals = sortedClasses.map(c => c.subjects?.[sub]?.mean).filter(v => v != null).sort((x, y) => y - x);
      const mean = (a.subject_stats || []).find(s => s.subject === sub)?.mean ?? (vals.length ? vals.reduce((p, q) => p + q, 0) / vals.length : 0);
      const max = vals.length ? vals[0] : mean;
      const second = vals.length > 1 ? vals[1] : max;
      const min = vals.length ? vals[vals.length - 1] : mean;
      const span = Math.max(1, max - min);
      const leadGapRatio = (max - second) / span;
      subStats[sub] = { mean, max, min, span };
      peakCandidates.push({ sub, leadGapRatio, max });
    });
    const peakSubs = new Set(peakCandidates.sort((x, y) => y.leadGapRatio - x.leadGapRatio).slice(0, 2).map(x => x.sub));

    const rowsHTML = shown.map(c => {
      if (!c) {
        return `<tr class="hm-ellipsis"><td colspan="${1 + subs.length}">… 已折叠中间 ${sortedClasses.length - 7} 个班，点击右上角可展开全部 …</td></tr>`;
      }
      const cells = subs.map(sub => {
        const val = c.subjects?.[sub]?.mean;
        if (val == null) return '<td class="hm-cell hm-0">—</td>';
        const st = subStats[sub];
        const ratio = (val - st.min) / st.span;
        const isAlertWeak = sa && sub === sa.subject && (alertWeakSet.has(c.class) || val <= st.mean - st.span * 0.25);
        const isLowExtreme = val <= st.min + st.span * 0.08 && st.span >= 3;
        let cls = 'hm-2';
        if (val >= st.max - 0.05) cls = peakSubs.has(sub) ? 'hm-peak' : 'hm-lead';
        else if (isAlertWeak || isLowExtreme) cls = 'hm-low';
        else if (ratio >= 0.72) cls = 'hm-3';
        else if (ratio <= 0.28) cls = 'hm-1';
        const diff = val - st.mean;
        const tip = `${c.class}班 ${sub}均分 ${fix(val, 1)}（较年级 ${diff >= 0 ? '+' : ''}${fix(diff, 1)}）`;
        return `<td class="hm-cell ${cls}" title="${e(tip)}"><button type="button" class="hm-btn" data-action="brief-jump" data-id="${e(g.exam.id)}" data-class="${e(c.class)}" data-section="overview">${fix(val, 1)}</button></td>`;
      }).join('');
      return `<tr><td class="hm-cls"><button type="button" class="hm-cls-btn" data-action="brief-jump" data-id="${e(g.exam.id)}" data-class="${e(c.class)}" data-section="overview">${e(c.class)}班</button></td>${cells}</tr>`;
    }).join('');

    return `<div class="cockpit-viz-col">
      <div class="brief-block-head">
        <div><h3>班级学科表现热力矩阵</h3><p>按总分均分展示领跑与滞后班 · 单点高亮显著领跑与重点会诊短板，点击直达班情</p></div>
        ${sortedClasses.length > 7 ? `<button type="button" class="text-button" data-action="overview-toggle-heatmap">${showAll ? '收起仅看极值班' : `展开全部 ${sortedClasses.length} 班`}</button>` : ''}
      </div>
      <div class="hm-wrap"><table class="hm-table"><thead><tr><th>班级</th>${subs.map(s => `<th${sa && s === sa.subject ? ' class="hm-th-alert"' : ''}>${e(s)}</th>`).join('')}</tr></thead><tbody>${rowsHTML}</tbody></table></div>
      <div class="hm-legend"><span><i class="hm-swatch hm-1"></i>偏低</span><span><i class="hm-swatch hm-2"></i>常规</span><span><i class="hm-swatch hm-lead"></i>学科第一</span><span><i class="hm-swatch hm-peak"></i>断层领跑</span><span><i class="hm-swatch hm-low"></i>会诊/滞后</span></div>
    </div>`;
  }

  function buildOverviewCapsulesHTML(g) {
    const a = g.analysis;
    const tiers = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const participants = (a.students || []).filter(s => s.rank != null);
    const total = participants.length || 1;
    const counts = tiers.map(t => ({
      label: t,
      count: participants.filter(s => s.levels?.['总分'] === t).length,
    }));
    const hasLevels = counts.some(x => x.count > 0);
    const bars = hasLevels
      ? counts.map(x => ({ label: x.label, count: x.count, pct: (100 * x.count) / total }))
      : (a.score_bins || []).slice(0, 6).map(b => ({ label: b.label, count: b.count, pct: (100 * b.count) / total }));
    if (!bars.length) return '';
    const peakCount = Math.max(...bars.map(b => b.count), 1);
    const peakIdx = bars.findIndex(b => b.count === peakCount);
    return `<div class="cockpit-viz-col">
      <div class="brief-block-head">
        <div><h3>${hasLevels ? '年级六层等级分布（A1–C2）' : '总分分数段分布'}</h3><p>斜纹浅灰为常规层，单点高亮人数最集中的主体分层</p></div>
        <button type="button" class="text-button" data-action="open-exam" data-id="${e(g.exam.id)}">查看完整对比 →</button>
      </div>
      <div class="capsule-chart" role="img" aria-label="年级分层分布">
        ${bars.map((b, i) => {
          const hPct = Math.max(14, Math.round((b.count / peakCount) * 100));
          const isPeak = i === peakIdx;
          return `<div class="cap-col${isPeak ? ' is-peak' : ''}" title="${e(b.label)}：${b.count}人（${fix(b.pct, 1)}%）">
            <span class="cap-pct">${fix(b.pct, 1)}%</span>
            <div class="cap-track"><div class="cap-bar" style="height:${hPct}%"></div></div>
            <strong class="cap-label">${e(b.label)}</strong>
            <small class="cap-cnt">${n(b.count, 0)}人</small>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function renderOverview() {
    const data = S.school;
    if (!data?.grades?.length) {
      paint(empty('让第一份成绩成为全校分析的起点', '导入后，平台会按年级建立考试档案。未导入的年级不显示推测数据。'));
      return;
    }
    const g = data.grades.find(x => x.grade === S.overviewGrade) || data.grades[0];
    S.overviewGrade = g.grade;
    const a = g.analysis, b = g.grade_brief || {}, cm = b.class_mover, sa = b.subject_alert, bf = b.borderline_focus;
    const best = cm?.best, lag = cm?.lag;
    const fmtDelta = v => v == null ? '' : (v === 0 ? '持平' : `${v > 0 ? '+' : ''}${n(v, 1)}%`);

    const headlineParts = [];
    if (cm?.has_prev && best) headlineParts.push(`${best.class}班前${cm.ratio_label}领涨 ${fmtDelta(best.delta_rate)}${lag ? `，${lag.class}班 ${fmtDelta(lag.delta_rate)}` : ''}`);
    else if (best) headlineParts.push(`${best.class}班达标率领跑 (${n(best.rate, 1)}%)${lag ? `，${lag.class}班待拉升 (${n(lag.rate, 1)}%)` : ''}`);
    if (sa) headlineParts.push(`${sa.subject}最需会诊（集中率 ${sa.conc_rate != null ? `${n(sa.conc_rate, 1)}%` : '—'}）`);
    if (bf) headlineParts.push(`临界生 ${n(bf.borderline_total, 0)} 人`);
    const headline = headlineParts.join('；') || `${g.grade} · ${g.exam.name} 最新学业盘面已就绪`;

    const subNotes = [];
    if (sa?.weak_class_count) subNotes.push(`${sa.subject}有 ${sa.weak_class_count} 个班明显低于年级均分（${sa.weak_classes.map(c => c + '班').join('、')}）`);
    if (bf?.top_class) subNotes.push(`${bf.top_class}班临界生最集中（${bf.top_class_count}人），全年级单科短板 ${n(bf.single_short_count, 0)}人`);
    const subline = subNotes.join(' · ') || `${g.exam.date} · ${a.classes.length} 个班 · ${a.rules.total_subjects.length} 科计入总分`;

    const gradeSwitchHTML = data.grades.length > 1
      ? `<div class="cockpit-grade-bar"><span class="small-text">当前查看届别</span><div class="seg-pills">${data.grades.map(item => `<button type="button" class="${item.grade === g.grade ? 'active' : ''}" data-action="overview-select-grade" data-grade="${e(item.grade)}">${e(item.grade)} · ${e(item.exam.name)}</button>`).join('')}</div></div>`
      : '';

    const issues = warnings(a.warnings);
    const issueStripHTML = issues.length
      ? `<div class="cockpit-verify-strip"><div><i class="sig-dot is-warn"></i><span><strong>导入核验提醒：</strong>${e(issues[0])}${issues.length > 1 ? `（另有 ${issues.length - 1} 项）` : ''}</span></div><button type="button" class="text-button" data-action="open-quality" data-id="${e(g.exam.id)}">查看完整核验 →</button></div>`
      : '';

    paint(`
      ${gradeSwitchHTML}
      <section class="anchor-spotlight cockpit-spotlight">
        <div class="spotlight-main">
          <span class="anchor-kicker">${e(g.grade)} · ${e(g.exam.name)}（${e(g.exam.date)}） · 本次三件事</span>
          <h2>${e(headline)}</h2>
          <p>${e(subline)}</p>
          <div class="spotlight-links">
            ${best ? `<button type="button" class="spotlight-link" data-action="brief-jump" data-id="${e(g.exam.id)}" data-class="${e(best.class)}" data-section="overview">看 ${e(best.class)}班 班情 →</button>` : ''}
            ${lag ? `<button type="button" class="spotlight-link" data-action="brief-jump" data-id="${e(g.exam.id)}" data-class="${e(lag.class)}" data-section="overview">看 ${e(lag.class)}班 班情 →</button>` : ''}
            ${sa ? `<button type="button" class="spotlight-link" data-action="open-subject" data-id="${e(g.exam.id)}" data-subject="${e(sa.subject)}">会诊${e(sa.subject)}各班 →</button>` : ''}
            ${bf?.top_class ? `<button type="button" class="spotlight-link" data-action="brief-jump" data-id="${e(g.exam.id)}" data-class="${e(bf.top_class)}" data-section="students">查 ${e(bf.top_class)}班 临界名单 →</button>` : ''}
          </div>
        </div>
        <div class="spotlight-cta">
          <button type="button" class="btn-anchor-ghost" data-action="brief-jump" data-id="${e(g.exam.id)}" data-class="${e(best?.class || bf?.top_class || a.classes[0] || '')}" data-section="overview">进入班情工作台 →</button>
        </div>
      </section>

      <div class="brief-kpi-strip cockpit-kpi-strip" role="region" aria-label="年级核心指标">
        <div class="bk-cell">
          <span class="bk-label">年级总分均分</span>
          <strong class="bk-val">${n(a.summary.mean)}<small>分</small></strong>
          <span class="bk-sub">前${n(a.rules.cutoff_ratio * 100, 0)}%有效分界 ${n(a.summary.cutoff)} 分</span>
        </div>
        <div class="bk-cell">
          <span class="bk-label">实考参评规模</span>
          <strong class="bk-val">${n(a.summary.participants, 0)}<small>人</small></strong>
          <span class="bk-sub">${a.classes.length} 个班 · 已存档 ${n(data.exam_count, 0)} 场考试</span>
        </div>
        <div class="bk-cell">
          <span class="bk-label">最需会诊学科</span>
          <strong class="bk-val">${e(sa?.subject || '整体均衡')}</strong>
          <span class="bk-sub">${sa ? `集中率 ${sa.conc_rate != null ? `${n(sa.conc_rate, 1)}%` : '—'} · 班极差 ${n(sa.spread, 1)}分` : '各学科集中率均平稳'}</span>
        </div>
        <div class="bk-cell">
          <span class="bk-label">临界与短板群体</span>
          <strong class="bk-val">${bf ? n(bf.borderline_total, 0) : '—'}<small>${bf ? '人' : ''}</small></strong>
          <span class="bk-sub">${bf ? `单科短板 ${n(bf.single_short_count, 0)}人 · ${bf.top_class ? `${bf.top_class}班最集中` : '分布均匀'}` : '导入多科成绩自动识别'}</span>
        </div>
      </div>

      <section class="cockpit-viz-grid">
        ${buildOverviewHeatmapHTML(g)}
        ${buildOverviewCapsulesHTML(g)}
      </section>

      <section class="brief-block">
        <div class="brief-block-head">
          <div><h3>${e(g.grade)} · 各学科核心指标</h3><p>点击任意学科进入各班均分、达标与集中率深度对照</p></div>
          <div class="panel-heading-actions">${btn('进入班级与学科', 'open-exam', `data-id="${e(g.exam.id)}"`, 'secondary small')}</div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>学科</th><th class="number">实考人数</th><th class="number">年级均分</th><th class="number">有效分界</th><th class="number">达标人数</th><th class="number">集中人数</th><th class="number">集中率</th><th></th></tr></thead><tbody>${a.subject_stats.map(x => { const cr = x.achievers ? (100 * x.concentrated / x.achievers) : null; return `<tr data-action="open-subject" data-id="${e(g.exam.id)}" data-subject="${e(x.subject)}"><td><strong>${e(x.subject)}</strong></td><td class="number">${n(x.count, 0)}</td><td class="number">${n(x.mean)}</td><td class="number">${n(x.cutoff)}</td><td class="number">${n(x.achievers, 0)}</td><td class="number">${n(x.concentrated, 0)}</td><td class="number">${cr != null ? `${n(cr, 1)}%` : '—'}</td><td class="table-action">会诊 →</td></tr>`; }).join('')}</tbody></table></div>
      </section>
      ${issueStripHTML}
    `);
  }
  function classRows(){const a=S.analysis,needle=S.classSearch.trim();return a.class_stats.filter(c=>!needle||String(c.class).includes(needle)).slice().sort((a,b)=>{const av=S.subject==='总分'?a.mean:a.subjects[S.subject]?.mean,bv=S.subject==='总分'?b.mean:b.subjects[S.subject]?.mean;return (bv??-Infinity)-(av??-Infinity)||String(a.class).localeCompare(String(b.class));});}
  function classTable(){const sub=S.subject;return {id:'class_filtered',title:`${sub}班级对比`,columns:['班级','实考人数','平均分','最高分','最低分','达标人数','集中人数','总分前100','总分前200','得分率（%）'],rows:classRows().map(c=>{const q=sub==='总分'?c:c.subjects[sub]||{};return [c.class,sub==='总分'?c.participants:q.count,q.mean,q.max,q.min,sub==='总分'?c.elite_count:q.achievers,sub==='总分'?c.elite_count:q.concentrated,c.top?.['100']??0,c.top?.['200']??0,q.score_rate??null];}),note:subtitle()};}
  function studentRows(){const needle=S.studentSearch.trim().toLowerCase();return S.analysis.students.filter(s=>(!S.studentClass||s.class===S.studentClass)&&(!needle||[s.name,s.class,s.id,String(s.source_row)].some(x=>String(x).toLowerCase().includes(needle))));}
  function studentTable(rows=studentRows()){const subjects=S.analysis.subjects;return {id:'students_filtered',title:'学生成绩与薄弱学科',columns:['班级','姓名 / 来源行','总分','年级名次','班级名次',...subjects,'薄弱学科'],rows:rows.map(s=>[s.class,s.name,s.total,s.rank,s.class_rank,...subjects.map(x=>s.scores[x]),s.weak.map(x=>x.subject).join('、')]),note:subtitle()};}
  function scoreBinsSection(a){const bins=a.score_bins||[];if(!bins.length||S.subject!=='总分')return '';const peak=Math.max(...bins.map(b=>b.count),1);return `<section class="brief-block"><div class="brief-block-head"><div><h3>总分分数段分布</h3><p>按口径设置的分数段间隔（每段 ${n(a.rules.score_bin_step,0)} 分）统计总分有效人群</p></div>${btn('调整间隔','rules','','secondary small')}</div><div class="score-bins-grid">${bins.map(b=>`<div class="score-bin-row"><span class="score-bin-label">${e(b.label)}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(0,100*b.count/peak)}%"></span></span><span class="score-bin-count">${n(b.count,0)}人</span></div>`).join('')}</div></section>`;}
  function renderCompare(){const a=S.analysis,stats=S.subject==='总分'?a.summary:a.subject_stats.find(x=>x.subject===S.subject)||{},classes=classRows();const vals=classes.map(c=>S.subject==='总分'?c.mean:c.subjects[S.subject]?.mean).filter(v=>v!=null);const max=vals.length?Math.max(...vals):1,min=vals.length?Math.min(...vals):0;const span=Math.max(1,max-min);const axisMin=Math.max(0,Math.floor((min-span*0.32)/10)*10);const axisSpan=Math.max(1,max-axisMin);const meanVal=stats.mean??null,meanPct=meanVal!=null&&axisSpan>0?Math.max(0,Math.min(100,100*(meanVal-axisMin)/axisSpan)):null;const rows=studentRows(),pageSize=40;S.page=Math.min(S.page,Math.max(0,Math.ceil(rows.length/pageSize)-1));const LE=window.LeaderEdits;const stagedBar=LE?LE.stagingBarHTML(S.stagedEdits):'';const pubNote=a.metadata?.published_at?'<div class="support-note" style="margin-bottom:10px">本场考试已发布锁定；如需更正成绩，请点击顶部「已发布」徽标解锁。</div>':'';paint(`<div class="tab-strip"><button data-action="compare-tab" data-tab="classes" class="${S.compareTab==='classes'?'active':''}">班级与学科对比</button><button data-action="compare-tab" data-tab="students" class="${S.compareTab==='students'?'active':''}">学生明细与成绩更正</button></div>${S.compareTab==='classes'?`<div class="toolbar"><label>比较指标<select id="subject-select">${['总分',...a.subjects].map(x=>option(x,x,S.subject)).join('')}</select></label><input id="class-search" type="search" placeholder="搜索班号" value="${e(S.classSearch)}" aria-label="搜索班号"><div class="spacer"></div>${btn('复制班级表','copy-classes','','secondary small')}${btn('下载 CSV','csv-classes','','secondary small')}</div><div class="brief-kpi-strip" style="margin-bottom:18px"><div class="bk-cell"><span class="bk-label">${S.subject==='总分'?'总分有效人数':'学科实考人数'}</span><strong class="bk-val">${n(S.subject==='总分'?stats.participants:stats.count,0)}<small>人</small></strong></div><div class="bk-cell"><span class="bk-label">${e(S.subject)}均分</span><strong class="bk-val">${n(stats.mean)}<small>分</small></strong></div><div class="bk-cell"><span class="bk-label">前${n(a.rules.cutoff_ratio*100,0)}%分界</span><strong class="bk-val">${n(stats.cutoff)}<small>分</small></strong></div><div class="bk-cell"><span class="bk-label">达标${S.subject!=='总分'?' / 集中':''}</span><strong class="bk-val">${n(S.subject==='总分'?stats.elite_count:stats.achievers,0)}<small>人</small>${S.subject!=='总分'?`<em>集中 ${n(stats.concentrated,0)}</em>`:''}</strong></div></div><section class="brief-block" style="border-top:0;padding-top:0"><div class="brief-block-head"><div><h3>${e(S.subject)}班级梯队对比</h3><p>横轴起点自动收敛至 ${axisMin} 分以放大真实班差 · 点击任意班进入明细与达标名单</p></div><div class="bar-chart-legend"><span><i style="background:var(--signal)"></i>前3领跑</span><span><i style="background:#b9becd"></i>均分以上</span><span><i style="background:#dfe2ea"></i>低于均分</span>${meanPct!=null?`<span><i class="dash"></i>年级均分 ${fix(meanVal,1)}</span>`:''}</div></div><div class="bar-chart">${classes.map((c,idx)=>{const value=S.subject==='总分'?c.mean:c.subjects[S.subject]?.mean;const pct=value!=null?Math.max(4,Math.min(100,100*(value-axisMin)/axisSpan)):0;const rowCls=idx<3?'is-top':(meanVal!=null&&value!=null&&value<meanVal?'is-below':'');const diff=value!=null&&meanVal!=null?value-meanVal:null;return `<button class="bar-row ${rowCls}" data-action="class-detail" data-class="${e(c.class)}"><span class="bar-rank">${idx+1}</span><span class="bar-label">${e(c.class)}班</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${pct}%"></span>${meanPct!=null?`<span class="bar-mean-mark" style="left:${meanPct}%" title="年级均分 ${fix(meanVal,1)}"></span>`:''}</span><span class="bar-number"><span class="bar-val">${fix(value,1)}</span><span class="bar-diff ${diff!=null?(diff>=0?'delta-positive':'delta-negative'):'muted'}">${diff!=null?`${diff>=0?'+':''}${fix(diff,1)}`:'—'}</span></span></button>`;}).join('')||'<p class="muted">没有匹配的班级，试试清空搜索。</p>'}</div><div class="bar-axis-ruler"><span>${axisMin} 分（起点）</span><span>${meanVal!=null?`年级均分 ${fix(meanVal,1)} 分`:''}</span><span>${fix(max,1)} 分</span></div></section><section class="brief-block"><div class="brief-block-head"><div><h3>班级统计明细</h3><p>达标：单科达线；集中：单科与总分同时达线</p></div></div><div class="table-wrap"><table><thead><tr>${classTable().columns.map((x,i)=>`<th class="${i?'number':''}">${e(x)}</th>`).join('')}<th></th></tr></thead><tbody>${classTable().rows.map(r=>`<tr data-action="class-detail" data-class="${e(r[0])}">${r.map((v,i)=>`<td class="${i?'number':''}">${i?n(v):e(v)+'班'}</td>`).join('')}<td class="table-action">查看 →</td></tr>`).join('')}</tbody></table></div><p class="table-note">前100、前200始终按总分名次统计；切换学科不会改变这两列的含义。各科满分未确认时不展示得分率。</p></section>${scoreBinsSection(a)}`:`<div class="compare-students-stage">${pubNote}<div class="toolbar"><label>班级<select id="student-class">${option('','全部班级',S.studentClass)}${a.classes.map(x=>option(x,x+'班',S.studentClass)).join('')}</select></label><input id="student-search" type="search" placeholder="姓名、班号或来源行" value="${e(S.studentSearch)}" aria-label="搜索学生"><div class="spacer"></div><span class="small-text">${n(rows.length,0)}条记录</span>${btn('更正记录 / 导入','open-score-edits','','secondary small')}${btn('复制筛选结果','copy-students','','secondary small')}${btn('打印名单','print-students','','secondary small')}</div><div class="table-wrap"><table><thead><tr><th>班级</th><th>姓名 / 来源行</th><th class="number">总分</th><th class="number">年级名次</th><th class="number">班级名次</th>${a.subjects.map(sub=>`<th class="number">${e(sub)}</th>`).join('')}<th>薄弱学科</th><th></th></tr></thead><tbody>${rows.slice(S.page*pageSize,(S.page+1)*pageSize).map(s=>`<tr><td>${e(s.class)}</td><td><button type="button" class="text-button" data-action="student-detail" data-index="${a.students.indexOf(s)}">${e(s.name)}</button></td><td class="number">${n(s.total)}</td><td class="number">${n(s.rank,0)}</td><td class="number">${n(s.class_rank,0)}</td>${a.subjects.map(sub=>LE?LE.scoreCellHTML(s,sub,a,S.stagedEdits):`<td class="number">${n(s.scores[sub])}</td>`).join('')}<td>${e(s.weak.map(x=>x.subject).join('、')||'未参与排名')}</td><td class="table-action"><button type="button" class="text-button" data-action="student-detail" data-index="${a.students.indexOf(s)}">详情 →</button></td></tr>`).join('')||`<tr><td colspan="${7+a.subjects.length}">当前筛选没有学生记录。</td></tr>`}</tbody></table></div>${pager(rows.length,pageSize,S.page,'students')}<p class="table-note">点击任意学科分数格即可修改单科成绩（支持改分数或设为缺考）；带右上角标记者为已更正成绩，悬停可查看原值与原因。</p></div>${stagedBar}`}`);}
  function pager(count,size,page,type){return `<div class="table-pager"><span>共 ${n(count,0)} 条 · 第 ${page+1} / ${Math.max(1,Math.ceil(count/size))} 页</span><div>${btn('上一页','page',`data-type="${type}" data-direction="-1" ${page===0?'disabled':''}`,'small')}${btn('下一页','page',`data-type="${type}" data-direction="1" ${(page+1)*size>=count?'disabled':''}`,'small')}</div></div>`;}
  function openDrawer(title,label,html,type='detail'){lastFocus=document.activeElement;S.drawerType=type;$('drawer-title').textContent=title;$('drawer-label').textContent=label;$('drawer-content').innerHTML=html;$('drawer-content').querySelectorAll('tr[data-action]').forEach(row=>row.tabIndex=0);$('drawer-overlay').hidden=false;document.body.style.overflow='hidden';$('drawer-overlay').querySelector('button').focus();}
  function closeDrawer(){if($('drawer-overlay').hidden)return;const prevType=S.drawerType;$('drawer-overlay').hidden=true;document.body.style.overflow='';S.drawerType='';S.drawerFile=null;if(prevType==='score-preview'&&S.lastEditedCellKey){const [rid,sub]=S.lastEditedCellKey.split('||');const cell=document.querySelector(`td[data-edit-cell][data-row-id="${CSS.escape(rid)}"][data-subject="${CSS.escape(sub)}"]`);if(cell){cell.focus();return;}}if(lastFocus?.isConnected)lastFocus.focus();}
  function classDetail(cls){const a=S.analysis,c=a.class_stats.find(x=>x.class===cls);if(!c)return;const rows=a.students.filter(x=>x.class===cls);S.drawerTable=studentTable(rows);openDrawer(`${cls}班 · ${S.subject}`,`${a.metadata.grade} · ${a.metadata.name}`,`<div class="metric-strip compact"><div><small>总分有效人数</small><strong>${n(c.participants,0)}</strong></div><div><small>总分均分</small><strong>${n(c.mean)}</strong></div><div><small>总分达标</small><strong>${n(c.elite_count,0)}</strong></div></div><div class="drawer-actions">${btn('进入班情分析','open-class-brief',`data-class="${e(cls)}"`,'primary')}${btn('复制本班成绩','copy-drawer')}${btn('打印本班成绩','print-drawer')}${btn('记录教研事项','note-class',`data-class="${e(cls)}"`)}</div><h3>各科表现与入选人数</h3><div class="table-wrap"><table><thead><tr><th>学科</th><th class="number">均分</th><th class="number">达标</th><th class="number">集中</th><th></th></tr></thead><tbody>${a.subjects.map(sub=>{const q=c.subjects[sub]||{};return `<tr><td>${e(sub)}</td><td class="number">${n(q.mean)}</td><td class="number">${n(q.achievers,0)}</td><td class="number">${n(q.concentrated,0)}</td><td><button class="table-action" data-action="achiever-detail" data-class="${e(cls)}" data-subject="${e(sub)}">看名单 →</button></td></tr>`;}).join('')}</tbody></table></div><h3>学生明细</h3><div class="table-wrap"><table><thead><tr><th>姓名 / 来源行</th><th>总分</th><th>年级名次</th><th>薄弱学科</th></tr></thead><tbody>${rows.map(s=>`<tr data-action="student-detail" data-index="${a.students.indexOf(s)}"><td>${e(s.name)}</td><td>${n(s.total)}</td><td>${n(s.rank,0)}</td><td>${e(s.weak.map(x=>x.subject).join('、')||'—')}</td></tr>`).join('')}</tbody></table></div><p class="table-note">${e(subtitle())}</p>`);}
  function achieverDetail(cls,subject){const a=S.analysis,line=a.cutoffs[subject]?.score,totalLine=a.cutoffs['总分']?.score;const rows=a.students.filter(s=>s.class===cls&&s.rank!==null&&s.rank!==undefined&&s.scores[subject]!==null&&s.scores[subject]!==undefined&&line!==null&&s.scores[subject]>=line);S.drawerTable={title:`${cls}班${subject}达标名单`,columns:['班级','姓名 / 来源行',subject+'分数','总分','年级名次','是否集中'],rows:rows.map(s=>[s.class,s.name,s.scores[subject],s.total,s.rank,s.total>=totalLine?'是':'否']),note:`${subject}分界 ${line}；总分分界 ${totalLine}。${subtitle()}`};openDrawer(`${cls}班 · ${subject}达标名单`,'从人数回到依据',`<p class="history-explain">${e(subject)} ≥ <b>${n(line)}</b> 分纳入学科达标；同时总分 ≥ <b>${n(totalLine)}</b> 分，计入集中人数。</p><div class="drawer-actions">${btn('复制名单','copy-drawer')}${btn('打印名单','print-drawer')}</div>${Z.tableHTML(S.drawerTable)}<p class="table-note">${e(subtitle())}</p>`);}
  function studentDetail(index){const a=S.analysis,s=a.students[index];if(!s)return;const LE=window.LeaderEdits;const table={title:`${s.name} · 学科分析`,columns:['学科','分数','单科名次','ABC','六等级','总分名次−单科名次'],rows:a.subjects.map(x=>[x,s.scores[x],s.ranks[x],s.grades[x],s.levels[x],s.rank!=null&&s.ranks[x]!=null?s.rank-s.ranks[x]:null]),note:subtitle()};S.drawerTable=table;const subRowsHTML=a.subjects.map(x=>`<tr><td><strong>${e(x)}</strong></td>${LE?LE.scoreCellHTML(s,x,a,S.stagedEdits):`<td class="number">${n(s.scores[x])}</td>`}<td class="number">${n(s.ranks[x],0)}</td><td>${e(s.grades[x]||'—')}</td><td>${e(s.levels[x]||'—')}</td><td class="number">${s.rank!=null&&s.ranks[x]!=null?n(s.rank-s.ranks[x],0):'—'}</td></tr>`).join('');const stagedCnt=Object.keys(S.stagedEdits||{}).length;openDrawer(s.name,`${s.class}班 · 来源第${s.source_row}行`,`<div class="metric-strip compact"><div><small>总分</small><strong>${n(s.total)}</strong></div><div><small>年级名次</small><strong>${n(s.rank,0)}</strong></div><div><small>班级名次</small><strong>${n(s.class_rank,0)}</strong></div></div><div class="drawer-actions">${btn('打印个人诊断卡（发家长）','print-single-card',`data-student-id="${e(s.id)}"`,'primary')}${stagedCnt?btn(`预览已暂存修改 (${stagedCnt})`,'score-edit-preview','','secondary'):''}${btn('复制学科表','copy-drawer')}${btn('打印学科表','print-drawer')}</div><div class="table-wrap"><table><thead><tr><th>学科</th><th class="number">分数（点格修改）</th><th class="number">单科名次</th><th>ABC</th><th>六等级</th><th class="number">总分名次−单科名次</th></tr></thead><tbody>${subRowsHTML}</tbody></table></div><div class="support-note"><b>本次优先关注：</b>${e(s.weak.map(x=>x.subject).join('、')||'未生成薄弱科结果')}<br>按名次差从小到大选取不同学科；与历次表现、课堂证据结合后再确定支持安排。</div>${!s.identity_reliable?'<p class="table-note">原表未提供可用于跨考试匹配的身份信息，该来源行不会被自动当作同一个人的历史记录。</p>':''}`,'student-detail');}
  function selectedHistoryIds(exams){const ids=exams.map(x=>x.id);if(!S.historySelectionInitialized){S.historySelection=ids.slice();S.historySelectionInitialized=true;}else{S.historySelection=S.historySelection.filter(id=>ids.includes(id));}return S.historySelection;}
  function historyStudents(){const needle=S.historySearch.trim().toLowerCase();return (S.history?.students||[]).filter(s=>!needle||[s.name,s.class,s.id].some(x=>String(x).toLowerCase().includes(needle)));}
  function historyTable(){const rows=historyStudents();return {title:'历次综合名次',columns:['班级','姓名','有效次数','普通平均','去极值平均','加权平均','平均PR','PR首末变化','综合指标','综合名次'],rows:rows.map(s=>[s.class,s.name,s.attempts,s.mean,s.trimmed,s.weighted,s.mean_pr,s.pr_delta,s.composite,s.rank]),note:'综合指标为三个平均名次的均值，越小越靠前；年级百分位 PR（0–100，越高越靠前）可消除试卷难度波动。'};}
  function historyTableHTML(){const rows=historyStudents(),start=S.historyPage*50,visible=rows.slice(start,start+50);return `<div class="table-wrap history-result-table"><table><thead><tr><th>班级</th><th>姓名</th><th class="number">有效次数</th><th class="number">普通平均</th><th class="number">去极值平均</th><th class="number">加权平均</th><th class="number" title="年级百分位(PR)：0–100，表示超过年级百分之多少的同学，不受试卷难易波动影响">年级百分位(PR)</th><th class="number" title="首末两场考试的年级百分位变化，正数代表相对位次进步">百分位变化</th><th class="number">综合名次</th><th></th></tr></thead><tbody>${visible.length?visible.map(s=>{const d=s.pr_delta;const dCls=d==null||d===0?'':d>0?'delta-positive':'delta-negative';const dTxt=d==null?'—':d===0?'0':`${d>0?'+':''}${n(d,1)}`;return `<tr data-action="growth-detail" data-id="${e(s.id)}"><td>${e(s.class)}</td><td>${e(s.name)}</td><td class="number">${n(s.attempts,0)}</td><td class="number">${n(s.mean)}</td><td class="number">${n(s.trimmed)}</td><td class="number">${n(s.weighted)}</td><td class="number">${n(s.mean_pr,1)}</td><td class="number ${dCls}">${dTxt}</td><td class="number">${n(s.rank,0)}</td><td class="table-action">看成长 →</td></tr>`;}).join(''):'<tr><td colspan="10">没有可关联的学生历史记录。请导入包含稳定学号或班级姓名的考试表。</td></tr>'}</tbody></table></div>`;}
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
  function renderReports(){const a=S.analysis;const t=reportTable(),count=t.rows.length;S.page=Math.min(S.page,Math.max(0,Math.ceil(count/60)-1));const stale=window.LeaderEdits?window.LeaderEdits.staleExportNoticeHTML(S.examId,a.metadata?.data_version):'';paint(`${stale}<section class="panel dist-bar-panel"><div class="dist-bar"><div><h2>分级安全分发（按角色防泄密）</h2><p>按班主任、科任教师与家长的隐私边界一键导出，无需手工拆表</p></div><div class="dist-bar-actions">${btn('导出各班 ABC 表（按姓氏）','open-abc-export','','secondary small')}${btn('一键按班拆包 ZIP（发班主任）','download-class-zip','','secondary small')}${btn('学生个人诊断卡（发家长/学生）','open-student-cards','','primary small')}</div></div></section><div class="report-tab-list">${a.tables.map(x=>`<button data-action="report-tab" data-table="${e(x.id)}" class="${x.id===t.id?'active':''}">${e(x.title)}</button>`).join('')}</div><section class="panel"><div class="section-title"><div><h2>${e(t.title)}</h2><p>${e(a.metadata.name)} · ${n(count,0)}条记录</p></div><div class="panel-heading-actions">${btn('复制当前表','copy-report')}${btn('打印当前表','print-report','','primary')}</div></div><div class="toolbar"><input id="report-search" type="search" value="${e(S.reportSearch)}" placeholder="在当前报表中查找" aria-label="在报表中搜索"><div class="spacer"></div>${btn('下载当前 CSV','csv-report')}${btn('打印全部分析表','print-all')}</div>${t.note?`<p class="table-note" style="margin:0 0 15px">${e(t.note)}</p>`:''}<div class="report-table">${Z.tableHTML({...t,rows:t.rows.slice(S.page*60,(S.page+1)*60)})}</div>${pager(count,60,S.page,'report')}<p class="table-note">复制、CSV与打印当前表包含全部筛选结果，不限于当前页。导出全部Excel会保留各分析表与统计口径。</p></section>`);}
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
    if(saveAsDefault||applyToGrade){
      const impacts=[];
      if(saveAsDefault)impacts.push('· 覆盖「全校默认口径」（后续新导入考试将自动沿用）');
      if(applyToGrade)impacts.push('· 同步改写本年级全部已保存考试的公共口径并重算统计');
      if(!window.confirm(`您勾选了全局口径选项，确认继续吗？\n\n${impacts.join('\n')}`))return;
    }
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
  function markExported() {
    if (window.LeaderEdits && S.examId && S.analysis?.metadata?.data_version) {
      window.LeaderEdits.recordExportVersion(S.examId, S.analysis.metadata.data_version);
    }
  }
  function activateScoreCellEditor(td) {
    if (!td || td.querySelector('.score-inline-editor') || !S.analysis) return;
    if (S.analysis.metadata?.published_at) {
      Z.notice('本场考试已发布锁定，如需更正请点击顶部「已发布」徽标先解锁。', true);
      return;
    }
    const rowId = td.dataset.rowId, subject = td.dataset.subject;
    if (!rowId || !subject) return;
    const stu = (S.analysis.students || []).find(x => x.id === rowId);
    if (!stu) return;
    const key = `${rowId}||${subject}`;
    S.lastEditedCellKey = key;
    const origVal = stu.scores?.[subject] ?? null;
    const curVal = Object.prototype.hasOwnProperty.call(S.stagedEdits, key) ? S.stagedEdits[key].value : origVal;
    const prevHTML = td.innerHTML;
    td.classList.add('is-editing');
    td.innerHTML = `<div class="score-inline-editor"><input type="number" step="0.1" value="${curVal == null ? '' : e(curVal)}" aria-label="${e(stu.name)}${e(subject)}新分数" placeholder="分数"><button type="button" class="score-inline-btn" data-inline-op="absent" title="设为缺考">缺考</button><button type="button" class="score-inline-btn is-ok" data-inline-op="ok" title="暂存">✓</button></div>`;
    const input = td.querySelector('input');
    const btns = td.querySelectorAll('.score-inline-btn');
    let done = false;
    const refreshAfterEdit = () => {
      const inStudentDrawer = S.drawerType === 'student-detail';
      if (S.view === 'compare' && S.compareTab === 'students') renderCompare();
      if (inStudentDrawer) {
        const idx = S.analysis.students.indexOf(stu);
        if (idx >= 0) studentDetail(idx);
      } else {
        const nextCell = document.querySelector(`td[data-edit-cell][data-row-id="${CSS.escape(rowId)}"][data-subject="${CSS.escape(subject)}"]`);
        if (nextCell) nextCell.focus({ preventScroll: true });
      }
    };
    const cancel = () => {
      if (done) return;
      done = true;
      td.classList.remove('is-editing');
      td.innerHTML = prevHTML;
    };
    const commit = rawVal => {
      if (done) return;
      let parsed = null;
      if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
        parsed = Number(rawVal);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
          Z.notice('请输入 0–1000 之间的有效分数，或点击「缺考」。', true);
          input.focus();
          input.select();
          return;
        }
      }
      done = true;
      const same = (parsed === null && origVal === null) || (parsed !== null && origVal !== null && Math.abs(parsed - Number(origVal)) < 1e-9);
      if (same) delete S.stagedEdits[key];
      else S.stagedEdits[key] = { row_id: rowId, subject, value: parsed, old_value: origVal };
      refreshAfterEdit();
    };
    btns.forEach(b => {
      b.addEventListener('mousedown', ev => ev.preventDefault());
      b.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (b.dataset.inlineOp === 'absent') commit(null);
        else commit(input.value);
      });
    });
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(input.value); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (done) return;
        const active = document.activeElement;
        if (active && td.contains(active)) return;
        const raw = input.value.trim();
        const curStr = curVal == null ? '' : String(curVal);
        if (raw === curStr) cancel();
        else commit(raw);
      }, 100);
    });
    input.focus();
    input.select();
  }
  async function openScoreEditsDrawer() {
    if (!S.examId) return;
    const res = await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/scores/edits');
    S.scoreEditsList = res.edits || [];
    const meta = metadata();
    openDrawer('成绩更正记录', `${meta.grade || S.analysis?.metadata?.grade || ''} · ${meta.name || S.analysis?.metadata?.name || ''}`, window.LeaderEdits.editsHistoryDrawerHTML(res, meta), 'score-edits');
  }
  async function openScorePreviewDrawer(opts = {}) {
    if (!S.examId || !window.LeaderEdits) return;
    const mode = opts.mode || 'save';
    const meta = metadata();
    const label = `${meta.grade || S.analysis?.metadata?.grade || ''} · ${meta.name || S.analysis?.metadata?.name || ''}`;
    if (mode === 'revoke') {
      const editId = opts.editId;
      const rev = (S.scoreEditsList || []).find(x => x.id === editId) || { id: editId };
      const preview = await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/scores/preview', { revoke_edit_id: editId });
      openDrawer('撤销更正 · 影响预览', label, window.LeaderEdits.previewDrawerHTML(preview, { mode: 'revoke', revokeEdit: rev }), 'score-preview');
      return;
    }
    if (mode === 'import') {
      S.pendingImportEdits = opts.matchedEdits || [];
      openDrawer('批量更正 · 影响预览', label, window.LeaderEdits.previewDrawerHTML(opts.preview || {}, { mode: 'import', unmatched: opts.unmatched || [], defaultReason: opts.defaultReason || '' }), 'score-preview');
      return;
    }
    const edits = Object.values(S.stagedEdits || {}).map(x => ({ row_id: x.row_id, subject: x.subject, value: x.value }));
    if (!edits.length) {
      Z.notice('当前没有已暂存的成绩修改。');
      return;
    }
    const preview = await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/scores/preview', { edits });
    openDrawer('修改影响预览', label, window.LeaderEdits.previewDrawerHTML(preview, { mode: 'save' }), 'score-preview');
  }
  async function confirmScoreEdits(form) {
    const mode = form.dataset.mode || 'save';
    const reason = ($('score-edit-reason')?.value || '').trim();
    if (!reason) throw new Error('请填写修改原因（1–200 字）。');
    const edits = mode === 'import'
      ? (S.pendingImportEdits || []).map(x => ({ row_id: x.row_id, subject: x.subject, value: x.value }))
      : Object.values(S.stagedEdits || {}).map(x => ({ row_id: x.row_id, subject: x.subject, value: x.value }));
    if (!edits.length) throw new Error('没有可保存的成绩修改。');
    const res = await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/scores', { edits, reason });
    S.stagedEdits = {};
    S.pendingImportEdits = null;
    S.analysis = null;
    S.brief = null;
    S.trends = null;
    S.history = null;
    await loadExams();
    closeDrawer();
    await loadView();
    Z.notice(`已保存 ${res.saved_count} 处成绩更正，所有排名与报表已重新计算（当前数据版本 v${res.data_version}）。`);
  }
  async function confirmRevokeEdit(editId) {
    if (!S.examId || !editId) return;
    const res = await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/scores/edits/' + encodeURIComponent(editId) + '/revoke', {});
    S.analysis = null;
    S.brief = null;
    S.trends = null;
    S.history = null;
    await loadExams();
    closeDrawer();
    await loadView();
    Z.notice(`已撤销该条成绩更正，当前数据版本 v${res.data_version}。`);
  }
  async function importScoreEditsFile(file) {
    if (!file || !S.examId) return;
    const content = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
      r.readAsDataURL(file);
    });
    const res = await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/scores/import', { filename: file.name, content });
    const reasons = [...new Set((res.matched_edits || []).map(x => String(x.reason || '').trim()).filter(Boolean))];
    const defaultReason = reasons.length === 1 ? reasons[0] : (reasons.length ? reasons.slice(0, 2).join('；') : '');
    await openScorePreviewDrawer({
      mode: 'import',
      preview: res.preview,
      matchedEdits: res.matched_edits || [],
      unmatched: res.unmatched || [],
      defaultReason,
    });
  }
  async function publishExam() {
    if (!S.examId) return;
    if (!window.confirm('发布后将锁定本场考试成绩，防止误操作修改；如需后续更正需先解锁并写明原因。确认发布吗？')) return;
    await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/publish', {});
    S.stagedEdits = {};
    S.analysis = null;
    S.brief = null;
    await loadExams();
    await loadView();
    await openScoreEditsDrawer();
    Z.notice('本场考试已发布锁定。');
  }
  async function unlockExam() {
    if (!S.examId) return;
    const reason = window.prompt('请输入解锁修改的原因（必填，将记入审计记录）：', '');
    if (reason === null) return;
    if (!reason.trim()) throw new Error('解锁本场考试必须填写原因。');
    await Z.api('/api/exams/' + encodeURIComponent(S.examId) + '/unlock', { reason: reason.trim() });
    S.analysis = null;
    S.brief = null;
    await loadExams();
    await loadView();
    await openScoreEditsDrawer();
    Z.notice('已解除发布锁定，现在可以更正成绩。');
  }
  async function generateStudentCards(form) {
    const fd = new FormData(form);
    const cls = String(fd.get('class_name') || '');
    const layout = String(fd.get('layout') || 'two-up');
    const hideRank = !!form.querySelector('[name="hide_rank"]')?.checked;
    const hideScore = !!form.querySelector('[name="hide_score"]')?.checked;
    const res = await Z.api('/api/student-cards', { exam_id: S.examId, class: cls });
    markExported();
    closeDrawer();
    window.LeaderCards.printStudentCards(res, { layout, hideRank, hideScore });
  }
  function downloadStudentCardsZip() {
    if (!S.examId) return;
    const form = $('student-cards-form');
    const cls = String(form?.querySelector('[name="class_name"]')?.value || '');
    const hideRank = form ? !!form.querySelector('[name="hide_rank"]')?.checked : true;
    const hideScore = form ? !!form.querySelector('[name="hide_score"]')?.checked : false;
    const qs = new URLSearchParams();
    if (cls) qs.set('class', cls);
    qs.set('hide_rank', hideRank ? '1' : '0');
    qs.set('hide_score', hideScore ? '1' : '0');
    markExported();
    const url = `/api/exams/${encodeURIComponent(S.examId)}/student-cards.zip?${qs.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    Z.notice(`正在下载${cls ? cls + '班' : '全年级'}家长版个人诊断卡（一人一档 HTML ZIP）…`);
  }
  function openBriefPromptDrawer() {
    if (!S.brief || !window.LeaderPrompts) return;
    const m = S.brief.meta;
    openDrawer('脱敏分析提示词（AI 写稿助手）', `${m.grade} · ${m.class}班 · ${m.exam_name}`, window.LeaderPrompts.briefPromptDrawerHTML(S.brief, S.promptOpts), 'brief-prompt');
  }
  function openStudentPromptDrawer() {
    if (!S.lastProfileData || !window.LeaderPrompts) return;
    const st = S.lastProfileData.student || {};
    openDrawer('个别生谈话与家校沟通提示词', `${st.grade || ''} · ${st.class_name || ''}班`, window.LeaderPrompts.studentPromptDrawerHTML(S.lastProfileData, S.studentPromptOpts), 'student-prompt');
  }
  function refreshPromptDrawer() {
    if (!window.LeaderPrompts) return;
    if (S.drawerType === 'brief-prompt' && S.brief) {
      $('drawer-content').innerHTML = window.LeaderPrompts.briefPromptDrawerHTML(S.brief, S.promptOpts);
    } else if (S.drawerType === 'student-prompt' && S.lastProfileData) {
      $('drawer-content').innerHTML = window.LeaderPrompts.studentPromptDrawerHTML(S.lastProfileData, S.studentPromptOpts);
    }
  }
  async function printSingleStudentCard(studentId, examIdOverride = '') {
    const eid = examIdOverride || S.examId;
    if (!eid || !studentId) return;
    const res = await Z.api('/api/student-cards', { exam_id: eid, student_id: studentId });
    markExported();
    window.LeaderCards.printStudentCards(res, { layout: 'one-up', hideRank: true });
  }
  async function openStudentProfileDrawer(params) {
    const qs = new URLSearchParams();
    if (params.grade) qs.set('grade', params.grade);
    if (params.studentId) qs.set('student_id', params.studentId);
    if (params.name) qs.set('name', params.name);
    if (params.className) qs.set('class', params.className);
    const data = await Z.api('/api/students/profile?' + qs.toString());
    const st = data.student, hist = data.history || [], pWeak = data.persistent_weak || [], notes = data.notes || [];
    const subjects = [...new Set(hist.flatMap(item => item.subjects || Object.keys(item.scores || {})))];
    const orderedForChart = hist.map(h => ({ ...h, name: h.exam_name }));
    const charts = orderedForChart.length >= 2 ? `<div class="growth-charts">
      ${growthChartSVG(orderedForChart, 'pr', { title: '年级百分位走势', hint: '0–100，越高越靠前，不受试卷难易影响', invert: false, digits: 1, lineClass: 'line-rank', dotClass: 'dot-rank' })}
      ${growthChartSVG(orderedForChart, 't_score', { title: '标准分（T分）走势', hint: '年级均分为50，高于50即高于年级均分', invert: false, digits: 1 })}
    </div>` : '';
    const histTable = {
      title: `${st.name} · 个人历次成绩档案`,
      columns: ['考试', '日期', '班级', '总分', '年级名次', '等级', '年级百分位', '标准分', '薄弱学科'],
      rows: hist.map(h => [h.exam_name, h.date, `${h.class}班`, h.total, h.rank, h.total_level, h.pr, h.t_score, (h.weak || []).slice(0, 3).join('、') || '—']),
      note: `${st.grade} · ${st.class_name}班 · 共关联 ${st.exam_count} 场考试`,
    };
    const subRows = subjects.map(sub => [sub, ...hist.map(h => {
      const sc = h.scores?.[sub], lv = h.levels?.[sub];
      if (sc == null) return '—';
      return lv ? `${sc} (${lv})` : sc;
    })]);
    S.drawerTable = histTable;
    S.lastProfileData = data;
    S.profileContext = { examId: st.latest_exam_id, className: st.class_name, name: st.name, grade: st.grade, studentId: st.id };
    const weakHtml = pWeak.length
      ? pWeak.map(w => `<span class="weak-pill${w.hits >= 2 ? ' is-persist' : ''}">${e(w.subject)}${w.hits >= 2 ? `（${w.hits}/${w.total_exams}次）` : ''}</span>`).join(' ')
      : '<span class="muted">各科整体均衡</span>';
    const notesHtml = notes.length
      ? notes.map(nt => `<article class="profile-note-item"><header><span class="badge${nt.mentions_student ? ' success' : ''}">${e(nt.mentions_student ? '含该生记录' : (nt.class ? nt.class + '班' : '年级'))}</span><time>${e(nt.created_at ? new Date(nt.created_at).toLocaleString('zh-CN', { hour12: false }) : '')}</time></header><p>${e(nt.text)}</p></article>`).join('')
      : '<p class="muted" style="margin:6px 0">暂无相关谈话或教研记录，可在下方直接补记一条。</p>';
    const prDelta = st.pr_delta;
    const html = `
      <div class="metric-strip compact growth-metrics">
        <div><small>已关联考试</small><strong>${n(st.exam_count, 0)}<em>场</em></strong></div>
        <div><small>最近等级</small><strong>${e(st.latest_level || '—')}</strong></div>
        <div title="年级百分位(PR)：0–100，表示超过年级百分之多少的同学"><small>最近年级百分位</small><strong>${n(st.latest_pr, 1)}</strong></div>
        <div title="首末两场考试的年级百分位变化，正数表示相对位次进步"><small>百分位首末变化</small><strong class="${prDelta != null && prDelta >= 0 ? 'growth-positive' : prDelta != null ? 'growth-negative' : ''}">${prDelta == null ? '—' : `${prDelta >= 0 ? '+' : ''}${n(prDelta, 1)}`}</strong></div>
      </div>
      <div class="drawer-actions">
        ${btn('打印个人诊断卡（发家长）', 'print-single-card', `data-student-id="${e(st.id)}" data-exam-id="${e(st.latest_exam_id)}"`, 'primary small')}
        ${btn('复制谈话提示词', 'open-student-prompt', '', 'secondary small')}
        ${btn('查看所在班班情', 'brief-jump', `data-id="${e(st.latest_exam_id)}" data-class="${e(st.class_name)}" data-section="overview"`, 'secondary small')}
        ${btn('复制档案表', 'copy-drawer', '', 'secondary small')}
        ${btn('打印档案表', 'print-drawer', '', 'secondary small')}
      </div>
      <div class="profile-weak-bar"><b>持续关注学科：</b>${weakHtml}</div>
      ${charts}
      <h3>历次考试轨迹</h3>
      ${Z.tableHTML(histTable)}
      <h3>各科历次得分与等级</h3>
      ${Z.tableHTML({ title: `${st.name} · 学科变化`, columns: ['学科', ...hist.map(h => `${h.exam_name}`)], rows: subRows })}
      <h3>谈话与跟进记录</h3>
      <div class="profile-notes-list">${notesHtml}</div>
      <form id="student-profile-note-form" class="profile-note-form">
        <label class="field"><span>快速记一条该生谈话 / 跟进记录（随最近考试保存）</span>
          <textarea id="profile-note-text" rows="2" required maxlength="5000" placeholder="例如：考后谈心，数学基础题粗心失分较多，下周重点盯紧限时小测。"></textarea>
        </label>
        <div id="profile-note-error" class="error" hidden></div>
        <div class="form-actions" style="margin-top:8px"><button type="submit" class="btn primary small">保存谈话记录</button></div>
      </form>
    `;
    openDrawer(`${st.name} · 个人成长档案`, `${st.grade} · ${st.class_name}班 · ${identityLabel(st.id)}`, html, 'student-profile');
  }
  async function saveProfileNote(form) {
    const ctx = S.profileContext;
    if (!ctx?.examId) return;
    const raw = ($('profile-note-text')?.value || '').trim();
    if (!raw) throw new Error('请填写谈话或跟进内容。');
    const text = raw.includes(ctx.name) ? raw : `【${ctx.name}】${raw}`;
    await Z.api('/api/notes', { exam_id: ctx.examId, class: ctx.className, text });
    Z.notice(`已保存 ${ctx.name} 的谈话记录。`);
    await openStudentProfileDrawer({ grade: ctx.grade, studentId: ctx.studentId, name: ctx.name, className: ctx.className });
  }
  let globalSearchTimer = null, globalSearchSeq = 0;
  function hideGlobalSearchDropdown() {
    const box = $('global-student-results');
    if (box) box.hidden = true;
  }
  async function runGlobalStudentSearch(q) {
    const box = $('global-student-results');
    if (!box) return;
    const needle = String(q || '').trim();
    if (!needle) { box.hidden = true; box.innerHTML = ''; return; }
    const seq = ++globalSearchSeq;
    try {
      const res = await Z.api('/api/students/search?q=' + encodeURIComponent(needle));
      if (seq !== globalSearchSeq) return;
      const list = res.results || [];
      if (!list.length) {
        box.innerHTML = '<div class="global-stu-empty">未找到匹配的学生，请核对姓名或班号</div>';
      } else {
        box.innerHTML = list.map(item => `<button type="button" class="global-stu-item" data-action="open-student-profile" data-grade="${e(item.grade)}" data-student-id="${e(item.student_id)}" data-name="${e(item.name)}" data-class="${e(item.class)}">
          <div><strong>${e(item.name)}</strong><span class="badge">${e(item.grade)} · ${e(item.class)}班</span>${item.total_level ? `<span class="badge success">${e(item.total_level)}</span>` : ''}</div>
          <small>${e(item.exam_name)} · 第 ${item.rank != null ? n(item.rank, 0) : '—'} 名 · 关联 ${item.exam_count} 场${item.weak?.length ? ` · 弱科：${e(item.weak.join('、'))}` : ''}</small>
        </button>`).join('');
      }
      box.hidden = false;
    } catch (_) {
      if (seq === globalSearchSeq) box.hidden = true;
    }
  }
  function downloadClassPackagesZip() {
    if (!S.examId) return;
    markExported();
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
    Z.notice('正在打包各班独立分发 ZIP（含成绩明细、ABC 等级表与打印版）…');
  }
  function openAbcExportDrawer() {
    if (!S.examId || !S.analysis || !window.LeaderBrief) return;
    const cls = S.briefClass || S.studentClass || S.analysis.classes?.[0] || '';
    openDrawer(
      '导出各班 ABC 等级表（按姓氏排序）',
      `${S.analysis.metadata.grade} · ${S.analysis.metadata.name}`,
      window.LeaderBrief.abcExportDrawerHTML(S.analysis, cls, S.abcExportMode || 'six'),
      'abc-export'
    );
  }
  function downloadClassAbc(kind = 'xlsx', className = '') {
    if (!S.examId) return;
    markExported();
    const mode = S.abcExportMode === 'abc' ? 'abc' : 'six';
    const qs = new URLSearchParams({ mode });
    if (className) qs.set('class', className);
    const ext = kind === 'zip' ? 'zip' : 'xlsx';
    const url = `/api/exams/${encodeURIComponent(S.examId)}/class-abc.${ext}?${qs.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    const label = kind === 'zip'
      ? '正在打包各班独立 ABC 等级表 ZIP（按姓氏排序）…'
      : className
        ? `正在导出 ${className}班 ABC 等级表（按姓氏排序）…`
        : '正在导出全年级各班 ABC 总簿 Excel（每班一页 · 按姓氏排序）…';
    Z.notice(label);
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
      compare_exam_id: S.briefCompareExamId || undefined,
    });
    markExported();
    closeDrawer();
    window.LeaderBrief.printBriefs(res.briefs || [], kind, ratioMode || S.briefTpl2Ratio || 'main');
  }
  function openPrintStudioDrawer() {
    if (!S.brief || !window.LeaderPrintStudio) return;
    if (!S.printStudio) S.printStudio = window.LeaderPrintStudio.loadConfig();
    openDrawer('分模块班情分析打印台', `${S.brief.meta.grade} · ${S.brief.meta.exam_name} · ${S.brief.meta.class}班`, window.LeaderPrintStudio.studioDrawerHTML(S.brief, S.printStudio), 'print-studio');
  }
  function refreshPrintStudioDrawer() {
    if (S.drawerType !== 'print-studio' || !S.brief || !window.LeaderPrintStudio) return;
    window.LeaderPrintStudio.saveConfig(S.printStudio);
    $('drawer-content').innerHTML = window.LeaderPrintStudio.studioDrawerHTML(S.brief, S.printStudio);
  }
  async function executePrintStudio() {
    if (!S.brief || !window.LeaderPrintStudio) return;
    const cfg = S.printStudio || window.LeaderPrintStudio.loadConfig();
    if (!cfg.enabled?.length) throw new Error('请至少勾选一个要打印的模块。');
    const chosenCompare = $('studio-compare-exam')?.value || S.briefCompareExamId || '';
    if (chosenCompare && chosenCompare !== S.briefCompareExamId) {
      S.briefCompareExamId = chosenCompare;
    }
    window.LeaderPrintStudio.saveConfig(cfg);
    if (cfg.scope === 'all') {
      const res = await Z.api('/api/class-brief', {
        exam_id: S.examId,
        all_classes: true,
        high_ratio: S.briefHighRatio,
        main_ratio: S.briefMainRatio,
        compare_exam_id: chosenCompare || undefined,
      });
      markExported();
      closeDrawer();
      window.LeaderPrintStudio.printModularBriefs(res.briefs || [], cfg);
      return;
    }
    let targetBrief = S.brief;
    if (chosenCompare && targetBrief.student_comparison?.compare_exam?.id !== chosenCompare) {
      await loadBrief();
      renderBrief();
      targetBrief = S.brief;
    }
    markExported();
    closeDrawer();
    window.LeaderPrintStudio.printModularBriefs([targetBrief], cfg);
  }
  async function saveNote(form){S.noteDraft=$('note-text').value;const text=S.noteDraft.trim();if(!text)throw new Error('请填写需要保存的教研记录。');const cls=$('note-class').value;await Z.api('/api/notes',{exam_id:S.examId,class:cls,text});S.notes=(await Z.api('/api/notes?exam_id='+encodeURIComponent(S.examId))).notes||[];S.noteDraft='';S.noteClass='';renderNotes();Z.notice('教研记录已保存并重新读取。');}
  function printSchool(){if(!S.school?.grades?.length)return;const t={title:'全校年级概况',columns:['年级','最新考试','日期','班级数','纳入记录','总分有效人数','均分','总分分界'],rows:S.school.grades.map(g=>[g.grade,g.exam.name,g.exam.date,g.analysis.classes.length,g.analysis.summary.registered,g.analysis.summary.participants,g.analysis.summary.mean,g.analysis.summary.cutoff]),note:'各年级独立统计；不同科目组合与试卷难度的均分不直接横向排名。'};Z.printTables([t],'全校学情概况','各年级最新一场已保存考试 · 数据来源与规则随考试档案保留');}
  async function run(button,task,target){const label=button?.textContent;if(button){button.disabled=true;button.setAttribute('aria-busy','true');}try{clearError();await task();}catch(err){const el=target&&$(target);if(el){el.textContent=err.message;el.hidden=false;}else fail(err.message);}finally{if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');if(label&&button.textContent==='处理中…')button.textContent=label;}}}
  async function action(name,target){switch(name){case'navigate':return go(target.dataset.view);case'reload':return loadView();case'presentation':S.presentation=!S.presentation;persist();header();return;case'open-score-edits':return openScoreEditsDrawer();case'score-edit-preview':return openScorePreviewDrawer({mode:'save'});case'score-edit-discard':S.stagedEdits={};if(S.view==='compare'&&S.compareTab==='students')renderCompare();Z.notice('已放弃暂存的成绩修改。');return;case'score-reason-chip':{const inp=$('score-edit-reason');if(inp){inp.value=target.dataset.reason||'';inp.focus();inp.dispatchEvent(new Event('input',{bubbles:true}));}return;}case'score-edit-revoke-preview':return openScorePreviewDrawer({mode:'revoke',editId:target.dataset.editId});case'score-edit-confirm-revoke':return confirmRevokeEdit(target.dataset.editId);case'score-edit-choose-import':$('score-edits-import-file')?.click();return;case'score-exam-publish':return publishExam();case'score-exam-unlock':return unlockExam();case'open-import':return openImportDrawer();case'open-multi-import':return openMultiImportDrawer();case'multi-commit':return commitMultiImport();case'open-student-cards':return openStudentCardsDrawer(target.dataset.class||'');case'download-student-cards-zip':return downloadStudentCardsZip();case'open-prompt-studio':return openBriefPromptDrawer();case'open-student-prompt':return openStudentPromptDrawer();case'prompt-scenario':{if(target.dataset.target==='student'){S.studentPromptOpts={...S.studentPromptOpts,scenario:target.dataset.scenario||'talk'};}else{S.promptOpts={...S.promptOpts,scenario:target.dataset.scenario||'meeting'};}return refreshPromptDrawer();}case'prompt-copy':{const txt=$('prompt-preview-box')?.value||'';return window.LeaderPrompts?.copyText(txt);}case'print-single-card':return printSingleStudentCard(target.dataset.studentId,target.dataset.examId||'');case'open-student-profile':{hideGlobalSearchDropdown();const inp=$('global-student-input');if(inp)inp.value='';return openStudentProfileDrawer({grade:target.dataset.grade||'',studentId:target.dataset.studentId||'',name:target.dataset.name||'',className:target.dataset.class||''});}case'brief-jump':{closeDrawer();if(target.dataset.id){S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.stagedEdits={};S.pendingImportEdits=null;}if(target.dataset.class)S.briefClass=target.dataset.class;if(target.dataset.section)S.briefSection=target.dataset.section;persist();return go('brief');}case'download-class-zip':return downloadClassPackagesZip();case'open-abc-export':return openAbcExportDrawer();case'abc-mode':{S.abcExportMode=target.dataset.mode==='abc'?'abc':'six';persist();if(S.drawerType==='abc-export'&&S.analysis&&window.LeaderBrief){const cls=S.briefClass||S.studentClass||S.analysis.classes?.[0]||'';$('drawer-content').innerHTML=window.LeaderBrief.abcExportDrawerHTML(S.analysis,cls,S.abcExportMode);}return;}case'download-abc-xlsx':return downloadClassAbc('xlsx');case'download-abc-zip':return downloadClassAbc('zip');case'download-abc-class':return downloadClassAbc('xlsx',target.dataset.class||S.briefClass||'');case'brief-section':S.briefSection=target.dataset.section||'overview';persist();return renderBrief();case'brief-select-class':{const next=target.dataset.class;if(!next||next===S.briefClass)return;S.briefClass=next;await loadBrief();renderBrief();return;}case'brief-diverge-mode':S.briefDivergeMode=target.dataset.mode==='high'?'high':'main';return renderBrief();case'overview-select-grade':S.overviewGrade=target.dataset.grade||'';S.overviewHeatmapAll=false;return renderOverview();case'overview-toggle-heatmap':S.overviewHeatmapAll=!S.overviewHeatmapAll;return renderOverview();case'trend-scale':S.classTrendScale=target.dataset.scale||'raw';return renderTrends();case'example':return example();case'open-exam':S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.stagedEdits={};S.pendingImportEdits=null;S.subject='总分';S.compareTab='classes';return go('compare');case'open-subject':S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.stagedEdits={};S.pendingImportEdits=null;S.subject=target.dataset.subject;S.compareTab='classes';return go('compare');case'open-quality':S.examId=target.dataset.id;S.analysis=null;S.brief=null;S.briefRatioOverride=false;S.stagedEdits={};S.pendingImportEdits=null;S.tableId='quality';S.reportSearch='';return go('reports');case'compare-tab':S.compareTab=target.dataset.tab;S.page=0;return renderCompare();case'class-detail':return classDetail(target.dataset.class);case'achiever-detail':return achieverDetail(target.dataset.class,target.dataset.subject);case'student-detail':return studentDetail(Number(target.dataset.index));case'growth-detail':return growthDetail(target.dataset.id);case'close-drawer':return closeDrawer();case'copy-classes':return Z.copyTable(classTable());case'csv-classes':{const table=classTable();markExported();return Z.downloadTable(table,`${S.analysis.metadata.name}_${table.title}.csv`);}case'copy-class-trends':{const exams=S.trends?.exams||[];if(exams.length<2)return;return Z.copyTable(classTrendTable(exams).table);}case'csv-class-trends':{const exams=S.trends?.exams||[];if(exams.length<2)return;const {table}=classTrendTable(exams);return Z.downloadTable(table,`${table.title}.csv`);}case'copy-students':return Z.copyTable(studentTable());case'print-students':markExported();return Z.printTables([studentTable()],S.analysis.metadata.name,subtitle());case'copy-drawer':return Z.copyTable(S.drawerTable);case'print-drawer':markExported();return Z.printTables([S.drawerTable],S.analysis.metadata.name,subtitle());case'note-class':S.noteClass=target.dataset.class;return go('notes');case'edit-note':S.confirmDeleteNote='';return editNote(target.dataset.id);case'delete-note':{const id=target.dataset.id;if(S.confirmDeleteNote!==id){S.confirmDeleteNote=id;renderNotes();Z.notice('再次点击“确认删除”将永久删除该条教研记录。');return;}await Z.api('/api/notes/'+encodeURIComponent(id)+'/delete',{});S.confirmDeleteNote='';S.notes=(await Z.api('/api/notes?exam_id='+encodeURIComponent(S.examId))).notes||[];renderNotes();Z.notice('教研记录已删除。');return;}case'report-tab':S.tableId=target.dataset.table;S.reportSearch='';S.page=0;return renderReports();case'copy-report':return Z.copyTable(reportTable());case'csv-report':{const table=reportTable();markExported();return Z.downloadTable(table,`${S.analysis.metadata.name}_${table.title}.csv`);}case'print-report':markExported();return Z.printTables([reportTable()],S.analysis.metadata.name,subtitle());case'print-all':markExported();return Z.printTables(S.analysis.tables,S.analysis.metadata.name,subtitle());case'xlsx':markExported();return Z.downloadWorkbook(S.analysis);case'save-import':return saveImport();case'save-drawer-import':return saveImport('drawer-');case'discard-import':readImportMeta();S.pending=null;S.pendingHygiene=null;return renderData();case'discard-drawer-import':readImportMeta('drawer-');S.pending=null;S.pendingHygiene=null;return refreshImportDrawer();case'edit-exam':return editExam(target.dataset.id);case'rules':return rules(target.dataset.id||S.examId);case'rule-mark-preset':return applyRuleMarkPreset(target.dataset.preset);case'all-classes':$('rules-form')?.querySelectorAll('[name="classes"]').forEach(x=>x.checked=true);return;case'twenty-classes':$('rules-form')?.querySelectorAll('[name="classes"]').forEach(x=>x.checked=Number(x.value)>=1&&Number(x.value)<=20);return;case'archive':await Z.api('/api/exams/'+encodeURIComponent(target.dataset.id)+'/archive',{});S.analysis=null;S.confirmDeleteExam='';await loadExams();await loadView();Z.notice('考试已归档，可在下方恢复。');return;case'restore-exam':await Z.api('/api/exams/'+encodeURIComponent(target.dataset.id)+'/restore',{});S.confirmDeleteExam='';await loadExams();await loadView();Z.notice('考试已恢复。');return;case'delete-exam':{const id=target.dataset.id;if(S.confirmDeleteExam!==id){S.confirmDeleteExam=id;renderData();Z.notice('再次点击“确认删除”将永久删除该已归档考试及其教研记录。');return;}await Z.api('/api/exams/'+encodeURIComponent(id)+'/delete',{});S.confirmDeleteExam='';await loadExams();await loadView();Z.notice('已归档考试已彻底删除。');return;}case'choose-backup':$('backup-file').click();return;case's3-config':return openS3ConfigDrawer();case's3-test':return testS3Config();case's3-clear':{const res=await Z.api('/api/s3/config',{clear:true});S.s3={config:res.config,status:res.status};closeDrawer();if(S.view==='data')renderData();Z.notice('已清除本机 S3 连接配置。');return;}case's3-backup':return backupToS3(false);case's3-backup-drawer':return backupToS3(true);case's3-snapshots':return openS3SnapshotsDrawer();case's3-diff':return previewS3Diff(target.dataset.key);case's3-diff-close':S.s3Diff=null;$('drawer-content').innerHTML=window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots,S.s3?.config,S.confirmDeleteS3,null);return;case's3-restore':return restoreFromS3(target.dataset.key,target.dataset.mode||'smart_merge');case's3-delete':{const key=target.dataset.key;if(S.confirmDeleteS3!==key){S.confirmDeleteS3=key;$('drawer-content').innerHTML=window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots,S.s3?.config,S.confirmDeleteS3,S.s3Diff);Z.notice('再次点击“确认删除”将从云端永久删除该快照。');return;}await Z.api('/api/s3/delete',{key});S.confirmDeleteS3='';const listRes=await Z.api('/api/s3/backups');S.s3Snapshots=listRes.snapshots||[];$('drawer-content').innerHTML=window.LeaderS3.snapshotsDrawerHTML(S.s3Snapshots,S.s3?.config,'',S.s3Diff);Z.notice('云端快照已删除。');return;}case'history':{const error=$('history-error');if(error)error.hidden=true;if(!S.historySelection.length){if(error){error.textContent='请至少选择一场考试。';error.hidden=false;}return;}if(S.historySelection.length<2&&S.trends?.exams?.length>1){if(error){error.textContent='请至少选择两场考试，再生成成长轨迹。';error.hidden=false;}return;}const selectedWeights={};for(const id of S.historySelection){if(S.weights[id]!==undefined){const value=Number(S.weights[id]);if(!Number.isFinite(value)||value<=0||value>1000){if(error){error.textContent='考试权重必须大于0且不超过1000。';error.hidden=false;}return;}selectedWeights[id]=value;}}S.history=await Z.api('/api/history',{grade:metadata().grade,exam_ids:S.historySelection,weights:selectedWeights});S.historyPage=0;return renderTrends();}case'copy-history':return Z.copyTable(historyTable());case'csv-history':return Z.downloadTable(historyTable(),`${metadata().grade||'历次'}_综合名次.csv`);case'open-teachers':return openTeachersDrawer();case'open-batch-print':if(!S.brief)return;return openDrawer('批量打印全年级班情报告',`${S.brief.meta.grade} · ${S.brief.meta.exam_name}`,window.LeaderBrief.batchPrintDrawerHTML(S.brief),'batch-print');case'open-print-studio':return openPrintStudioDrawer();case'studio-preset':{const p=window.LeaderPrintStudio?.PRESETS?.[target.dataset.preset];if(!p)return;S.printStudio={...S.printStudio,preset:p.id,enabled:[...p.enabled],order:[...p.order],m4Filter:p.m4Filter,m4Sort:p.m4Sort,m4PageBreak:p.m4PageBreak,m6Variant:p.m6Variant,m7Ratio:p.m7Ratio,m10Filter:p.m10Filter||'all',m10Sort:p.m10Sort||'surname',m10PageBreak:p.m10PageBreak!==false,m10IncludeGroups:!!p.m10IncludeGroups};refreshPrintStudioDrawer();return;}case'studio-select-all':{if(!window.LeaderPrintStudio)return;S.printStudio={...S.printStudio,preset:'custom',enabled:window.LeaderPrintStudio.MODULES.map(m=>m.id)};refreshPrintStudioDrawer();return;}case'studio-move':{const modId=target.dataset.mod,dir=Number(target.dataset.dir);const ord=[...(S.printStudio?.order||[])];const i=ord.indexOf(modId),j=i+dir;if(i<0||j<0||j>=ord.length)return;[ord[i],ord[j]]=[ord[j],ord[i]];S.printStudio={...S.printStudio,preset:'custom',order:ord};refreshPrintStudioDrawer();return;}case'studio-print':return executePrintStudio();case'brief-lvl-tab':S.briefLevelTab=target.dataset.tab||'dist';return renderBrief();case'brief-lvl-filter':S.briefLevelFilter=target.dataset.filter||'all';return renderBrief();case'brief-lvl-subject':S.briefLevelSubject=target.dataset.subject||'';return renderBrief();case'copy-brief-levers':if(S.brief&&window.LeaderLevels)return Z.copyTable(window.LeaderLevels.leversTableObj(S.brief,S.briefLevelFilter));return;case'csv-brief-levers':if(S.brief&&window.LeaderLevels){const t=window.LeaderLevels.leversTableObj(S.brief,S.briefLevelFilter);markExported();return Z.downloadTable(t,`${t.title}.csv`);}return;case'print-brief-levers':if(S.brief&&window.LeaderPrintStudio){markExported();return window.LeaderPrintStudio.printSingleLevers(S.brief,S.briefLevelFilter,S.briefLevelSort||'surname');}return;case'print-teacher-safe':if(S.brief&&window.LeaderPrintStudio){markExported();return window.LeaderPrintStudio.printTeacherSafePacket(S.brief);}return;case'print-subject-groups':if(S.brief&&window.LeaderLevels){markExported();return window.LeaderLevels.printSubjectGroups(S.brief,target.dataset.subject);}return;case'brief-comp-filter':S.briefCompFilter=target.dataset.filter||'all';return renderBrief();case'copy-brief-comp':if(S.brief&&window.LeaderPrintStudio)return Z.copyTable(window.LeaderPrintStudio.comparisonTableObj(S.brief,S.briefCompFilter,S.briefCompSort));return;case'csv-brief-comp':if(S.brief&&window.LeaderPrintStudio){const t=window.LeaderPrintStudio.comparisonTableObj(S.brief,S.briefCompFilter,S.briefCompSort);markExported();return Z.downloadTable(t,`${t.title}.csv`);}return;case'print-brief-comp':if(S.brief&&window.LeaderPrintStudio){markExported();return window.LeaderPrintStudio.printSingleComparison(S.brief,S.briefCompFilter,S.briefCompSort);}return;case'batch-print-run':return runBatchPrint(target.dataset.kind,target.dataset.ratio);case'print-brief-card':if(S.brief){markExported();return window.LeaderBrief.printBriefs(S.brief,'card');}return;case'print-tpl1-leader':if(S.brief){markExported();return window.LeaderBrief.printBriefs(S.brief,'tpl1-leader');}return;case'print-tpl1-teacher':if(S.brief){markExported();return window.LeaderBrief.printBriefs(S.brief,'tpl1-teacher');}return;case'print-tpl2':if(S.brief){markExported();return window.LeaderBrief.printBriefs(S.brief,'tpl2',S.briefTpl2Ratio);}return;case'brief-prev-class':case'brief-next-class':{if(!S.brief)return;const list=S.brief.meta.classes||[],idx=list.indexOf(S.brief.meta.class);const next=name==='brief-prev-class'?list[idx-1]:list[idx+1];if(!next)return;S.briefClass=next;await loadBrief();renderBrief();return;}case'save-brief-ratios':{if(!S.examId||!S.analysis)return;const nextRules={...(S.analysis.rules||{}),high_ratio:S.briefHighRatio,main_ratio:S.briefMainRatio};await Z.api('/api/exams/'+encodeURIComponent(S.examId)+'/rules',{rules:nextRules});S.analysis=null;S.briefRatioOverride=false;await ensureAnalysis();await loadBrief();renderBrief();Z.notice('已将当前双线比例保存为本场考试口径。');return;}case'brief-list-tab':S.briefListTab=target.dataset.tab;return renderBrief();case'brief-tpl-tab':S.briefTemplateTab=target.dataset.tab;return renderBrief();case'copy-brief-list':if(S.brief)return Z.copyTable(window.LeaderBrief.actionListTable(S.brief,S.briefListTab));return;case'csv-brief-list':if(S.brief){const t=window.LeaderBrief.actionListTable(S.brief,S.briefListTab);markExported();return Z.downloadTable(t,`${t.title}.csv`);}return;case'open-class-brief':S.briefClass=target.dataset.class;return go('brief');case'page':if(target.dataset.type==='history'){S.historyPage=Math.max(0,S.historyPage+Number(target.dataset.direction));renderTrends();}else{S.page=Math.max(0,S.page+Number(target.dataset.direction));render();}return;}}
  document.addEventListener('click',event=>{if(!event.target.closest('#global-stu-search'))hideGlobalSearchDropdown();document.querySelectorAll('.print-menu[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('[data-action]'))menu.open=false;});const editCell=event.target.closest('td[data-edit-cell]');if(editCell&&!event.target.closest('.score-inline-editor')){activateScoreCellEditor(editCell);return;}const target=event.target.closest('[data-action]');if(!target)return;event.preventDefault();const name=target.dataset.action;run(target,()=>action(name,target),name==='save-import'?'import-error':name==='history'?'history-error':name==='rule-mark-preset'?'rules-error':name==='multi-commit'?'multi-commit-error':name==='studio-print'?'studio-error':name==='s3-test'||name==='s3-clear'?'s3-config-error':name==='s3-restore'||name==='s3-diff'||name==='s3-delete'||name==='s3-backup-drawer'?'s3-snap-error':name==='score-edit-confirm-revoke'?'score-edit-error':name==='score-exam-publish'||name==='score-exam-unlock'?'score-edits-drawer-error':null);});
  document.addEventListener('submit',event=>{if(!['import-form','drawer-import-form','multi-inspect-form','student-cards-form','rules-form','note-form','exam-meta-form','edit-note-form','teacher-import-form','teacher-edit-form','s3-config-form','student-profile-note-form','score-edit-confirm-form'].includes(event.target.id))return;event.preventDefault();const form=event.target,submit=form.querySelector('[type="submit"]');const target=form.id==='import-form'?'import-error':form.id==='drawer-import-form'?'drawer-import-error':form.id==='multi-inspect-form'?'multi-inspect-error':form.id==='student-cards-form'?'cards-error':form.id==='rules-form'?'rules-error':form.id==='exam-meta-form'?'exam-meta-error':form.id==='edit-note-form'?'edit-note-error':form.id==='teacher-import-form'?'teacher-import-error':form.id==='teacher-edit-form'?'teacher-edit-error':form.id==='s3-config-form'?'s3-config-error':form.id==='student-profile-note-form'?'profile-note-error':form.id==='score-edit-confirm-form'?'score-edit-error':'note-error';$(target).hidden=true;run(submit,()=>form.id==='import-form'?importFile(form):form.id==='drawer-import-form'?importFile(form,'drawer-'):form.id==='multi-inspect-form'?inspectMultiFile():form.id==='student-cards-form'?generateStudentCards(form):form.id==='rules-form'?saveRules(form):form.id==='exam-meta-form'?saveExamMeta(form):form.id==='edit-note-form'?updateNote(form):form.id==='teacher-import-form'?importTeachersFile():form.id==='teacher-edit-form'?saveTeachersEdit(form):form.id==='s3-config-form'?saveS3Config(form):form.id==='student-profile-note-form'?saveProfileNote(form):form.id==='score-edit-confirm-form'?confirmScoreEdits(form):saveNote(form),target);});
  document.addEventListener('change',event=>{const t=event.target;if(t.id==='exam-select'){S.examId=t.value;S.analysis=null;S.brief=null;S.briefCompareExamId='';S.briefRatioOverride=false;S.stagedEdits={};S.pendingImportEdits=null;S.page=0;S.studentClass='';persist();run(null,loadView);}else if(t.id==='subject-select'){S.subject=t.value;S.page=0;renderCompare();}else if(t.id==='student-class'){S.studentClass=t.value;S.page=0;renderCompare();}else if(t.id==='brief-class'){S.briefClass=t.value;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-compare-exam'){S.briefCompareExamId=t.value;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-comp-sort'){S.briefCompSort=t.value;renderBrief();}else if(t.dataset.studioMod){const id=t.dataset.studioMod,set=new Set(S.printStudio?.enabled||[]);if(t.checked)set.add(id);else set.delete(id);S.printStudio={...S.printStudio,preset:'custom',enabled:[...set]};refreshPrintStudioDrawer();}else if(t.dataset.promptOpt){const k=t.dataset.promptOpt;if(S.drawerType==='student-prompt'){S.studentPromptOpts={...S.studentPromptOpts,[k]:t.checked};}else{S.promptOpts={...S.promptOpts,[k]:t.checked};}refreshPromptDrawer();}else if(t.dataset.studioOpt){const k=t.dataset.studioOpt;S.printStudio={...S.printStudio,preset:'custom',[k]:t.type==='checkbox'?t.checked:t.value};window.LeaderPrintStudio?.saveConfig(S.printStudio);}else if(t.id==='brief-high-ratio'){S.briefHighRatio=Number(t.value);S.briefRatioOverride=true;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-main-ratio'){S.briefMainRatio=Number(t.value);S.briefRatioOverride=true;run(null,async()=>{await loadBrief();renderBrief();});}else if(t.id==='brief-tpl2-ratio'){S.briefTpl2Ratio=t.value;renderBrief();}else if(t.id==='class-trend-metric'){S.classTrendMetric=t.value;renderTrends();}else if(t.dataset.historyExam!==undefined){S.historySelection=[...document.querySelectorAll('[data-history-exam]:checked')].map(x=>x.value);S.history=null;S.historyPage=0;renderTrends();}else if(t.dataset.weight!==undefined){if(t.value.trim()==='')delete S.weights[t.dataset.weight];else S.weights[t.dataset.weight]=Number(t.value);}else if(t.id==='score-edits-import-file'&&t.files[0]){const f=t.files[0];t.value='';run(null,()=>importScoreEditsFile(f),'score-edits-drawer-error');}else if(t.id==='backup-file'&&t.files[0]){run(null,async()=>{let backup;try{backup=JSON.parse(await t.files[0].text());}catch(_){throw new Error('备份文件不是有效的 JSON，请选择由本软件导出的备份。');}const result=await Z.api('/api/restore',{backup});S.analysis=null;await loadExams();await loadView();Z.notice(`备份恢复完成，处理 ${result.count} 场考试。`);},'backup-result');}});
  const searchFields={'class-search':'classSearch','student-search':'studentSearch','report-search':'reportSearch','history-search':'historySearch'};
  document.addEventListener('compositionstart',event=>{if(searchFields[event.target.id])composing=true;});
  document.addEventListener('compositionend',event=>{const key=searchFields[event.target.id];if(!key)return;composing=false;S[key]=event.target.value;S.page=0;S.historyPage=0;clearTimeout(inputTimer);render();});
  document.addEventListener('input',event=>{const t=event.target;if(t.id==='score-edit-reason'){const btnEl=$('score-edit-confirm-btn');if(btnEl){const mode=$('score-edit-confirm-form')?.dataset.mode||'save';const cnt=mode==='import'?(S.pendingImportEdits||[]).length:Object.keys(S.stagedEdits||{}).length;btnEl.disabled=!t.value.trim()||cnt<=0;}return;}if(t.id==='global-student-input'){clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(()=>runGlobalStudentSearch(t.value),160);return;}if(t.id==='note-text'){S.noteDraft=t.value;return;}if(['import-name','import-grade','import-date'].includes(t.id)){readImportMeta();return;}if(['drawer-import-name','drawer-import-grade','drawer-import-date'].includes(t.id)){readImportMeta('drawer-');return;}if(searchFields[t.id]){if(composing)return;S[searchFields[t.id]]=t.value;S.page=0;S.historyPage=0;clearTimeout(inputTimer);inputTimer=setTimeout(render,170);}});
  $('drawer-overlay').addEventListener('click',event=>{if(event.target===$('drawer-overlay'))closeDrawer();});
  document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();const inp=$('global-student-input');if(inp){inp.focus();inp.select();}return;}if(event.key==='Enter'&&event.target.id==='global-student-input'){const first=$('global-student-results')?.querySelector('.global-stu-item');if(first){event.preventDefault();first.click();}return;}if(event.key==='Enter'&&event.target.matches('td[data-edit-cell]')&&!event.target.querySelector('.score-inline-editor')){event.preventDefault();activateScoreCellEditor(event.target);return;}if(event.key==='Enter'&&event.target.matches('tr[data-action]')){event.preventDefault();run(null,()=>action(event.target.dataset.action,event.target));}if(event.key==='Escape'){hideGlobalSearchDropdown();if(!$('drawer-overlay').hidden)closeDrawer();else if(S.presentation){S.presentation=false;persist();header();}}if(event.key==='Tab'&&!$('drawer-overlay').hidden){const list=[...$('drawer-overlay').querySelectorAll('button:not([disabled]),input,select,textarea,a[href],tr[tabindex]')].filter(x=>!x.hidden&&x.offsetParent!==null);const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  Z.bindShutdown($('shutdown-button'));
  header();run(null,async()=>{await loadExams();await loadView();if(queryAction==='abc'&&S.analysis)openAbcExportDrawer();if(queryExam||queryView||queryAction){history.replaceState(null,'',location.pathname);if(queryExam&&!S.exams.some(x=>x.id===queryExam))Z.notice('链接中的考试未在当前档案中找到，请在数据管理中查看是否已归档。',true);}});
})();

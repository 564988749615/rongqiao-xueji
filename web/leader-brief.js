'use strict';
/* 融侨学迹 · 20%/40% 双线班情分析、教师映射与四套真实打印模板 */
(() => {
  const e = value => Z.escape(value);
  const n = (value, digits = 1) => Z.num(value, digits);
  const signed = (value, digits = 0, suffix = '') => {
    if (value === null || value === undefined || value === '') return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    if (num === 0) return `0${suffix}`;
    return `${num > 0 ? '+' : ''}${n(num, digits)}${suffix}`;
  };
  const pctText = v => (v === null || v === undefined ? '—' : `${n(v, 1)}%`);
  const option = (value, label, chosen) => `<option value="${e(value)}"${String(value) === String(chosen) ? ' selected' : ''}>${e(label)}</option>`;
  const btn = (label, action, attrs = '', style = 'secondary') => `<button class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;

  function dualTimelineSVG(timeline, highRatio, mainRatio) {
    if (!timeline || timeline.length < 2) {
      return '<p class="muted">导入同一届的多场考试后，这里会展示前20%与前40%占比的双线走势。</p>';
    }
    const width = 620, height = 220, padLeft = 48, padRight = 28, plotLeft = padLeft + 22, plotRight = width - padRight;
    const topY = 26, bottomY = height - 42;
    const hVals = timeline.map(x => x.high_rate ?? 0);
    const mVals = timeline.map(x => x.main_rate ?? 0);
    const maxVal = Math.max(55, Math.ceil((Math.max(...hVals, ...mVals, mainRatio * 100) + 8) / 10) * 10);
    const yFor = val => bottomY - (val / maxVal) * (bottomY - topY);
    const xFor = i => plotLeft + i * (plotRight - plotLeft) / (timeline.length - 1);

    const hPts = timeline.map((x, i) => [xFor(i), yFor(x.high_rate ?? 0)]);
    const mPts = timeline.map((x, i) => [xFor(i), yFor(x.main_rate ?? 0)]);
    const gridTicks = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const val = Math.round(maxVal * t);
      const y = yFor(val);
      return `<line class="axis" x1="${padLeft}" y1="${y}" x2="${plotRight}" y2="${y}"/><text x="${padLeft - 6}" y="${y + 4}" text-anchor="end">${val}%</text>`;
    }).join('');
    const refLines = [
      { val: highRatio * 100, color: '#3e785f' },
      { val: mainRatio * 100, color: '#8061b5' },
    ].map(r => `<line x1="${padLeft}" y1="${yFor(r.val)}" x2="${plotRight}" y2="${yFor(r.val)}" stroke="${r.color}" stroke-dasharray="4 4" stroke-opacity="0.35"/>`).join('');

    const hDots = hPts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff" stroke="#3e785f" stroke-width="2.5"><title>${e(timeline[i].name)} 前${Math.round(highRatio * 100)}%：${timeline[i].high_count}人（${pctText(timeline[i].high_rate)}）</title></circle><text x="${x}" y="${y + 15}" text-anchor="middle" fill="#3e785f">${n(timeline[i].high_rate, 0)}%</text>`).join('');
    const mDots = mPts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff" stroke="#8061b5" stroke-width="2.5"><title>${e(timeline[i].name)} 前${Math.round(mainRatio * 100)}%：${timeline[i].main_count}人（${pctText(timeline[i].main_rate)}）</title></circle><text x="${x}" y="${y - 10}" text-anchor="middle" fill="#684792">${n(timeline[i].main_rate, 0)}%</text>`).join('');
    const xLabels = timeline.map((item, i) => `<text x="${xFor(i)}" y="${height - 12}" text-anchor="middle">${e(item.name.slice(0, 7))}</text>`).join('');
    return `<div class="brief-legend"><span><i style="background:#8061b5"></i>前${Math.round(mainRatio * 100)}%占比（虚线为年级均值）</span><span><i style="background:#3e785f"></i>前${Math.round(highRatio * 100)}%占比</span></div><svg class="mini-chart brief-dual-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="历次双线占比趋势">${gridTicks}${refLines}<polyline fill="none" stroke="#8061b5" stroke-width="2.6" points="${mPts.map(p => p.join(',')).join(' ')}"/><polyline fill="none" stroke="#3e785f" stroke-width="2.6" points="${hPts.map(p => p.join(',')).join(' ')}"/>${mDots}${hDots}${xLabels}</svg>`;
  }

  function actionListTable(brief, tab) {
    const lists = brief.action_lists || {};
    const hLabel = brief.headline.high.label, mLabel = brief.headline.main.label;
    if (tab === 'high' || tab === 'main') {
      const items = tab === 'high' ? (lists.borderline_high || []) : (lists.borderline_main || []);
      const label = tab === 'high' ? hLabel : mLabel;
      return {
        title: `${brief.meta.class}班 · 冲${label}临界与单科跛脚名单`,
        columns: ['姓名', '总分', '年级名次', `距${label}线差`, '类型', '未达该线学科（缺口分）'],
        rows: items.map(s => [
          s.name,
          s.total,
          s.rank,
          s.score_gap,
          s.single_lame ? '单科跛脚（速提）' : `${s.missing_subjects.length}科未达`,
          s.missing_subjects.map(m => `${m.subject}${m.gap != null ? `(-${n(m.gap, 1)})` : '(缺)'}`).join('、') || '各科均已达线',
        ]),
        note: `${brief.meta.grade} · ${brief.meta.exam_name} · ${brief.meta.class}班 · 按优先单科跛脚、分差由小到大排序`,
      };
    }
    if (tab === 'drop') {
      const items = lists.drop_alerts || [];
      return {
        title: `${brief.meta.class}班 · 掉出双线失血预警名单`,
        columns: ['姓名', '上次层级', '本次层级', '上次名次', '本次名次', '名次退步', '骤降学科'],
        rows: items.map(s => [
          s.name,
          s.prev_tier,
          s.curr_tier,
          s.prev_rank,
          s.curr_rank,
          s.rank_drop != null ? `+${s.rank_drop}` : '—',
          (s.biggest_drop_subjects || []).map(d => `${d.subject}(退${d.drop}名)`).join('、') || '—',
        ]),
        note: `${brief.meta.grade} · ${brief.meta.exam_name} · 较上一场考试掉出${hLabel}或${mLabel}线的学生`,
      };
    }
    if (tab === 'mentor') {
      const items = lists.mentor_list || [];
      const mr = brief.meta.mentor_range;
      const rangeText = mr ? `${mr[0]}-${mr[1]}名` : '未启用';
      return {
        title: `${brief.meta.class}班 · 导师制名单（${rangeText}）`,
        columns: ['姓名', '总分', '年级名次', '班内名次', '优先关注薄弱科'],
        rows: items.map(s => [s.name, s.total, s.rank, s.class_rank, (s.weak || []).join('、') || '—']),
        note: `${brief.meta.grade} · ${brief.meta.exam_name} · ${brief.meta.class}班 · 总分名次区间 ${rangeText}`,
      };
    }
    const items = lists.persistent_weak || [];
    return {
      title: `${brief.meta.class}班 · 连续顽固偏科名单`,
      columns: ['姓名', '本次总分', '年级名次', '顽固弱科', '连续命中次数', '本次该科分', '本次单科名次'],
      rows: items.map(s => [s.name, s.total, s.rank, s.subject, `${s.hits}/${s.exams_checked}次`, s.curr_score, s.curr_sub_rank]),
      note: `${brief.meta.grade} · 最近最多3场考试中至少2次位列前两弱科的学科`,
    };
  }

  function renderActionListsHTML(brief, activeTab) {
    const lists = brief.action_lists || {};
    const hLabel = brief.headline.high.label, mLabel = brief.headline.main.label;
    const mr = brief.meta.mentor_range;
    const mentorLabel = mr ? `导师制 ${mr[0]}-${mr[1]} (${(lists.mentor_list || []).length})` : `导师制 (${(lists.mentor_list || []).length})`;
    const tabs = [
      ['high', `冲${hLabel}临界 (${(lists.borderline_high || []).length})`],
      ['main', `保冲${mLabel}临界 (${(lists.borderline_main || []).length})`],
      ['mentor', mentorLabel],
      ['drop', `掉线失血预警 (${(lists.drop_alerts || []).length})`],
      ['weak', `顽固偏科与突围 (${(lists.persistent_weak || []).length} / ${(lists.breakthroughs || []).length})`],
    ];
    let bodyHTML = '';
    if (activeTab === 'high' || activeTab === 'main') {
      const items = activeTab === 'high' ? (lists.borderline_high || []) : (lists.borderline_main || []);
      const label = activeTab === 'high' ? hLabel : mLabel;
      bodyHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th class="number">总分</th><th class="number">年级名次</th><th class="number">距${e(label)}线</th><th>诊断标签</th><th>未达${e(label)}线学科（分差）</th></tr></thead><tbody>${items.map(s => `<tr><td><strong>${e(s.name)}</strong></td><td class="number">${n(s.total)}</td><td class="number">${n(s.rank, 0)}</td><td class="number delta-negative">-${n(s.score_gap)}分</td><td>${s.single_lame ? '<span class="badge warning">单科跛脚 · 优先认领</span>' : `<span class="badge">${s.missing_subjects.length}科待补</span>`}</td><td>${e(s.missing_subjects.map(m => `${m.subject}${m.gap != null ? `(-${n(m.gap, 1)})` : '(缺)'}`).join('、') || '各科均达线')}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">当前范围下没有落入冲${e(label)}临界区间的学生。</p>`;
    } else if (activeTab === 'mentor') {
      const items = lists.mentor_list || [];
      bodyHTML = !mr
        ? '<p class="muted">当前未启用导师制名次区间，可在「调整统计口径 → 常用口径」中设置（如 180-300）。</p>'
        : items.length
          ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th class="number">总分</th><th class="number">年级名次</th><th class="number">班内名次</th><th>优先关注薄弱科</th></tr></thead><tbody>${items.map(s => `<tr><td><strong>${e(s.name)}</strong></td><td class="number">${n(s.total)}</td><td class="number">${n(s.rank, 0)}</td><td class="number">${n(s.class_rank, 0)}</td><td>${e((s.weak || []).join('、') || '—')}</td></tr>`).join('')}</tbody></table></div>`
          : `<p class="muted">本班在总分名次 ${mr[0]}–${mr[1]} 区间内暂无学生。</p>`;
    } else if (activeTab === 'drop') {
      const items = lists.drop_alerts || [];
      bodyHTML = !brief.flow.available
        ? `<div class="support-note">${e(brief.flow.reason)}</div>`
        : items.length
          ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th>上次层级</th><th>本次层级</th><th class="number">上次名次</th><th class="number">本次名次</th><th class="number">退步</th><th>骤降学科</th></tr></thead><tbody>${items.map(s => `<tr><td><strong>${e(s.name)}</strong></td><td>${e(s.prev_tier)}</td><td><span class="badge warning">${e(s.curr_tier)}</span></td><td class="number">${n(s.prev_rank, 0)}</td><td class="number">${n(s.curr_rank, 0)}</td><td class="number delta-negative">${s.rank_drop != null ? `退${s.rank_drop}名` : '—'}</td><td>${e((s.biggest_drop_subjects || []).map(d => `${d.subject}(退${d.drop}名)`).join('、') || '—')}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">本班较上次没有掉出双线的学生，守线稳健。</p>';
    } else {
      const weak = lists.persistent_weak || [], rise = lists.breakthroughs || [];
      bodyHTML = `<div class="two-col"><div><h3 style="margin:0 0 10px">连续顽固偏科</h3>${weak.length ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th class="number">名次</th><th>顽固弱科</th><th>命中</th></tr></thead><tbody>${weak.map(s => `<tr><td>${e(s.name)}</td><td class="number">${n(s.rank, 0)}</td><td><span class="badge warning">${e(s.subject)}</span></td><td>${s.hits}/${s.exams_checked}次</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">需至少两场同年级含稳定身份的考试才能识别连续弱科。</p>'}</div><div><h3 style="margin:0 0 10px">临界突围表扬名单</h3>${rise.length ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th>突破</th><th class="number">上次→本次</th><th class="number">进步</th></tr></thead><tbody>${rise.map(s => `<tr><td>${e(s.name)}</td><td><span class="badge success">${e(s.target)}</span></td><td class="number">${n(s.prev_rank, 0)}→${n(s.curr_rank, 0)}</td><td class="number delta-positive">${s.rank_gain != null ? `+${s.rank_gain}名` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无较上次跨线突围记录。</p>'}</div></div>`;
    }
    return `<div class="tab-strip" style="margin-top:0;margin-bottom:14px">${tabs.map(([id, label]) => `<button data-action="brief-list-tab" data-tab="${id}" class="${activeTab === id ? 'active' : ''}">${e(label)}</button>`).join('')}</div>${bodyHTML}`;
  }

  /* ---- Template 1: 历次单科纵向对比（领导版 50-800 / 教师版 200-800） ---- */
  function template1HTML(brief, mode = 'leader') {
    const cols = mode === 'teacher' ? brief.template_columns.teacher_top : brief.template_columns.leader_top;
    const subjects = ['总分', ...(brief.meta.all_subjects || [])];
    const blocks = subjects.map(sub => {
      const rows = brief.timeline.map(item => {
        const isTotal = sub === '总分';
        const teacher = isTotal ? (item.homeroom || '') : (item.subjects[sub]?.teacher || '');
        const hasData = isTotal ? item.participants > 0 : Boolean(item.subjects[sub]);
        const nums = cols.map(k => {
          if (!hasData) return '';
          const v = isTotal ? item.top_total[String(k)] : item.subjects[sub]?.top?.[String(k)];
          return v === undefined || v === null ? '' : v;
        });
        return `<tr${item.is_current ? ' class="tpl-current-row"' : ''}><td class="center">${item.seq}</td><td>${e(item.name)}</td><td class="center">${e(brief.meta.class)}</td><td class="center">${e(teacher)}</td>${nums.map(v => `<td class="number">${v === '' ? '' : n(v, 0)}</td>`).join('')}</tr>`;
      }).join('');
      return `<div class="tpl-subject-block"><table class="tpl-table tpl1-block"><thead><tr class="tpl-group-row"><th colspan="${4 + cols.length}">${e(sub)}</th></tr><tr><th class="center" style="width:36px">序号</th><th style="width:128px">考试名称</th><th class="center" style="width:44px">班级</th><th class="center" style="width:72px">${sub === '总分' ? '班主任' : '任课教师'}</th>${cols.map(k => `<th class="number">${k}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    const versionText = mode === 'teacher' ? '教师版 · 前200—800名' : '领导版 · 前50—800名';
    return `<div class="tpl-sheet tpl1-sheet">
      <div class="tpl-header-bar">
        <div>
          <div class="print-brand-tag"><span></span>融侨学迹 · 历次纵向数据对比</div>
          <span class="tpl-main-title">${e(brief.meta.grade)}历次单科数据对比（${e(brief.meta.class)}班）</span>
        </div>
        <div class="tpl-meta-right"><strong>${versionText}</strong><small>班主任：${e(brief.meta.homeroom || '未录入')} ｜ 当前：${e(brief.meta.exam_name)}（${e(brief.meta.exam_date)}）</small></div>
      </div>
      ${blocks}
      <div class="tpl-foot"><span>统计口径：名次累计人数（同分并列全纳入） · 高亮行为本次最新考试</span><span>融侨学迹 · 教研分析存档</span></div>
    </div>`;
  }

  /* ---- Template 2: 历次有效分达标/集中 + 本次单科统计 + 本班薄弱学科 ---- */
  function template2HTML(brief, ratioMode = 'main') {
    const subjects = brief.meta.all_subjects || [];
    const ratioLabel = ratioMode === 'high'
      ? `${Math.round(brief.meta.high_ratio * 100)}%`
      : ratioMode === 'mid30' ? '30%' : `${Math.round(brief.meta.main_ratio * 100)}%`;
    const countKey = ratioMode === 'high' ? 'high_count' : ratioMode === 'mid30' ? 'mid30_count' : 'main_count';
    const achKey = ratioMode === 'high' ? 'high_achievers' : ratioMode === 'mid30' ? 'mid30_achievers' : 'main_achievers';
    const concKey = ratioMode === 'high' ? 'high_concentrated' : ratioMode === 'mid30' ? 'mid30_concentrated' : 'main_concentrated';

    const topRows = brief.timeline.map(item => {
      const subCells = subjects.map(sub => {
        const s = item.subjects[sub];
        if (!s) return '<td class="grp-start"></td><td></td><td></td>';
        return `<td class="center grp-start">${e(s.teacher || '')}</td><td class="number">${n(s[achKey], 0)}</td><td class="number">${n(s[concKey], 0)}</td>`;
      }).join('');
      return `<tr${item.is_current ? ' class="tpl-current-row"' : ''}><td class="center">${item.seq}</td><td>${e(item.name)}</td><td class="center">${e(brief.meta.class)}</td><td class="center">${e(item.homeroom || '')}</td><td class="number">${n(item.participants, 0)}</td><td class="number"><strong>${n(item[countKey], 0)}</strong></td>${subCells}</tr>`;
    }).join('');

    const matrix = brief.current_subject_matrix || { subjects: [], rows: [] };
    const matrixHTML = `<table class="tpl-table"><thead><tr class="tpl-group-row"><th colspan="${1 + matrix.subjects.length}">${e(brief.meta.exam_name)}单科统计（${e(brief.meta.class)}班）</th></tr><tr><th>统计项目</th>${matrix.subjects.map(s => `<th class="number">${e(s)}</th>`).join('')}</tr></thead><tbody>${matrix.rows.map(r => `<tr><td>${e(r[0])}</td>${r.slice(1).map(v => `<td class="number">${r[0] === '平均分' ? n(v, 1) : n(v, 0)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    const weakRows = brief.current_weak_summary || [];
    const weakHTML = `<table class="tpl-table"><thead><tr class="tpl-group-row"><th colspan="${2 + matrix.subjects.length}">${e(brief.meta.class)}班 ${e(brief.meta.exam_name)}薄弱学科统计</th></tr><tr><th class="center">班级</th>${matrix.subjects.map(s => `<th class="number">${e(s)}</th>`).join('')}<th class="number">名次范围</th></tr></thead><tbody>${weakRows.map(w => `<tr><td class="center">${e(brief.meta.class)}</td>${matrix.subjects.map(s => `<td class="number">${n(w.counts[s] ?? 0, 0)}</td>`).join('')}<td class="number"><strong>前${w.cutoff}名</strong></td></tr>`).join('')}</tbody></table>`;

    return `<div class="tpl-sheet tpl2-sheet">
      <div class="tpl-header-bar">
        <div>
          <div class="print-brand-tag"><span></span>融侨学迹 · 有效分与薄弱学科分析</div>
          <span class="tpl-main-title">${e(brief.meta.grade)} · ${e(brief.meta.class)}班 有效分达标集中与单科薄弱汇总</span>
        </div>
        <div class="tpl-meta-right"><strong>达标线口径：前${e(ratioLabel)}</strong><small>班主任：${e(brief.meta.homeroom || '未录入')} ｜ 当前：${e(brief.meta.exam_name)}（${e(brief.meta.exam_date)}）</small></div>
      </div>
      <div class="table-wrap"><table class="tpl-table tpl2-top"><thead><tr class="tpl-group-row"><th colspan="${6 + subjects.length * 3}">历次测试有效分达标数、集中数（达标率前${e(ratioLabel)}）</th></tr><tr><th rowspan="2" class="center">序号</th><th rowspan="2">考试名称</th><th rowspan="2" class="center">班级</th><th rowspan="2" class="center">班主任</th><th rowspan="2" class="number">参考<br>人数</th><th rowspan="2" class="number">优生<br>人数</th>${subjects.map(s => `<th colspan="3" class="center grp-start">${e(s)}</th>`).join('')}</tr><tr>${subjects.map(() => '<th class="center grp-start">教师</th><th class="number">达标</th><th class="number">集中</th>').join('')}</tr></thead><tbody>${topRows}</tbody></table></div>
      <div class="tpl2-bottom"><div>${matrixHTML}</div><div>${weakHTML}</div></div>
      <div class="tpl-foot"><span>集中数 = 总分与该科同时达到前${e(ratioLabel)}有效线的人数；薄弱学科按第${n(brief.meta.weak_rank_index || 1, 0)}薄弱统计</span><span>融侨学迹 · 教研分析存档</span></div>
    </div>`;
  }

  /* ---- Print Card: 领导一页纸班情谈话卡（A4 横向一页排版） ---- */
  function leaderCardPrintHTML(brief) {
    const h = brief.headline, m = brief.meta;
    const hL = h.high.label, mL = h.main.label;
    const toneClass = t => (t === 'good' ? 'p-tag-good' : t === 'alert' ? 'p-tag-alert' : t === 'warn' ? 'p-tag-warn' : 'p-tag-flat');
    const signSpan = (v, d = 0) => {
      if (v === null || v === undefined) return '—';
      const cls = v > 0 ? 'p-pos' : v < 0 ? 'p-neg' : 'p-muted';
      return `<span class="${cls}">${signed(v, d)}</span>`;
    };
    const subRows = brief.subject_diagnosis.map(s => {
      const otherText = (s.same_teacher_other_classes || []).map(o => `${o.class}班 ${pctText(o.main_rate)}`).join(' · ');
      return `<tr>
        <td><strong>${e(s.subject)}</strong></td>
        <td class="center">${e(s.teacher || '—')}${s.teacher_changed ? '<span class="p-tag p-tag-warn">换师</span>' : ''}</td>
        <td class="number">${n(s.mean)} <small>(${signSpan(s.mean_diff, 1)})</small></td>
        <td class="number">${n(s.high.achievers, 0)} / ${n(s.high.concentrated, 0)} <small>(${signSpan(s.high.gap, 0)})</small></td>
        <td class="number">${n(s.main.achievers, 0)} / ${n(s.main.concentrated, 0)} <small>(${signSpan(s.main.gap, 0)})</small></td>
        <td class="center"><span class="p-tag ${toneClass(s.mismatch_tone)}">${e(s.mismatch_label)}</span></td>
        <td>${e(otherText || '—')}</td>
      </tr>`;
    }).join('');
    const flow = brief.flow;
    const flowLine = flow.available
      ? `较上次（${e(flow.prev_exam_name)}，跨次匹配 ${flow.matched_count} 人）：<b>${hL}保尖率 ${pctText(flow.high_keep_rate)}</b>（稳住 ${flow.high_keep}/${flow.high_prev} · 掉出 ${flow.high_drop_count} · 冲尖 +${flow.high_rise_count}）｜ <b>${mL}守线率 ${pctText(flow.main_keep_rate)}</b>（稳住 ${flow.main_keep}/${flow.main_prev} · 跌出 ${flow.main_drop_count} · 突围 +${flow.main_rise_count}）`
      : e(flow.reason);
    const bHigh = (brief.action_lists.borderline_high || []).slice(0, 6).map(s => `${s.name}(差${n(s.score_gap)}分:${s.missing_subjects.slice(0, 2).map(x => x.subject).join('/')})`).join('；') || '无';
    const bMain = (brief.action_lists.borderline_main || []).slice(0, 7).map(s => `${s.name}(差${n(s.score_gap)}分:${s.missing_subjects.slice(0, 2).map(x => x.subject).join('/')})`).join('；') || '无';
    const drops = (brief.action_lists.drop_alerts || []).slice(0, 5).map(s => `${s.name}(${s.prev_tier}→${s.curr_tier}${s.biggest_drop_subjects?.length ? ',' + s.biggest_drop_subjects.map(d => `${d.subject}退${d.drop}`).join('/') : ''})`).join('；') || '无';
    const pWeak = (brief.action_lists.persistent_weak || []).slice(0, 5).map(s => `${s.name}(${s.subject} ${s.hits}/${s.exams_checked}次)`).join('；') || '无';
    const mentorItems = brief.action_lists.mentor_list || [];
    const mentorLine = m.mentor_range
      ? `<div><b>导师制（${m.mentor_range[0]}-${m.mentor_range[1]}名，${mentorItems.length}人）：</b>${e(mentorItems.slice(0, 8).map(s => `${s.name}(#${s.rank}${s.weak?.[0] ? '·' + s.weak[0] : ''})`).join('、') || '无')}</div>`
      : '';

    return `<div class="tpl-sheet card-sheet">
      <div class="card-head">
        <div class="card-title-block">
          <div class="print-brand-tag"><span></span>融侨学迹 · 班情分析会议专用</div>
          <h1>${e(m.grade)} · ${e(m.class)}班 班情双线谈话卡</h1>
          <p class="card-meta-line"><span>${e(m.exam_name)}（${e(m.exam_date)}）</span><span>班主任：<strong>${e(m.homeroom || '未录入')}</strong></span><span>实考 ${n(h.participants, 0)}/${n(h.registered, 0)} 人</span><span>标准差 ${n(h.std)}</span><span>后20% ${n(h.bottom20_count, 0)} 人</span></p>
        </div>
        <div class="card-kpis">
          <div class="kpi-green"><small>${e(hL)}尖优（线 ${n(h.high.cutoff)}）</small><b>${n(h.high.count, 0)}人 <em>${pctText(h.high.rate)}</em></b><span>较上次 ${signed(h.high.delta_prev_count, 0)} · 较首考 ${signed(h.high.delta_entry_count, 0)}</span></div>
          <div class="kpi-purple"><small>${e(mL)}基本盘（线 ${n(h.main.cutoff)}）</small><b>${n(h.main.count, 0)}人 <em>${pctText(h.main.rate)}</em></b><span>较上次 ${signed(h.main.delta_prev_count, 0)} · 较首考 ${signed(h.main.delta_entry_count, 0)}</span></div>
          <div><small>尖优含金量 (${e(hL)}÷${e(mL)})</small><b>${pctText(h.elite_ratio)}</b><span>20%–40%蓄水池 ${Math.max(0, (h.main.count || 0) - (h.high.count || 0))} 人</span></div>
          <div><small>总分均分</small><b>${n(h.mean)} <em>${signed(h.mean_diff, 1)}</em></b><span>年级均分 ${n(h.grade_mean)}</span></div>
        </div>
      </div>

      <div class="card-points">
        <div class="card-points-title">班情会核心谈话要点</div>
        <ol>${h.talking_points.map(p => `<li>${e(p)}</li>`).join('')}</ol>
      </div>

      <table class="tpl-table card-sub-table">
        <thead>
          <tr class="tpl-group-row"><th colspan="7">${e(hL)} / ${e(mL)} 双线学科诊断与同师对比</th></tr>
          <tr><th style="width:54px">学科</th><th class="center" style="width:76px">任课教师</th><th class="number" style="width:94px">均分 (离均差)</th><th class="number" style="width:118px">${e(hL)} 达标/集中(差)</th><th class="number" style="width:118px">${e(mL)} 达标/集中(差)</th><th class="center" style="width:108px">双线诊断</th><th>同师另班 (${e(mL)}占比)</th></tr>
        </thead>
        <tbody>${subRows}</tbody>
      </table>

      <div class="card-flow"><strong>跨次人员流动：</strong>${flowLine}</div>

      <div class="card-bottom-grid">
        <div class="card-lists">
          <div class="card-box-title">分层盯人与包干名单</div>
          <div><b>冲${e(hL)}临界：</b>${e(bHigh)}</div>
          <div><b>保冲${e(mL)}临界：</b>${e(bMain)}</div>
          <div><b>掉队失血预警：</b>${e(drops)}</div>
          <div><b>连续顽固偏科：</b>${e(pWeak)}</div>
          ${mentorLine}
        </div>
        <div class="card-notes">
          <div class="card-box-title">班情会纪要与包干落实</div>
          <div class="note-line"><span>核心定性：</span></div>
          <div class="note-line"><span>整改抓手：</span></div>
          <div class="note-line"><span>下阶段目标：</span></div>
          <div class="sign-row"><span>参会领导：______________</span><span>班主任：______________</span><span>日期：____/____</span></div>
        </div>
      </div>
    </div>`;
  }

  function openPrintWindow(title, pagesHTML, landscape = true) {
    const win = window.open('', '_blank');
    if (!win) {
      Z.notice('打印窗口被浏览器拦截，请允许本页面打开新窗口后重试。', true);
      return null;
    }
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(title)} · 融侨学迹</title><style>
      *{box-sizing:border-box}
      body{margin:0;background:#eae8f2;color:#1e1b2e;font:11px/1.44 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .controls{position:sticky;top:0;z-index:30;background:#fff;padding:10px 24px;border-bottom:1px solid #d9d4e5;display:flex;align-items:center;justify-content:space-between;gap:14px;box-shadow:0 2px 10px rgba(30,27,46,.06)}
      .controls-left{display:flex;align-items:center;gap:12px}
      .controls button{font:inherit;padding:7px 18px;border:1px solid #6f4eb8;border-radius:6px;background:#6f4eb8;color:#fff;cursor:pointer;font-weight:600;font-size:12.5px}
      .controls button:hover{background:#573a9b}
      .controls small{color:#69627e;font-size:12px}
      .pages-wrap{padding:20px;display:grid;gap:20px;justify-items:center}
      .print-page{width:${landscape ? '277mm' : '190mm'};max-width:100%;background:#fff;padding:${landscape ? '9mm 10mm' : '10mm 11mm'};border-radius:4px;box-shadow:0 4px 20px rgba(30,27,46,.10);break-before:page;page-break-before:always}
      .print-page:first-of-type{break-before:auto;page-break-before:auto}
      .print-brand-tag{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:650;color:#6f4eb8;letter-spacing:.3px;margin-bottom:2px}
      .print-brand-tag span{display:inline-block;width:6px;height:6px;border-radius:2px;background:#6f4eb8}
      .tpl-header-bar{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:9px;padding-bottom:6px;border-bottom:2px solid #573a9b}
      .tpl-main-title{display:block;font-size:16px;font-weight:700;color:#1e1b2e;line-height:1.25}
      .tpl-meta-right{text-align:right;font-size:10px;color:#5a536e;line-height:1.45}
      .tpl-meta-right strong{display:block;color:#573a9b;font-size:11px}
      .tpl-subject-block{break-inside:avoid;page-break-inside:avoid;margin-bottom:8px}
      .tpl-table{width:100%;border-collapse:collapse;margin-bottom:7px;font-size:10px}
      .tpl-table thead{display:table-header-group}
      .tpl-table tr{break-inside:avoid;page-break-inside:avoid}
      .tpl-table th,.tpl-table td{border:1px solid #bfb8cf;padding:3.5px 5px;text-align:left;vertical-align:middle}
      .tpl-table th{background:#efebf8;font-weight:650;color:#27203d}
      .tpl-table tr.tpl-group-row th{background:#dfd6f2;color:#3d2570;text-align:center;font-size:11px;padding:4px}
      .tpl-table tbody tr:nth-child(even) td{background:#faf9fd}
      .tpl-table td.number,.tpl-table th.number{text-align:right;white-space:nowrap}
      .tpl-table td.center,.tpl-table th.center{text-align:center}
      .tpl-table tr.tpl-current-row td{background:#e9e2f8;font-weight:700}
      .tpl-table tr.tpl-current-row td:first-child{border-left:3px solid #6f4eb8}
      .tpl-table th.grp-start,.tpl-table td.grp-start{border-left:1.5px solid #8a7dad}
      .card-meta-line{display:flex;flex-wrap:wrap;gap:2px 10px;margin:0;color:#5a536e;font-size:10px}
      .card-meta-line span{white-space:nowrap}
      .tpl2-top{font-size:9px}
      .tpl2-top th,.tpl2-top td{padding:2.5px 3.5px}
      .tpl2-bottom{display:grid;grid-template-columns:1.15fr 1fr;gap:12px;margin-top:8px;align-items:start;break-inside:avoid;page-break-inside:avoid}
      .tpl-foot{display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:5px;border-top:1px solid #ded8ea;font-size:9.5px;color:#69627e}

      /* 领导谈话卡专版 */
      .card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:8px;padding-bottom:7px;border-bottom:2px solid #573a9b}
      .card-title-block h1{margin:0 0 3px;font-size:17px;line-height:1.2;color:#1e1b2e}
      .card-title-block p{margin:0;color:#5a536e;font-size:10px}
      .card-kpis{display:grid;grid-template-columns:repeat(4,minmax(108px,1fr));gap:6px;flex-shrink:0}
      .card-kpis>div{border:1px solid #d5cee6;background:#f8f7fc;border-radius:5px;padding:4.5px 8px}
      .card-kpis>div.kpi-green{background:#ecf7f2;border-color:#bfe2d3}
      .card-kpis>div.kpi-purple{background:#f1ecfa;border-color:#cfc2ea}
      .card-kpis small{display:block;font-size:9px;color:#5a536e;font-weight:600}
      .card-kpis b{display:block;font-size:14px;color:#1e1b2e;line-height:1.25;margin:1px 0}
      .card-kpis b em{font-style:normal;font-size:10px;font-weight:600;color:#573a9b;margin-left:3px}
      .card-kpis span{display:block;font-size:9px;color:#69627e}
      .card-points{background:#f7f4fc;border:1px solid #dfd7ee;border-left:3.5px solid #6f4eb8;border-radius:5px;padding:6px 10px;margin-bottom:8px;font-size:10.5px;break-inside:avoid}
      .card-points-title{font-weight:700;color:#573a9b;margin-bottom:2px;font-size:10.5px}
      .card-points ol{margin:0;padding-left:16px}
      .card-points li{margin:1.5px 0;line-height:1.45}
      .card-sub-table{margin-bottom:7px}
      .p-pos{color:#1f7a5a;font-weight:650}
      .p-neg{color:#b4324e;font-weight:650}
      .p-muted{color:#69627e}
      .p-tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9.5px;font-weight:600;white-space:nowrap}
      .p-tag-good{background:#ecf7f2;color:#1f7a5a}
      .p-tag-warn{background:#fef6e8;color:#9a5b13}
      .p-tag-alert{background:#fdf0f3;color:#b4324e}
      .p-tag-flat{background:#f2f1f6;color:#5a536e}
      .card-flow{padding:5px 9px;background:#ecf7f2;border:1px solid #c5e5d8;border-radius:5px;margin-bottom:7px;font-size:10px;color:#1e1b2e;break-inside:avoid}
      .card-bottom-grid{display:grid;grid-template-columns:1.28fr 1fr;gap:9px;align-items:stretch;break-inside:avoid;page-break-inside:avoid}
      .card-lists,.card-notes{border:1px solid #d5cee6;border-radius:5px;padding:6px 9px;font-size:10px}
      .card-lists{display:grid;gap:3px;align-content:start}
      .card-box-title{font-weight:700;color:#573a9b;font-size:10.5px;padding-bottom:3px;margin-bottom:3px;border-bottom:1px solid #e4e1ee}
      .card-notes{display:flex;flex-direction:column;background:#fcfbfe}
      .note-line{flex:1;min-height:22px;border-bottom:1px dashed #ccc6dd;padding:3px 0;color:#5a536e;font-weight:600}
      .sign-row{display:flex;justify-content:space-between;gap:8px;padding-top:6px;margin-top:auto;font-size:9.5px;color:#5a536e}

      @page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:${landscape ? '8mm 9mm' : '10mm 11mm'}}
      @media print{
        body{background:#fff}
        .controls{display:none!important}
        .pages-wrap{padding:0;display:block}
        .print-page{width:auto;padding:0;margin:0;border-radius:0;box-shadow:none}
      }
    </style></head><body>
      <div class="controls">
        <div class="controls-left"><button onclick="window.print()">打印 / 存为 PDF</button><small>${e(title)} · 共 ${pagesHTML.length} 份（已按 A4 ${landscape ? '横向' : '纵向'}优化排版与分页）</small></div>
        <small>融侨学迹 · 纸面打印预览</small>
      </div>
      <div class="pages-wrap">${pagesHTML.map(p => `<section class="print-page">${p}</section>`).join('')}</div>
    </body></html>`);
    win.document.close();
    return win;
  }

  function printBriefs(briefs, kind, ratioMode = 'main') {
    const list = Array.isArray(briefs) ? briefs : [briefs];
    if (!list.length) return;
    const first = list[0];
    const scope = list.length === 1 ? `${first.meta.class}班` : `全年级${list.length}个班`;
    if (kind === 'card') {
      return openPrintWindow(`${first.meta.grade} ${scope} 领导班情谈话卡`, list.map(leaderCardPrintHTML), true);
    }
    if (kind === 'tpl1-leader') {
      return openPrintWindow(`${first.meta.grade} ${scope} 历次纵向对比（领导版）`, list.map(b => template1HTML(b, 'leader')), false);
    }
    if (kind === 'tpl1-teacher') {
      return openPrintWindow(`${first.meta.grade} ${scope} 历次纵向对比（教师版）`, list.map(b => template1HTML(b, 'teacher')), false);
    }
    return openPrintWindow(`${first.meta.grade} ${scope} 有效分与单科薄弱汇总`, list.map(b => template2HTML(b, ratioMode)), true);
  }

  function renderBriefView(brief, state) {
    const m = brief.meta, h = brief.headline;
    const hPct = Math.round(m.high_ratio * 100), mPct = Math.round(m.main_ratio * 100);
    const toneClass = t => (t === 'good' ? 'success' : t === 'alert' ? 'danger' : t === 'warn' ? 'warning' : '');

    const subjectRows = brief.subject_diagnosis.map(s => {
      const others = (s.same_teacher_other_classes || []).map(o => `<span class="brief-other-cls">${e(o.class)}班 均${n(o.mean)} / ${mPct}%:${pctText(o.main_rate)}</span>`).join('');
      return `<tr>
        <td><strong>${e(s.subject)}</strong></td>
        <td>${e(s.teacher || '—')}${s.teacher_changed ? `<span class="badge warning" style="margin-left:6px" title="上次：${e(s.prev_teacher)}">换师</span>` : ''}</td>
        <td class="number">${n(s.mean)} <small class="${s.mean_diff > 0 ? 'delta-positive' : s.mean_diff < 0 ? 'delta-negative' : 'muted'}">(${signed(s.mean_diff, 1)})</small></td>
        <td class="number">${n(s.high.achievers, 0)} / ${n(s.high.concentrated, 0)} <small class="${s.high.gap > 0 ? 'delta-positive' : s.high.gap < 0 ? 'delta-negative' : 'muted'}">(${signed(s.high.gap, 0)})</small></td>
        <td class="number">${n(s.main.achievers, 0)} / ${n(s.main.concentrated, 0)} <small class="${s.main.gap > 0 ? 'delta-positive' : s.main.gap < 0 ? 'delta-negative' : 'muted'}">(${signed(s.main.gap, 0)})</small></td>
        <td><span class="badge ${toneClass(s.mismatch_tone)}">${e(s.mismatch_label)}</span></td>
        <td class="brief-other-cell">${others || '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    const flow = brief.flow;
    const flowHTML = flow.available ? `<div class="brief-flow-grid">
      <div class="brief-flow-box"><span>${e(h.high.label)}保尖率</span><strong>${pctText(flow.high_keep_rate)}</strong><small>稳住 ${flow.high_keep}/${flow.high_prev} · 掉出 ${flow.high_drop_count} · 冲尖 +${flow.high_rise_count}</small></div>
      <div class="brief-flow-box"><span>${e(h.main.label)}守线率</span><strong>${pctText(flow.main_keep_rate)}</strong><small>稳住 ${flow.main_keep}/${flow.main_prev} · 跌出 ${flow.main_drop_count} · 突围 +${flow.main_rise_count}</small></div>
    </div><p class="table-note">较上一场考试（${e(flow.prev_exam_name)}），共跨次匹配 ${flow.matched_count} 名学生。</p>` : `<div class="support-note">${e(flow.reason)}</div>`;

    const tplMode = state.briefTemplateTab || 'tpl1-leader';
    const tpl2Ratio = state.briefTpl2Ratio || 'main';
    const tplPreview = tplMode === 'tpl1-leader'
      ? template1HTML(brief, 'leader')
      : tplMode === 'tpl1-teacher'
        ? template1HTML(brief, 'teacher')
        : template2HTML(brief, tpl2Ratio);

    const highChoices = [...new Set([10, 15, 20, 25, 30, Number((m.high_ratio * 100).toFixed(1))])].sort((a, b) => a - b);
    const mainChoices = [...new Set([30, 35, 40, 45, 50, 60, Number((m.main_ratio * 100).toFixed(1))])].sort((a, b) => a - b);
    const roundingLabel = m.cutoff_rounding === 'round' ? '四舍五入' : m.cutoff_rounding === 'ceil' ? '向上取整' : '向下取整';
    const tieLabel = m.tie_mode === 'dense' ? '不跳号(1,1,2)' : '跳号(1,1,3)';
    const clsIdx = m.classes.indexOf(m.class);
    const hasPrevCls = clsIdx > 0;
    const hasNextCls = clsIdx >= 0 && clsIdx < m.classes.length - 1;

    return `
      <section class="panel brief-control-panel">
        <div class="brief-bar">
          <div class="class-stepper" role="group" aria-label="逐班切换">
            <button type="button" data-action="brief-prev-class" title="上一班" aria-label="上一班"${hasPrevCls ? '' : ' disabled'}>‹</button>
            <select id="brief-class" aria-label="选择班情分析班级">${m.classes.map(c => option(c, `${c}班`, m.class)).join('')}</select>
            <button type="button" data-action="brief-next-class" title="下一班" aria-label="下一班"${hasNextCls ? '' : ' disabled'}>›</button>
          </div>
          <div class="brief-ratio-group">
            <span>尖优</span>
            <select id="brief-high-ratio" aria-label="尖优线比例">${highChoices.map(v => option(Number((v / 100).toFixed(4)), `前 ${v}%`, Number(m.high_ratio.toFixed(4)))).join('')}</select>
            <span>达标</span>
            <select id="brief-main-ratio" aria-label="达标线比例">${mainChoices.map(v => option(Number((v / 100).toFixed(4)), `前 ${v}%`, Number(m.main_ratio.toFixed(4)))).join('')}</select>
            ${state.briefRatioOverride ? '<button type="button" class="text-button" data-action="save-brief-ratios" title="将当前试算双线写入本场口径">存为口径</button>' : ''}
          </div>
          <div class="brief-actions">
            ${btn('任课教师', 'open-teachers', '', 'secondary small')}
            <details class="print-menu">
              <summary class="btn secondary small">更多打印模板 ▾</summary>
              <div class="print-menu-list">
                <button type="button" data-action="open-print-studio"><strong>分模块组合打印台…（推荐）</strong><small>自由勾选 8 大模块与排序，含全班较上次对比</small></button>
                <div class="print-menu-divider"></div>
                <button type="button" data-action="print-tpl1-leader"><strong>打印模板1 · 领导版</strong><small>A4 纵向 · 展示历次前 50–800 名</small></button>
                <button type="button" data-action="print-tpl1-teacher"><strong>打印模板1 · 教师版</strong><small>A4 纵向 · 展示历次前 200–800 名</small></button>
                <button type="button" data-action="print-tpl2"><strong>打印模板2 · 有效分与薄弱科</strong><small>A4 横向 · 达标集中 + 单科矩阵 + 薄弱科</small></button>
                <div class="print-menu-divider"></div>
                <button type="button" data-action="open-batch-print"><strong>批量打印全年级…</strong><small>一键生成全年级 ${m.classes.length} 个班自动分页稿</small></button>
                <button type="button" data-action="open-student-cards" data-class="${e(m.class)}"><strong>学生个人诊断卡（发家长/学生）…</strong><small>零他人隐私 · 雷达图 + 百分位 + 提分抓手</small></button>
                <button type="button" data-action="download-class-zip"><strong>一键按班拆包导出 ZIP（发班主任）</strong><small>每班独立文件夹 · 本班明细 Excel + 打印版</small></button>
              </div>
            </details>
            ${btn('分模块打印', 'open-print-studio', '', 'secondary small')}
            ${btn('打印 · 领导谈话卡', 'print-brief-card', '', 'primary small')}
          </div>
        </div>
        <div class="brief-rules-pill">
          <span>当前口径：${roundingLabel} · 并列${tieLabel} · 临界 ±${n(m.borderline_band, 0)} 名 · 显著进退 ≥${n(m.shift_threshold, 0)} 名 · 预警 ${n(m.warn_gap_pct ?? 5, 1)}%${m.mentor_range ? ` · 导师制 ${m.mentor_range[0]}-${m.mentor_range[1]} 名` : ''}</span>
          ${state.briefRatioOverride ? '<span class="badge warning">当前为临时双线试算</span>' : ''}
        </div>
      </section>

      <section class="panel brief-hero">
        <div class="section-title brief-hero-head">
          <div>
            <h2 class="brief-hero-title"><span>${e(m.grade)} · ${e(m.class)}班 班情诊断</span><span class="badge">班主任：${e(m.homeroom || '未录入')}</span></h2>
            <p>${e(m.exam_name)}（${e(m.exam_date)}） · 实考 ${n(h.participants, 0)} / ${n(h.registered, 0)} 人 · 已追踪 ${m.exam_count} 场历次考试</p>
          </div>
          <div class="brief-tags">${h.tags.map(t => `<span class="badge ${toneClass(t.tone)}">${e(t.text)}</span>`).join('')}</div>
        </div>
        <div class="brief-kpi-grid">
          <div class="brief-kpi accent-green">
            <span>${e(h.high.label)}尖优 · 线 ${n(h.high.cutoff)}分</span>
            <strong>${n(h.high.count, 0)}<em>人 · ${pctText(h.high.rate)}</em></strong>
            <small class="kpi-meta"><span class="kpi-chip">较上次 ${signed(h.high.delta_prev_count, 0, '人')}</span><span class="kpi-chip">较首考 ${signed(h.high.delta_entry_count, 0, '人')}</span></small>
          </div>
          <div class="brief-kpi accent-purple">
            <span>${e(h.main.label)}基本盘 · 线 ${n(h.main.cutoff)}分</span>
            <strong>${n(h.main.count, 0)}<em>人 · ${pctText(h.main.rate)}</em></strong>
            <small class="kpi-meta"><span class="kpi-chip">较上次 ${signed(h.main.delta_prev_count, 0, '人')}</span><span class="kpi-chip">较首考 ${signed(h.main.delta_entry_count, 0, '人')}</span></small>
          </div>
          <div class="brief-kpi">
            <span>尖优含金量（${e(h.high.label)}÷${e(h.main.label)}）</span>
            <strong>${pctText(h.elite_ratio)}</strong>
            <small class="kpi-meta"><span class="kpi-chip">${hPct}%–${mPct}%蓄水池：${Math.max(0, (h.main.count || 0) - (h.high.count || 0))} 人</span></small>
          </div>
          <div class="brief-kpi">
            <span>总分均分（离均差）</span>
            <strong>${n(h.mean)}<em>${signed(h.mean_diff, 1)}</em></strong>
            <small class="kpi-meta"><span class="kpi-chip">年级均分 ${n(h.grade_mean)}</span><span class="kpi-chip">标准差 ${n(h.std)}</span><span class="kpi-chip">后20% ${n(h.bottom20_count, 0)}人</span></small>
          </div>
        </div>
        <div class="brief-talking-box">
          <h3>班情会谈话要点（领导可直接开口）</h3>
          <ol>${h.talking_points.map(p => `<li>${e(p)}</li>`).join('')}</ol>
        </div>
      </section>

      <section class="panel">
        <div class="section-title">
          <div><h2>${e(h.high.label)} / ${e(h.main.label)} 双线分学科诊断与同师对比</h2><p>达标/集中括号内为“贡献差（单科达标数 − 总分达标数）”，正数托举、负数拖累</p></div>
          ${!m.homeroom && !brief.subject_diagnosis.some(s => s.teacher) ? btn('导入任课教师表', 'open-teachers', '', 'secondary small') : ''}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>学科</th><th>任课教师</th><th class="number">均分（离均差）</th><th class="number">${e(h.high.label)} 达标/集中(贡献差)</th><th class="number">${e(h.main.label)} 达标/集中(贡献差)</th><th>双线诊断</th><th>同师另班对照</th></tr></thead>
            <tbody>${subjectRows}</tbody>
          </table>
        </div>
      </section>

      <div class="two-col">
        <section class="panel">
          <div class="section-title"><div><h2>历次双线占比走势</h2><p>用占本班比例消除历次年级总人数变化干扰</p></div></div>
          ${dualTimelineSVG(brief.timeline, m.high_ratio, m.main_ratio)}
        </section>
        <section class="panel">
          <div class="section-title"><div><h2>双线人员流动</h2><p>区分“保尖/守线”与“掉线/突围”，避免净人数掩盖流失</p></div></div>
          ${flowHTML}
        </section>
      </div>

      <section class="panel">
        <div class="section-title">
          <div><h2>现场点名与包干微名单</h2><p>直接定位最易提分的单科跛脚生、老优生失血预警与顽固偏科生</p></div>
          <div class="panel-heading-actions">${btn('复制当前名单', 'copy-brief-list', '', 'secondary small')}${btn('下载 CSV', 'csv-brief-list', '', 'secondary small')}</div>
        </div>
        ${renderActionListsHTML(brief, state.briefListTab || 'high')}
      </section>

      ${window.LeaderLevels ? window.LeaderLevels.renderLevelsSectionHTML(brief, state) : ''}

      ${window.LeaderPrintStudio ? window.LeaderPrintStudio.renderComparisonSectionHTML(brief, state) : ''}

      <section class="panel">
        <div class="section-title">
          <div><h2>打印模板在线预览（领导版 / 教师版 / 有效分薄弱科）</h2><p>与学校原有打印习惯一致，支持自动汇总历次考试并分版打印</p></div>
          <div class="toolbar-inline">
            ${tplMode === 'tpl2' ? `<label class="small-text">模板2有效分口径 <select id="brief-tpl2-ratio">${option('main', `前${mPct}%`, tpl2Ratio)}${option('high', `前${hPct}%`, tpl2Ratio)}${option('mid30', '前30%（兼容旧表）', tpl2Ratio)}</select></label>` : ''}
            ${btn('打印此预览模板', tplMode === 'tpl1-leader' ? 'print-tpl1-leader' : tplMode === 'tpl1-teacher' ? 'print-tpl1-teacher' : 'print-tpl2', '', 'primary small')}
          </div>
        </div>
        <div class="tab-strip" style="margin-top:0;margin-bottom:14px">
          <button data-action="brief-tpl-tab" data-tab="tpl1-leader" class="${tplMode === 'tpl1-leader' ? 'active' : ''}">模板1 · 纵向对比（领导版 50–800）</button>
          <button data-action="brief-tpl-tab" data-tab="tpl1-teacher" class="${tplMode === 'tpl1-teacher' ? 'active' : ''}">模板1 · 纵向对比（教师版 200–800）</button>
          <button data-action="brief-tpl-tab" data-tab="tpl2" class="${tplMode === 'tpl2' ? 'active' : ''}">模板2 · 历次有效分 + 单科 + 薄弱科</button>
        </div>
        <div class="tpl-preview-box">${tplPreview}</div>
      </section>
    `;
  }

  function teachersDrawerHTML(analysis, teachersList) {
    const byClass = new Map((teachersList || []).map(item => [item.class, item]));
    const subjects = analysis.subjects || [];
    const rows = analysis.classes.map(cls => {
      const existing = byClass.get(cls) || { homeroom: '', subjects: {} };
      return `<tr>
        <td><strong>${e(cls)}班</strong></td>
        <td><input type="text" data-t-class="${e(cls)}" data-t-field="homeroom" value="${e(existing.homeroom || '')}" placeholder="班主任"></td>
        ${subjects.map(sub => `<td><input type="text" data-t-class="${e(cls)}" data-t-sub="${e(sub)}" value="${e(existing.subjects?.[sub] || '')}" placeholder="${e(sub)}"></td>`).join('')}
      </tr>`;
    }).join('');
    return `
      <div class="drawer-intro"><p>支持直接上传学校的《教师基本信息》Excel/CSV（含“班级、班主任、各学科”，若含“考试名称”列将自动匹配本年级多场考试），也可以在下方直接填写或修改当前考试的任课教师。</p></div>
      <form id="teacher-import-form" class="rules-section">
        <h3>方式一：导入任课教师表（支持多场汇总表）</h3>
        <div class="drawer-upload" style="margin:10px 0">
          <div class="drawer-upload-symbol">${Z.icons('upload')}</div>
          <div><strong id="teacher-file-name">选择教师基本信息 .xlsx / .csv</strong><p>可直接选择包含“教师基本信息”工作表的成绩总表。</p></div>
          <label class="btn secondary">选择文件<input id="teacher-import-file" type="file" accept=".xlsx,.xlsm,.csv" hidden></label>
        </div>
        <div class="form-actions" style="margin-top:10px"><button type="submit" class="btn primary" id="teacher-import-submit" disabled>导入并自动匹配</button></div>
        <div id="teacher-import-error" class="error" hidden></div>
      </form>
      <form id="teacher-edit-form" class="rules-section">
        <h3>方式二：编辑当前考试（${e(analysis.metadata.name)}）任课教师</h3>
        <div class="table-wrap teacher-edit-table"><table><thead><tr><th>班级</th><th>班主任</th>${subjects.map(s => `<th>${e(s)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
        <div id="teacher-edit-error" class="error" hidden></div>
        <div class="form-actions"><button type="submit" class="btn primary">保存当前考试教师配置</button><button type="button" class="btn secondary" data-action="close-drawer">关闭</button></div>
      </form>
    `;
  }

  function batchPrintDrawerHTML(brief) {
    const m = brief.meta;
    const hPct = Math.round(m.high_ratio * 100), mPct = Math.round(m.main_ratio * 100);
    return `
      <div class="drawer-intro"><p>按班级自动分页，一键生成 ${e(m.grade)} 全部 <strong>${m.classes.length} 个班</strong> 的可打印报告，打印或另存为 PDF 即可直接下发给领导和班主任。</p></div>
      <div class="batch-print-grid">
        <button type="button" class="batch-print-card" data-action="batch-print-run" data-kind="card"><strong>领导班情谈话卡（全年级 ${m.classes.length} 页）</strong><span>每班一页 A4 横向：20%/40%双线定调、谈话要点、学科诊断、同师对照与包干名单</span></button>
        <button type="button" class="batch-print-card" data-action="batch-print-run" data-kind="tpl1-leader"><strong>打印模板1 · 纵向对比（领导版 50–800）</strong><span>每班一页：总分与各科历次 50—800 名累计人数及任课教师</span></button>
        <button type="button" class="batch-print-card" data-action="batch-print-run" data-kind="tpl1-teacher"><strong>打印模板1 · 纵向对比（教师版 200–800）</strong><span>每班一页：隐去前50/100顶尖列，展示前200—800名历次变化，适合发给科任老师</span></button>
        <button type="button" class="batch-print-card" data-action="batch-print-run" data-kind="tpl2" data-ratio="main"><strong>打印模板2 · 有效分与薄弱科（前${mPct}%口径）</strong><span>每班一页 A4 横向：历次前${mPct}%达标集中 + 本次单科统计 + 本班前200/400/600薄弱科</span></button>
        <button type="button" class="batch-print-card" data-action="batch-print-run" data-kind="tpl2" data-ratio="high"><strong>打印模板2 · 有效分与薄弱科（前${hPct}%口径）</strong><span>每班一页 A4 横向：历次前${hPct}%尖优达标集中 + 本次单科统计 + 本班薄弱科</span></button>
      </div>
    `;
  }

  window.LeaderBrief = {
    renderBriefView,
    actionListTable,
    printBriefs,
    teachersDrawerHTML,
    batchPrintDrawerHTML,
  };
})();

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
      return `<table class="tpl-table tpl1-block"><thead><tr class="tpl-group-row"><th colspan="${4 + cols.length}">${e(sub)}</th></tr><tr><th style="width:46px">序号</th><th style="width:130px">考试名称</th><th style="width:52px">班级</th><th style="width:84px">${sub === '总分' ? '班主任' : '任课教师'}</th>${cols.map(k => `<th class="number">${k}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    return `<div class="tpl-sheet"><div class="tpl-header-bar"><span>${e(brief.meta.grade)}历次单科数据对比（${e(brief.meta.class)}班）</span><small>${mode === 'teacher' ? '教师版 · 展示前200—800名' : '领导版 · 展示前50—800名'}</small></div>${blocks}</div>`;
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
        if (!s) return '<td></td><td></td><td></td>';
        return `<td class="center">${e(s.teacher || '')}</td><td class="number">${n(s[achKey], 0)}</td><td class="number">${n(s[concKey], 0)}</td>`;
      }).join('');
      return `<tr${item.is_current ? ' class="tpl-current-row"' : ''}><td class="center">${item.seq}</td><td>${e(item.name)}</td><td class="center">${e(brief.meta.class)}</td><td class="center">${e(item.homeroom || '')}</td><td class="number">${n(item.participants, 0)}</td><td class="number">${n(item[countKey], 0)}</td>${subCells}</tr>`;
    }).join('');

    const matrix = brief.current_subject_matrix || { subjects: [], rows: [] };
    const matrixHTML = `<table class="tpl-table"><thead><tr class="tpl-group-row"><th colspan="${1 + matrix.subjects.length}">${e(brief.meta.exam_name)}单科统计（${e(brief.meta.class)}班）</th></tr><tr><th>统计项目</th>${matrix.subjects.map(s => `<th class="number">${e(s)}</th>`).join('')}</tr></thead><tbody>${matrix.rows.map(r => `<tr><td>${e(r[0])}</td>${r.slice(1).map((v, idx) => `<td class="number">${r[0] === '平均分' ? n(v, 1) : n(v, 0)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    const weakRows = brief.current_weak_summary || [];
    const weakHTML = `<table class="tpl-table"><thead><tr class="tpl-group-row"><th colspan="${2 + matrix.subjects.length}">${e(brief.meta.class)}班 ${e(brief.meta.exam_name)}薄弱学科统计</th></tr><tr><th>班级</th>${matrix.subjects.map(s => `<th class="number">${e(s)}</th>`).join('')}<th class="number">名次范围</th></tr></thead><tbody>${weakRows.map(w => `<tr><td class="center">${e(brief.meta.class)}</td>${matrix.subjects.map(s => `<td class="number">${n(w.counts[s] ?? 0, 0)}</td>`).join('')}<td class="number"><strong>前${w.cutoff}名</strong></td></tr>`).join('')}</tbody></table>`;

    return `<div class="tpl-sheet"><div class="tpl-header-bar"><span>${e(brief.meta.grade)} · ${e(brief.meta.class)}班 有效分达标集中与单科薄弱汇总</span><small>达标线口径：前${e(ratioLabel)}</small></div><div class="table-wrap"><table class="tpl-table tpl2-top"><thead><tr class="tpl-group-row"><th colspan="${6 + subjects.length * 3}">历次测试有效分达标数、集中数（达标率前${e(ratioLabel)}）</th></tr><tr><th rowspan="2">序号</th><th rowspan="2">考试名称</th><th rowspan="2">班级</th><th rowspan="2">班主任</th><th rowspan="2" class="number">参考<br>人数</th><th rowspan="2" class="number">优生<br>人数</th>${subjects.map(s => `<th colspan="3" class="center">${e(s)}</th>`).join('')}</tr><tr>${subjects.map(() => '<th class="center">教师</th><th class="number">达标</th><th class="number">集中</th>').join('')}</tr></thead><tbody>${topRows}</tbody></table></div><div class="tpl2-bottom"><div>${matrixHTML}</div><div>${weakHTML}</div></div></div>`;
  }

  /* ---- Print Card: 领导一页纸班情谈话卡 ---- */
  function leaderCardPrintHTML(brief) {
    const h = brief.headline, m = brief.meta;
    const hL = h.high.label, mL = h.main.label;
    const subRows = brief.subject_diagnosis.map(s => {
      const otherText = (s.same_teacher_other_classes || []).map(o => `${o.class}班:${pctText(o.main_rate)}`).join(' ');
      return `<tr><td>${e(s.subject)}</td><td>${e(s.teacher || '—')}${s.teacher_changed ? ' *换' : ''}</td><td class="number">${n(s.mean)} (${signed(s.mean_diff, 1)})</td><td class="number">${n(s.high.achievers, 0)} / ${n(s.high.concentrated, 0)} (${signed(s.high.gap, 0)})</td><td class="number">${n(s.main.achievers, 0)} / ${n(s.main.concentrated, 0)} (${signed(s.main.gap, 0)})</td><td>${e(s.mismatch_label)}</td><td>${e(otherText || '—')}</td></tr>`;
    }).join('');
    const flow = brief.flow;
    const flowLine = flow.available
      ? `较上次（${e(flow.prev_exam_name)}，匹配${flow.matched_count}人）：${hL}保尖 ${flow.high_keep}/${flow.high_prev}（${pctText(flow.high_keep_rate)}）、掉出 ${flow.high_drop_count}人、冲尖 ${flow.high_rise_count}人 ｜ ${mL}守线 ${flow.main_keep}/${flow.main_prev}（${pctText(flow.main_keep_rate)}）、跌出 ${flow.main_drop_count}人、临界突围 ${flow.main_rise_count}人`
      : flow.reason;
    const bHigh = (brief.action_lists.borderline_high || []).slice(0, 6).map(s => `${s.name}(差${n(s.score_gap)}分:${s.missing_subjects.slice(0, 2).map(x => x.subject).join('/')})`).join('；') || '无';
    const bMain = (brief.action_lists.borderline_main || []).slice(0, 8).map(s => `${s.name}(差${n(s.score_gap)}分:${s.missing_subjects.slice(0, 2).map(x => x.subject).join('/')})`).join('；') || '无';
    const drops = (brief.action_lists.drop_alerts || []).slice(0, 6).map(s => `${s.name}(${s.prev_tier}→${s.curr_tier}，${(s.biggest_drop_subjects || []).map(d => `${d.subject}退${d.drop}`).join('/')})`).join('；') || '无';
    const pWeak = (brief.action_lists.persistent_weak || []).slice(0, 6).map(s => `${s.name}(${s.subject} ${s.hits}/${s.exams_checked}次)`).join('；') || '无';

    return `<div class="tpl-sheet card-sheet">
      <div class="card-head">
        <div><h1>${e(m.grade)} · ${e(m.class)}班 班情双线谈话卡</h1><p>${e(m.exam_name)}（${e(m.exam_date)}）｜ 班主任：${e(m.homeroom || '未录入')} ｜ 参考 ${n(h.participants, 0)}/${n(h.registered, 0)} 人 ｜ 均分 ${n(h.mean)}（离均差 ${signed(h.mean_diff, 1)}）｜ 标准差 ${n(h.std)} ｜ 后20% ${n(h.bottom20_count, 0)}人</p></div>
        <div class="card-kpis">
          <div><small>${e(hL)}尖优</small><b>${n(h.high.count, 0)}人</b><span>${pctText(h.high.rate)} · 较上次${signed(h.high.delta_prev_count, 0)} · 较首考${signed(h.high.delta_entry_count, 0)}</span></div>
          <div><small>${e(mL)}基本盘</small><b>${n(h.main.count, 0)}人</b><span>${pctText(h.main.rate)} · 较上次${signed(h.main.delta_prev_count, 0)} · 较首考${signed(h.main.delta_entry_count, 0)}</span></div>
          <div><small>尖优比 (${e(hL)}÷${e(mL)})</small><b>${pctText(h.elite_ratio)}</b><span>${e(hL)}线 ${n(h.high.cutoff)} / ${e(mL)}线 ${n(h.main.cutoff)}</span></div>
        </div>
      </div>
      <div class="card-points"><strong>谈话要点：</strong><ol>${h.talking_points.map(p => `<li>${e(p)}</li>`).join('')}</ol></div>
      <table class="tpl-table"><thead><tr class="tpl-group-row"><th colspan="7">${e(hL)} / ${e(mL)} 双线学科诊断与同师对比</th></tr><tr><th>学科</th><th>任课教师</th><th class="number">均分（离均差）</th><th class="number">${e(hL)} 达标/集中(贡献差)</th><th class="number">${e(mL)} 达标/集中(贡献差)</th><th>双线诊断</th><th>同师另班(${e(mL)})</th></tr></thead><tbody>${subRows}</tbody></table>
      <div class="card-flow"><strong>人员流动：</strong>${flowLine}</div>
      <div class="card-lists">
        <div><b>冲${e(hL)}临界/跛脚：</b>${e(bHigh)}</div>
        <div><b>保冲${e(mL)}临界/跛脚：</b>${e(bMain)}</div>
        <div><b>掉线失血预警：</b>${e(drops)}</div>
        <div><b>连续顽固偏科：</b>${e(pWeak)}</div>
      </div>
      <div class="card-notes"><div>下阶段重点盯人（班主任/学科认领）：</div><div>教研与跟进举措：</div></div>
    </div>`;
  }

  function openPrintWindow(title, pagesHTML, landscape = true) {
    const win = window.open('', '_blank');
    if (!win) {
      Z.notice('打印窗口被浏览器拦截，请允许本页面打开新窗口后重试。', true);
      return null;
    }
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(title)}</title><style>
      *{box-sizing:border-box}
      body{margin:20px;color:#231b33;font:11.5px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
      .controls{position:sticky;top:0;background:#fff;padding:10px 0 12px;border-bottom:1px solid #e5dfec;margin-bottom:14px;display:flex;align-items:center;gap:12px}
      .controls button{font:inherit;padding:8px 18px;border:1px solid #8061b5;border-radius:6px;background:#8061b5;color:#fff;cursor:pointer;font-weight:600}
      .controls small{color:#73647f}
      .print-page{break-before:page;margin-bottom:24px}
      .print-page:first-of-type{break-before:auto}
      .tpl-header-bar{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #684792}
      .tpl-header-bar span{font-size:17px;font-weight:700;color:#2c2240}
      .tpl-header-bar small{font-size:11px;color:#6e607d}
      .tpl-table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:10.5px}
      .tpl-table th,.tpl-table td{border:1px solid #8a8298;padding:3.5px 5px;text-align:left}
      .tpl-table th{background:#dfe6f5;font-weight:650;color:#231b33}
      .tpl-table tr.tpl-group-row th{background:#c8d5ef;text-align:center;font-size:11.5px;padding:4px}
      .tpl-table td.number,.tpl-table th.number{text-align:right}
      .tpl-table td.center,.tpl-table th.center{text-align:center}
      .tpl-table tr.tpl-current-row td{background:#f7f2fc;font-weight:600}
      .tpl2-bottom{display:grid;grid-template-columns:1.15fr 1fr;gap:14px;margin-top:10px;align-items:start}
      .card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #8061b5}
      .card-head h1{margin:0 0 4px;font-size:18px;color:#302a40}
      .card-head p{margin:0;color:#645773;font-size:11px}
      .card-kpis{display:flex;gap:8px;flex-shrink:0}
      .card-kpis>div{border:1px solid #d5c6e7;background:#f7f3fc;border-radius:6px;padding:5px 9px;min-width:128px}
      .card-kpis small{display:block;font-size:10px;color:#6e5d82}
      .card-kpis b{display:block;font-size:15px;color:#5a3789;line-height:1.25}
      .card-kpis span{display:block;font-size:9.5px;color:#73647f}
      .card-points{background:#faf8fd;border:1px solid #e2d8ee;border-radius:6px;padding:7px 10px;margin-bottom:9px;font-size:11px}
      .card-points ol{margin:4px 0 0;padding-left:18px}
      .card-points li{margin:2px 0}
      .card-flow{padding:6px 9px;background:#f5f9f7;border:1px solid #d2e4db;border-radius:6px;margin:8px 0;font-size:10.5px}
      .card-lists{border:1px solid #e0d7eb;border-radius:6px;padding:7px 10px;font-size:10.5px;display:grid;gap:4px;margin-bottom:8px}
      .card-notes{border:1px dashed #a99ab9;border-radius:6px;padding:7px 10px;font-size:10.5px;color:#665873}
      .card-notes>div{min-height:24px;border-bottom:1px dotted #d7cde3;padding:3px 0}
      .card-notes>div:last-child{border-bottom:0}
      @page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:9mm}
      @media print{body{margin:0}.controls{display:none}.print-page{margin-bottom:0}}
    </style></head><body>
      <div class="controls"><button onclick="window.print()">打印 / 存为 PDF</button><small>${e(title)} · 共 ${pagesHTML.length} 页（每班一页自动分页）</small></div>
      ${pagesHTML.map(p => `<section class="print-page">${p}</section>`).join('')}
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
        <td>${others || '<span class="muted">—</span>'}</td>
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

    return `
      <section class="panel brief-control-panel">
        <div class="toolbar" style="margin-bottom:12px">
          <label>选择班级<select id="brief-class" aria-label="选择班情分析班级">${m.classes.map(c => option(c, `${c}班`, m.class)).join('')}</select></label>
          <label>尖优线<select id="brief-high-ratio" aria-label="尖优线比例">${highChoices.map(v => option(Number((v / 100).toFixed(4)), `前 ${v}%`, Number(m.high_ratio.toFixed(4)))).join('')}</select></label>
          <label>达标线<select id="brief-main-ratio" aria-label="达标线比例">${mainChoices.map(v => option(Number((v / 100).toFixed(4)), `前 ${v}%`, Number(m.main_ratio.toFixed(4)))).join('')}</select></label>
          <div class="spacer"></div>
          ${btn('自定义口径', 'rules', '', 'secondary')}
          ${btn('任课教师管理', 'open-teachers', '', 'secondary')}
          ${btn('批量打印全年级', 'open-batch-print', '', 'secondary')}
          ${btn('打印 · 领导谈话卡', 'print-brief-card', '', 'primary')}
        </div>
        <div class="brief-print-strip">
          <span class="small-text">单班模板直出：</span>
          ${btn('打印模板1 · 领导版 (50–800)', 'print-tpl1-leader', '', 'secondary small')}
          ${btn('打印模板1 · 教师版 (200–800)', 'print-tpl1-teacher', '', 'secondary small')}
          ${btn('打印模板2 · 有效分与薄弱科', 'print-tpl2', '', 'secondary small')}
        </div>
        <div class="brief-rules-pill">
          <span>当前口径：${roundingLabel} · 并列${tieLabel} · 临界 ±${n(m.borderline_band, 0)} 名 · 显著进退 ≥${n(m.shift_threshold, 0)} 名 · 预警阈值 ${n(m.warn_gap_pct ?? 5, 1)}%${m.mentor_range ? ` · 导师制 ${m.mentor_range[0]}-${m.mentor_range[1]} 名` : ''}</span>
        </div>
      </section>

      <section class="panel brief-hero">
        <div class="section-title">
          <div>
            <h2>${e(m.grade)} · ${e(m.class)}班 班情诊断 <span class="badge" style="margin-left:8px">班主任：${e(m.homeroom || '未录入')}</span></h2>
            <p>${e(m.exam_name)}（${e(m.exam_date)}） · 实考 ${n(h.participants, 0)} / ${n(h.registered, 0)} 人 · 已追踪 ${m.exam_count} 场历次考试</p>
          </div>
          <div class="brief-tags">${h.tags.map(t => `<span class="badge ${toneClass(t.tone)}">${e(t.text)}</span>`).join('')}</div>
        </div>
        <div class="brief-kpi-grid">
          <div class="brief-kpi accent-green">
            <span>${e(h.high.label)}尖优（线 ${n(h.high.cutoff)}分）</span>
            <strong>${n(h.high.count, 0)}<em>人 · ${pctText(h.high.rate)}</em></strong>
            <small>较上次 ${signed(h.high.delta_prev_count, 0, '人')} ｜ 较首考 ${signed(h.high.delta_entry_count, 0, '人')}</small>
          </div>
          <div class="brief-kpi accent-purple">
            <span>${e(h.main.label)}基本盘（线 ${n(h.main.cutoff)}分）</span>
            <strong>${n(h.main.count, 0)}<em>人 · ${pctText(h.main.rate)}</em></strong>
            <small>较上次 ${signed(h.main.delta_prev_count, 0, '人')} ｜ 较首考 ${signed(h.main.delta_entry_count, 0, '人')}</small>
          </div>
          <div class="brief-kpi">
            <span>尖优含金量（${e(h.high.label)}÷${e(h.main.label)}）</span>
            <strong>${pctText(h.elite_ratio)}</strong>
            <small>20%–40%蓄水池：${Math.max(0, (h.main.count || 0) - (h.high.count || 0))} 人</small>
          </div>
          <div class="brief-kpi">
            <span>总分均分（离均差）</span>
            <strong>${n(h.mean)}<em>${signed(h.mean_diff, 1)}</em></strong>
            <small>年级均分 ${n(h.grade_mean)} · 标准差 ${n(h.std)} · 后20% ${n(h.bottom20_count, 0)}人</small>
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

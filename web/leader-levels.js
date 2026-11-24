'use strict';
/* 融侨学迹 · 六层等级分布（A1/A2/B1/B2/C1/C2）与无分无名次教师脱敏抓手模块 */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 1) => Z.num(v, d);
  const pct = v => (v === null || v === undefined ? '—' : `${n(v, 1)}%`);
  const signed = (v, d = 0, suffix = '') => {
    if (v === null || v === undefined) return '—';
    const num = Number(v);
    if (!Number.isFinite(num)) return '—';
    if (num === 0) return `0${suffix}`;
    return `${num > 0 ? '+' : ''}${n(num, d)}${suffix}`;
  };

  function tierTone(lbl, tiers) {
    const idx = (tiers || []).indexOf(lbl);
    if (idx === 0) return 'tier-a1';
    if (idx === 1) return 'tier-a2';
    if (idx === 2) return 'tier-b1';
    if (idx === 3) return 'tier-b2';
    if (idx === 4) return 'tier-c1';
    return 'tier-c2';
  }

  const cmpSurname = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-CN');

  function filterLevers(rows, filterMode = 'all', sortMode = 'surname', tiers = []) {
    const list = (rows || []).filter(r => {
      if (filterMode === 'slide') return r.is_slide;
      if (filterMode === 'push') return r.is_push;
      if (filterMode === 'drag') return r.is_drag;
      if (filterMode === 'surge') return r.is_surge;
      return true;
    }).slice();
    if (sortMode === 'level') {
      const idxMap = new Map((tiers || []).map((t, i) => [t, i]));
      list.sort((a, b) => (idxMap.get(a.level) ?? 99) - (idxMap.get(b.level) ?? 99) || cmpSurname(a.name, b.name));
    } else {
      list.sort((a, b) => cmpSurname(a.name, b.name));
    }
    return list;
  }

  function formatPushText(pt) {
    if (!pt) return '—';
    const blocks = (pt.block_subjects || []).join('、');
    if (pt.single_block && blocks) return `${pt.label}（单科卡壳：${blocks}）`;
    return blocks ? `${pt.label}（待补：${blocks}）` : `${pt.label}（临门一脚）`;
  }

  function formatDragText(list) {
    if (!list || !list.length) return '—';
    return list.map(d => `${d.subject}${d.persistent ? '★' : ''}(${d.level})`).join('、');
  }

  function formatStrengthText(list) {
    if (!list || !list.length) return '—';
    return list.map(s => `${s.subject}(${s.level})`).join('、');
  }

  function leversTableObj(brief, filterMode = 'all', sortMode = 'surname') {
    const lp = brief?.level_profile || {};
    const rows = filterLevers(lp.student_levers || [], filterMode, sortMode, lp.tiers || []);
    const base = lp.transitions?.compare_exam;
    return {
      title: `${brief.meta.class}班 · 学生无分无名次抓手清单（教师脱敏版）`,
      columns: ['姓名', '状态信号', '升档临门一脚', '拖档 / 薄弱科（★连弱）', '优势鼓励科', '波动主因'],
      rows: rows.map(r => [
        r.name,
        r.status_label || '—',
        formatPushText(r.push_target),
        formatDragText(r.drag_subjects),
        formatStrengthText(r.strength_subjects),
        r.driver_text || '—',
      ]),
      note: `${brief.meta.grade} · ${brief.meta.exam_name} · 教师脱敏版（按姓氏拼音排序，不含原始分数与具体名次） · 对比基准：${base ? base.name : '暂无'}`,
    };
  }

  /* ==================== On-Screen View inside 班情分析 ==================== */

  function renderDistTab(lp) {
    const dist = lp.total_distribution || [];
    const tiers = lp.tiers || [];
    const tr = lp.transitions || {};
    const syn = lp.subject_synergy || [];

    const stacked = `<div class="lvl-stacked-bar" role="img" aria-label="本班六层等级占比结构">${dist.map(d => {
      const w = Math.max(0, Number(d.rate || 0));
      if (!w) return '';
      return `<span class="lvl-seg ${tierTone(d.level, tiers)}" style="width:${w}%" title="${e(d.level)}：${d.count}人（${pct(d.rate)}）">${w >= 7 ? `${e(d.level)} ${n(d.rate, 0)}%` : ''}</span>`;
    }).join('')}</div>`;

    const cards = `<div class="lvl-cards-grid">${dist.map(d => {
      const diffCls = d.rate_diff == null || Math.abs(d.rate_diff) < 1 ? '' : d.rate_diff > 0 ? 'delta-positive' : 'delta-negative';
      return `<div class="lvl-card ${tierTone(d.level, tiers)}">
        <div class="lvl-card-top"><span class="lvl-badge ${tierTone(d.level, tiers)}">${e(d.level)}</span><small>基准 ${n(d.expected_rate, 0)}%</small></div>
        <strong>${n(d.count, 0)}<em>人 · ${pct(d.rate)}</em></strong>
        <div class="lvl-card-meta">
          <span class="${diffCls}">较基准 ${signed(d.rate_diff, 1, '%')}</span>
          ${d.delta_count != null ? `<span>较上次 ${signed(d.delta_count, 0, '人')}</span>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;

    const flowStrip = tr.available ? `<div class="lvl-flow-strip">
      <div class="lvl-flow-counts">
        <span class="badge success">较「${e(tr.compare_exam?.name || '上次')}」升档 ${n(tr.up_count, 0)} 人</span>
        <span class="badge">守档 ${n(tr.same_count, 0)} 人</span>
        <span class="badge ${tr.down_count >= 5 ? 'danger' : 'warning'}">降档 ${n(tr.down_count, 0)} 人</span>
      </div>
      ${(tr.top_flows || []).length ? `<div class="lvl-flow-chips">${tr.top_flows.map(f =>
        `<span class="hygiene-chip">${e(f.flow)}：<b>${n(f.count, 0)}人</b></span>`
      ).join('')}</div>` : ''}
    </div>` : '<p class="inline-help" style="margin:8px 0 0">导入同年级多场考试后，此处自动统计较上次升档、守档与降档流动。</p>';

    const synTable = `<div class="section-title" style="margin-top:16px">
      <div><h3>学科脱敏协同表（无均分 · 无分数线）</h3><p>用 A 档率、优良率、待转化率与「高总评·本科未达A」精准识别协同短板</p></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>学科</th><th>任课教师</th>
        ${tiers.map(t => `<th class="number">${e(t)}</th>`).join('')}
        <th class="number">A档率</th><th class="number">优良率</th><th class="number">待转化率</th>
        <th>总评A但本科未达A（优先认领）</th>
      </tr></thead>
      <tbody>${syn.map(s => {
        const miss = (s.mismatch_a_students || []).slice().sort((a, b) => cmpSurname(a.name, b.name)).map(x => `${x.name}(${x.total_level}→${x.sub_level})`).join('、') || '—';
        return `<tr>
          <td><strong>${e(s.subject)}</strong></td>
          <td>${e(s.teacher || '—')}</td>
          ${tiers.map(t => `<td class="number">${n(s.counts?.[t] ?? 0, 0)}</td>`).join('')}
          <td class="number"><b>${pct(s.a_rate)}</b></td>
          <td class="number">${pct(s.good_rate)}</td>
          <td class="number ${(s.c_rate || 0) >= 25 ? 'delta-negative' : ''}">${pct(s.c_rate)}</td>
          <td class="lvl-mismatch-cell">${s.mismatch_a_count ? `<span class="badge warning" style="margin-right:5px">${s.mismatch_a_count}人</span>${e(miss)}` : '<span class="muted">全部同步达A</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    return `${stacked}${cards}${flowStrip}${synTable}`;
  }

  function renderLeversTab(lp, state) {
    const tiers = lp.tiers || [];
    const counts = lp.counts || {};
    const filterMode = state.briefLevelFilter || 'all';
    const sortMode = state.briefLevelSort || 'surname';
    const rows = filterLevers(lp.student_levers || [], filterMode, sortMode, tiers);
    const pills = [
      ['all', `全班 (${counts.all ?? counts.total ?? 0})`],
      ['slide', `⚠️ 滑坡/降档 (${counts.slide || 0})`],
      ['push', `🎯 升档临界 (${counts.push || 0})`],
      ['drag', `📌 拖档偏科 (${counts.drag || 0})`],
      ['surge', `🚀 升档跃升 (${counts.surge || 0})`],
    ];

    const trs = rows.length ? rows.map(r => {
      const statusCls = r.status_code === 'slide' ? 'danger' : r.status_code === 'dip' ? 'warning'
        : r.status_code === 'surge' ? 'success' : r.status_code === 'rise' ? 'good-soft' : '';
      const pushHtml = r.push_target
        ? `<span class="badge ${r.push_target.single_block ? 'warning' : ''}">${e(r.push_target.label)}</span>${(r.push_target.block_subjects || []).length ? ` <small class="muted">${r.push_target.single_block ? '单科卡壳:' : ''}${e(r.push_target.block_subjects.join('、'))}</small>` : ''}`
        : '<span class="muted">—</span>';
      const dragHtml = (r.drag_subjects || []).length
        ? r.drag_subjects.map(d => `<span class="weak-pill${d.persistent || d.drag_steps >= 2 ? ' is-persist' : ''}">${e(d.subject)}${d.persistent ? '★' : ''} <small>${e(d.level)}</small></span>`).join(' ')
        : '<span class="muted">—</span>';
      const strHtml = (r.strength_subjects || []).length
        ? r.strength_subjects.map(s => `<span class="weak-pill is-good">${e(s.subject)} <small>${e(s.level)}</small></span>`).join(' ')
        : '<span class="muted">—</span>';
      return `<tr>
        <td><strong>${e(r.name)}</strong></td>
        <td><span class="lvl-status-pill ${statusCls}">${e(r.status_label)}</span></td>
        <td>${pushHtml}</td>
        <td>${dragHtml}</td>
        <td>${strHtml}</td>
        <td class="small-text">${e(r.driver_text || '—')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="muted" style="text-align:center">当前筛选下没有学生记录。</td></tr>';

    return `<div class="toolbar" style="margin-bottom:10px">
      <div class="tab-strip compact-tabs" style="margin:0">${pills.map(([id, label]) =>
        `<button type="button" data-action="brief-lvl-filter" data-filter="${id}" class="${filterMode === id ? 'active' : ''}">${e(label)}</button>`
      ).join('')}</div>
      <div class="spacer"></div>
      <button type="button" class="btn secondary small" data-action="copy-brief-levers">复制脱敏清单</button>
      <button type="button" class="btn secondary small" data-action="csv-brief-levers">CSV</button>
      <button type="button" class="btn primary small" data-action="print-brief-levers">打印本清单（1页A4）</button>
    </div>
    <div class="table-wrap comp-table-wrap"><table>
      <thead><tr>
        <th>姓名</th><th>状态信号</th>
        <th>升档临门一脚</th><th>拖档 / 薄弱科（★连弱）</th><th>优势鼓励科</th><th>波动主因</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table></div>
    <p class="table-note">本视图严格遵循「零分数 · 零名次」脱敏原则，默认按姓氏拼音顺序排列，查人快捷且绝不泄露任何名次先后；可直接用于科任教师教学帮扶与谈心。</p>`;
  }

  function renderGroupsTab(brief, lp, state) {
    const syn = lp.subject_synergy || [];
    if (!syn.length) return '<p class="muted">当前考试暂无学科数据。</p>';
    const currentSub = syn.some(s => s.subject === state.briefLevelSubject) ? state.briefLevelSubject : syn[0].subject;
    const item = syn.find(s => s.subject === currentSub) || syn[0];
    const tiers = lp.tiers || [];

    const subPills = `<div class="toolbar" style="margin-bottom:12px">
      <div class="check-group">${syn.map(s =>
        `<button type="button" class="scale-pill${s.subject === item.subject ? ' active' : ''}" data-action="brief-lvl-subject" data-subject="${e(s.subject)}">${e(s.subject)}</button>`
      ).join('')}</div>
      <div class="spacer"></div>
      <button type="button" class="btn primary small" data-action="print-subject-groups" data-subject="${e(item.subject)}">打印${e(item.subject)}分层分组单</button>
    </div>`;

    const summaryBar = `<div class="lvl-sub-summary">
      <span><b>${e(item.subject)}</b>（任课教师：${e(item.teacher || '未录入')}）</span>
      <span>A档率 <b>${pct(item.a_rate)}</b></span>
      <span>优良率 <b>${pct(item.good_rate)}</b></span>
      <span>待转化率 <b>${pct(item.c_rate)}</b></span>
      <span>${tiers.map(t => `${e(t)}:${n(item.counts?.[t] ?? 0, 0)}`).join(' / ')}</span>
    </div>`;

    const mismatchSorted = (item.mismatch_a_students || []).slice().sort((a, b) => cmpSurname(a.name, b.name));
    const mismatchBox = item.mismatch_a_count ? `<div class="lvl-claim-box">
      <strong>优先认领 · 总评已达 A 档但「${e(item.subject)}」未达 A 档（${item.mismatch_a_count} 人）</strong>
      <p>${mismatchSorted.map(x => `<span class="hygiene-chip is-warn">${e(x.name)}（总评${e(x.total_level)} · ${e(item.subject)}${e(x.sub_level)}）</span>`).join(' ')}</p>
    </div>` : '';

    const groupCards = `<div class="lvl-groups-grid">${(item.teaching_groups || []).map(g => {
      const names = (g.names || []).slice().sort(cmpSurname);
      return `<div class="lvl-group-card grp-${e(g.id)}">
      <header><strong>${e(g.label)}</strong><span class="badge">${names.length} 人</span></header>
      <p class="grp-hint">${e(g.hint)}</p>
      <div class="grp-names">${names.length ? names.map(nm => `<span>${e(nm)}</span>`).join('') : '<em class="muted">暂无学生</em>'}</div>
    </div>`;
    }).join('')}</div>`;

    return `${subPills}${summaryBar}${mismatchBox}${groupCards}`;
  }

  function renderLevelsSectionHTML(brief, state) {
    const lp = brief?.level_profile;
    if (!lp) return '';
    const tab = state.briefLevelTab || 'dist';
    const tiersText = (lp.tiers || []).join(' / ');
    let body = '';
    if (tab === 'levers') body = renderLeversTab(lp, state);
    else if (tab === 'groups') body = renderGroupsTab(brief, lp, state);
    else body = renderDistTab(lp);

    return `<section class="panel lvl-panel">
      <div class="section-title">
        <div>
          <h2 class="brief-hero-title"><span>六层等级与教师脱敏抓手（无分无名次）</span><span class="badge">${e(lp.structure_tag)}</span></h2>
          <p>按口径等级（${e(tiersText)}）生成脱敏教学抓手，不透露任何学生原始分数与具体名次，方便直接发给科任老师</p>
        </div>
        <div class="panel-heading-actions">
          <button type="button" class="btn primary small" data-action="print-teacher-safe">打印教师脱敏抓手册</button>
        </div>
      </div>
      <div class="tab-strip compact-tabs">
        <button type="button" data-action="brief-lvl-tab" data-tab="dist" class="${tab === 'dist' ? 'active' : ''}">六层分布与学科协同</button>
        <button type="button" data-action="brief-lvl-tab" data-tab="levers" class="${tab === 'levers' ? 'active' : ''}">学生脱敏抓手清单（${n(lp.counts?.all ?? lp.counts?.total, 0)}）</button>
        <button type="button" data-action="brief-lvl-tab" data-tab="groups" class="${tab === 'groups' ? 'active' : ''}">单科四层教学分组</button>
      </div>
      ${body}
    </section>`;
  }

  /* ==================== Print Studio Modules M9 & M10 (ZERO scores/ranks!) ==================== */

  function modM9HTML(brief) {
    const lp = brief.level_profile;
    if (!lp) return '';
    const tiers = lp.tiers || [];
    const dist = lp.total_distribution || [];
    const tr = lp.transitions || {};
    const syn = lp.subject_synergy || [];

    const distCells = dist.map(d => `<div class="pm-lvl-box">
      <small>${e(d.level)}（基准${n(d.expected_rate, 0)}%）</small>
      <strong>${n(d.count, 0)}人 <em>${pct(d.rate)}</em></strong>
      <span>${d.delta_count != null ? `较上次 ${signed(d.delta_count, 0)}` : `较基准 ${signed(d.rate_diff, 1, '%')}`}</span>
    </div>`).join('');

    const flowLine = tr.available
      ? `较「${e(tr.compare_exam?.name || '上次')}」（匹配 ${n(tr.matched_count, 0)} 人）：<b>升档 ${n(tr.up_count, 0)} 人</b> ｜ 守档 ${n(tr.same_count, 0)} 人 ｜ <b>降档 ${n(tr.down_count, 0)} 人</b>${(tr.top_flows || []).length ? `（主要流动：${tr.top_flows.slice(0, 4).map(f => `${e(f.flow)} ${f.count}人`).join('、')}）` : ''}`
      : '暂无历史考试对照，导入多场考试后自动显示档位跃迁统计。';

    const synRows = syn.map(s => {
      const miss = (s.mismatch_a_students || []).slice().sort((a, b) => cmpSurname(a.name, b.name)).slice(0, 8).map(x => `${x.name}(${x.sub_level})`).join('、') || '全部达A';
      return `<tr>
        <td><b>${e(s.subject)}</b></td>
        <td class="c">${e(s.teacher || '—')}</td>
        ${tiers.map(t => `<td class="num">${n(s.counts?.[t] ?? 0, 0)}</td>`).join('')}
        <td class="num"><b>${pct(s.a_rate)}</b></td>
        <td class="num">${pct(s.good_rate)}</td>
        <td class="num">${pct(s.c_rate)}</td>
        <td>${s.mismatch_a_count ? `${s.mismatch_a_count}人：${e(miss)}` : '全部达A'}</td>
      </tr>`;
    }).join('');

    return `<section class="pm-mod pm-avoid">
      <div class="pm-mod-head">
        <h3>六层等级分布与学科脱敏协同表（无分无名次）</h3>
        <span>结构画像：${e(lp.structure_tag)} · 全程不含原始分数与具体名次</span>
      </div>
      <div class="pm-lvl-grid" style="grid-template-columns:repeat(${Math.min(tiers.length, 6)}, 1fr)">${distCells}</div>
      <div class="pm-flow-bar">${flowLine}</div>
      <table class="pm-table pm-tight" style="margin-top:5px">
        <thead><tr>
          <th style="width:38px">学科</th><th class="c" style="width:50px">教师</th>
          ${tiers.map(t => `<th class="num" style="width:26px">${e(t)}</th>`).join('')}
          <th class="num" style="width:42px">A档率</th><th class="num" style="width:42px">优良率</th><th class="num" style="width:44px">待转化</th>
          <th>总评A但本科未达A（认领名单）</th>
        </tr></thead>
        <tbody>${synRows}</tbody>
      </table>
    </section>`;
  }

  function formatCompactStatus(code) {
    if (code === 'surge') return '▲ 显著跃升';
    if (code === 'rise') return '↗ 稳步上行';
    if (code === 'dip') return '↘ 略有回落';
    if (code === 'slide') return '▼ 滑坡·谈心';
    return '● 守档';
  }

  function formatCompactPush(pt) {
    if (!pt) return '—';
    const target = String(pt.target_level || pt.label || '').replace(/^冲\s*/, '');
    const blocks = (pt.block_subjects || []).map(b => String(b).replace(/\(([^)]+)\)/, '$1'));
    if (!blocks.length) return `冲${target}`;
    return pt.single_block ? `冲${target}★${blocks[0]}` : `冲${target}:${blocks.slice(0, 2).join('/')}`;
  }

  function formatCompactDrag(list) {
    if (!list || !list.length) return '—';
    return list.slice(0, 3).map(d => `${d.subject}${d.persistent ? '★' : ''}(${d.level})`).join(' ');
  }

  function formatCompactStrength(list) {
    if (!list || !list.length) return '—';
    return list.slice(0, 2).map(s => `${s.subject}(${s.level})`).join(' ');
  }

  function modM10HTML(brief, cfg, isFirstModule) {
    const lp = brief.level_profile;
    if (!lp) return '';
    const filterMode = cfg.m10Filter || 'all';
    const sortMode = cfg.m10Sort || 'surname';
    const rows = filterLevers(lp.student_levers || [], filterMode, sortMode, lp.tiers || []);
    const filterLabels = { all: '全班学生', slide: '滑坡/降档预警', push: '升档临界生', drag: '拖档偏科生', surge: '升档跃升生' };
    const sortLabel = sortMode === 'level' ? '按档位归组排序' : '按姓氏拼音排序';
    const denseCls = rows.length > 48 ? ' is-ultra-dense' : '';
    const trs = rows.map((r, i) => {
      const rowCls = r.status_code === 'slide' ? 'row-alert' : r.status_code === 'surge' ? 'row-good' : '';
      const stCls = r.status_code === 'slide' ? 'g-dn is-bold' : r.status_code === 'dip' ? 'g-dn' : (r.status_code === 'surge' || r.status_code === 'rise') ? 'g-up' : '';
      return `<tr class="${rowCls}">
        <td class="num">${i + 1}</td>
        <td><b>${e(r.name)}</b></td>
        <td class="nw ${stCls}">${e(formatCompactStatus(r.status_code))}</td>
        <td class="nw">${e(formatCompactPush(r.push_target))}</td>
        <td class="nw">${e(formatCompactDrag(r.drag_subjects))}</td>
        <td class="nw">${e(formatCompactStrength(r.strength_subjects))}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="c">当前筛选范围内没有学生记录。</td></tr>';

    let groupsBlock = '';
    if (cfg.m10IncludeGroups) {
      const syn = lp.subject_synergy || [];
      groupsBlock = `<div class="pm-mod pm-break-before">
        <div class="pm-mod-head"><h3>各学科课堂四层教学分组（无分无名次）</h3><span>按单科档位自动分组，组内按姓氏拼音排序，供科任教师分层作业与面批</span></div>
        ${syn.map(s => `<div class="pm-avoid pm-sub-block">
          <div class="pm-sub-bar">${e(s.subject)}（${e(s.teacher || '未录教师')} · A档率 ${pct(s.a_rate)} · 待转化 ${pct(s.c_rate)}）</div>
          <table class="pm-table pm-tight">
            <tbody>${(s.teaching_groups || []).map(g => {
              const names = (g.names || []).slice().sort(cmpSurname);
              return `<tr><td style="width:128px"><b>${e(g.label)}</b> (${names.length})</td><td>${e(names.join('、') || '—')}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>`).join('')}
      </div>`;
    }

    const pageBreakCls = cfg.m10PageBreak && !isFirstModule ? ' pm-break-before' : '';
    return `<section class="pm-mod pm-m10${pageBreakCls}">
      <div class="pm-mod-head">
        <h3>学生无分无名次抓手清单（${e(filterLabels[filterMode] || '全班学生')} · ${rows.length} 人）</h3>
        <span>${sortLabel}（不含分数与名次） · ★连续薄弱科 · 冲X★表示单科卡壳最易升档</span>
      </div>
      <table class="pm-table pm-m10-table${denseCls}">
        <thead><tr>
          <th class="num" style="width:22px">序</th>
          <th style="width:48px">姓名</th>
          <th style="width:74px">状态信号</th>
          <th style="width:112px">升档临门一脚</th>
          <th>拖档 / 薄弱科（★连弱）</th>
          <th style="width:100px">优势鼓励科</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </section>${groupsBlock}`;
  }

  function printSubjectGroups(brief, subjectName) {
    const lp = brief?.level_profile;
    const item = (lp?.subject_synergy || []).find(s => s.subject === subjectName);
    if (!item) return;
    const m = brief.meta;
    const tiers = lp.tiers || [];
    const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${e(m.grade)} ${e(m.class)}班 · ${e(item.subject)}分层教学分组单（无分无名次）</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "PingFang SC","Microsoft YaHei",sans-serif; color: #1e192b; background: #edeaf4; font-size: 11px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-bar { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; background: #261e38; color: #fff; font-size: 13px; }
  .print-bar button { background: #6f4eb8; color: #fff; border: 0; border-radius: 6px; padding: 7px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .sheet { width: 210mm; min-height: 297mm; margin: 18px auto; background: #fff; padding: 12mm 13mm; box-shadow: 0 8px 28px rgba(34,24,60,.16); }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #6f4eb8; padding-bottom: 8px; margin-bottom: 12px; }
  .head h1 { margin: 2px 0 0; font-size: 18px; }
  .brand { font-size: 10px; color: #6f4eb8; font-weight: 650; }
  .meta { text-align: right; font-size: 10.5px; color: #5f5672; }
  .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .kpi { border: 1px solid #d9d1e8; border-radius: 6px; padding: 7px 10px; background: #faf8fd; }
  .kpi small { display: block; font-size: 10px; color: #675e78; }
  .kpi strong { font-size: 16px; color: #3c2869; }
  .claim { border: 1px solid #e6c68a; background: #fef9ee; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; }
  .claim strong { display: block; color: #8c5a12; margin-bottom: 4px; }
  .groups { display: grid; gap: 10px; }
  .grp { border: 1px solid #d9d1e8; border-radius: 6px; padding: 10px 12px; break-inside: avoid; }
  .grp-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .grp-h strong { font-size: 13px; color: #36255c; }
  .grp-hint { font-size: 10.5px; color: #6c627e; margin: 0 0 8px; }
  .names { display: flex; flex-wrap: wrap; gap: 6px; }
  .names span { display: inline-block; padding: 2px 9px; border-radius: 4px; border: 1px solid #dfd7ee; background: #faf8fd; font-size: 11.5px; font-weight: 550; }
  .foot { margin-top: 14px; font-size: 10px; color: #786e8a; border-top: 1px dashed #d4cbe4; padding-top: 8px; }
  @media print { body { background: #fff; } .print-bar { display: none; } .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; } }
</style></head>
<body>
  <div class="print-bar"><span>${e(m.grade)} ${e(m.class)}班 · ${e(item.subject)}分层教学分组单（无分无名次）</span><button onclick="window.print()">打印 / 另存为 PDF</button></div>
  <div class="sheet">
    <div class="head">
      <div><div class="brand">融侨学迹 · 科任教师脱敏教学分组单（不含原始分数与具体名次）</div><h1>${e(m.grade)} · ${e(m.class)}班 ${e(item.subject)}四层教学分组</h1></div>
      <div class="meta"><strong>${e(m.exam_name)}（${e(m.exam_date)}）</strong><br>任课教师：${e(item.teacher || '未录入')} ｜ 班主任：${e(m.homeroom || '未录入')}</div>
    </div>
    <div class="strip">
      <div class="kpi"><small>A档率（${e((lp.a_tiers || []).join('+'))}）</small><strong>${pct(item.a_rate)}</strong></div>
      <div class="kpi"><small>优良率</small><strong>${pct(item.good_rate)}</strong></div>
      <div class="kpi"><small>待转化率（${e((lp.c_tiers || []).join('+'))}）</small><strong>${pct(item.c_rate)}</strong></div>
      <div class="kpi"><small>各档人数</small><strong style="font-size:12px">${tiers.map(t => `${e(t)}:${n(item.counts?.[t] ?? 0, 0)}`).join(' ')}</strong></div>
    </div>
    ${item.mismatch_a_count ? `<div class="claim"><strong>优先认领：总评已达 A 档但「${e(item.subject)}」未达 A 档（${item.mismatch_a_count} 人）</strong><div>${(item.mismatch_a_students || []).slice().sort((a, b) => cmpSurname(a.name, b.name)).map(x => `${e(x.name)}（总评${e(x.total_level)} → 本科${e(x.sub_level)}）`).join('、')}</div></div>` : ''}
    <div class="groups">${(item.teaching_groups || []).map(g => {
      const names = (g.names || []).slice().sort(cmpSurname);
      return `<div class="grp">
      <div class="grp-h"><strong>${e(g.label)}</strong><span>共 ${names.length} 人</span></div>
      <p class="grp-hint">教学策略：${e(g.hint)}</p>
      <div class="names">${names.length ? names.map(nm => `<span>${e(nm)}</span>`).join('') : '<em>暂无学生</em>'}</div>
    </div>`;
    }).join('')}</div>
    <div class="foot">说明：本分组单严格隐去所有学生的原始分数与年级/班级具体名次，组内按姓氏拼音排序，可直接用于课堂分层教学、分层作业与个别辅导。</div>
  </div>
</body></html>`;
    const win = window.open('', '_blank', 'width=940,height=860');
    if (!win) { Z.notice('浏览器拦截了打印预览窗口，请允许弹窗后重试。', true); return; }
    win.document.open(); win.document.write(doc); win.document.close();
  }

  window.LeaderLevels = {
    filterLevers,
    leversTableObj,
    renderLevelsSectionHTML,
    modM9HTML,
    modM10HTML,
    printSubjectGroups,
  };
})();

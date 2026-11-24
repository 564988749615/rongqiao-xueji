'use strict';
/* 融侨学迹 · 学生较上次对比分析 + 班情分析 8 大模块自由组合打印台 */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 1) => Z.num(v, d);
  const STORAGE_KEY = 'zhixu-print-studio-v1';

  const signed = (v, d = 0, suffix = '') => {
    if (v === null || v === undefined || v === '') return '—';
    const num = Number(v);
    if (!Number.isFinite(num)) return '—';
    if (num === 0) return `0${suffix}`;
    return `${num > 0 ? '+' : ''}${n(num, d)}${suffix}`;
  };
  const pctText = v => (v === null || v === undefined ? '—' : `${n(v, 1)}%`);

  const MODULES = [
    { id: 'M1', name: '班情核心 KPI 与谈话要点', desc: '双线人数/占比、较上次与首考增减、尖优含金量、均分及核心谈话要点' },
    { id: 'M2', name: '双线分学科诊断与同师对比', desc: '任课教师、各科均分、双线达标/集中与贡献差、同师另班对照' },
    { id: 'M3', name: '历次双线走势与人员流动', desc: '历次 20%/40% 双线走势图 + 较上次保尖率、守线率、掉线/突围流动' },
    { id: 'M4', name: '学生较上次对比明细表', desc: 'A4 竖版精简 1 页排全班：本次/上次总分与名次、名次进退、薄弱科、单科波动' },
    { id: 'M5', name: '分层抓手与包干微名单', desc: '冲尖优临界、保达标临界、中优层流失预警、连续薄弱学科、导师制名单' },
    { id: 'M6', name: '历次单科名次段纵向对比', desc: '原模板1：总分与各科历次名次段趋势（可选领导版 50–800 或教师版 200–800）' },
    { id: 'M7', name: '有效分与薄弱科统计矩阵', desc: '原模板2：历次达标集中率 + 本次单科前 100–500 矩阵 + 薄弱学科统计' },
    { id: 'M8', name: '班情会手写纪要与签字栏', desc: '核心定性、整改抓手、包干责任人、下次复盘节点及领导/班主任签字' },
    { id: 'M9', name: '等级分布与学科协同表', desc: 'A1/A2/B1/B2/C1/C2 分布与跃迁、各科 A档率/待转化率、认领名单' },
    { id: 'M10', name: '学生学情与帮扶清单（教师版）', desc: 'A4 竖版精简 1 页排全班：状态信号、升档临门一脚、拖档薄弱科与优势鼓励科（按姓氏排序）' },
  ];

  const PRESETS = {
    leader: {
      id: 'leader',
      name: '领导精简汇报册',
      desc: '适合行政会与约谈 · 按名次排序（M1+M2+M3+M5+M8）',
      enabled: ['M1', 'M2', 'M3', 'M5', 'M8'],
      order: ['M1', 'M2', 'M3', 'M5', 'M8', 'M4', 'M9', 'M10', 'M6', 'M7'],
      m4Filter: 'all',
      m4Sort: 'rank',
      m4PageBreak: true,
      m6Variant: 'leader',
      m7Ratio: 'main',
      m10Filter: 'all',
      m10Sort: 'surname',
      m10PageBreak: true,
      m10IncludeGroups: false,
    },
    full: {
      id: 'full',
      name: '班情分析完整作战册（领导版）',
      desc: '班情会全套材料 · 学生按名次排序（含 M4 全班对比）',
      enabled: ['M1', 'M2', 'M3', 'M4', 'M5', 'M8'],
      order: ['M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M10', 'M6', 'M7'],
      m4Filter: 'all',
      m4Sort: 'rank',
      m4PageBreak: true,
      m6Variant: 'leader',
      m7Ratio: 'main',
      m10Filter: 'all',
      m10Sort: 'surname',
      m10PageBreak: true,
      m10IncludeGroups: false,
    },
    teacher: {
      id: 'teacher',
      name: '班主任 / 科任复盘册（教师版）',
      desc: '学生按姓氏拼音排序 · 含较上次对比、薄弱科与单科名次段',
      enabled: ['M1', 'M2', 'M4', 'M6', 'M7'],
      order: ['M1', 'M2', 'M4', 'M6', 'M7', 'M3', 'M5', 'M9', 'M10', 'M8'],
      m4Filter: 'all',
      m4Sort: 'surname',
      m4PageBreak: true,
      m6Variant: 'teacher',
      m7Ratio: 'main',
      m10Filter: 'all',
      m10Sort: 'surname',
      m10PageBreak: true,
      m10IncludeGroups: false,
    },
    teacher_safe: {
      id: 'teacher_safe',
      name: '教师学情帮扶册（仅等级）',
      desc: '仅呈现等级与教学抓手 · 按姓氏拼音排序：等级分布 + 学生帮扶清单 + 分层分组',
      enabled: ['M9', 'M10', 'M8'],
      order: ['M9', 'M10', 'M8', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'],
      m4Filter: 'all',
      m4Sort: 'surname',
      m4PageBreak: true,
      m6Variant: 'teacher',
      m7Ratio: 'main',
      m10Filter: 'all',
      m10Sort: 'surname',
      m10PageBreak: true,
      m10IncludeGroups: true,
    },
  };

  function defaultConfig() {
    return {
      preset: 'full',
      enabled: [...PRESETS.full.enabled],
      order: [...PRESETS.full.order],
      scope: 'current',
      m4Filter: 'all',
      m4Sort: 'rank',
      m4PageBreak: true,
      m6Variant: 'leader',
      m7Ratio: 'main',
      m10Filter: 'all',
      m10Sort: 'surname',
      m10PageBreak: true,
      m10IncludeGroups: true,
    };
  }

  function loadConfig() {
    const def = defaultConfig();
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return def;
      const validIds = new Set(MODULES.map(m => m.id));
      const order = Array.isArray(raw.order) ? raw.order.filter(id => validIds.has(id)) : [];
      MODULES.forEach(m => { if (!order.includes(m.id)) order.push(m.id); });
      const enabled = Array.isArray(raw.enabled) ? raw.enabled.filter(id => validIds.has(id)) : def.enabled;
      return {
        preset: raw.preset || 'custom',
        enabled: enabled.length ? enabled : def.enabled,
        order,
        scope: raw.scope === 'all' ? 'all' : 'current',
        m4Filter: ['all', 'big_drop', 'big_gain', 'big_shift', 'borderline', 'mentor'].includes(raw.m4Filter) ? raw.m4Filter : 'all',
        m4Sort: ['rank', 'surname', 'drop', 'gain'].includes(raw.m4Sort) ? raw.m4Sort : 'rank',
        m4PageBreak: raw.m4PageBreak !== false,
        m6Variant: raw.m6Variant === 'teacher' ? 'teacher' : 'leader',
        m7Ratio: ['main', 'high', 'mid30'].includes(raw.m7Ratio) ? raw.m7Ratio : 'main',
        m10Filter: ['all', 'slide', 'push', 'drag', 'surge'].includes(raw.m10Filter) ? raw.m10Filter : 'all',
        m10Sort: ['surname', 'level'].includes(raw.m10Sort) ? raw.m10Sort : 'surname',
        m10PageBreak: raw.m10PageBreak !== false,
        m10IncludeGroups: raw.m10IncludeGroups !== false,
      };
    } catch (_) {
      return def;
    }
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  function filterComparisonRows(rows, filterMode = 'all', sortMode = 'rank') {
    const list = (rows || []).filter(r => {
      if (filterMode === 'big_gain') return r.is_big_gain;
      if (filterMode === 'big_drop') return r.is_big_drop;
      if (filterMode === 'big_shift') return r.is_big_gain || r.is_big_drop;
      if (filterMode === 'borderline') return r.in_borderline_high || r.in_borderline_main;
      if (filterMode === 'mentor') return r.in_mentor;
      return true;
    }).slice();

    if (sortMode === 'surname') {
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    } else if (sortMode === 'drop') {
      list.sort((a, b) => (a.rank_gain ?? 999999) - (b.rank_gain ?? 999999) || (a.rank ?? 999999) - (b.rank ?? 999999));
    } else if (sortMode === 'gain') {
      list.sort((a, b) => (b.rank_gain ?? -999999) - (a.rank_gain ?? -999999) || (a.rank ?? 999999) - (b.rank ?? 999999));
    } else {
      list.sort((a, b) => (a.class_rank ?? 999999) - (b.class_rank ?? 999999) || (a.rank ?? 999999) - (b.rank ?? 999999));
    }
    return list;
  }

  function formatGainText(gain) {
    if (gain === null || gain === undefined) return '—';
    if (gain === 0) return '持平';
    return gain > 0 ? `↑${gain}` : `↓${Math.abs(gain)}`;
  }

  function formatWeakDetail(w) {
    const parts = [];
    if (w.score !== null && w.score !== undefined) parts.push(`${n(w.score, 1)}`);
    if (w.rank !== null && w.rank !== undefined) parts.push(`${n(w.rank, 0)}名`);
    return parts.length ? parts.join('/') : '';
  }

  function formatWeakText(items) {
    if (!items || !items.length) return '—';
    return items.map(w => {
      const tag = w.persistent ? `${w.subject}★` : w.subject;
      const detail = formatWeakDetail(w);
      return detail ? `${tag}(${detail})` : tag;
    }).join('、');
  }

  function formatWeakPrintHTML(items) {
    if (!items || !items.length) return '—';
    return items.map(w => {
      const detail = formatWeakDetail(w);
      const nameHtml = w.persistent ? `<b>${e(w.subject)}★</b>` : e(w.subject);
      return `<span class="wk-item">${nameHtml}${detail ? `<small> ${e(detail)}</small>` : ''}</span>`;
    }).join('<span class="wk-sep">、</span>');
  }

  function comparisonTableObj(brief, filterMode = 'all', sortMode = 'rank') {
    const comp = brief?.student_comparison || {};
    const rows = filterComparisonRows(comp.rows || [], filterMode, sortMode);
    const baseName = comp.compare_exam ? `${comp.compare_exam.name}（${comp.compare_exam.date}）` : '暂无对比基准';
    return {
      title: `${brief.meta.class}班 · 学生较上次对比与薄弱学科`,
      columns: ['班内序', '姓名', '层级', '本次总分', '本次年级名次', '上次总分', '上次年级名次', '名次进退', '薄弱学科（分数/名次 · ★连弱）', '单科波动归因'],
      rows: rows.map(r => [
        r.class_rank,
        r.name,
        r.tier_label,
        r.total,
        r.rank,
        r.prev_total,
        r.prev_rank,
        formatGainText(r.rank_gain),
        formatWeakText(r.weak),
        r.sub_mover_text || '—',
      ]),
      note: `${brief.meta.grade} · ${brief.meta.exam_name}（${brief.meta.exam_date}） · 对比基准：${baseName} · ★表示连续两场位列薄弱学科`,
    };
  }

  function renderComparisonSectionHTML(brief, state) {
    const comp = brief?.student_comparison;
    if (!comp) return '';
    const allRows = comp.rows || [];
    const filterMode = state.briefCompFilter || 'all';
    const sortMode = state.briefCompSort || 'rank';
    const rows = filterComparisonRows(allRows, filterMode, sortMode);
    const opts = comp.compare_options || [];
    const baseExam = comp.compare_exam;
    const borderCount = allRows.filter(r => r.in_borderline_high || r.in_borderline_main).length;
    const mentorCount = allRows.filter(r => r.in_mentor).length;

    const filterTabs = [
      ['all', `全班学生 (${allRows.length})`],
      ['big_drop', `显著退步 (${comp.big_drop_count || 0})`],
      ['big_gain', `显著进步 (${comp.big_gain_count || 0})`],
      ['borderline', `双线临界 (${borderCount})`],
      ['mentor', `导师制 (${mentorCount})`],
    ];

    const bodyRows = rows.length ? rows.map(r => {
      const g = r.rank_gain;
      const gainCls = g == null || g === 0 ? '' : g > 0 ? 'delta-positive' : 'delta-negative';
      const gainBadge = g == null ? '—' : g === 0 ? '<span class="muted">持平</span>'
        : `<span class="comp-gain ${gainCls} ${r.is_big_gain || r.is_big_drop ? 'is-strong' : ''}">${g > 0 ? `↑${g}` : `↓${Math.abs(g)}`}</span>`;
      const tierBadge = r.tier === 'high'
        ? `<span class="badge success">${e(r.tier_label)}</span>`
        : r.tier === 'main'
          ? `<span class="badge">${e(r.tier_label)}</span>`
          : '<span class="muted">—</span>';
      const weakHtml = (r.weak || []).length
        ? r.weak.map(w => {
            const detail = formatWeakDetail(w);
            const detailHtml = detail ? ` <small>${e(detail)}</small>` : '';
            return w.persistent
              ? `<span class="weak-pill is-persist" title="连续薄弱学科 · 本次得分/年级名次">${e(w.subject)}★${detailHtml}</span>`
              : `<span class="weak-pill" title="本次得分/年级名次">${e(w.subject)}${detailHtml}</span>`;
          }).join(' ')
        : '<span class="muted">—</span>';
      const mover = r.sub_mover_text || '—';
      const moverCls = mover.includes('↓') ? 'delta-negative' : mover.includes('↑') ? 'delta-positive' : 'muted';
      return `<tr>
        <td class="number">${n(r.class_rank, 0)}</td>
        <td><strong>${e(r.name)}</strong></td>
        <td>${tierBadge}</td>
        <td class="number">${n(r.total, 1)}</td>
        <td class="number">${n(r.rank, 0)}</td>
        <td class="number">${r.prev_total == null ? '—' : n(r.prev_total, 1)}</td>
        <td class="number">${r.prev_rank == null ? '—' : n(r.prev_rank, 0)}</td>
        <td class="number">${gainBadge}</td>
        <td>${weakHtml}</td>
        <td class="${moverCls}">${e(mover)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="10" class="muted" style="text-align:center">当前筛选条件下没有学生记录。</td></tr>';

    return `<section class="panel">
      <div class="section-title">
        <div>
          <h2>学生较上次对比与薄弱学科</h2>
          <p>${baseExam
            ? `对比基准：<strong>${e(baseExam.name)}</strong>（${e(baseExam.date)}） · 匹配 ${n(comp.matched_count, 0)} 人 · 显著进步 ${n(comp.big_gain_count, 0)} 人 · 显著退步 ${n(comp.big_drop_count, 0)} 人`
            : '当前年级仅保存 1 场考试；导入更多考试后将自动计算较上次总分、名次进退与单科波动归因。'}</p>
        </div>
        <div class="toolbar-inline">
          ${opts.length ? `<label class="small-text">对比基准
            <select id="brief-compare-exam" aria-label="选择对比基准考试">${opts.map(o =>
              `<option value="${e(o.id)}"${baseExam && baseExam.id === o.id ? ' selected' : ''}>${e(o.name)}${o.is_prev ? '（上一场）' : ''} · ${e(o.date)}</option>`
            ).join('')}</select>
          </label>` : ''}
          <label class="small-text">排序
            <select id="brief-comp-sort" aria-label="学生对比排序">
              <option value="rank"${sortMode === 'rank' ? ' selected' : ''}>按本次名次（领导版）</option>
              <option value="surname"${sortMode === 'surname' ? ' selected' : ''}>按姓氏拼音（教师版）</option>
              <option value="drop"${sortMode === 'drop' ? ' selected' : ''}>按退步最多优先</option>
              <option value="gain"${sortMode === 'gain' ? ' selected' : ''}>按进步最多优先</option>
            </select>
          </label>
          <button type="button" class="btn secondary small" data-action="copy-brief-comp">复制</button>
          <button type="button" class="btn secondary small" data-action="csv-brief-comp">CSV</button>
          <button type="button" class="btn primary small" data-action="print-brief-comp">打印本表</button>
        </div>
      </div>
      <div class="tab-strip compact-tabs">${filterTabs.map(([id, label]) =>
        `<button type="button" data-action="brief-comp-filter" data-filter="${id}" class="${filterMode === id ? 'active' : ''}">${e(label)}</button>`
      ).join('')}</div>
      <div class="table-wrap comp-table-wrap">
        <table>
          <thead><tr>
            <th class="number">序</th><th>姓名</th><th>层级</th>
            <th class="number">本次总分</th><th class="number">本次名次</th>
            <th class="number">上次总分</th><th class="number">上次名次</th>
            <th class="number">名次进退</th><th>薄弱学科（分数/名次 · ★连弱）</th><th>单科波动归因</th>
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <p class="table-note">名次进退 = 上次年级名次 − 本次年级名次（↑ 为进步，↓ 为退步）；★ 表示该生连续两场考试位列该弱科；点击顶部「分模块组合打印」可将本表与谈话要点、学科诊断等自由拼装成班情会议材料。</p>
    </section>`;
  }

  function studioDrawerHTML(brief, cfg) {
    const m = brief.meta;
    const comp = brief.student_comparison || {};
    const opts = comp.compare_options || [];
    const baseExam = comp.compare_exam;
    const enabledSet = new Set(cfg.enabled || []);
    const orderedMods = (cfg.order || MODULES.map(x => x.id))
      .map(id => MODULES.find(x => x.id === id))
      .filter(Boolean);

    const presetBtns = Object.values(PRESETS).map(p => `<button type="button" class="studio-preset-card${cfg.preset === p.id ? ' active' : ''}" data-action="studio-preset" data-preset="${p.id}">
      <strong>${e(p.name)}</strong>
      <span>${e(p.desc)}</span>
    </button>`).join('');

    const modRows = orderedMods.map((mod, idx) => {
      const checked = enabledSet.has(mod.id);
      let extra = '';
      if (mod.id === 'M4') {
        extra = `<div class="studio-sub-opts">
          <label>人群
            <select data-studio-opt="m4Filter">
              <option value="all"${cfg.m4Filter === 'all' ? ' selected' : ''}>全班全部学生</option>
              <option value="big_shift"${cfg.m4Filter === 'big_shift' ? ' selected' : ''}>仅显著进退学生</option>
              <option value="big_drop"${cfg.m4Filter === 'big_drop' ? ' selected' : ''}>仅显著退步学生</option>
              <option value="borderline"${cfg.m4Filter === 'borderline' ? ' selected' : ''}>仅双线临界生</option>
              <option value="mentor"${cfg.m4Filter === 'mentor' ? ' selected' : ''}>仅导师制名单</option>
            </select>
          </label>
          <label>排序
            <select data-studio-opt="m4Sort">
              <option value="rank"${cfg.m4Sort === 'rank' ? ' selected' : ''}>按本次名次（领导版）</option>
              <option value="surname"${cfg.m4Sort === 'surname' ? ' selected' : ''}>按姓氏拼音（教师版）</option>
              <option value="drop"${cfg.m4Sort === 'drop' ? ' selected' : ''}>退步最多优先</option>
              <option value="gain"${cfg.m4Sort === 'gain' ? ' selected' : ''}>进步最多优先</option>
            </select>
          </label>
          <label class="studio-inline-check"><input type="checkbox" data-studio-opt="m4PageBreak"${cfg.m4PageBreak ? ' checked' : ''}><span>独立起页（1 页排全班）</span></label>
        </div>`;
      } else if (mod.id === 'M6') {
        extra = `<div class="studio-sub-opts">
          <label>名次段版本
            <select data-studio-opt="m6Variant">
              <option value="leader"${cfg.m6Variant === 'leader' ? ' selected' : ''}>领导版（前 50–800 名）</option>
              <option value="teacher"${cfg.m6Variant === 'teacher' ? ' selected' : ''}>教师版（前 200–800 名）</option>
            </select>
          </label>
        </div>`;
      } else if (mod.id === 'M7') {
        extra = `<div class="studio-sub-opts">
          <label>有效分口径
            <select data-studio-opt="m7Ratio">
              <option value="main"${cfg.m7Ratio === 'main' ? ' selected' : ''}>主达标线（前 ${Math.round(m.main_ratio * 100)}%）</option>
              <option value="high"${cfg.m7Ratio === 'high' ? ' selected' : ''}>尖优线（前 ${Math.round(m.high_ratio * 100)}%）</option>
              <option value="mid30"${cfg.m7Ratio === 'mid30' ? ' selected' : ''}>前 30%（兼容旧表）</option>
            </select>
          </label>
        </div>`;
      } else if (mod.id === 'M10') {
        extra = `<div class="studio-sub-opts">
          <label>人群
            <select data-studio-opt="m10Filter">
              <option value="all"${cfg.m10Filter === 'all' ? ' selected' : ''}>全班全部学生</option>
              <option value="slide"${cfg.m10Filter === 'slide' ? ' selected' : ''}>仅滑坡 / 降档学生</option>
              <option value="push"${cfg.m10Filter === 'push' ? ' selected' : ''}>仅升档临界生</option>
              <option value="drag"${cfg.m10Filter === 'drag' ? ' selected' : ''}>仅拖档偏科生</option>
            </select>
          </label>
          <label>排序
            <select data-studio-opt="m10Sort">
              <option value="surname"${(cfg.m10Sort || 'surname') === 'surname' ? ' selected' : ''}>按姓氏拼音（教师版默认）</option>
              <option value="level"${cfg.m10Sort === 'level' ? ' selected' : ''}>按档位归组</option>
            </select>
          </label>
          <label class="studio-inline-check"><input type="checkbox" data-studio-opt="m10PageBreak"${cfg.m10PageBreak !== false ? ' checked' : ''}><span>独立起页</span></label>
          <label class="studio-inline-check"><input type="checkbox" data-studio-opt="m10IncludeGroups"${cfg.m10IncludeGroups ? ' checked' : ''}><span>附带各科四层教学分组</span></label>
        </div>`;
      }

      return `<div class="studio-mod-row${checked ? ' is-on' : ''}">
        <div class="studio-mod-main">
          <label class="studio-mod-check">
            <input type="checkbox" data-studio-mod="${mod.id}"${checked ? ' checked' : ''}>
            <span class="studio-mod-id">${mod.id}</span>
            <span><b>${e(mod.name)}</b><small>${e(mod.desc)}</small></span>
          </label>
          <div class="studio-mod-move">
            <button type="button" class="studio-move-btn" data-action="studio-move" data-mod="${mod.id}" data-dir="-1" title="上移"${idx === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="studio-move-btn" data-action="studio-move" data-mod="${mod.id}" data-dir="1" title="下移"${idx === orderedMods.length - 1 ? ' disabled' : ''}>↓</button>
          </div>
        </div>
        ${checked && extra ? extra : ''}
      </div>`;
    }).join('');

    const enabledOrderLabels = orderedMods.filter(mod => enabledSet.has(mod.id)).map(mod => mod.id).join(' · ') || '未选';
    const customOpen = cfg.preset === 'custom' ? ' open' : '';

    return `<div class="studio-wrap">
      <div class="drawer-intro">
        <p>选好下方场景方案，再选择单班或全年级，点击底部<strong>「生成打印预览」</strong>即可 2 步出稿；如需自由增删或调整模块顺序，展开高级设置即可。</p>
      </div>

      <div class="studio-section-label">一、快捷场景方案（按角色自动匹配排序与脱敏）</div>
      <div class="studio-presets">${presetBtns}</div>

      <div class="studio-section-label">二、打印范围与对比基准</div>
      <div class="studio-scope-box">
        <label class="field">
          <span>打印范围</span>
          <select id="studio-scope" data-studio-opt="scope">
            <option value="current"${cfg.scope === 'current' ? ' selected' : ''}>仅打印当前班（${e(m.class)}班）</option>
            <option value="all"${cfg.scope === 'all' ? ' selected' : ''}>全年级批量套打（全部 ${m.classes.length} 个班，每班自动换新页）</option>
          </select>
        </label>
        ${opts.length ? `<label class="field">
          <span>学生对比基准考试（M4）</span>
          <select id="studio-compare-exam">
            ${opts.map(o => `<option value="${e(o.id)}"${baseExam && baseExam.id === o.id ? ' selected' : ''}>${e(o.name)}${o.is_prev ? '（上一场）' : ''} · ${e(o.date)}</option>`).join('')}
          </select>
        </label>` : ''}
      </div>

      <details class="studio-custom-details"${customOpen}>
        <summary>
          <span>自定义增删与排序模块（已选 <strong>${enabledSet.size}</strong> / ${MODULES.length} 项：${e(enabledOrderLabels)}）</span>
          <small>点击展开微调 ▾</small>
        </summary>
        <div class="studio-mod-list">${modRows}</div>
      </details>

      <div id="studio-error" class="error" hidden></div>
      <div class="rules-footer-bar">
        <div class="rules-footer-left">
          <button type="button" class="btn quiet small" data-action="studio-select-all">全选模块</button>
          <button type="button" class="btn quiet small" data-action="studio-preset" data-preset="full">恢复默认</button>
        </div>
        <div class="rules-footer-right">
          <button type="button" class="btn secondary" data-action="close-drawer">取消</button>
          <button type="button" class="btn primary" data-action="studio-print">生成打印预览</button>
        </div>
      </div>
    </div>`;
  }

  /* ==================== A4 Portrait Modular Print Renderers ==================== */

  function modM1HTML(brief) {
    const m = brief.meta, h = brief.headline;
    const hL = h.high.label, mL = h.main.label;
    return `<section class="pm-mod pm-avoid">
      <div class="pm-mod-head"><h3>班情核心 KPI 与谈话要点</h3><span>${e(m.exam_name)} · 实考 ${n(h.participants, 0)}/${n(h.registered, 0)} 人 · 标准差 ${n(h.std)} · 后20% ${n(h.bottom20_count, 0)} 人</span></div>
      <div class="pm-kpis">
        <div class="pm-kpi accent-green"><small>${e(hL)}尖优（线 ${n(h.high.cutoff)}）</small><strong>${n(h.high.count, 0)}人 <em>${pctText(h.high.rate)}</em></strong><span>较上次 ${signed(h.high.delta_prev_count, 0)} · 较首考 ${signed(h.high.delta_entry_count, 0)}</span></div>
        <div class="pm-kpi accent-purple"><small>${e(mL)}基本盘（线 ${n(h.main.cutoff)}）</small><strong>${n(h.main.count, 0)}人 <em>${pctText(h.main.rate)}</em></strong><span>较上次 ${signed(h.main.delta_prev_count, 0)} · 较首考 ${signed(h.main.delta_entry_count, 0)}</span></div>
        <div class="pm-kpi"><small>尖优含金量（${e(hL)}÷${e(mL)}）</small><strong>${pctText(h.elite_ratio)}</strong><span>中层蓄水池 ${Math.max(0, (h.main.count || 0) - (h.high.count || 0))} 人</span></div>
        <div class="pm-kpi"><small>总分均分（年级 ${n(h.grade_mean)}）</small><strong>${n(h.mean)} <em>${signed(h.mean_diff, 1)}</em></strong><span>${h.tags.slice(0, 2).map(t => e(t.text)).join(' · ') || '常态平稳'}</span></div>
      </div>
      <div class="pm-points">
        <div class="pm-points-title">核心谈话要点</div>
        <ol>${(h.talking_points || []).map(p => `<li>${e(p)}</li>`).join('')}</ol>
      </div>
    </section>`;
  }

  function modM2HTML(brief) {
    const h = brief.headline, hL = h.high.label, mL = h.main.label;
    const rows = (brief.subject_diagnosis || []).map(s => {
      const other = (s.same_teacher_other_classes || []).map(o => `${o.class}班(${pctText(o.main_rate)})`).join('、') || '—';
      const toneCls = s.mismatch_tone === 'good' ? 't-good' : s.mismatch_tone === 'alert' ? 't-alert' : s.mismatch_tone === 'warn' ? 't-warn' : '';
      return `<tr>
        <td><b>${e(s.subject)}</b></td>
        <td class="c">${e(s.teacher || '—')}${s.teacher_changed ? '<small>(换)</small>' : ''}</td>
        <td class="num">${n(s.mean)} <small>(${signed(s.mean_diff, 1)})</small></td>
        <td class="num">${n(s.high.achievers, 0)}/${n(s.high.concentrated, 0)} <small>(${signed(s.high.gap, 0)})</small></td>
        <td class="num">${n(s.main.achievers, 0)}/${n(s.main.concentrated, 0)} <small>(${signed(s.main.gap, 0)})</small></td>
        <td class="c"><span class="pm-tag ${toneCls}">${e(s.mismatch_label)}</span></td>
        <td>${e(other)}</td>
      </tr>`;
    }).join('');
    return `<section class="pm-mod pm-avoid">
      <div class="pm-mod-head"><h3>双线分学科诊断与同师对比</h3><span>括号内为贡献差（单科达标 − 总分达标），正数托举、负数拖累</span></div>
      <table class="pm-table">
        <thead><tr><th style="width:42px">学科</th><th class="c" style="width:58px">任课教师</th><th class="num" style="width:76px">均分(离均)</th><th class="num" style="width:94px">${e(hL)} 达/集(差)</th><th class="num" style="width:94px">${e(mL)} 达/集(差)</th><th class="c" style="width:82px">双线诊断</th><th>同师另班(${e(mL)})</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }

  function miniDualTimelineSVG(timeline, highRatio, mainRatio) {
    if (!timeline || timeline.length < 2) return '<div class="pm-empty">仅 1 场考试，暂不绘制走势图</div>';
    const w = 420, h = 112, pl = 34, pr = 36, top = 16, bot = 86;
    const hVals = timeline.map(x => x.high_rate ?? 0);
    const mVals = timeline.map(x => x.main_rate ?? 0);
    const maxV = Math.max(55, Math.ceil((Math.max(...hVals, ...mVals, mainRatio * 100) + 6) / 10) * 10);
    const xFor = i => pl + (i * (w - pl - pr)) / (timeline.length - 1);
    const yFor = v => bot - (v / maxV) * (bot - top);
    const hPts = timeline.map((x, i) => [xFor(i), yFor(x.high_rate ?? 0)]);
    const mPts = timeline.map((x, i) => [xFor(i), yFor(x.main_rate ?? 0)]);
    const ticks = [0, 0.5, 1].map(t => {
      const v = Math.round(maxV * t), y = yFor(v);
      return `<line x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}" stroke="#e3ddf0" stroke-width="0.8"/><text x="${pl - 4}" y="${y + 3}" text-anchor="end" font-size="8.5" fill="#6f6680">${v}%</text>`;
    }).join('');
    const labels = timeline.map((it, i) => {
      const [mx, my] = mPts[i], [hx, hy] = hPts[i];
      return `<circle cx="${mx}" cy="${my}" r="3" fill="#fff" stroke="#6f4eb8" stroke-width="1.8"/><text x="${mx}" y="${my - 5}" text-anchor="middle" font-size="8.5" fill="#4f358c" font-weight="650">${n(it.main_rate, 0)}%</text>`
        + `<circle cx="${hx}" cy="${hy}" r="3" fill="#fff" stroke="#2f7056" stroke-width="1.8"/><text x="${hx}" y="${hy + 11}" text-anchor="middle" font-size="8.5" fill="#2f7056" font-weight="650">${n(it.high_rate, 0)}%</text>`
        + `<text x="${xFor(i)}" y="${h - 4}" text-anchor="middle" font-size="8" fill="#5e5570">${e((it.name || '').slice(0, 7))}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-height:112px;display:block">${ticks}<polyline fill="none" stroke="#6f4eb8" stroke-width="2" points="${mPts.map(p => p.join(',')).join(' ')}"/><polyline fill="none" stroke="#2f7056" stroke-width="2" points="${hPts.map(p => p.join(',')).join(' ')}"/>${labels}</svg>`;
  }

  function modM3HTML(brief) {
    const m = brief.meta, h = brief.headline, f = brief.flow || {};
    const flowHtml = f.available ? `
      <div class="pm-flow-grid">
        <div class="pm-flow-card">
          <small>${e(h.high.label)}保尖率（较 ${e(f.prev_exam_name)}）</small>
          <strong>${pctText(f.high_keep_rate)}</strong>
          <span>稳住 ${f.high_keep}/${f.high_prev} · 掉出 ${f.high_drop_count} · 冲尖 +${f.high_rise_count}</span>
        </div>
        <div class="pm-flow-card">
          <small>${e(h.main.label)}守线率（匹配 ${f.matched_count} 人）</small>
          <strong>${pctText(f.main_keep_rate)}</strong>
          <span>稳住 ${f.main_keep}/${f.main_prev} · 跌出 ${f.main_drop_count} · 突围 +${f.main_rise_count}</span>
        </div>
      </div>` : `<div class="pm-empty">${e(f.reason || '暂无跨次人员流动数据')}</div>`;
    return `<section class="pm-mod pm-avoid">
      <div class="pm-mod-head"><h3>历次双线走势与人员流动</h3><span>紫色实线：${e(h.main.label)}占比 ｜ 绿色实线：${e(h.high.label)}占比</span></div>
      <div class="pm-m3-grid">
        <div class="pm-chart-frame">${miniDualTimelineSVG(brief.timeline, m.high_ratio, m.main_ratio)}</div>
        <div>${flowHtml}</div>
      </div>
    </section>`;
  }

  function modM4HTML(brief, cfg, isFirstModule) {
    const comp = brief.student_comparison || {};
    const rows = filterComparisonRows(comp.rows || [], cfg.m4Filter, cfg.m4Sort);
    const base = comp.compare_exam;
    const filterNames = { all: '全班学生', big_shift: '显著进退学生', big_drop: '显著退步学生', big_gain: '显著进步学生', borderline: '双线临界生', mentor: '导师制名单' };
    const sortLabels = { rank: '按本次名次排序', surname: '按姓氏拼音排序', drop: '按退步优先排序', gain: '按进步优先排序' };
    const trs = rows.map((r, idx) => {
      const g = r.rank_gain;
      const gText = g == null ? '—' : g === 0 ? '0' : g > 0 ? `▲+${g}` : `▼-${Math.abs(g)}`;
      const gCls = g == null || g === 0 ? '' : g > 0 ? 'g-up' : 'g-dn';
      const strong = (r.is_big_gain || r.is_big_drop) ? ' is-bold' : '';
      const weakHtmlPrint = formatWeakPrintHTML(r.weak);
      const mv = r.sub_mover_text || '—';
      const mvCls = mv.includes('↓') ? 'g-dn' : mv.includes('↑') ? 'g-up' : '';
      const seqNo = cfg.m4Sort === 'rank' ? n(r.class_rank, 0) : (idx + 1);
      return `<tr class="${r.is_big_drop ? 'row-alert' : r.is_big_gain ? 'row-good' : ''}">
        <td class="num">${seqNo}</td>
        <td><b>${e(r.name)}</b></td>
        <td class="c">${e(r.tier_label)}</td>
        <td class="num">${n(r.total, 1)}</td>
        <td class="num">${n(r.rank, 0)}</td>
        <td class="num">${r.prev_total == null ? '—' : n(r.prev_total, 1)}</td>
        <td class="num">${r.prev_rank == null ? '—' : n(r.prev_rank, 0)}</td>
        <td class="num ${gCls}${strong}">${gText}</td>
        <td class="wk-cell">${weakHtmlPrint}</td>
        <td class="${mvCls}">${e(mv)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" class="c">当前筛选范围内没有学生记录。</td></tr>';

    const pageBreakCls = cfg.m4PageBreak && !isFirstModule ? ' pm-break-before' : '';
    return `<section class="pm-mod pm-m4${pageBreakCls}">
      <div class="pm-mod-head">
        <h3>学生较上次对比明细表（${e(filterNames[cfg.m4Filter] || '全班学生')} · ${rows.length} 人）</h3>
        <span>${e(sortLabels[cfg.m4Sort] || '按本次名次排序')} · 对比基准：${base ? `${e(base.name)}（${e(base.date)}）` : '暂无历史对照'} · ★连续薄弱科</span>
      </div>
      <table class="pm-table pm-comp-table">
        <thead><tr>
          <th class="num" style="width:24px">序</th>
          <th style="width:46px">姓名</th>
          <th class="c" style="width:38px">层级</th>
          <th class="num" style="width:42px">本次分</th>
          <th class="num" style="width:42px">本次名</th>
          <th class="num" style="width:42px">上次分</th>
          <th class="num" style="width:42px">上次名</th>
          <th class="num" style="width:48px">名次进退</th>
          <th>薄弱学科（本次分数/年级名次 · ★连弱）</th>
          <th style="width:60px">单科波动</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </section>`;
  }

  function modM5HTML(brief) {
    const m = brief.meta, h = brief.headline, lists = brief.action_lists || {};
    const hL = h.high.label, mL = h.main.label;
    const fmtBorder = arr => (arr || []).slice(0, 10).map(s =>
      `${s.name}(#${s.rank},差${n(s.score_gap)}分:${(s.missing_subjects || []).slice(0, 2).map(x => x.subject).join('/') || '全达'})`
    ).join('；') || '无';
    const drops = (lists.drop_alerts || []).slice(0, 8).map(s =>
      `${s.name}(${s.prev_tier}→${s.curr_tier}${s.biggest_drop_subjects?.[0] ? ',' + s.biggest_drop_subjects[0].subject + '↓' + s.biggest_drop_subjects[0].drop : ''})`
    ).join('；') || '无';
    const pWeak = (lists.persistent_weak || []).slice(0, 8).map(s => `${s.name}(${s.subject} ${s.hits}/${s.exams_checked}次)`).join('；') || '无';
    const mentor = (lists.mentor_list || []).slice(0, 12).map(s => `${s.name}(#${s.rank}${s.weak?.[0] ? '·' + s.weak[0] : ''})`).join('、') || '无';
    return `<section class="pm-mod pm-avoid">
      <div class="pm-mod-head"><h3>分层抓手与包干微名单</h3><span>现场点名认领，优先转化单科短板与中优层流失预警学生</span></div>
      <div class="pm-lists-grid">
        <div class="pm-list-item"><b>冲 ${e(hL)} 临界：</b>${e(fmtBorder(lists.borderline_high))}</div>
        <div class="pm-list-item"><b>保冲 ${e(mL)} 临界：</b>${e(fmtBorder(lists.borderline_main))}</div>
        <div class="pm-list-item"><b>中优层流失预警：</b>${e(drops)}</div>
        <div class="pm-list-item"><b>连续顽固偏科：</b>${e(pWeak)}</div>
        ${m.mentor_range ? `<div class="pm-list-item wide"><b>导师制名单（${m.mentor_range[0]}-${m.mentor_range[1]}名，共 ${(lists.mentor_list || []).length} 人）：</b>${e(mentor)}</div>` : ''}
      </div>
    </section>`;
  }

  function modM6HTML(brief, cfg) {
    const m = brief.meta;
    const isLeader = cfg.m6Variant !== 'teacher';
    const cols = isLeader ? (brief.template_columns?.leader_top || [50, 100, 200, 300, 400, 500, 600, 700, 800])
      : (brief.template_columns?.teacher_top || [200, 300, 400, 500, 600, 700, 800]);
    const blocks = ['总分', ...(m.all_subjects || [])].map(sub => {
      const rows = (brief.timeline || []).map((tl, idx) => {
        const isLast = idx === brief.timeline.length - 1;
        const teacher = sub === '总分' ? (tl.homeroom || '—') : (tl.subjects?.[sub]?.teacher || '—');
        const topMap = sub === '总分' ? (tl.top_total || {}) : (tl.subjects?.[sub]?.top || {});
        const hasSub = sub === '总分' || !!tl.subjects?.[sub];
        return `<tr class="${isLast ? 'row-latest' : ''}">
          <td class="c">${idx + 1}</td>
          <td>${e(tl.name)}</td>
          <td class="c">${e(teacher)}</td>
          ${cols.map(c => `<td class="num">${hasSub ? n(topMap[String(c)] ?? 0, 0) : ''}</td>`).join('')}
        </tr>`;
      }).join('');
      return `<div class="pm-avoid pm-sub-block">
        <div class="pm-sub-bar">${e(sub)}</div>
        <table class="pm-table pm-tight">
          <thead><tr><th class="c" style="width:24px">序</th><th>考试名称</th><th class="c" style="width:52px">${sub === '总分' ? '班主任' : '教师'}</th>${cols.map(c => `<th class="num">${c}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');
    return `<section class="pm-mod">
      <div class="pm-mod-head"><h3>历次单科名次段纵向对比（${isLeader ? '领导版 50–800' : '教师版 200–800'}）</h3><span>粗框底纹为本场最新考试</span></div>
      ${blocks}
    </section>`;
  }

  function modM7HTML(brief, cfg) {
    const m = brief.meta;
    const ratioKey = cfg.m7Ratio || 'main';
    const pctNum = ratioKey === 'high' ? Math.round(m.high_ratio * 100) : ratioKey === 'mid30' ? 30 : Math.round(m.main_ratio * 100);
    const rateKey = ratioKey === 'high' ? 'high_rate' : ratioKey === 'mid30' ? 'mid30_rate' : 'main_rate';
    const concKey = ratioKey === 'high' ? 'high_conc_rate' : ratioKey === 'mid30' ? 'mid30_conc_rate' : 'main_conc_rate';
    const subs = brief.current_subject_matrix?.subjects || [];

    const tlRows = (brief.timeline || []).map((tl, idx) => {
      const isLast = idx === brief.timeline.length - 1;
      const totRate = ratioKey === 'high' ? tl.high_rate : ratioKey === 'mid30' ? tl.mid30_rate : tl.main_rate;
      return `<tr class="${isLast ? 'row-latest' : ''}">
        <td>${e(tl.name)}</td>
        <td class="num">${pctText(totRate)}</td>
        ${subs.map(s => {
          const d = tl.subjects?.[s];
          return `<td class="num">${d ? `${n(d[rateKey], 0)}%/${n(d[concKey], 0)}%` : '—'}</td>`;
        }).join('')}
      </tr>`;
    }).join('');

    const matRows = (brief.current_subject_matrix?.rows || []).map(row =>
      `<tr><td><b>${e(row[0])}</b></td>${row.slice(1).map(v => `<td class="num">${v == null ? '—' : n(v, row[0] === '平均分' ? 1 : 0)}</td>`).join('')}</tr>`
    ).join('');

    const weakRows = (brief.current_weak_summary || []).map(w =>
      `<tr><td><b>前${w.cutoff}名</b></td>${subs.map(s => `<td class="num">${n(w.counts?.[s] ?? 0, 0)}</td>`).join('')}<td class="num"><b>${n(w.total, 0)}</b></td></tr>`
    ).join('');

    return `<section class="pm-mod">
      <div class="pm-mod-head"><h3>有效分达标集中率与薄弱科统计矩阵（前 ${pctNum}% 口径）</h3><span>单元格为「达标率 / 集中率」</span></div>
      <div class="pm-avoid pm-sub-block">
        <div class="pm-sub-bar">历次测试各科达标率 / 集中率</div>
        <table class="pm-table pm-tight">
          <thead><tr><th>考试名称</th><th class="num">总分达标</th>${subs.map(s => `<th class="num">${e(s)}</th>`).join('')}</tr></thead>
          <tbody>${tlRows}</tbody>
        </table>
      </div>
      <div class="pm-avoid pm-sub-block">
        <div class="pm-sub-bar">本次各科成绩与名次段分布</div>
        <table class="pm-table pm-tight">
          <thead><tr><th>指标</th>${subs.map(s => `<th class="num">${e(s)}</th>`).join('')}</tr></thead>
          <tbody>${matRows}</tbody>
        </table>
      </div>
      <div class="pm-avoid pm-sub-block">
        <div class="pm-sub-bar">本次第 ${n(m.weak_rank_index || 1, 0)} 薄弱学科人数分布</div>
        <table class="pm-table pm-tight">
          <thead><tr><th>总分范围</th>${subs.map(s => `<th class="num">${e(s)}</th>`).join('')}<th class="num">合计</th></tr></thead>
          <tbody>${weakRows}</tbody>
        </table>
      </div>
    </section>`;
  }

  function modM8HTML() {
    return `<section class="pm-mod pm-avoid">
      <div class="pm-mod-head"><h3>班情会纪要与包干签字</h3><span>现场记录整改措施、包干责任人与复盘时间</span></div>
      <div class="pm-notes-box">
        <div class="pm-note-line"><span>核心定性：</span></div>
        <div class="pm-note-line"><span>学科整改抓手：</span></div>
        <div class="pm-note-line"><span>重点生包干分工：</span></div>
        <div class="pm-note-line"><span>下次复盘节点与目标：</span></div>
        <div class="pm-sign-row">
          <span>年级/校领导签字：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
          <span>班主任签字：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
          <span>日期：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
        </div>
      </div>
    </section>`;
  }

  function renderClassPacket(brief, cfg) {
    const m = brief.meta;
    const enabledSet = new Set(cfg.enabled || []);
    const activeIds = (cfg.order || MODULES.map(x => x.id)).filter(id => enabledSet.has(id));
    const base = brief.student_comparison?.compare_exam;
    const isPureDesensitized = activeIds.length > 0 && activeIds.every(id => ['M9', 'M10', 'M8'].includes(id));
    const modHTML = activeIds.map((id, idx) => {
      if (id === 'M1') return modM1HTML(brief);
      if (id === 'M2') return modM2HTML(brief);
      if (id === 'M3') return modM3HTML(brief);
      if (id === 'M4') return modM4HTML(brief, cfg, idx === 0);
      if (id === 'M5') return modM5HTML(brief);
      if (id === 'M6') return modM6HTML(brief, cfg);
      if (id === 'M7') return modM7HTML(brief, cfg);
      if (id === 'M8') return modM8HTML();
      if (id === 'M9' && window.LeaderLevels) return window.LeaderLevels.modM9HTML(brief);
      if (id === 'M10' && window.LeaderLevels) return window.LeaderLevels.modM10HTML(brief, cfg, idx === 0);
      return '';
    }).join('');

    return `<article class="pm-class-packet">
      <header class="pm-masthead">
        <div>
          <div class="pm-brand"><i></i>${isPureDesensitized ? '融侨学迹 · 教师学情分析册' : '融侨学迹 · 班情分析定制打印册'}</div>
          <h1>${e(m.grade)} · ${e(m.class)}班 ${isPureDesensitized ? '班情与教学帮扶报告' : '班情分析报告'}</h1>
        </div>
        <div class="pm-meta-right">
          <strong>${e(m.exam_name)}（${e(m.exam_date)}）</strong>
          <span>班主任：${e(m.homeroom || '未录入')} ｜ 对比基准：${e(base ? base.name : '暂无')} ｜ 数据版本 v${m.data_version || 1}${m.edit_count ? ` · 含 ${m.edit_count} 处更正` : ' · 原始导入'}</span>
        </div>
      </header>
      ${modHTML}
    </article>`;
  }

  function printModularBriefs(briefOrList, cfg) {
    const list = Array.isArray(briefOrList) ? briefOrList : [briefOrList];
    if (!list.length) return;
    const activeIds = (cfg.order || MODULES.map(x => x.id)).filter(id => (cfg.enabled || []).includes(id));
    if (!activeIds.length) {
      Z.notice('请至少勾选一个打印模块。', true);
      return;
    }
    const first = list[0].meta;
    const title = list.length > 1
      ? `${first.grade} · 全年级班情分析打印册（${list.length}班）`
      : `${first.grade} ${first.class}班 · 班情分析打印册（${first.exam_name}）`;

    const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(title)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm 9mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif; color: #1e192b; background: #edeaf4; font-size: 10px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-bar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; background: #261e38; color: #fff; font-size: 13px; }
  .print-bar button { background: #6f4eb8; color: #fff; border: 0; border-radius: 6px; padding: 7px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .print-bar button:hover { background: #5b3c9e; }
  .print-canvas { padding: 18px 0 36px; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .pm-class-packet { width: 210mm; min-height: 297mm; background: #fff; padding: 8mm 9mm; box-shadow: 0 8px 28px rgba(34,24,60,.16); }
  .pm-masthead { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid #6f4eb8; padding-bottom: 6px; margin-bottom: 10px; }
  .pm-brand { font-size: 9px; font-weight: 650; color: #6f4eb8; letter-spacing: 0.04em; display: flex; align-items: center; gap: 5px; }
  .pm-brand i { display: inline-block; width: 6px; height: 6px; border-radius: 2px; background: #6f4eb8; }
  .pm-masthead h1 { margin: 2px 0 0; font-size: 16.5px; color: #1a1526; }
  .pm-meta-right { text-align: right; }
  .pm-meta-right strong { display: block; font-size: 11px; color: #2b233a; }
  .pm-meta-right span { font-size: 9px; color: #6b617e; }
  .pm-mod { margin-bottom: 10px; }
  .pm-avoid { break-inside: avoid; page-break-inside: avoid; }
  .pm-break-before { break-before: page; page-break-before: always; }
  .pm-mod-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 5px; border-left: 3px solid #6f4eb8; padding-left: 7px; }
  .pm-mod-head h3 { margin: 0; font-size: 11.5px; color: #36255c; }
  .pm-mod-head span { font-size: 8.8px; color: #6d6380; }
  .pm-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 7px; }
  .pm-kpi { border: 1px solid #dbd3ea; border-radius: 5px; padding: 5px 8px; background: #faf8fd; }
  .pm-kpi.accent-green { background: #eef7f2; border-color: #bfdccc; }
  .pm-kpi.accent-purple { background: #f3eefb; border-color: #cab9e8; }
  .pm-kpi small { display: block; font-size: 8.8px; color: #5f5672; }
  .pm-kpi strong { display: block; font-size: 13.5px; color: #1e182b; margin: 1px 0; font-variant-numeric: tabular-nums; }
  .pm-kpi strong em { font-style: normal; font-size: 9.5px; font-weight: 550; color: #4c4260; }
  .pm-kpi span { display: block; font-size: 8.5px; color: #6d6380; }
  .pm-points { border: 1px solid #dfd7ee; border-radius: 5px; background: #fcfbfe; padding: 6px 10px; }
  .pm-points-title { font-size: 9.5px; font-weight: 650; color: #4a357a; margin-bottom: 3px; }
  .pm-points ol { margin: 0; padding-left: 16px; font-size: 9.5px; line-height: 1.48; }
  .pm-table { width: 100%; border-collapse: collapse; font-size: 9.3px; }
  .pm-table thead { display: table-header-group; }
  .pm-table th, .pm-table td { border: 1px solid #d9d1e8; padding: 3px 5px; text-align: left; }
  .pm-table th { background: #f2ecf9; color: #37275c; font-weight: 650; }
  .pm-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pm-table .c { text-align: center; }
  .pm-table small { font-size: 8.2px; color: #6c627e; }
  .pm-comp-table { font-size: 8.6px; line-height: 1.26; }
  .pm-comp-table th, .pm-comp-table td { padding: 2.2px 4px; }
  .pm-m10-table { font-size: 8.1px; line-height: 1.18; table-layout: auto; }
  .pm-m10-table th, .pm-m10-table td { padding: 1.8px 3.5px; }
  .pm-m10-table.is-ultra-dense { font-size: 7.5px; line-height: 1.14; }
  .pm-m10-table.is-ultra-dense th, .pm-m10-table.is-ultra-dense td { padding: 1.35px 3px; }
  .pm-m10-table .nw { white-space: nowrap; }
  .pm-m10-table tbody tr:nth-child(even) { background: #faf9fc; }
  .pm-m10-table tr.row-alert { background: #fff4f4; }
  .pm-m10-table tr.row-good { background: #f2faf5; }
  .pm-comp-table .wk-cell { font-variant-numeric: tabular-nums; }
  .pm-comp-table .wk-item { white-space: nowrap; }
  .pm-comp-table .wk-item small { font-size: 7.9px; color: #5b5170; font-weight: 400; }
  .pm-comp-table .wk-sep { color: #9c92b0; }
  .pm-comp-table tbody tr:nth-child(even) { background: #faf9fc; }
  .pm-comp-table tr.row-alert { background: #fff4f4; }
  .pm-comp-table tr.row-good { background: #f2faf5; }
  .pm-tight { font-size: 8.5px; }
  .pm-tight th, .pm-tight td { padding: 2.2px 3.8px; }
  .row-latest td { background: #f3eefb !important; font-weight: 650; border-top: 1.4px solid #6f4eb8; border-bottom: 1.4px solid #6f4eb8; }
  .g-up { color: #1f6b4b; }
  .g-dn { color: #b43030; }
  .is-bold { font-weight: 700; text-decoration: underline; }
  .pm-tag { display: inline-block; padding: 0.5px 4px; border-radius: 3px; font-size: 8.2px; border: 1px solid #d7cfe6; }
  .pm-tag.t-good { background: #ebf6f0; color: #1f6b4b; border-color: #b7dac8; }
  .pm-tag.t-warn { background: #fef7ea; color: #8c5a12; border-color: #ebd2a2; }
  .pm-tag.t-alert { background: #fdf0f0; color: #a82e2e; border-color: #e6b8b8; font-weight: 650; }
  .pm-m3-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 8px; align-items: stretch; }
  .pm-chart-frame { border: 1px solid #e0d8ee; border-radius: 5px; padding: 4px 6px; background: #fcfbfe; }
  .pm-flow-grid { display: grid; gap: 6px; height: 100%; }
  .pm-flow-card { border: 1px solid #dfd7ee; border-radius: 5px; padding: 6px 9px; background: #faf8fd; display: flex; flex-direction: column; justify-content: center; }
  .pm-flow-card small { font-size: 8.5px; color: #665c78; }
  .pm-flow-card strong { font-size: 14px; color: #462f80; margin: 1px 0; }
  .pm-flow-card span { font-size: 8.5px; color: #5b526d; }
  .pm-lists-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .pm-list-item { border: 1px solid #e0d8ee; border-radius: 5px; padding: 5px 8px; background: #fcfbfe; font-size: 8.8px; line-height: 1.45; }
  .pm-list-item.wide { grid-column: 1 / -1; }
  .pm-sub-block { margin-bottom: 6px; }
  .pm-sub-bar { background: #ede6f7; color: #36255c; font-weight: 650; font-size: 9px; padding: 2.5px 7px; border: 1px solid #d9d1e8; border-bottom: 0; }
  .pm-lvl-grid { display: grid; gap: 5px; margin-bottom: 5px; }
  .pm-lvl-box { border: 1px solid #d9d1e8; border-radius: 5px; padding: 4px 6px; background: #faf8fd; text-align: center; }
  .pm-lvl-box small { display: block; font-size: 8px; color: #675e78; }
  .pm-lvl-box strong { display: block; font-size: 11.5px; color: #2b2042; margin: 1px 0; }
  .pm-lvl-box strong em { font-style: normal; font-size: 8.5px; font-weight: 500; color: #5b526d; }
  .pm-lvl-box span { display: block; font-size: 8px; color: #6e6480; }
  .pm-flow-bar { border: 1px solid #dfd7ee; border-radius: 4px; background: #fcfbfe; padding: 4px 8px; font-size: 8.8px; color: #3d3452; }
  .pm-notes-box { border: 1px solid #cfc6e2; border-radius: 5px; padding: 8px 11px; background: #fff; }
  .pm-note-line { border-bottom: 1px dashed #c8bedc; min-height: 22px; padding-top: 4px; font-size: 9.2px; color: #4f4662; }
  .pm-sign-row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 9.2px; color: #4f4662; }
  .pm-empty { padding: 12px; text-align: center; color: #7e7491; border: 1px dashed #d8d0e8; border-radius: 5px; font-size: 9px; }
  .pm-table tr.row-alert td:first-child { border-left: 2.5px solid #222; }
  .pm-badge.alert { border: 1px solid #992e2e; font-weight: 700; }
  .pm-badge.warn { border: 1px dashed #8a5612; font-weight: 650; }
  .print-bar-actions { display: flex; align-items: center; gap: 14px; }
  .bw-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #e5dff2; cursor: pointer; user-select: none; }
  body.bw-preview .print-canvas { filter: grayscale(100%) contrast(1.08); }
  @media print {
    body { background: #fff; }
    .print-bar { display: none; }
    .print-canvas { padding: 0; gap: 0; display: block; filter: none !important; }
    .pm-class-packet { width: auto; min-height: 0; padding: 0; box-shadow: none; page-break-after: always; break-after: page; }
    .pm-class-packet:last-child { page-break-after: auto; break-after: auto; }
  }
</style></head>
<body>
  <div class="print-bar">
    <span>${e(title)} · 已选模块：${activeIds.join(' · ')}</span>
    <div class="print-bar-actions">
      <label class="bw-toggle"><input type="checkbox" onchange="document.body.classList.toggle('bw-preview',this.checked)">黑白打印预览</label>
      <button type="button" onclick="window.print()">打印 / 另存为 PDF</button>
    </div>
  </div>
  <div class="print-canvas">${list.map(b => renderClassPacket(b, cfg)).join('')}</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=980,height=880');
    if (!win) {
      Z.notice('浏览器拦截了打印预览窗口，请允许本机弹窗后重试。', true);
      return;
    }
    win.document.open();
    win.document.write(doc);
    win.document.close();
  }

  function printSingleComparison(brief, filterMode = 'all', sortMode = 'rank') {
    const cfg = {
      ...defaultConfig(),
      enabled: ['M4'],
      order: ['M4'],
      m4Filter: filterMode,
      m4Sort: sortMode,
      m4PageBreak: false,
    };
    printModularBriefs([brief], cfg);
  }

  function printSingleLevers(brief, filterMode = 'all', sortMode = 'surname') {
    printModularBriefs([brief], {
      ...defaultConfig(),
      enabled: ['M10'],
      order: ['M10'],
      m10Filter: filterMode,
      m10Sort: sortMode,
      m10PageBreak: false,
      m10IncludeGroups: false,
    });
  }

  function printTeacherSafePacket(brief) {
    printModularBriefs([brief], { ...defaultConfig(), ...PRESETS.teacher_safe, scope: 'current' });
  }

  window.LeaderPrintStudio = {
    MODULES,
    PRESETS,
    loadConfig,
    saveConfig,
    filterComparisonRows,
    comparisonTableObj,
    renderComparisonSectionHTML,
    studioDrawerHTML,
    printModularBriefs,
    printSingleComparison,
    printSingleLevers,
    printTeacherSafePacket,
  };
})();

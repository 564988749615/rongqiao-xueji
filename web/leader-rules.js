'use strict';
/* 融侨学迹 · 规范化三标签口径设置（常用口径 / 科目与满分 / 等级比例 + 参数表导入导出） */
(() => {
  const e = value => Z.escape(value);
  const option = (value, label, chosen) => `<option value="${e(value)}"${String(value) === String(chosen) ? ' selected' : ''}>${e(label)}</option>`;

  const DEFAULTS = {
    cutoff_ratio: 0.30,
    cutoff_rounding: 'floor',
    high_ratio: 0.20,
    main_ratio: 0.40,
    borderline_band: 30,
    tie_mode: 'competition',
    zero_policy: 'exclude',
    missing_policy: 'exclude_total',
    shift_threshold: 50,
    warn_gap_pct: 5,
    top_nodes: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800],
    weak_count: 4,
    weak_rank_index: 1,
    weak_cutoffs: [200, 400, 600],
    mentor_range: [180, 300],
    score_bin_step: 50,
    abc_bounds: [
      { label: 'A', pct: 0.30 },
      { label: 'B', pct: 0.80 },
      { label: 'C', pct: 1.00 },
    ],
    level_bounds: [
      { label: 'A1', pct: 0.18 },
      { label: 'A2', pct: 0.30 },
      { label: 'B1', pct: 0.55 },
      { label: 'B2', pct: 0.80 },
      { label: 'C1', pct: 0.90 },
      { label: 'C2', pct: 1.00 },
    ],
  };

  function pctNum(v) {
    const num = Number(v);
    if (!Number.isFinite(num)) return '';
    const scaled = num <= 1 ? num * 100 : num;
    return Number(scaled.toFixed(2));
  }

  function gradeRowsHTML(prefix, items) {
    const canRemove = items.length > 2;
    return items.map((item, i) => `<tr>
      <td><input type="text" data-${prefix}-label="${i}" value="${e(item.label)}" maxlength="8" required></td>
      <td><input type="number" data-${prefix}-pct="${i}" value="${pctNum(item.pct)}" min="0.5" max="100" step="0.5" required></td>
      <td class="rules-grade-op"><button type="button" class="rules-grade-del" data-grade-remove="${prefix}" data-index="${i}" title="删除该档" aria-label="删除该档"${canRemove ? '' : ' disabled'}>×</button></td>
    </tr>`).join('');
  }

  function ruleMarkPresetsHTML() {
    const saved = Z.getFullMarkTemplate();
    return `<div class="mark-presets" id="rule-mark-presets">${Z.fullMarkPresets.map(p => `<button type="button" data-action="rule-mark-preset" data-preset="${e(p.id)}">${e(p.label)}</button>`).join('')}${saved ? '<button type="button" data-action="rule-mark-preset" data-preset="saved">套用已存模板</button>' : ''}<button type="button" data-action="rule-mark-preset" data-preset="save">存为常用模板</button><button type="button" data-action="rule-mark-preset" data-preset="clear">清空</button></div>`;
  }

  function buildFormHTML(id, dataset, rawRules, opts = {}) {
    const r = { ...DEFAULTS, ...(rawRules || {}) };
    const activeTab = opts.activeTab || 'common';
    const showScopeActions = opts.showScopeActions !== false;
    const submitLabel = opts.submitLabel || '保存并重新计算';
    const classes = r.classes || dataset.classes;
    const orderedSubjects = Array.isArray(r.subject_order) && r.subject_order.length
      ? [...r.subject_order.filter(s => dataset.subjects.includes(s)), ...dataset.subjects.filter(s => !r.subject_order.includes(s))]
      : [...dataset.subjects];
    const totalSubjects = r.total_subjects || dataset.subjects;
    const abc = Array.isArray(r.abc_bounds) && r.abc_bounds.length ? r.abc_bounds : DEFAULTS.abc_bounds;
    const levels = Array.isArray(r.level_bounds) && r.level_bounds.length ? r.level_bounds : DEFAULTS.level_bounds;
    const topNodesText = (Array.isArray(r.top_nodes) && r.top_nodes.length ? r.top_nodes : DEFAULTS.top_nodes).join(',');
    const weakCutoffsText = (Array.isArray(r.weak_cutoffs) && r.weak_cutoffs.length ? r.weak_cutoffs : DEFAULTS.weak_cutoffs).join(',');
    const mentorText = Array.isArray(r.mentor_range) && r.mentor_range.length === 2 ? `${r.mentor_range[0]}-${r.mentor_range[1]}` : '';

    return `<form id="rules-form" class="rules-modal-form" data-id="${e(id)}">
      <div class="tab-strip rules-tabs" role="tablist">
        <button type="button" role="tab" data-rules-tab="common" class="${activeTab === 'common' ? 'active' : ''}" aria-selected="${activeTab === 'common'}">常用口径</button>
        <button type="button" role="tab" data-rules-tab="subjects" class="${activeTab === 'subjects' ? 'active' : ''}" aria-selected="${activeTab === 'subjects'}">科目与满分</button>
        <button type="button" role="tab" data-rules-tab="grades" class="${activeTab === 'grades' ? 'active' : ''}" aria-selected="${activeTab === 'grades'}">等级比例</button>
      </div>

      <div class="rules-pane" data-rules-pane="common"${activeTab === 'common' ? '' : ' hidden'}>
        <div class="rules-row-list">
          <div class="rules-row">
            <label class="rules-row-label" for="rule-cutoff-ratio">有效分参考比例</label>
            <div class="rules-row-ctrl">
              <input id="rule-cutoff-ratio" name="ratio" type="number" min="0.1" max="100" step="0.1" required value="${pctNum(r.cutoff_ratio)}" class="rules-num-sm">
              <span>%</span>
              <select name="cutoff_rounding" aria-label="参考名次取整方式">
                ${option('floor', '向下取整（floor）', r.cutoff_rounding || 'floor')}
                ${option('round', '四舍五入（round）', r.cutoff_rounding || 'floor')}
                ${option('ceil', '向上取整（ceil）', r.cutoff_rounding || 'floor')}
              </select>
              <small class="muted">参考名次 = 实考人数 × 比例</small>
            </div>
          </div>
          <div class="rules-row">
            <span class="rules-row-label">班情双线比例</span>
            <div class="rules-row-ctrl">
              <span>尖优线</span>
              <input name="high_ratio" type="number" min="1" max="100" step="0.5" required value="${pctNum(r.high_ratio)}" class="rules-num-sm">
              <span>%</span>
              <span style="margin-left:8px">达标线</span>
              <input name="main_ratio" type="number" min="1" max="100" step="0.5" required value="${pctNum(r.main_ratio)}" class="rules-num-sm">
              <span>%</span>
              <small class="muted">用于班情分析双线诊断与谈话卡</small>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-borderline-band">临界生带宽</label>
            <div class="rules-row-ctrl">
              <span>参考名次 ±</span>
              <input id="rule-borderline-band" name="borderline_band" type="number" min="1" max="500" step="1" required value="${r.borderline_band ?? 30}" class="rules-num-sm">
              <span>名</span>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-tie-mode">并列名次</label>
            <div class="rules-row-ctrl">
              <select id="rule-tie-mode" name="tie_mode">
                ${option('competition', '跳号（1, 1, 3）', r.tie_mode || 'competition')}
                ${option('dense', '不跳号 / 密集（1, 1, 2）', r.tie_mode || 'competition')}
              </select>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-zero-policy">缺考判定</label>
            <div class="rules-row-ctrl">
              <select id="rule-zero-policy" name="zero_policy">
                ${option('exclude', '空白或 0（均分与实考排除 0）', r.zero_policy || 'exclude')}
                ${option('include', '仅空白（保留真实 0 分计入）', r.zero_policy || 'exclude')}
              </select>
              <select name="missing_policy" aria-label="总分科目缺失处理">
                ${option('exclude_total', '缺科不生成总分', r.missing_policy || 'exclude_total')}
                ${option('zero', '缺科按 0 合计总分', r.missing_policy || 'exclude_total')}
              </select>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-shift-threshold">显著进退</label>
            <div class="rules-row-ctrl">
              <span>名次变动 ≥</span>
              <input id="rule-shift-threshold" name="shift_threshold" type="number" min="1" max="5000" step="1" required value="${r.shift_threshold ?? 50}" class="rules-num-sm">
              <span>名</span>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-warn-gap">预警阈值</label>
            <div class="rules-row-ctrl">
              <span>低于同层</span>
              <input id="rule-warn-gap" name="warn_gap_pct" type="number" min="0" max="100" step="0.5" required value="${r.warn_gap_pct ?? 5}" class="rules-num-sm">
              <span>个百分点</span>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-top-nodes">名次节点</label>
            <div class="rules-row-ctrl">
              <input id="rule-top-nodes" name="top_nodes" type="text" required value="${e(topNodesText)}" class="rules-text-wide" placeholder="50,100,150,200,250,300,400,500,600,700,800">
            </div>
          </div>
          <div class="rules-row">
            <span class="rules-row-label">薄弱学科</span>
            <div class="rules-row-ctrl">
              <span>每人列出</span>
              <input name="weak_count" type="number" min="1" max="${Math.max(1, dataset.subjects.length)}" required value="${Math.min(r.weak_count ?? 4, dataset.subjects.length)}" class="rules-num-xs">
              <span>科；班级统计按第</span>
              <input name="weak_rank_index" type="number" min="1" max="${Math.max(1, dataset.subjects.length)}" required value="${Math.min(r.weak_rank_index ?? 1, dataset.subjects.length)}" class="rules-num-xs">
              <span>薄弱；名次范围</span>
              <input name="weak_cutoffs" type="text" required value="${e(weakCutoffsText)}" class="rules-num-md" placeholder="200,400,600">
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-mentor-range">导师制名单</label>
            <div class="rules-row-ctrl">
              <span>总分名次</span>
              <input id="rule-mentor-range" name="mentor_range" type="text" value="${e(mentorText)}" class="rules-num-md" placeholder="如 180-300">
              <small class="muted">如 180-300，留空则不生成</small>
            </div>
          </div>
          <div class="rules-row">
            <label class="rules-row-label" for="rule-bin-step">分数段间隔</label>
            <div class="rules-row-ctrl">
              <input id="rule-bin-step" name="score_bin_step" type="number" min="1" max="500" step="1" required value="${r.score_bin_step ?? 50}" class="rules-num-sm">
              <span>分</span>
            </div>
          </div>
          <div class="rules-row rules-row-top">
            <span class="rules-row-label">纳入班级</span>
            <div class="rules-row-ctrl" style="display:block;flex:1">
              <div class="drawer-actions" style="margin-bottom:8px">
                <button type="button" class="btn secondary small" data-action="all-classes">全选</button>
                <button type="button" class="btn secondary small" data-action="twenty-classes">选择01—20班</button>
              </div>
              <div class="check-group">${dataset.classes.map(x => `<label class="check-pill"><input type="checkbox" name="classes" value="${e(x)}" ${classes.includes(x) ? 'checked' : ''}>${e(x)}班</label>`).join('')}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="rules-pane" data-rules-pane="subjects"${activeTab === 'subjects' ? '' : ' hidden'}>
        <p class="inline-help" style="margin:0 0 10px">“计入总分”不勾选的科目只单科排名、不计入总分。满分确认后才计算得分率；也可一键套用常用模板。</p>
        ${ruleMarkPresetsHTML()}
        <div class="table-wrap">
          <table class="rules-subject-table">
            <thead><tr><th>科目</th><th>满分（选填）</th><th style="text-align:center">计入总分</th><th>顺序</th></tr></thead>
            <tbody>
              ${orderedSubjects.map((sub, idx) => `<tr>
                <td><strong>${e(sub)}</strong></td>
                <td><input name="fullmark" data-subject="${e(sub)}" type="number" min="0.1" step="any" value="${r.full_marks?.[sub] ?? ''}" placeholder="未确认"></td>
                <td style="text-align:center"><input type="checkbox" name="subjects" value="${e(sub)}" ${totalSubjects.includes(sub) ? 'checked' : ''}></td>
                <td><input name="sub_order" data-subject="${e(sub)}" type="number" min="1" max="99" step="1" value="${idx + 1}" class="rules-num-xs"></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="rules-pane" data-rules-pane="grades"${activeTab === 'grades' ? '' : ' hidden'}>
        <div class="mark-presets" style="margin-bottom:14px">
          <button type="button" data-rules-grade-preset="default">默认比例（A 30% / 六级 18,30,55,80,90,100）</button>
          <button type="button" data-rules-grade-preset="2040">20%/40% 双线常用（A 40% / 六级 20,40,60,80,90,100）</button>
          <button type="button" data-rules-grade-preset="abcd4">ABCD 四级（25,55,85,100）</button>
        </div>
        <div class="rules-grades-grid">
          <div>
            <div class="rules-grade-head">
              <h3>学生等级（发年级）</h3>
              <button type="button" class="text-button" data-grade-add="abc">+ 新增一档</button>
            </div>
            <table class="rules-grade-table">
              <thead><tr><th>等级</th><th>累计比例上限 %</th><th></th></tr></thead>
              <tbody id="rules-abc-body">${gradeRowsHTML('abc', abc)}</tbody>
            </table>
          </div>
          <div>
            <div class="rules-grade-head">
              <h3>班情分析等级（分层）</h3>
              <button type="button" class="text-button" data-grade-add="lvl">+ 新增一档</button>
            </div>
            <table class="rules-grade-table">
              <thead><tr><th>等级</th><th>累计比例上限 %</th><th></th></tr></thead>
              <tbody id="rules-lvl-body">${gradeRowsHTML('lvl', levels)}</tbody>
            </table>
          </div>
        </div>
        <p class="inline-help">例：A 40% 表示年级前 40% 为 A；可自由增删档位（2–12 档），各级累计比例须严格递增且末档为 100%。</p>
      </div>

      <div id="rules-error" class="error" hidden></div>
      ${showScopeActions ? `<div class="rules-scope-options">
        <label class="rules-scope-check"><input type="checkbox" name="save_as_default"><span>设为新建考试默认口径（后续导入自动沿用）</span></label>
        <label class="rules-scope-check"><input type="checkbox" name="apply_to_grade"><span>同步公共口径到本年级全部考试（统一历次对比标准）</span></label>
      </div>` : ''}
      <div class="rules-footer-bar">
        <div class="rules-footer-left">
          <button type="button" class="btn secondary small" data-rules-io="import">导入参数表…</button>
          <input id="rules-import-file" type="file" accept=".json" hidden>
          <button type="button" class="btn secondary small" data-rules-io="export">导出参数表…</button>
          ${showScopeActions ? '<button type="button" class="btn secondary small" data-rules-io="load-default">载入默认口径</button>' : ''}
          <button type="button" class="btn secondary small" data-rules-io="reset">恢复出厂默认</button>
        </div>
        <div class="rules-footer-right">
          <button type="button" class="btn secondary" data-action="close-drawer">取消</button>
          <button type="submit" class="btn primary">${e(submitLabel)}</button>
        </div>
      </div>
    </form>`;
  }

  function readFormRules(form) {
    const data = new FormData(form);
    const classes = data.getAll('classes');
    const totalSubjects = data.getAll('subjects');
    if (!classes.length) throw new Error('请至少选择一个纳入统计的班级。');
    if (!totalSubjects.length) throw new Error('请至少勾选一门计入总分的科目。');

    const orderItems = [...form.querySelectorAll('[name="sub_order"]')].map((input, idx) => ({
      subject: input.dataset.subject,
      order: Number(input.value) || (idx + 1),
      idx,
    })).sort((a, b) => a.order - b.order || a.idx - b.idx);
    const subjectOrder = orderItems.map(x => x.subject);

    const fullMarks = {};
    form.querySelectorAll('[name="fullmark"]').forEach(input => {
      if (input.value.trim() !== '') fullMarks[input.dataset.subject] = Number(input.value);
    });

    const readBounds = (prefix, title) => {
      const labels = [...form.querySelectorAll(`[data-${prefix}-label]`)];
      const result = [];
      let prev = 0;
      for (let i = 0; i < labels.length; i += 1) {
        const label = labels[i].value.trim();
        const pct = Number(form.querySelector(`[data-${prefix}-pct="${i}"]`)?.value);
        if (!label) throw new Error(`${title}名称不能为空。`);
        if (!Number.isFinite(pct) || pct <= prev || pct > 100) {
          throw new Error(`${title}「${label}」的累计比例应大于上一级且不超过 100%。`);
        }
        result.push({ label, pct: Number((pct / 100).toFixed(4)) });
        prev = pct;
      }
      if (!result.length || Math.abs(result[result.length - 1].pct - 1) > 0.001) {
        throw new Error(`${title}最后一级累计比例应为 100%。`);
      }
      return result;
    };

    const parseInts = (raw, label) => {
      const vals = String(raw || '').replace(/，/g, ',').split(',').map(x => x.trim()).filter(Boolean).map(Number);
      if (!vals.length || vals.some(v => !Number.isInteger(v) || v <= 0)) {
        throw new Error(`${label}应为逗号分隔的正整数。`);
      }
      return [...new Set(vals)].sort((a, b) => a - b);
    };

    const mentorRaw = String(data.get('mentor_range') || '').trim();
    let mentorRange = null;
    if (mentorRaw) {
      const parts = mentorRaw.replace(/[—–~]/g, '-').split('-').map(x => x.trim()).filter(Boolean);
      if (parts.length !== 2 || parts.some(p => !/^\d+$/.test(p))) {
        throw new Error('导师制名单范围格式应为“起-止”，例如 180-300。');
      }
      const lo = Number(parts[0]), hi = Number(parts[1]);
      if (lo < 1 || hi < lo) throw new Error('导师制名单范围需满足 1 ≤ 起始 ≤ 截止。');
      mentorRange = [lo, hi];
    }

    const highRatio = Number(data.get('high_ratio')) / 100;
    const mainRatio = Number(data.get('main_ratio')) / 100;
    const weakCount = Number(data.get('weak_count'));
    const weakRankIndex = Math.min(Number(data.get('weak_rank_index')) || 1, weakCount);

    return {
      classes,
      total_subjects: subjectOrder.filter(s => totalSubjects.includes(s)),
      subject_order: subjectOrder,
      cutoff_ratio: Number(data.get('ratio')) / 100,
      cutoff_rounding: data.get('cutoff_rounding') || 'floor',
      high_ratio: Math.min(highRatio, mainRatio),
      main_ratio: Math.max(highRatio, mainRatio),
      borderline_band: Number(data.get('borderline_band')) || 30,
      tie_mode: data.get('tie_mode') || 'competition',
      zero_policy: data.get('zero_policy') || 'exclude',
      missing_policy: data.get('missing_policy') || 'exclude_total',
      shift_threshold: Number(data.get('shift_threshold')) || 50,
      warn_gap_pct: Number(data.get('warn_gap_pct')),
      top_nodes: parseInts(data.get('top_nodes'), '名次节点'),
      weak_count: weakCount,
      weak_rank_index: weakRankIndex,
      weak_cutoffs: parseInts(data.get('weak_cutoffs'), '薄弱学科名次范围'),
      mentor_range: mentorRange,
      score_bin_step: Number(data.get('score_bin_step')) || 50,
      abc_bounds: readBounds('abc', '学生等级'),
      level_bounds: readBounds('lvl', '班情分析等级'),
      full_marks: fullMarks,
    };
  }

  function bindRulesForm(form, dataset, onReRender) {
    if (!form) return;
    form.querySelectorAll('[data-rules-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.rulesTab;
        form.querySelectorAll('[data-rules-tab]').forEach(b => {
          const active = b.dataset.rulesTab === target;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        form.querySelectorAll('[data-rules-pane]').forEach(pane => {
          pane.hidden = pane.dataset.rulesPane !== target;
        });
      });
    });

    const readRawRows = prefix => {
      const labels = [...form.querySelectorAll(`[data-${prefix}-label]`)];
      return labels.map((el, i) => ({
        label: el.value.trim() || `${prefix.toUpperCase()}${i + 1}`,
        pct: Number(form.querySelector(`[data-${prefix}-pct="${i}"]`)?.value) || 100,
      }));
    };
    const repaintGrades = (prefix, items) => {
      const tbody = form.querySelector(`#rules-${prefix}-body`);
      if (tbody) tbody.innerHTML = gradeRowsHTML(prefix, items);
    };

    form.querySelectorAll('[data-rules-grade-preset]').forEach(presetBtn => {
      presetBtn.addEventListener('click', () => {
        const key = presetBtn.dataset.rulesGradePreset;
        if (key === 'abcd4') {
          repaintGrades('abc', [
            { label: 'A', pct: 0.25 },
            { label: 'B', pct: 0.55 },
            { label: 'C', pct: 0.85 },
            { label: 'D', pct: 1.00 },
          ]);
          Z.notice('已将学生等级切换为 ABCD 四级（25% / 55% / 85% / 100%）。');
          return;
        }
        const is2040 = key === '2040';
        repaintGrades('abc', is2040
          ? [{ label: 'A', pct: 0.40 }, { label: 'B', pct: 0.80 }, { label: 'C', pct: 1.00 }]
          : DEFAULTS.abc_bounds);
        repaintGrades('lvl', is2040
          ? [
              { label: 'A1', pct: 0.20 }, { label: 'A2', pct: 0.40 },
              { label: 'B1', pct: 0.60 }, { label: 'B2', pct: 0.80 },
              { label: 'C1', pct: 0.90 }, { label: 'C2', pct: 1.00 },
            ]
          : DEFAULTS.level_bounds);
        Z.notice(is2040 ? '已填入 20%/40% 双线常用等级比例，点击“保存并重新计算”生效。' : '已恢复默认等级比例。');
      });
    });

    form.querySelectorAll('[data-grade-add]').forEach(addBtn => {
      addBtn.addEventListener('click', () => {
        const prefix = addBtn.dataset.gradeAdd;
        const rows = readRawRows(prefix);
        if (rows.length >= 12) {
          Z.notice('最多支持 12 个等级档位。', true);
          return;
        }
        const lastIdx = rows.length - 1;
        const prevPct = lastIdx > 0 ? rows[lastIdx - 1].pct : 0;
        const midPct = Math.min(99, Math.max(prevPct + 1, Math.round((prevPct + 100) / 2)));
        const nextLabel = prefix === 'abc'
          ? String.fromCharCode(65 + Math.min(25, rows.length))
          : `L${rows.length + 1}`;
        rows.splice(lastIdx, 0, { label: nextLabel, pct: midPct / 100 });
        rows[rows.length - 1].pct = 1;
        repaintGrades(prefix, rows.map(x => ({ label: x.label, pct: x.pct > 1 ? x.pct / 100 : x.pct })));
      });
    });

    form.addEventListener('click', ev => {
      const delBtn = ev.target.closest('[data-grade-remove]');
      if (!delBtn || delBtn.disabled) return;
      const prefix = delBtn.dataset.gradeRemove;
      const idx = Number(delBtn.dataset.index);
      const rows = readRawRows(prefix);
      if (rows.length <= 2) return;
      rows.splice(idx, 1);
      rows[rows.length - 1].pct = 100;
      repaintGrades(prefix, rows.map(x => ({ label: x.label, pct: x.pct > 1 ? x.pct / 100 : x.pct })));
    });

    const importInput = form.querySelector('#rules-import-file');
    form.querySelectorAll('[data-rules-io]').forEach(ioBtn => {
      ioBtn.addEventListener('click', async () => {
        const mode = ioBtn.dataset.rulesIo;
        if (mode === 'export') {
          try {
            const payload = { format: 'rongqiao-rules', version: 1, exported_at: new Date().toISOString(), rules: readFormRules(form) };
            Z.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), '融侨学迹_口径参数表.json');
            Z.notice('已导出当前口径参数表，可在其他考试中一键导入复用。');
          } catch (err) {
            const errEl = form.querySelector('#rules-error');
            if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
          }
        } else if (mode === 'import') {
          importInput?.click();
        } else if (mode === 'load-default') {
          try {
            const res = await Z.api('/api/default-rules');
            const defRules = res.rules || DEFAULTS;
            const currentMarks = defRules.full_marks || {};
            const filteredMarks = {};
            dataset.subjects.forEach(s => { if (currentMarks[s] != null) filteredMarks[s] = currentMarks[s]; });
            const activeTab = form.querySelector('[data-rules-tab].active')?.dataset.rulesTab || 'common';
            onReRender({
              ...DEFAULTS,
              ...defRules,
              classes: dataset.classes,
              total_subjects: dataset.subjects,
              subject_order: dataset.subjects,
              full_marks: filteredMarks,
            }, activeTab);
            Z.notice(res.has_custom ? '已载入学校已保存的默认口径，核对后点击保存生效。' : '尚未设置自定义默认口径，已载入系统默认口径。');
          } catch (err) {
            const errEl = form.querySelector('#rules-error');
            if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
          }
        } else if (mode === 'reset') {
          const activeTab = form.querySelector('[data-rules-tab].active')?.dataset.rulesTab || 'common';
          onReRender({ ...DEFAULTS, classes: dataset.classes, total_subjects: dataset.subjects, subject_order: dataset.subjects, full_marks: {} }, activeTab);
          Z.notice('已恢复出厂默认口径，点击“保存并重新计算”生效。');
        }
      });
    });

    if (importInput) {
      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const importedRules = parsed?.rules && typeof parsed.rules === 'object' ? parsed.rules : parsed;
          if (!importedRules || typeof importedRules !== 'object') throw new Error('参数表格式无效。');
          // Keep classes compatible with current dataset
          const safeClasses = Array.isArray(importedRules.classes)
            ? importedRules.classes.filter(c => dataset.classes.includes(c))
            : dataset.classes;
          const safeTotal = Array.isArray(importedRules.total_subjects)
            ? importedRules.total_subjects.filter(s => dataset.subjects.includes(s))
            : dataset.subjects;
          onReRender({
            ...DEFAULTS,
            ...importedRules,
            classes: safeClasses.length ? safeClasses : dataset.classes,
            total_subjects: safeTotal.length ? safeTotal : dataset.subjects,
          });
          Z.notice('已导入参数表，请核对后点击“保存并重新计算”。');
        } catch (err) {
          const errEl = form.querySelector('#rules-error');
          if (errEl) { errEl.textContent = err.message || '参数表不是有效的 JSON 文件。'; errEl.hidden = false; }
        } finally {
          importInput.value = '';
        }
      });
    }
  }

  window.LeaderRules = { DEFAULTS, ruleMarkPresetsHTML, buildFormHTML, readFormRules, bindRulesForm };
})();

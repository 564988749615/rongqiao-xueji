/* 融侨学迹快速出表：一次导入，一组真实分析结果。成绩仅在本页内存中暂存。 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const now = new Date();
  const todayText = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const state = { dataset: null, analysis: null, edits: {}, lastFile: null, busy: false, saving: false, exporting: false, scope: 'all', tab: 'scores', page: 1, pageSize: 30, search: '', tableClass: '', dirty: false, importSerial: 0, analyzeSerial: 0, savedId: null };
  const SETTINGS_KEY = 'zhixu.quick.settings.v1';
  const tabLabels = { scores: '成绩排名', abc: 'ABC 等级', levels: '六等级', effective: '有效分', class_stats: '班级统计', segments: '前 N 名人数', weak: '薄弱学科', quality: '数据核验', rules: '计算口径' };
  const exportIds = ['workbook-button', 'print-all-button', 'copy-button', 'csv-button', 'print-button', 'save-button'];
  const html = (v) => Z.escape(v == null ? '' : v);
  const number = (v, digits = 1) => Z.num(v, digits);

  function metadata() {
    return { name: $('exam-name').value.trim(), grade: $('exam-grade').value.trim(), date: $('exam-date').value };
  }
  function showError(error, focus = true) {
    $('page-error').textContent = typeof error === 'string' ? error : (error.message || '操作未完成，请重试。');
    $('page-error').hidden = false;
    if (focus) $('page-error').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function clearError() { $('page-error').hidden = true; $('page-error').textContent = ''; }
  function setBusy(value, label = '正在读取文件…') {
    state.busy = value;
    document.body.classList.toggle('quick-busy', value);
    $('file-input').disabled = value;
    $('example-button').disabled = value;
    $('retry-upload-button').disabled = value;
    $('generate-button').disabled = value;
    $('regenerate-button').disabled = value;
    $('import-status').textContent = value ? label : (state.dataset ? '读取完成 · 原始文件未修改' : '支持 .xlsx、.xlsm、.csv');
    updateActions();
  }
  function updateActions() {
    const disabled = !state.analysis || state.dirty || state.busy || state.saving || state.exporting;
    exportIds.forEach(id => { $(id).disabled = disabled; });
    if (state.savedId && !state.dirty) $('save-button').disabled = true;
    $('stale-notice').hidden = !state.analysis || !state.dirty;
    $('results-section').setAttribute('aria-busy', String(state.busy));
  }
  const DEFAULT_ABC = [{ label: 'A', pct: 0.30 }, { label: 'B', pct: 0.80 }, { label: 'C', pct: 1.00 }];
  const DEFAULT_LVL = [
    { label: 'A1', pct: 0.18 }, { label: 'A2', pct: 0.30 },
    { label: 'B1', pct: 0.55 }, { label: 'B2', pct: 0.80 },
    { label: 'C1', pct: 0.90 }, { label: 'C2', pct: 1.00 },
  ];
  const DEFAULT_TOP_NODES = '50,100,150,200,250,300,350,400,450,500,600,700,800';
  const pctNum = v => { const x = Number(v); if (!Number.isFinite(x)) return ''; return Number((x <= 1 ? x * 100 : x).toFixed(2)); };

  function renderQuickGrades(prefix, items) {
    const body = $(`quick-${prefix}-body`);
    if (!body) return;
    const canRemove = items.length > 2;
    body.innerHTML = items.map((item, i) => `<tr>
      <td><input type="text" data-q-${prefix}-label="${i}" value="${html(item.label)}" maxlength="8" aria-label="等级名称"></td>
      <td><input type="number" data-q-${prefix}-pct="${i}" value="${pctNum(item.pct)}" min="0.5" max="100" step="0.5" aria-label="累计比例上限"></td>
      <td style="width:32px;text-align:center"><button type="button" class="quick-grade-del" data-quick-grade-del="${prefix}" data-index="${i}" title="删除该档" aria-label="删除该档"${canRemove ? '' : ' disabled'}>×</button></td>
    </tr>`).join('');
  }
  function readQuickRawGrades(prefix) {
    const body = $(`quick-${prefix}-body`);
    if (!body) return [];
    const labels = [...body.querySelectorAll(`[data-q-${prefix}-label]`)];
    return labels.map((el, i) => ({
      label: el.value.trim(),
      pct: Number(body.querySelector(`[data-q-${prefix}-pct="${i}"]`)?.value),
    }));
  }
  function parseQuickGrades(prefix, title) {
    const rows = readQuickRawGrades(prefix);
    if (rows.length < 2) throw new Error(`${title}至少需要 2 个档位。`);
    let prev = 0;
    const out = [];
    for (const row of rows) {
      if (!row.label) throw new Error(`${title}名称不能为空。`);
      if (!Number.isFinite(row.pct) || row.pct <= prev || row.pct > 100) {
        throw new Error(`${title}「${row.label}」的累计比例应大于上一档且不超过 100%。`);
      }
      out.push({ label: row.label, pct: Number((row.pct / 100).toFixed(4)) });
      prev = row.pct;
    }
    if (Math.abs(out[out.length - 1].pct - 1) > 0.001) {
      throw new Error(`${title}最后一档的累计比例应为 100%。`);
    }
    return out;
  }
  function applyQuickRulesToUI(r) {
    if (!r || typeof r !== 'object') return;
    if (r.cutoff_ratio != null) $('cutoff-ratio').value = pctNum(r.cutoff_ratio);
    if (['floor', 'round', 'ceil'].includes(r.cutoff_rounding)) $('cutoff-rounding').value = r.cutoff_rounding;
    if (['competition', 'dense'].includes(r.tie_mode)) $('tie-mode').value = r.tie_mode;
    if (['exclude', 'include'].includes(r.zero_policy)) $('zero-policy').value = r.zero_policy;
    if (['exclude_total', 'zero'].includes(r.missing_policy)) $('missing-policy').value = r.missing_policy;
    if (r.weak_count >= 1 && r.weak_count <= 7) $('weak-count').value = String(r.weak_count);
    if (r.score_bin_step >= 1 && r.score_bin_step <= 500) $('score-bin-step').value = String(r.score_bin_step);
    if (Array.isArray(r.top_nodes) && r.top_nodes.length) $('top-nodes').value = r.top_nodes.join(',');
    else if (typeof r.top_nodes === 'string' && r.top_nodes.trim()) $('top-nodes').value = r.top_nodes;
    if (Array.isArray(r.abc_bounds) && r.abc_bounds.length >= 2) renderQuickGrades('abc', r.abc_bounds);
    if (Array.isArray(r.level_bounds) && r.level_bounds.length >= 2) renderQuickGrades('lvl', r.level_bounds);
    if (r.full_marks && typeof r.full_marks === 'object') {
      $('full-mark-options')?.querySelectorAll('input').forEach(input => {
        const val = r.full_marks[input.dataset.subject];
        if (val != null && val !== '') input.value = val;
      });
    }
  }
  function rememberSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        cutoff: $('cutoff-ratio').value,
        rounding: $('cutoff-rounding').value,
        tie: $('tie-mode').value,
        zero: $('zero-policy').value,
        missing: $('missing-policy').value,
        weak: $('weak-count').value,
        binStep: $('score-bin-step').value,
        topNodes: $('top-nodes').value,
        abc: readQuickRawGrades('abc'),
        lvl: readQuickRawGrades('lvl'),
      }));
    } catch (_) { /* 页面仍可使用；这里不保存成绩。 */ }
  }
  function restoreSettings() {
    renderQuickGrades('abc', DEFAULT_ABC);
    renderQuickGrades('lvl', DEFAULT_LVL);
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (Number(s.cutoff) > 0 && Number(s.cutoff) <= 100) $('cutoff-ratio').value = s.cutoff;
      if (['floor', 'round', 'ceil'].includes(s.rounding)) $('cutoff-rounding').value = s.rounding;
      if (['competition', 'dense'].includes(s.tie)) $('tie-mode').value = s.tie;
      if (['exclude', 'include'].includes(s.zero)) $('zero-policy').value = s.zero;
      if (['exclude_total', 'zero'].includes(s.missing)) $('missing-policy').value = s.missing;
      if (Number(s.weak) >= 1 && Number(s.weak) <= 7) $('weak-count').value = s.weak;
      if (Number(s.binStep) >= 1 && Number(s.binStep) <= 500) $('score-bin-step').value = s.binStep;
      if (typeof s.topNodes === 'string' && s.topNodes.trim()) $('top-nodes').value = s.topNodes;
      if (Array.isArray(s.abc) && s.abc.length >= 2) renderQuickGrades('abc', s.abc);
      if (Array.isArray(s.lvl) && s.lvl.length >= 2) renderQuickGrades('lvl', s.lvl);
    } catch (_) { /* 无有效设置时使用已显示的默认值。 */ }
  }
  async function loadServerDefaultRules() {
    if (localStorage.getItem(SETTINGS_KEY)) return;
    try {
      const res = await Z.api('/api/default-rules');
      if (res?.has_custom && res.rules) applyQuickRulesToUI(res.rules);
    } catch (_) { /* 离线或无自定义默认时静默保持内置默认 */ }
  }
  function changed() {
    state.dirty = !!state.analysis;
    state.savedId = null;
    $('save-button').textContent = '保存到全校平台';
    $('save-feedback').hidden = true;
    $('rules-feedback').textContent = state.analysis ? '设置已更改，重新生成后再复制、打印或保存。' : '按所选范围统一生成所有报表。';
    rememberSettings();
    updateActions();
  }
  function selectedClasses() {
    if (!state.dataset) return [];
    if (state.scope === 'all') return [...state.dataset.classes];
    if (state.scope === 'first20') return state.dataset.classes.filter(c => { const n = Number(String(c).replace(/班$/u, '')); return Number.isFinite(n) && n >= 1 && n <= 20; });
    return [...$('class-options').querySelectorAll('input:checked')].map(input => input.value);
  }
  function updateScopeCaption() {
    const classes = selectedClasses();
    $('scope-caption').textContent = `已选择 ${classes.length} 个班级${state.dataset ? `，原表共 ${state.dataset.classes.length} 个班级` : ''}。`;
  }
  function setScope(scope) {
    state.scope = scope;
    document.querySelectorAll('[data-scope]').forEach(button => {
      const active = button.dataset.scope === scope;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('class-options').hidden = scope !== 'custom';
    updateScopeCaption();
    changed();
  }
  function readRules() {
    const classes = selectedClasses();
    const totalSubjects = [...$('subject-options').querySelectorAll('input:checked')].map(input => input.value);
    const percent = Number($('cutoff-ratio').value);
    const weakCount = Number($('weak-count').value);
    const binStep = Number($('score-bin-step').value);
    if (!classes.length) throw new Error('请至少选择一个班级。');
    if (!totalSubjects.length) throw new Error('请至少选择一个计入总分的科目。');
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('有效分比例应在 0.1%—100% 之间。');
    if (!Number.isFinite(binStep) || binStep < 1 || binStep > 500) throw new Error('分数段间隔应在 1—500 分之间。');
    const topNodes = String($('top-nodes').value || '').replace(/，/g, ',').split(',').map(x => x.trim()).filter(Boolean).map(Number);
    if (!topNodes.length || topNodes.some(v => !Number.isInteger(v) || v <= 0)) {
      throw new Error('前 N 名次节点应为逗号分隔的正整数，例如 50,100,200,400,600,800。');
    }
    const abcBounds = parseQuickGrades('abc', '学生等级');
    const levelBounds = parseQuickGrades('lvl', '分层等级');
    const fullMarks = {};
    $('full-mark-options').querySelectorAll('input').forEach(input => {
      if (input.value.trim() === '') return;
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${input.dataset.subject}的满分应大于 0，未确认可留空。`);
      fullMarks[input.dataset.subject] = value;
    });
    return {
      classes: state.scope === 'all' ? null : classes,
      total_subjects: totalSubjects,
      cutoff_ratio: percent / 100,
      cutoff_rounding: $('cutoff-rounding').value || 'floor',
      tie_mode: $('tie-mode').value || 'competition',
      zero_policy: $('zero-policy').value,
      missing_policy: $('missing-policy').value,
      weak_count: weakCount,
      score_bin_step: binStep,
      top_nodes: [...new Set(topNodes)].sort((a, b) => a - b),
      abc_bounds: abcBounds,
      level_bounds: levelBounds,
      full_marks: fullMarks,
    };
  }
  function warningHTML(warnings, limit = 12) {
    const messages = warnings.slice(0, limit).map(w => `<li>${html(w.message || w)}</li>`).join('');
    return `<ul>${messages}</ul>${warnings.length > limit ? `<p class="quick-more-warning">另有 ${warnings.length - limit} 项，生成后可在“数据核验”表中查看。</p>` : ''}`;
  }
  function acceptDataset(dataset, opts = {}) {
    if (!dataset || !Array.isArray(dataset.rows) || !Array.isArray(dataset.subjects) || !Array.isArray(dataset.classes)) throw new Error('读取结果不完整，请重新选择原始成绩表。');
    state.dataset = dataset;
    state.analysis = null;
    state.edits = {};
    state.dirty = false;
    state.savedId = null;
    state.tab = 'scores';
    state.search = '';
    state.tableClass = '';
    state.page = 1;
    $('table-search').value = '';
    $('save-feedback').hidden = true;
    $('save-button').textContent = '保存到全校平台';
    if (opts.useMetadata || !$('exam-name').value.trim()) $('exam-name').value = dataset.name || String(dataset.filename || '本次考试').replace(/\.[^.]+$/, '');
    if (opts.useMetadata && dataset.grade) $('exam-grade').value = dataset.grade;
    if (opts.useMetadata && dataset.date) $('exam-date').value = dataset.date;
    $('upload-title').textContent = dataset.filename || '成绩表已读入';
    $('upload-description').textContent = '已识别班级与学科；需要替换时，重新选择文件。';
    const reliable = dataset.rows.filter(r => r.identity_reliable).length;
    $('dataset-summary').innerHTML = `<span><b>${dataset.rows.length}</b> 条原始记录</span><span><b>${dataset.classes.length}</b> 个班级</span><span><b>${dataset.subjects.length}</b> 个科目</span><span>${reliable === dataset.rows.length ? '学生身份可关联' : '含匿名记录，使用原表行号定位'}</span><span class="quick-filename" title="${html(dataset.filename)}">${html(dataset.filename)}</span>`;
    $('dataset-summary').hidden = false;
    const warnings = dataset.warnings || [];
    $('import-warnings').hidden = !warnings.length;
    $('import-warnings-summary').textContent = `读取核验：${warnings.length} 项提示`;
    $('import-warnings-body').innerHTML = warningHTML(warnings);
    $('class-options').innerHTML = dataset.classes.map(cls => `<label><input type="checkbox" value="${html(cls)}" checked><span>${html(cls)} 班</span></label>`).join('');
    $('subject-options').innerHTML = dataset.subjects.map(subject => `<label><input type="checkbox" value="${html(subject)}" checked><span>${html(subject)}</span></label>`).join('');
    $('full-mark-options').innerHTML = dataset.subjects.map(subject => `<label class="field"><span>${html(subject)}</span><input type="number" data-subject="${html(subject)}" min="0.1" step="0.5" inputmode="decimal" placeholder="未确认" aria-label="${html(subject)}满分（选填）"></label>`).join('');
    renderFullMarkPresets();
    $('rules-section').hidden = false;
    $('results-section').hidden = true;
    $('before-results').hidden = false;
    $('rules-feedback').textContent = '按所选范围统一生成所有报表。';
    setScope('all');
    updateActions();
    $('rules-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function renderFullMarkPresets() {
    const saved = Z.getFullMarkTemplate();
    $('full-mark-presets').innerHTML = [
      ...Z.fullMarkPresets.map(p => `<button type="button" data-mark-preset="${html(p.id)}">${html(p.label)}</button>`),
      saved ? '<button type="button" data-mark-preset="saved">套用已存模板</button>' : '',
      '<button type="button" data-mark-preset="save">存为常用模板</button>',
      '<button type="button" data-mark-preset="clear">清空</button>'
    ].join('');
  }
  function applyFullMarkPreset(action) {
    const inputs = [...$('full-mark-options').querySelectorAll('input')];
    if (!inputs.length) return;
    if (action === 'clear') {
      inputs.forEach(input => { input.value = ''; });
      changed();
      Z.notice('已清空各科满分设置。');
      return;
    }
    if (action === 'save') {
      const current = {};
      inputs.forEach(input => { if (input.value.trim() !== '') current[input.dataset.subject] = Number(input.value); });
      try {
        const saved = Z.setFullMarkTemplate(current);
        renderFullMarkPresets();
        Z.notice(`已保存 ${Object.keys(saved).length} 科常用满分模板到本机。`);
      } catch (error) { showError(error); }
      return;
    }
    const preset = action === 'saved' ? { marks: Z.getFullMarkTemplate() } : Z.fullMarkPresets.find(p => p.id === action);
    if (!preset) return;
    let filled = 0;
    inputs.forEach(input => {
      const val = preset.all ?? preset.marks?.[input.dataset.subject];
      if (val != null) { input.value = val; filled += 1; }
    });
    changed();
    Z.notice(filled ? `已按模板填入 ${filled} 科满分，请核对后生成。` : '当前表中没有与模板匹配的学科。');
  }
  function base64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('无法读取这个文件，请重新选择。'));
      reader.readAsDataURL(file);
    });
  }
  async function upload(file) {
    if (!file || state.busy) return;
    clearError();
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) { showError('请选择 .xlsx、.xlsm 或 .csv 成绩表；旧版 .xls 请先在 Excel 中另存为 .xlsx。'); return; }
    if (file.size > 20 * 1024 * 1024) { showError('文件超过 20 MB，请删除无关工作表或另存为精简的成绩表后再导入。'); return; }
    state.lastFile = file;
    const serial = ++state.importSerial;
    setBusy(true);
    try {
      const meta = metadata();
      if (!meta.name) meta.name = file.name.replace(/\.[^.]+$/, '');
      const password = $('file-password').value;
      const dataset = password ? await Z.api('/api/import', { filename: file.name, content: await base64(file), metadata: meta, password }) : await Z.upload(file, meta);
      if (serial !== state.importSerial) return;
      state.lastFile = null;
      $('retry-upload-button').hidden = true;
      acceptDataset(dataset);
      $('file-password').value = '';
      Z.notice(`已读取 ${dataset.rows.length} 条成绩，请确认范围后生成分析表。`);
    } catch (error) {
      if (serial === state.importSerial) {
        showError(error);
        $('upload-title').textContent = file.name;
        $('upload-description').textContent = '读取未完成，已保留当前文件；核对密码或表格后可重新读取，或另选文件。';
        $('retry-upload-button').hidden = false;
        if (/密码/.test(String(error?.message || ''))) {
          const details = $('file-password').closest('details');
          if (details) details.open = true;
          $('file-password').focus();
        }
      }
    }
    finally { if (serial === state.importSerial) setBusy(false); $('file-input').value = ''; }
  }
  async function loadExample() {
    if (state.busy) return;
    clearError();
    state.lastFile = null;
    $('retry-upload-button').hidden = true;
    const serial = ++state.importSerial;
    setBusy(true, '正在读取已提供的原始表…');
    try {
      const dataset = await Z.api('/api/example');
      if (serial !== state.importSerial) return;
      acceptDataset(dataset, { useMetadata: true });
      Z.notice('已读取你提供的原始数据.xlsx，未保存到全校平台。');
    } catch (error) { if (serial === state.importSerial) showError(error); }
    finally { if (serial === state.importSerial) setBusy(false); }
  }
  function formLocked(locked) {
    $('rules-section').querySelectorAll('input,select,button').forEach(element => { element.disabled = locked; });
    ['exam-name', 'exam-grade', 'exam-date', 'file-password'].forEach(id => { $(id).disabled = locked; });
  }
  function effectiveQuickDataset(base) {
    const edits = Object.values(state.edits || {});
    if (!edits.length) return base;
    const byCell = new Map(edits.map(x => [`${x.row_id}||${x.subject}`, x.value]));
    return {
      ...base,
      rows: base.rows.map(r => {
        let changedRow = false;
        const nextScores = { ...r.scores };
        for (const sub of base.subjects) {
          const k = `${r.id}||${sub}`;
          if (byCell.has(k)) {
            nextScores[sub] = byCell.get(k);
            changedRow = true;
          }
        }
        return changedRow ? { ...r, scores: nextScores } : r;
      }),
    };
  }
  async function generate() {
    if (!state.dataset || state.busy) return;
    clearError();
    let rules;
    try {
      rules = readRules();
      if (!metadata().name) throw new Error('请填写考试名称，便于在下载和打印的报表中识别本次考试。');
      if (!metadata().grade) throw new Error('请填写年级，各年级需要独立统计。');
      if (!metadata().date) throw new Error('请选择考试日期，便于在全校平台中按时间查看。');
    } catch (error) { showError(error); return; }
    const serial = ++state.analyzeSerial;
    const dataset = { ...state.dataset, ...metadata() };
    const effectiveDs = effectiveQuickDataset(dataset);
    setBusy(true, '正在计算分析表…');
    formLocked(true);
    const original = $('generate-button').innerHTML;
    $('generate-button').textContent = '正在生成…';
    try {
      const analysis = await Z.api('/api/analyze', { dataset: effectiveDs, rules });
      if (serial !== state.analyzeSerial) return;
      if (!analysis || !Array.isArray(analysis.tables)) throw new Error('分析结果不完整，请重试。');
      state.dataset = dataset;
      state.analysis = analysis;
      const editCnt = Object.keys(state.edits || {}).length;
      state.analysis.metadata = { ...(analysis.metadata || {}), data_version: editCnt ? 2 : 1, edit_count: editCnt };
      state.dirty = false;
      state.savedId = null;
      state.page = 1;
      state.tableClass = '';
      state.search = '';
      $('table-search').value = '';
      $('save-feedback').hidden = true;
      $('save-button').textContent = '保存到全校平台';
      $('rules-feedback').textContent = `已按 ${analysis.classes.length} 个班级、${rules.total_subjects.length} 个总分科目生成${editCnt ? `（含 ${editCnt} 处内存修改）` : ''}。`;
      $('results-section').hidden = false;
      $('before-results').hidden = true;
      $('result-version').textContent = `${analysis.tables.length} 张分析表${editCnt ? ` · 已改 ${editCnt} 处` : ''}`;
      const s = analysis.summary;
      const totalMark = rules.total_subjects.every(sub => rules.full_marks[sub]) ? rules.total_subjects.reduce((sum, sub) => sum + rules.full_marks[sub], 0) : null;
      $('result-summary').innerHTML = [
        stat('参与排名', s.participants, '人', `纳入范围 ${s.registered} 人 · 排除 ${s.excluded} 人`, 0),
        stat('总分平均', s.mean, '分', `${rules.total_subjects.length} 个科目${totalMark ? ` · 满分 ${totalMark}` : ' · 未设总分满分'}`),
        stat(`前 ${number(rules.cutoff_ratio * 100, 1)}% 分界`, s.cutoff, '分', `参考位置 ${s.cutoff_rank || '—'}`),
        stat('总分达标', s.elite_count, '人', '边界同分全部纳入', 0),
        stat('当前统计', s.class_count || analysis.classes.length, '个班', `${html(analysis.metadata.grade)} · ${html(analysis.metadata.date)}`, 0)
      ].join('');
      $('table-tabs').innerHTML = analysis.tables.map(t => `<button id="tab-${html(t.id)}" type="button" role="tab" aria-controls="table-container" aria-selected="${t.id === state.tab}" data-table="${html(t.id)}">${html(tabLabels[t.id] || t.title)}</button>`).join('');
      if (!analysis.tables.some(t => t.id === state.tab)) state.tab = analysis.tables[0]?.id;
      renderTable();
      $('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      Z.notice(`已生成 ${analysis.tables.length} 张分析表。`);
    } catch (error) { if (serial === state.analyzeSerial) showError(error); }
    finally {
      if (serial === state.analyzeSerial) { formLocked(false); $('generate-button').innerHTML = original; setBusy(false); updateActions(); }
    }
  }
  function stat(label, value, unit, caption, digits = 1) {
    return `<div class="quick-stat"><span>${html(label)}</span><b>${number(value, digits)}<small>${html(unit)}</small></b><p>${caption}</p></div>`;
  }
  function currentTable() { return state.analysis?.tables.find(t => t.id === state.tab) || null; }
  function classColumn(table) { return table.columns.findIndex(c => /^(班级|班号|班别)$/u.test(String(c).trim())); }
  function filteredTable() {
    const table = currentTable();
    if (!table) return null;
    const cls = classColumn(table);
    const search = state.search.trim().toLocaleLowerCase();
    const rows = table.rows.filter(row => {
      if (state.tableClass && cls >= 0 && String(row[cls]) !== state.tableClass) return false;
      return !search || row.some(cell => String(cell ?? '').toLocaleLowerCase().includes(search));
    });
    const filters = [state.tableClass && cls >= 0 ? `${state.tableClass}班` : '', search ? `搜索“${state.search.trim()}”` : ''].filter(Boolean);
    return { ...table, rows, title: table.title + (filters.length ? ` · ${filters.join(' · ')}` : ''), note: [table.note, filters.length ? `筛选后共 ${rows.length} 行；复制和导出包括全部筛选结果。` : ''].filter(Boolean).join(' ') };
  }
  function renderTable() {
    const source = currentTable();
    if (!source) { $('table-container').innerHTML = '<div class="quick-table-empty">本次没有可展示的分析表。</div>'; return; }
    const clsIndex = classColumn(source);
    const classValues = clsIndex >= 0 ? [...new Set(source.rows.map(r => r[clsIndex]).filter(v => v != null && String(v).trim() && !/合计|全部|年级/u.test(String(v))).map(String))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })) : [];
    if (!classValues.includes(state.tableClass)) state.tableClass = '';
    $('table-class').innerHTML = '<option value="">全部班级</option>' + classValues.map(v => `<option value="${html(v)}"${v === state.tableClass ? ' selected' : ''}>${html(v)} 班</option>`).join('');
    $('table-class').disabled = clsIndex < 0;
    $('table-class').closest('label').hidden = clsIndex < 0;
    const table = filteredTable();
    const pageCount = Math.max(1, Math.ceil(table.rows.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pageCount));
    const offset = (state.page - 1) * state.pageSize;
    const visibleRows = table.rows.slice(offset, offset + state.pageSize);
    $('table-title').textContent = source.title;
    const scopeText = state.analysis.classes.join('、') + '班';
    const conciseNote = String(source.note || '').replace(scopeText, `${state.analysis.classes.length}个班级`);
    $('table-note').textContent = conciseNote || (source.id === 'scores' ? '排名以当前纳入范围为准，同分同名次；未参与排名的记录仍保留在表中。' : '当前表与本次分析使用同一份数据和计算口径。');
    $('table-count').textContent = table.rows.length === source.rows.length ? `共 ${source.rows.length} 行` : `筛选 ${table.rows.length} / ${source.rows.length} 行`;
    $('table-tabs').querySelectorAll('button').forEach(b => {
      const active = b.dataset.table === state.tab;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    $('table-container').setAttribute('aria-labelledby', `tab-${state.tab}`);
    if (visibleRows.length) {
      const classes = source.columns.map((c, i) => { const text = /姓名|学科|科目|说明|规则|状态|提示|内容|项目|来源|详情|等级|薄弱/u.test(String(c)); const long = /说明|内容|规则|详情|提示/u.test(String(c)); return (text ? 'quick-text-cell' : '') + (long ? ' quick-long-cell' : ''); });
      const canInlineEdit = source.id === 'scores' && Array.isArray(state.analysis?.students);
      const subjectSet = new Set(state.analysis?.subjects || []);
      const rowToStudent = canInlineEdit ? new Map(source.rows.map((r, idx) => [r, state.analysis.students[idx]])) : null;
      $('table-container').innerHTML = `<table><thead><tr>${source.columns.map((c, i) => `<th scope="col" class="${classes[i]}">${html(c)}</th>`).join('')}</tr></thead><tbody>${visibleRows.map(row => {
        const stu = rowToStudent?.get(row);
        return `<tr>${source.columns.map((col, i) => {
          const isSubCol = canInlineEdit && stu && subjectSet.has(col);
          const editKey = isSubCol ? `${stu.id}||${col}` : '';
          const editedInfo = editKey ? state.edits[editKey] : null;
          const extraCls = `${classes[i]}${row[i] == null || row[i] === '' ? ' quick-null' : ''}${isSubCol ? ' quick-editable-cell' : ''}${editedInfo ? ' is-edited' : ''}`;
          const attrs = isSubCol ? ` data-edit-row="${html(stu.id)}" data-edit-sub="${html(col)}" title="${editedInfo ? `原 ${editedInfo.old_value ?? '缺考'} · 点击可继续修改` : '点击修改该科成绩'}"` : '';
          return `<td class="${extraCls}"${attrs}>${html(displayCell(row[i]))}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table>`;
    } else {
      const hasFilter = state.tableClass || state.search;
      $('table-container').innerHTML = `<div class="quick-table-empty"><b>${hasFilter ? '没有匹配的记录' : '当前范围没有记录'}</b><span>${hasFilter ? '试试其他班级或关键词。' : '检查原始数据或调整统计范围后重新生成。'}</span>${hasFilter ? '<button type="button" id="clear-table-filters">清除筛选</button>' : ''}</div>`;
      $('clear-table-filters')?.addEventListener('click', () => { state.tableClass = ''; state.search = ''; state.page = 1; $('table-search').value = ''; renderTable(); });
    }
    $('page-label').textContent = `${state.page} / ${pageCount}`;
    $('previous-page').disabled = state.page <= 1;
    $('next-page').disabled = state.page >= pageCount;
    $('table-footnote').textContent = `${table.rows.length ? `显示第 ${offset + 1}—${offset + visibleRows.length} 行。` : ''}复制、下载和打印包含当前筛选的全部 ${table.rows.length} 行。`;
  }
  function displayCell(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round((value + Number.EPSILON) * 10000) / 10000);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  function switchTable(id, focus = false) {
    if (!state.analysis?.tables.some(t => t.id === id)) return;
    state.tab = id;
    state.page = 1;
    state.search = '';
    $('table-search').value = '';
    renderTable();
    $('table-container').scrollTop = 0;
    $('table-container').scrollLeft = 0;
    if (focus) $(`tab-${id}`).focus();
  }
  function ensureFresh() {
    if (!state.analysis || state.dirty || state.busy) { Z.notice('请先按当前设置重新生成分析表。', true); return false; }
    return true;
  }
  function reportSubtitle() {
    const a = state.analysis;
    const r = a.rules;
    const scope = a.classes.length === 1 ? `${a.classes[0]}班` : `${a.classes.length}个班级`;
    return `${a.metadata.grade} · ${a.metadata.date} · ${scope} · 总分科目：${r.total_subjects.join('、')} · 有效分前${number(r.cutoff_ratio * 100, 1)}% · 同分同名次，边界同分全纳入`;
  }
  async function save() {
    if (!ensureFresh() || state.saving || state.savedId) return;
    clearError();
    state.saving = true;
    updateActions();
    $('save-button').textContent = '正在保存…';
    try {
      const editList = Object.values(state.edits || {}).map(x => ({ row_id: x.row_id, subject: x.subject, value: x.value }));
      const saved = await Z.api('/api/exams', { dataset: state.dataset, rules: state.analysis.rules, ...(editList.length ? { edits: editList } : {}) });
      if (!saved.id) throw new Error('未收到保存结果，请稍后查看全校平台再重试。');
      const check = await Z.api(`/api/exams/${encodeURIComponent(saved.id)}`);
      if (!check.dataset || check.dataset.id !== state.dataset.id) throw new Error('保存后的读取校验未通过，请到全校平台核对。');
      state.savedId = saved.id;
      $('save-feedback').innerHTML = `已保存“${html(saved.name || state.dataset.name)}”，刷新后可在全校平台继续查看。<a href="/leader.html?exam=${encodeURIComponent(saved.id)}">打开本次考试 →</a>`;
      $('save-feedback').hidden = false;
      $('save-button').textContent = '已保存到全校平台';
      Z.notice('考试与计算口径已保存，并已重新读取核对。');
    } catch (error) { showError(error); $('save-button').textContent = '保存到全校平台'; }
    finally { state.saving = false; updateActions(); }
  }
  async function exportWorkbook() {
    if (!ensureFresh() || state.exporting) return;
    state.exporting = true;
    updateActions();
    const button = $('workbook-button');
    button.textContent = '正在生成 Excel…';
    try { await Z.downloadWorkbook(state.analysis); }
    catch (error) { showError(error); }
    finally { state.exporting = false; button.textContent = '下载全部 Excel'; updateActions(); }
  }
  function bind() {
    $('file-input').addEventListener('change', event => upload(event.target.files?.[0]));
    $('example-button').addEventListener('click', loadExample);
    $('retry-upload-button').addEventListener('click', () => { if (state.lastFile) upload(state.lastFile); });
    $('file-password').addEventListener('keydown', event => { if (event.key === 'Enter' && state.lastFile) { event.preventDefault(); upload(state.lastFile); } });
    const zone = $('drop-zone');
    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); if (!state.busy) zone.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('drag-over'); }));
    zone.addEventListener('drop', event => { const files = event.dataTransfer.files; if (files.length > 1) showError('一次选择一份原始成绩表即可。'); else upload(files[0]); });
    document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => setScope(button.dataset.scope)));
    $('class-options').addEventListener('change', () => { updateScopeCaption(); changed(); });
    $('subject-options').addEventListener('change', changed);
    $('full-mark-options').addEventListener('input', changed);
    $('full-mark-presets').addEventListener('click', event => { const btn = event.target.closest('[data-mark-preset]'); if (btn) applyFullMarkPreset(btn.dataset.markPreset); });
    ['cutoff-ratio', 'cutoff-rounding', 'tie-mode', 'zero-policy', 'missing-policy', 'weak-count', 'score-bin-step', 'top-nodes', 'exam-name', 'exam-grade', 'exam-date'].forEach(id => $(id).addEventListener('input', changed));
    ['cutoff-rounding', 'tie-mode', 'zero-policy', 'missing-policy', 'weak-count'].forEach(id => $(id).addEventListener('change', changed));
    $('quick-grade-presets').addEventListener('click', event => {
      const btn = event.target.closest('[data-quick-grade-preset]');
      if (!btn) return;
      const key = btn.dataset.quickGradePreset;
      if (key === 'abcd4') {
        renderQuickGrades('abc', [{ label: 'A', pct: 0.25 }, { label: 'B', pct: 0.55 }, { label: 'C', pct: 0.85 }, { label: 'D', pct: 1.00 }]);
      } else if (key === '2040') {
        renderQuickGrades('abc', [{ label: 'A', pct: 0.40 }, { label: 'B', pct: 0.80 }, { label: 'C', pct: 1.00 }]);
        renderQuickGrades('lvl', [{ label: 'A1', pct: 0.20 }, { label: 'A2', pct: 0.40 }, { label: 'B1', pct: 0.60 }, { label: 'B2', pct: 0.80 }, { label: 'C1', pct: 0.90 }, { label: 'C2', pct: 1.00 }]);
      } else {
        renderQuickGrades('abc', DEFAULT_ABC);
        renderQuickGrades('lvl', DEFAULT_LVL);
      }
      changed();
      Z.notice('已套用等级比例预设，点击“生成分析表”生效。');
    });
    $('advanced-rules').addEventListener('click', event => {
      const addBtn = event.target.closest('[data-quick-grade-add]');
      if (addBtn) {
        const prefix = addBtn.dataset.quickGradeAdd;
        const rows = readQuickRawGrades(prefix);
        if (rows.length >= 12) { Z.notice('最多支持 12 个等级档位。', true); return; }
        const lastIdx = rows.length - 1;
        const prevPct = lastIdx > 0 ? (rows[lastIdx - 1].pct || 0) : 0;
        const midPct = Math.min(99, Math.max(prevPct + 1, Math.round((prevPct + 100) / 2)));
        const nextLabel = prefix === 'abc' ? String.fromCharCode(65 + Math.min(25, rows.length)) : `L${rows.length + 1}`;
        rows.splice(lastIdx, 0, { label: nextLabel, pct: midPct });
        rows[rows.length - 1].pct = 100;
        renderQuickGrades(prefix, rows.map(x => ({ label: x.label, pct: x.pct / 100 })));
        changed();
        return;
      }
      const delBtn = event.target.closest('[data-quick-grade-del]');
      if (delBtn && !delBtn.disabled) {
        const prefix = delBtn.dataset.quickGradeDel;
        const idx = Number(delBtn.dataset.index);
        const rows = readQuickRawGrades(prefix);
        if (rows.length <= 2) return;
        rows.splice(idx, 1);
        rows[rows.length - 1].pct = 100;
        renderQuickGrades(prefix, rows.map(x => ({ label: x.label, pct: x.pct / 100 })));
        changed();
      }
    });
    ['quick-abc-body', 'quick-lvl-body'].forEach(id => $(id).addEventListener('input', changed));
    $('quick-rules-export-btn').addEventListener('click', () => {
      try {
        const rules = readRules();
        const payload = { format: 'rongqiao-rules', version: 1, exported_at: new Date().toISOString(), rules };
        Z.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), '融侨学迹_口径参数表.json');
        Z.notice('已导出当前口径参数表，可在考试档案或下次出表中一键导入。');
      } catch (err) { showError(err); }
    });
    $('quick-rules-import-btn').addEventListener('click', () => $('quick-rules-import-file').click());
    $('quick-rules-import-file').addEventListener('change', async () => {
      const file = $('quick-rules-import-file').files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const imported = parsed?.rules && typeof parsed.rules === 'object' ? parsed.rules : parsed;
        applyQuickRulesToUI(imported);
        changed();
        Z.notice('已导入参数表，核对后点击“生成分析表”即可生效。');
      } catch (err) { showError(err.message || '参数表不是有效的 JSON 文件。'); }
      finally { $('quick-rules-import-file').value = ''; }
    });
    $('quick-rules-default-btn').addEventListener('click', async () => {
      try {
        const rules = readRules();
        if (!window.confirm('确认将当前试算参数设为「全校默认口径」吗？\n\n影响范围：后续所有新导入的考试和试算将自动沿用这套规则；已保存的历史考试不会被改动。')) {
          return;
        }
        await Z.api('/api/default-rules', { rules });
        Z.notice('已保存为全校默认口径，后续新建考试与试算将自动沿用。');
      } catch (err) { showError(err); }
    });
    $('quick-rules-reset-btn').addEventListener('click', () => {
      applyQuickRulesToUI({
        cutoff_ratio: 0.30, cutoff_rounding: 'floor', tie_mode: 'competition',
        zero_policy: 'exclude', missing_policy: 'exclude_total', weak_count: 4,
        score_bin_step: 50, top_nodes: DEFAULT_TOP_NODES,
        abc_bounds: DEFAULT_ABC, level_bounds: DEFAULT_LVL,
      });
      $('full-mark-options').querySelectorAll('input').forEach(i => { i.value = ''; });
      changed();
      Z.notice('已恢复系统默认计算口径。');
    });
    $('generate-button').addEventListener('click', generate);
    $('regenerate-button').addEventListener('click', generate);
    $('table-container').addEventListener('click', event => {
      const td = event.target.closest('td[data-edit-row]');
      if (!td || td.querySelector('input') || state.busy) return;
      const rowId = td.dataset.editRow, subject = td.dataset.editSub;
      const rawStu = state.dataset?.rows?.find(r => r.id === rowId);
      const curStu = state.analysis?.students?.find(s => s.id === rowId);
      if (!rawStu || !curStu) return;
      const curVal = curStu.scores?.[subject];
      const rawVal = rawStu.scores?.[subject];
      td.innerHTML = `<div class="quick-inline-editor"><input type="number" step="0.1" min="0" max="1000" value="${curVal == null ? '' : html(curVal)}" placeholder="缺考"><button type="button" class="quick-inline-btn" data-act="absent" title="设为缺考">缺</button><button type="button" class="quick-inline-btn primary" data-act="ok">✓</button></div>`;
      const inp = td.querySelector('input');
      inp.focus(); inp.select();
      const commit = async (val) => {
        const key = `${rowId}||${subject}`;
        const sameAsRaw = (val === null && rawVal == null) || (val !== null && rawVal != null && Math.abs(Number(val) - Number(rawVal)) < 1e-9);
        if (sameAsRaw) delete state.edits[key];
        else state.edits[key] = { row_id: rowId, subject, value: val, old_value: rawVal ?? null };
        await generate();
      };
      td.querySelector('[data-act="absent"]').addEventListener('click', e => { e.stopPropagation(); commit(null); });
      td.querySelector('[data-act="ok"]').addEventListener('click', e => {
        e.stopPropagation();
        const txt = inp.value.trim();
        if (txt === '') return commit(null);
        const num = Number(txt);
        if (!Number.isFinite(num) || num < 0 || num > 1000) { Z.notice('请输入 0–1000 之间的有效分数，或留空表示缺考。', true); return; }
        commit(Math.round(num * 10) / 10);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); td.querySelector('[data-act="ok"]').click(); }
        if (e.key === 'Escape') { e.preventDefault(); renderTable(); }
      });
    });
    $('table-tabs').addEventListener('click', event => { const b = event.target.closest('[data-table]'); if (b) switchTable(b.dataset.table); });
    $('table-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !state.analysis) return;
      event.preventDefault();
      const list = state.analysis.tables;
      const index = list.findIndex(t => t.id === state.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      switchTable(list[next].id, true);
    });
    $('table-class').addEventListener('change', event => { state.tableClass = event.target.value; state.page = 1; renderTable(); });
    $('table-search').addEventListener('input', event => { state.search = event.target.value; state.page = 1; renderTable(); });
    $('page-size').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; renderTable(); });
    $('previous-page').addEventListener('click', () => { state.page--; renderTable(); $('table-container').scrollTop = 0; });
    $('next-page').addEventListener('click', () => { state.page++; renderTable(); $('table-container').scrollTop = 0; });
    $('copy-button').addEventListener('click', async () => { if (!ensureFresh()) return; try { await Z.copyTable(filteredTable()); } catch (error) { showError(error); } });
    $('csv-button').addEventListener('click', () => { if (!ensureFresh()) return; try { const table = filteredTable(); Z.downloadTable(table, `${state.analysis.metadata.name}_${table.title}.csv`); } catch (error) { showError(error); } });
    $('print-button').addEventListener('click', () => { if (!ensureFresh()) return; try { Z.printTables([filteredTable()], state.analysis.metadata.name, reportSubtitle()); } catch (error) { showError(error); } });
    $('print-all-button').addEventListener('click', () => { if (!ensureFresh()) return; try { Z.printTables(state.analysis.tables, state.analysis.metadata.name, reportSubtitle()); } catch (error) { showError(error); } });
    $('workbook-button').addEventListener('click', exportWorkbook);
    $('save-button').addEventListener('click', save);
    Z.bindShutdown($('shutdown-button'));
    window.addEventListener('beforeunload', event => {
      if (state.saving || state.busy || state.exporting) { event.preventDefault(); event.returnValue = ''; }
    });
  }
  if (!$('exam-date').value) $('exam-date').value = todayText;
  restoreSettings();
  loadServerDefaultRules();
  bind();
  if (new URLSearchParams(location.search).get('load') === 'original') loadExample();
})();

'use strict';
/* 融侨学迹 · 一表多考增量导入 + 脏数据（错别字/转班/重名）智能核对 */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 0) => Z.num(v, d);

  function hygienePanelHTML(hygiene, scopeKey = 'single') {
    if (!hygiene) return '';
    const typos = hygiene.typo_candidates || [];
    const transfers = hygiene.class_transfers || [];
    const dups = hygiene.duplicate_names || [];
    const hasIssues = typos.length || transfers.length || dups.length || hygiene.new_count || hygiene.missing_count;
    if (!hygiene.has_baseline && !dups.length) return '';

    return `<div class="hygiene-card">
      <div class="hygiene-head">
        <div>
          <h4>跨考人物与脏数据核对</h4>
          <p>${hygiene.has_baseline
            ? `已自动对比同年级「${e(hygiene.baseline_exam)}」：新增 ${n(hygiene.new_count)} 人 · 缺席 ${n(hygiene.missing_count)} 人`
            : '同年级首场考试，已完成本场重名风险检查'}</p>
        </div>
        <span class="badge ${typos.length || dups.length ? 'warning' : 'success'}">
          ${typos.length ? `${typos.length} 处疑似错别字` : dups.length ? `${dups.length} 组重名提醒` : '名单正常'}
        </span>
      </div>
      ${typos.length ? `<div class="hygiene-block">
        <strong>疑似姓名错别字（勾选将在保存时自动修正为历史姓名，避免成长轨迹断裂）</strong>
        <div class="typo-fix-list">${typos.map((t, idx) => `<label class="typo-fix-item">
          <input type="checkbox" checked data-typo-scope="${e(scopeKey)}" data-typo-index="${idx}"
            data-typo-class="${e(t.class)}" data-typo-from="${e(t.incoming_name)}" data-typo-to="${e(t.suggested_name)}">
          <span class="badge">${e(t.class)}班</span>
          <span class="typo-diff"><s>${e(t.incoming_name)}</s> → <b>${e(t.suggested_name)}</b></span>
          <small class="muted">第 ${n(t.source_row)} 行</small>
        </label>`).join('')}</div>
      </div>` : ''}
      ${transfers.length ? `<div class="hygiene-block">
        <strong>检测到班级变动（疑似转班 ${transfers.length} 人）</strong>
        <div class="hygiene-chips">${transfers.slice(0, 12).map(tr =>
          `<span class="hygiene-chip">${e(tr.name)}：${e(tr.from_class)}班 → ${e(tr.to_class)}班 <small>(${e(tr.by)})</small></span>`
        ).join('')}</div>
      </div>` : ''}
      ${dups.length ? `<div class="hygiene-block">
        <strong>无学号重名风险（建议补充稳定学号以确保跨班追踪准确）</strong>
        <div class="hygiene-chips">${dups.slice(0, 12).map(d =>
          `<span class="hygiene-chip is-warn">${e(d.name)}（${e(d.classes.map(c => c + '班').join('、'))}）</span>`
        ).join('')}</div>
      </div>` : ''}
      ${!hasIssues ? '<p class="inline-help" style="margin:6px 0 0">与上一场考试名单高度一致，未发现错别字或重名风险。</p>' : ''}
    </div>`;
  }

  function collectTypoFixes(container, scopeKey = 'single') {
    if (!container) return [];
    const fixes = [];
    container.querySelectorAll(`input[data-typo-scope="${scopeKey}"]:checked`).forEach(box => {
      fixes.push({
        class: box.dataset.typoClass,
        incoming_name: box.dataset.typoFrom,
        suggested_name: box.dataset.typoTo,
      });
    });
    return fixes;
  }

  function multiDrawerHTML(state) {
    const file = state.multiFile;
    const inspected = state.multiInspect;
    const grade = state.multiGrade || state.importMeta?.grade || '初三';
    const defDate = state.multiDate || state.importMeta?.date || '';

    let resultHTML = '';
    if (inspected) {
      const scores = inspected.score_sheets || [];
      const teachers = inspected.teacher_sheets || [];
      const ignored = inspected.ignored_sheets || [];
      const newCount = scores.filter(s => s.status === 'new').length;
      const existCount = scores.filter(s => s.status === 'exists').length;

      resultHTML = `<section class="import-drawer-preview" id="multi-inspect-result">
        <div class="section-title">
          <div>
            <h3>识别到 ${scores.length} 张成绩页${teachers.length ? ` · ${teachers.length} 张教师表` : ''}</h3>
            <p>${e(inspected.filename)} · 新增 ${newCount} 场${existCount ? ` · 已存在 ${existCount} 场` : ''}${ignored.length ? ` · 自动跳过 ${ignored.length} 张说明/模板页` : ''}</p>
          </div>
          <span class="badge success">等待确认导入</span>
        </div>
        ${scores.length ? `<div class="multi-sheet-list">${scores.map((item, idx) => {
          const isNew = item.status === 'new';
          const checked = isNew;
          return `<div class="multi-sheet-card ${isNew ? '' : 'is-existing'}" data-multi-sheet="${idx}">
            <div class="multi-sheet-top">
              <label class="multi-sheet-check">
                <input type="checkbox" data-multi-pick="${idx}" ${checked ? 'checked' : ''}>
                <strong>${e(item.sheet)}</strong>
              </label>
              <span class="badge ${isNew ? 'success' : 'warning'}">${isNew ? '新增考试' : '档案已存在'}</span>
              ${!isNew ? `<select class="multi-mode-select" data-multi-mode="${idx}" aria-label="重复处理方式">
                <option value="overwrite">勾选则覆盖更新原档案</option>
                <option value="create">作为新考试另存一份</option>
              </select>` : ''}
              <span class="small-text">${n(item.row_count)} 人 · ${n(item.class_count)} 班 · ${item.subjects.length} 科</span>
            </div>
            <div class="multi-sheet-fields">
              <label class="field"><span>考试名称</span><input type="text" data-multi-name="${idx}" value="${e(item.exam_name)}"></label>
              <label class="field"><span>考试日期</span><input type="date" data-multi-date="${idx}" value="${e(item.exam_date || defDate)}"></label>
            </div>
            <p class="inline-help" style="margin:6px 0 0">识别学科：${e(item.subjects.join('、'))}</p>
            ${hygienePanelHTML(item.hygiene, `multi-${idx}`)}
          </div>`;
        }).join('')}</div>` : '<p class="muted">此工作簿中没有识别到成绩页。</p>'}
        ${teachers.length ? `<div class="multi-teacher-box">
          <h4>同步识别到任课教师表</h4>
          ${teachers.map((t, idx) => `<label class="rules-scope-check">
            <input type="checkbox" checked data-multi-teacher="${idx}">
            <span>同步导入「<b>${e(t.sheet)}</b>」（${n(t.row_count)} 条班级任课记录，${t.has_exam_name ? '按考试名称自动匹配各场考试' : '应用到本次导入的全部考试'}）</span>
          </label>`).join('')}
        </div>` : ''}
        ${ignored.length ? `<details class="drawer-password" style="margin-top:10px">
          <summary>已自动跳过 ${ignored.length} 张非原始成绩页（点击查看）</summary>
          <ul class="validation-list" style="margin-top:6px">${ignored.map(g => `<li><b>${e(g.sheet)}</b>：${e(g.reason)}</li>`).join('')}</ul>
        </details>` : ''}
        <div id="multi-commit-error" class="error" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn primary" data-action="multi-commit">确认批量导入已选项</button>
          <button type="button" class="btn secondary" data-action="close-drawer">取消</button>
        </div>
      </section>`;
    }

    return `<form id="multi-inspect-form" class="import-drawer-form">
      <div class="drawer-intro">
        <p>把同一届历次考试放在同一个 Excel 的不同工作表（Sheet）中，一次性扫描识别全部成绩页与「教师基本信息」页；已导入过的考试会自动标出，支持只增量追加新考试。</p>
      </div>
      <div class="form-grid two">
        <label class="field"><span>所属年级 / 届别</span><input id="multi-grade" name="grade" required value="${e(grade)}" placeholder="如：初2028届 或 初三"></label>
        <label class="field"><span>默认考试日期（工作表名无日期时使用）</span><input id="multi-date" name="default_date" type="date" required value="${e(defDate)}"></label>
      </div>
      <div class="drawer-upload" id="multi-dropzone">
        <div class="drawer-upload-symbol">${Z.icons('upload')}</div>
        <div>
          <strong id="multi-file-name">${e(file ? file.name : '尚未选择多考总表 Excel')}</strong>
          <p>${file ? '已选择工作簿，点击下方按钮扫描全部工作表。' : '支持 .xlsx / .xlsm 多工作表总表（自动忽略使用指南、打印模板等派生页）。'}</p>
        </div>
        <label class="btn secondary">选择总表<input id="multi-file-input" type="file" accept=".xlsx,.xlsm" hidden></label>
      </div>
      <details class="drawer-password"><summary>文件有密码？</summary><label class="field">读取密码<input id="multi-password" type="password" autocomplete="off" placeholder="仅用于本次读取"></label></details>
      <div class="form-actions">
        <button class="btn primary" type="submit" ${file ? '' : 'disabled'}>扫描全部工作表</button>
        <a class="btn quiet small" href="/api/templates/scores.xlsx" download>下载成绩模板</a>
        <a class="btn quiet small" href="/api/templates/teachers.xlsx" download>下载教师模板</a>
      </div>
      <div id="multi-inspect-error" class="error" hidden></div>
    </form>${resultHTML}`;
  }

  function bindMultiDrawer(state) {
    const dz = document.getElementById('multi-dropzone');
    const input = document.getElementById('multi-file-input');
    if (!dz || !input) return;
    const pick = file => {
      if (!file) return;
      state.multiFile = file;
      const nameEl = document.getElementById('multi-file-name');
      if (nameEl) nameEl.textContent = file.name;
      const p = dz.querySelector('p');
      if (p) p.textContent = '已选择工作簿，点击下方按钮扫描全部工作表。';
      const btn = document.getElementById('multi-inspect-form')?.querySelector('[type="submit"]');
      if (btn) btn.disabled = false;
    };
    input.addEventListener('change', () => pick(input.files?.[0]));
    dz.addEventListener('dragover', ev => { ev.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', ev => { ev.preventDefault(); dz.classList.remove('drag-over'); pick(ev.dataTransfer.files?.[0]); });
  }

  function readMultiCommitPayload(state) {
    const inspected = state.multiInspect;
    if (!inspected) throw new Error('请先扫描总表工作簿。');
    const root = document.getElementById('multi-inspect-result');
    const grade = (document.getElementById('multi-grade')?.value || state.multiGrade || '').trim();
    if (!grade) throw new Error('请填写所属年级 / 届别。');
    const exams = [];
    (inspected.score_sheets || []).forEach((item, idx) => {
      const picked = root?.querySelector(`[data-multi-pick="${idx}"]`)?.checked;
      if (!picked) return;
      const name = (root?.querySelector(`[data-multi-name="${idx}"]`)?.value || item.exam_name || '').trim();
      const date = (root?.querySelector(`[data-multi-date="${idx}"]`)?.value || item.exam_date || '').trim();
      const mode = root?.querySelector(`[data-multi-mode="${idx}"]`)?.value || (item.status === 'exists' ? 'overwrite' : 'create');
      const fixes = collectTypoFixes(root, `multi-${idx}`);
      exams.push({
        dataset: item.dataset,
        name,
        date,
        mode,
        existing_id: item.existing_id || '',
        name_fixes: fixes,
      });
    });
    const teacher_sheets = [];
    (inspected.teacher_sheets || []).forEach((t, idx) => {
      if (root?.querySelector(`[data-multi-teacher="${idx}"]`)?.checked) {
        teacher_sheets.push({ sheet: t.sheet, parsed: t.parsed });
      }
    });
    if (!exams.length && !teacher_sheets.length) {
      throw new Error('请至少勾选一场考试或一张任课教师表。');
    }
    return { grade, exams, teacher_sheets };
  }

  window.LeaderMulti = {
    hygienePanelHTML,
    collectTypoFixes,
    multiDrawerHTML,
    bindMultiDrawer,
    readMultiCommitPayload,
  };
})();

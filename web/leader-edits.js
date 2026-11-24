'use strict';
/* 融侨学迹 · 成绩更正（点格编辑、暂存条、影响预览、更正记录与撤销、批量导入、发布锁定、过时导出提示） */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 1) => Z.num(v, d);
  const EXPORT_VER_KEY = 'zhixu-export-versions-v1';

  function loadExportVersions() {
    try {
      return JSON.parse(localStorage.getItem(EXPORT_VER_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function recordExportVersion(examId, version) {
    if (!examId || !version) return;
    const map = loadExportVersions();
    map[examId] = Number(version);
    try {
      localStorage.setItem(EXPORT_VER_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function staleExportNoticeHTML(examId, currentVersion) {
    if (!examId) return '';
    const map = loadExportVersions();
    const lastVer = Number(map[examId] || 0);
    const curVer = Number(currentVersion || 1);
    if (!lastVer || curVer <= lastVer) return '';
    return `<div class="stale-export-banner" role="status">上次导出的材料基于 <strong>v${lastVer}</strong>，当前数据版本已更新至 <strong>v${curVer}</strong>，建议重新导出或打印最新材料。</div>`;
  }

  function fmtVal(v) {
    if (v === null || v === undefined || v === '') return '缺考';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
    return String(v);
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
    } catch (_) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  function scoreCellHTML(stu, subject, analysis, stagedMap) {
    const key = `${stu.id}||${subject}`;
    const staged = stagedMap?.[key];
    const activeEdit = analysis?.active_edits?.[key];
    const published = Boolean(analysis?.metadata?.published_at);
    const displayVal = staged ? staged.value : stu.scores?.[subject];
    const cls = ['score-cell', 'number'];
    if (staged) cls.push('is-staged');
    else if (activeEdit) cls.push('is-edited');
    if (published) cls.push('is-locked');
    else cls.push('is-editable');

    let tip = published
      ? '本场已发布，如需更正请先在「更正记录」中解锁'
      : '点击修改该科成绩（可改分数或设为缺考）';
    if (staged) {
      tip = `已暂存修改：${fmtVal(stu.scores?.[subject])} → ${fmtVal(staged.value)}（点击可再调整）`;
    } else if (activeEdit) {
      tip = `原 ${fmtVal(activeEdit.old_value)} · ${fmtTime(activeEdit.created_at)} · ${activeEdit.reason}`;
    }

    return `<td class="${cls.join(' ')}" data-edit-cell="1" data-row-id="${e(stu.id)}" data-student-name="${e(stu.name)}" data-student-class="${e(stu.class)}" data-subject="${e(subject)}" title="${e(tip)}" tabindex="${published ? '-1' : '0'}">${e(displayVal == null ? '—' : fmtVal(displayVal))}</td>`;
  }

  function stagingBarHTML(stagedMap) {
    const items = Object.values(stagedMap || {});
    if (!items.length) return '';
    return `<div id="score-edit-staging-bar" class="score-staging-bar" role="region" aria-label="暂存成绩修改">
      <span>已暂存 <strong>${items.length}</strong> 处成绩修改</span>
      <div class="score-staging-actions">
        <button type="button" class="btn primary small" data-action="score-edit-preview">预览影响</button>
        <button type="button" class="btn secondary small" data-action="score-edit-discard">放弃</button>
      </div>
    </div>`;
  }

  function formatStudentDiffLines(stu) {
    const d = stu.diff || {};
    const scoreLines = Object.entries(d)
      .filter(([k]) => k.startsWith('scores.'))
      .map(([k, [o, nv]]) => `${k.slice(7)} ${fmtVal(o)} → <b>${fmtVal(nv)}</b>`);
    const parts = [];
    if (d.total) parts.push(`总分 ${fmtVal(d.total[0])} → <b>${fmtVal(d.total[1])}</b>`);
    if (d.rank) parts.push(`年级名次 ${d.rank[0] ?? '无'} → <b>${d.rank[1] ?? '无'}</b>`);
    if (d.class_rank) parts.push(`班级名次 ${d.class_rank[0] ?? '无'} → <b>${d.class_rank[1] ?? '无'}</b>`);
    if (d['grades.总分']) parts.push(`总分等级 ${d['grades.总分'][0] || '—'} → <b>${d['grades.总分'][1] || '—'}</b>`);
    if (d['levels.总分']) parts.push(`总分六级 ${d['levels.总分'][0] || '—'} → <b>${d['levels.总分'][1] || '—'}</b>`);
    Object.entries(d).forEach(([k, [o, nv]]) => {
      if (k.startsWith('grades.') && k !== 'grades.总分') parts.push(`${k.slice(7)}等级 ${o || '—'} → <b>${nv || '—'}</b>`);
      if (k.startsWith('levels.') && k !== 'levels.总分') parts.push(`${k.slice(7)}六级 ${o || '—'} → <b>${nv || '—'}</b>`);
    });
    return { scoreLines, parts };
  }

  function previewDrawerHTML(preview, opts = {}) {
    const mode = opts.mode || 'save'; // 'save' | 'import' | 'revoke'
    const sum = preview.summary || {};
    const students = preview.students || [];
    const editedStudents = students.filter(s => s.edited);
    const otherStudents = students.filter(s => !s.edited);
    const gradeMovedOthers = otherStudents.filter(s => Object.keys(s.diff || {}).some(k => k.startsWith('grades.') || k.startsWith('levels.')));
    const rankOnlyOthers = otherStudents.filter(s => !gradeMovedOthers.includes(s));

    const cutoffChangedEntries = Object.entries(preview.cutoffs || {}).filter(([, pair]) => pair && pair[0] !== pair[1]);
    const cutoffAlertHTML = cutoffChangedEntries.length
      ? `<div class="preview-cutoff-alert">
          <strong>有效分线发生变化（共 ${cutoffChangedEntries.length} 项）</strong>
          <ul>${cutoffChangedEntries.map(([k, [o, nv]]) => `<li>${e(k)}有效分线：${fmtVal(o)} → <b>${fmtVal(nv)}</b>（将影响达标人数）</li>`).join('')}</ul>
        </div>`
      : `<p class="small-text" style="margin:8px 0">有效分分界线：<strong>不变</strong>（总分线 ${fmtVal(preview.cutoffs?.['总分']?.[0])}）</p>`;

    const editedHTML = editedStudents.length
      ? editedStudents.map(s => {
          const { scoreLines, parts } = formatStudentDiffLines(s);
          return `<div class="preview-stu-card">
            <div class="preview-stu-head"><strong>${e(s.name)}（${e(s.class)}班）</strong><span>${scoreLines.join('；') || '分值未变化'}</span></div>
            <p>${parts.join('，') || '总分、名次与等级均无变化'}</p>
          </div>`;
        }).join('')
      : '<p class="muted">没有产生分值变化的学生记录。</p>';

    const gradeMovedHTML = gradeMovedOthers.length
      ? `<div class="preview-other-block"><strong>等级发生变化的同学（${gradeMovedOthers.length} 人）</strong><ul>${gradeMovedOthers.slice(0, 20).map(s => {
          const { parts } = formatStudentDiffLines(s);
          return `<li><b>${e(s.name)}（${e(s.class)}班）</b>：${parts.join('，')}</li>`;
        }).join('')}</ul></div>`
      : '';

    const rankOnlyHTML = rankOnlyOthers.length
      ? `<details class="preview-rank-fold"><summary>另有 <strong>${rankOnlyOthers.length}</strong> 名同学仅名次顺移（点击展开查看）</summary><ul>${rankOnlyOthers.slice(0, 60).map(s => `<li>${e(s.name)}（${e(s.class)}班）：年级名次 ${s.diff?.rank?.[0] ?? '—'} → ${s.diff?.rank?.[1] ?? '—'}</li>`).join('')}${rankOnlyOthers.length > 60 ? `<li class="muted">…其余 ${rankOnlyOthers.length - 60} 人略</li>` : ''}</ul></details>`
      : '';

    const classesHTML = (preview.classes || []).length
      ? `<div class="preview-classes-box"><strong>班级统计变化</strong><ul>${preview.classes.map(c => {
          const items = Object.entries(c.diff || {}).map(([k, [o, nv]]) => {
            const label = k === 'elite_count' ? '总分达标人数' : k === 'participants' ? '有效人数' : k === 'mean' ? '总分均分' : k.replace('.achievers', '达标').replace('.concentrated', '集中');
            return `${label} ${fmtVal(o)} → <b>${fmtVal(nv)}</b>`;
          });
          return `<li><b>${e(c.class)}班</b>：${items.join('，')}</li>`;
        }).join('')}</ul></div>`
      : '';

    const warningsHTML = (preview.warnings || []).length
      ? `<div class="support-note">${preview.warnings.map(w => e(w)).join('<br>')}</div>`
      : '';

    const unmatched = opts.unmatched || [];
    const unmatchedHTML = unmatched.length
      ? `<div class="import-validation"><strong>以下 ${unmatched.length} 行未能匹配或校验未通过（已自动跳过）：</strong><ul class="validation-list">${unmatched.map(u => `<li>第 ${u.row} 行：${e(u.reason)}</li>`).join('')}</ul></div>`
      : '';

    if (mode === 'revoke') {
      const rev = opts.revokeEdit || {};
      return `<div class="score-preview-wrap">
        <div class="drawer-intro"><p>即将撤销 <strong>${e(rev.name)}（${e(rev.class)}班）${e(rev.subject)}</strong> 的更正记录（${fmtVal(rev.old_value)} → ${fmtVal(rev.new_value)}），撤销后所有排名与统计将立即重新计算。</p></div>
        ${editedHTML}${cutoffAlertHTML}${gradeMovedHTML}${rankOnlyHTML}${classesHTML}${warningsHTML}
        <div id="score-edit-error" class="error" hidden></div>
        <div class="form-actions" style="margin-top:14px">
          <button type="button" class="btn primary" data-action="score-edit-confirm-revoke" data-edit-id="${e(rev.id)}">确认撤销并重新计算</button>
          <button type="button" class="btn secondary" data-action="open-score-edits">返回修改记录</button>
        </div>
      </div>`;
    }

    const defaultReason = opts.defaultReason || '';
    const hasChanges = (sum.edited_cells || 0) > 0;
    const quickReasons = ['复核更正', '录入错误', '补录缺考', '其他'];

    return `<div class="score-preview-wrap">
      <div class="anchor-spotlight preview-anchor-strip">
        <div><small>待修改格数</small><strong>${n(sum.edited_cells || 0, 0)}</strong></div>
        <div><small>名次变动人数</small><strong>${n(sum.students_rank_changed || 0, 0)}</strong></div>
        <div><small>等级变动人数</small><strong>${n(sum.students_grade_changed || 0, 0)}</strong></div>
        <div><small>分数线变动项</small><strong>${n(sum.cutoffs_changed || 0, 0)}</strong></div>
      </div>
      ${unmatchedHTML}
      <h3>被修改学生变化</h3>
      ${editedHTML}
      ${cutoffAlertHTML}
      ${gradeMovedHTML}
      ${rankOnlyHTML}
      ${classesHTML}
      ${warningsHTML}
      <form id="score-edit-confirm-form" class="score-reason-form" data-mode="${e(mode)}">
        <label class="field">
          <span>修改原因（必填，1–200 字）</span>
          <div class="score-reason-chips">${quickReasons.map(r => `<button type="button" class="scale-pill" data-action="score-reason-chip" data-reason="${e(r)}">${e(r)}</button>`).join('')}</div>
          <input id="score-edit-reason" name="reason" type="text" maxlength="200" required value="${e(defaultReason)}" placeholder="如：学生申请查分复核，数学第 18 题漏加 6 分">
        </label>
        <div id="score-edit-error" class="error" hidden></div>
        <div class="form-actions">
          <button id="score-edit-confirm-btn" type="submit" class="btn primary"${(!defaultReason.trim() || !hasChanges) ? ' disabled' : ''}>确认修改并重新计算</button>
          <button type="button" class="btn secondary" data-action="close-drawer">取消</button>
        </div>
      </form>
    </div>`;
  }

  function editsHistoryDrawerHTML(data, examMeta) {
    const edits = data?.edits || [];
    const ver = data?.data_version || 1;
    const cnt = data?.edit_count || 0;
    const published = Boolean(data?.published_at);

    const lockBar = published
      ? `<div class="publish-lock-bar is-locked">
          <div><strong>已发布锁定</strong><small>发布于 ${e(fmtTime(data.published_at))} · 当前禁止直接改分，如需更正请先解锁并填写原因</small></div>
          <button type="button" class="btn secondary small" data-action="score-exam-unlock">解锁修改</button>
        </div>`
      : `<div class="publish-lock-bar">
          <div><strong>数据版本 v${ver}</strong><small>${cnt ? `当前生效更正 ${cnt} 处（原始导入表完好保留）` : '当前为原始导入数据，暂无更正记录'}</small></div>
          <button type="button" class="btn secondary small" data-action="score-exam-publish">发布锁定</button>
        </div>`;

    const rowsHTML = edits.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>时间</th><th>学生</th><th>科目</th><th>变更</th><th>原因</th><th>状态 / 操作</th></tr></thead>
          <tbody>${edits.map(item => {
            const isUnlock = item.subject === '__unlock__';
            const isRevoked = Boolean(item.revoked_at);
            return `<tr class="${isRevoked ? 'is-revoked-row' : ''}">
              <td class="small-text">${e(fmtTime(item.created_at))}</td>
              <td>${isUnlock ? '<span class="badge warning">整场解锁</span>' : `<strong>${e(item.name)}</strong> <small class="muted">${e(item.class)}班</small>`}</td>
              <td>${isUnlock ? '—' : e(item.subject)}</td>
              <td class="number">${isUnlock ? '已解除发布锁' : `${e(fmtVal(item.old_value))} → <b>${e(fmtVal(item.new_value))}</b>`}</td>
              <td class="small-text">${e(item.reason)}</td>
              <td>${isUnlock ? '<span class="muted">审计记录</span>' : isRevoked ? `<span class="muted">已撤销<br><small>${e(fmtTime(item.revoked_at))}</small></span>` : (published ? '<span class="muted">已锁定</span>' : `<button type="button" class="text-button danger" data-action="score-edit-revoke-preview" data-edit-id="${e(item.id)}">撤销</button>`)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`
      : '<p class="muted" style="padding:14px 0">本场考试暂无成绩更正记录。在「班级与学科 → 学生明细」或学生详情抽屉中点击任意分数格即可修改，也可点击上方「导入更正表」批量更正。</p>';

    return `
      ${lockBar}
      <div class="drawer-actions" style="margin-top:12px">
        ${published ? '' : '<button type="button" class="btn primary small" data-action="score-edit-choose-import">导入更正表…</button>'}
        <a class="btn secondary small" href="/api/templates/score-edits.xlsx" download>下载更正模板</a>
        <input id="score-edits-import-file" type="file" accept=".xlsx,.xlsm,.csv" hidden>
      </div>
      <div id="score-edits-drawer-error" class="error" hidden></div>
      <h3>更正与审计记录（共 ${edits.length} 条）</h3>
      ${rowsHTML}
    `;
  }

  window.LeaderEdits = {
    recordExportVersion,
    staleExportNoticeHTML,
    scoreCellHTML,
    stagingBarHTML,
    previewDrawerHTML,
    editsHistoryDrawerHTML,
    fmtVal,
  };
})();

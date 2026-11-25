'use strict';
/* 融侨学迹 · 可选小题分 / 板块得分率与试卷讲评优先级分析模块 */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 1) => Z.num(v, d);
  const pct = v => (v === null || v === undefined ? '—' : `${n(v, 1)}%`);
  const option = (val, label, chosen) => `<option value="${e(val)}"${String(val) === String(chosen) ? ' selected' : ''}>${e(label)}</option>`;

  function lectureTableObj(ana) {
    const rows = (ana?.lecture_queue || []).map((it, idx) => [
      idx + 1,
      it.item,
      it.full_mark != null ? it.full_mark : '未设',
      it.count,
      it.mean,
      it.score_rate != null ? `${n(it.score_rate, 1)}%` : '—',
      it.discrimination != null ? n(it.discrimination, 2) : '—',
      it.total_loss != null ? n(it.total_loss, 1) : '—',
      it.priority_label,
    ]);
    return {
      title: `${ana?.subject || '学科'} · ${ana?.class ? ana.class + '班' : '全年级'} 小题讲评优先级清单`,
      columns: ['讲评序', '题号 / 板块', '满分', '实考', '均分', '得分率(难度)', '区分度(D)', '累计失分', '讲评建议'],
      rows,
      note: `来源：${ana?.filename || '—'} · 区分度 D = 高分组(前27%)得分率 − 低分组(后27%)得分率；未设满分题不猜测满分。`,
    };
  }

  function renderItemsTabHTML(analysis, itemsPayload, state) {
    const subjects = analysis?.subjects || [];
    const savedSubs = itemsPayload?.subjects || [];
    const active = itemsPayload?.analysis || null;
    const chosenSub = state.itemUploadSubject || active?.subject || subjects[0] || '';
    const activeCls = state.itemClass || '';

    const uploadBar = `<section class="brief-block" style="border-top:0;padding-top:4px">
      <div class="brief-block-head">
        <div>
          <h3>小题分 / 板块得分率讲评分析（可选扩展）</h3>
          <p>上传单科小题分或大题板块表（如五岳/智学网导出或标准模板），自动计算难度、区分度与讲评优先级清单；未设满分不猜测</p>
        </div>
        <div class="toolbar-inline">
          <a class="btn quiet small" href="/api/templates/item-scores.xlsx" download>下载小题分模板</a>
        </div>
      </div>
      <div class="item-upload-bar">
        <label class="small-text">所属学科
          <select id="item-upload-subject" aria-label="选择小题分所属学科">
            ${subjects.map(s => option(s, s, chosenSub)).join('')}
          </select>
        </label>
        <label class="btn secondary small">选择小题分 .xlsx / .csv
          <input id="item-upload-file" type="file" accept=".xlsx,.xlsm,.csv" hidden>
        </label>
        <span class="small-text muted">列名建议带满分如「第1题(4分)」「选择题(30分)」，或表头下附「满分」行</span>
      </div>
      <div id="item-analysis-error" class="error" hidden></div>
    </section>`;

    if (!savedSubs.length || !active) {
      return `${uploadBar}<div class="support-note" style="margin-top:12px">本场考试尚未挂载任何学科的小题分或板块分表。如需生成试卷讲评优先级清单，请先选择学科并上传对应小题分文件（不影响常规总分与单科分析）。</div>`;
    }

    const sum = active.summary || {};
    const dotCls = tone => (tone === 'alert' ? 'is-danger' : tone === 'warn' ? 'is-warn' : tone === 'good' ? 'is-good' : 'is-flat');
    const queue = active.lecture_queue || [];
    const rowsHTML = queue.map((it, idx) => `<tr>
      <td class="number">${idx + 1}</td>
      <td><strong>${e(it.item)}</strong></td>
      <td class="number">${it.full_mark != null ? n(it.full_mark, 1) : '<span class="muted">未设</span>'}</td>
      <td class="number">${n(it.count, 0)}</td>
      <td class="number">${n(it.mean, 2)}</td>
      <td class="number ${it.score_rate != null && it.score_rate < 50 ? 'delta-negative' : ''}">${pct(it.score_rate)}</td>
      <td class="number">${it.discrimination != null ? n(it.discrimination, 2) : '<span class="muted">—</span>'}</td>
      <td class="number">${it.total_loss != null ? n(it.total_loss, 1) : '<span class="muted">—</span>'}</td>
      <td><span class="sig-label"><i class="sig-dot ${dotCls(it.priority_tone)}"></i>${e(it.priority_label)}</span></td>
    </tr>`).join('');

    return `${uploadBar}
      <div class="tab-strip compact-tabs" style="margin-top:10px">
        ${savedSubs.map(item => `<button type="button" data-action="item-select-subject" data-subject="${e(item.subject)}" class="${item.subject === active.subject ? 'active' : ''}">${e(item.subject)}</button>`).join('')}
      </div>
      <div class="toolbar" style="margin-bottom:12px">
        <label>查看范围
          <select id="item-class-select" aria-label="按班级筛选小题分">
            ${option('', `全年级（${sum.student_count || 0}人）`, activeCls)}
            ${(active.classes || []).map(c => option(c, `${c}班`, activeCls)).join('')}
          </select>
        </label>
        <span class="small-text muted">文件：${e(active.filename || '—')}</span>
        <div class="spacer"></div>
        <button type="button" class="btn secondary small" data-action="copy-item-queue">复制讲评单</button>
        <button type="button" class="btn secondary small" data-action="csv-item-queue">CSV</button>
        <button type="button" class="btn primary small" data-action="print-item-queue">打印讲评单</button>
        <button type="button" class="btn quiet small danger" data-action="delete-item-analysis" data-subject="${e(active.subject)}">移除该科</button>
      </div>
      <div class="brief-kpi-strip" style="margin-bottom:14px">
        <div class="bk-cell"><span class="bk-label">有效作答人数</span><strong class="bk-val">${n(sum.student_count, 0)}<small>人</small></strong><span class="bk-sub">${sum.has_discrimination ? '已按高低27%计算区分度' : '不足6人不计算区分度'}</span></div>
        <div class="bk-cell"><span class="bk-label">识别题项 / 板块</span><strong class="bk-val">${n(sum.item_count, 0)}<small>项</small></strong><span class="bk-sub">已设满分 ${n(sum.full_mark_known_count, 0)} / ${n(sum.item_count, 0)} 项</span></div>
        <div class="bk-cell"><span class="bk-label">平均得分率（难度）</span><strong class="bk-val">${pct(sum.avg_score_rate)}</strong><span class="bk-sub">仅统计已明确满分的题项</span></div>
        <div class="bk-cell"><span class="bk-label">建议优先讲评</span><strong class="bk-val">${n(sum.must_teach_count, 0)}<small>题必讲</small></strong><span class="bk-sub">另 ${n(sum.focus_count, 0)} 题建议重点辨析</span></div>
      </div>
      ${sum.small_sample ? '<div class="support-note" style="margin-bottom:10px">当前筛选范围有效样本不足 3 人，仅展示均分与累计失分，不输出群体讲评定性。</div>' : ''}
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="number">序</th><th>题号 / 板块</th><th class="number">满分</th><th class="number">实考</th>
            <th class="number">均分</th><th class="number">得分率(难度)</th><th class="number" title="高分组(前27%)得分率 − 低分组(后27%)得分率，≥0.30代表区分度良好">区分度 D</th>
            <th class="number">累计失分</th><th>讲评建议</th>
          </tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
      <p class="table-note">默认按「必讲共性失分 → 累计失分由高到低」排序，方便任课老师考后 1 分钟排定讲评课重点。</p>`;
  }

  window.LeaderItems = {
    lectureTableObj,
    renderItemsTabHTML,
  };
})();

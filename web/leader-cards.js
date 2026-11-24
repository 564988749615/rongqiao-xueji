'use strict';
/* 融侨学迹 · 学生个人学业诊断成长卡（零他人隐私，A4 一页两生 / 一页一生出版级套打） */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 1) => Z.num(v, d);

  function radarSVG(subjects) {
    const valid = (subjects || []).filter(s => s.pr !== null && s.pr !== undefined);
    if (valid.length < 3) {
      return '<div class="sc-chart-empty">有效学科不足 3 科，暂不绘制雷达图</div>';
    }
    const size = 196, cx = size / 2, cy = size / 2, rMax = 66;
    const count = valid.length;
    const polar = (idx, ratio) => {
      const ang = -Math.PI / 2 + (idx * 2 * Math.PI) / count;
      return [cx + Math.cos(ang) * rMax * ratio, cy + Math.sin(ang) * rMax * ratio];
    };
    const rings = [0.25, 0.5, 0.75, 1].map(ratio => {
      const pts = valid.map((_, i) => polar(i, ratio).map(v => v.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="#d8d1e6" stroke-width="${ratio === 1 ? 1.1 : 0.75}" stroke-dasharray="${ratio === 0.5 ? '3 2' : 'none'}"/>`;
    }).join('');
    const spokes = valid.map((s, i) => {
      const [x2, y2] = polar(i, 1);
      const [lx, ly] = polar(i, 1.24);
      const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
      return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e3ddef" stroke-width="0.8"/>`
        + `<text x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="${anchor}" font-size="9.5" fill="#3b3250" font-weight="600">${e(s.subject)}</text>`;
    }).join('');
    const dataPts = valid.map((s, i) => polar(i, Math.max(0.08, Math.min(1, Number(s.pr) / 100))));
    const poly = `<polygon points="${dataPts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="rgba(111,78,184,0.20)" stroke="#6f4eb8" stroke-width="1.8"/>`;
    const dots = dataPts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#6f4eb8"/>`).join('');
    return `<svg class="sc-radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="学科均衡雷达图">${rings}${spokes}${poly}${dots}</svg>`;
  }

  function historySparkSVG(history) {
    const valid = (history || []).filter(h => h.pr !== null && h.pr !== undefined);
    if (valid.length < 2) {
      return '<div class="sc-chart-empty">导入同年级多场考试后，此处自动绘制个人成长曲线</div>';
    }
    const w = 228, h = 112, pl = 28, pr = 16, top = 20, bot = 84;
    const vals = valid.map(x => Number(x.pr));
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 10) / 10) * 10);
    const hi = Math.min(100, Math.ceil((Math.max(...vals) + 10) / 10) * 10);
    const span = Math.max(hi - lo, 20);
    const xFor = i => pl + (i * (w - pl - pr)) / (valid.length - 1);
    const yFor = v => bot - ((v - lo) / span) * (bot - top);
    const pts = valid.map((item, i) => [xFor(i), yFor(Number(item.pr))]);
    const ticks = [lo, Math.round((lo + hi) / 2), hi].map(v => {
      const y = yFor(v);
      return `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${w - pr}" y2="${y.toFixed(1)}" stroke="#e6e1f0" stroke-width="0.8"/>`
        + `<text x="${pl - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#776d8c">${v}</text>`;
    }).join('');
    const labels = pts.map(([x, y], i) => (
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#fff" stroke="#6f4eb8" stroke-width="1.8"/>`
      + `<text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#4f358c" font-weight="650">${n(vals[i], 0)}</text>`
      + `<text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="8" fill="#6f6680">${e((valid[i].date || valid[i].exam_name || '').slice(-5))}</text>`
    )).join('');
    return `<svg class="sc-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="个人年级百分位成长走势">${ticks}<polyline fill="none" stroke="#6f4eb8" stroke-width="2" points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>${labels}</svg>`;
  }

  function singleCardHTML(card, meta, { hideRank = true, compact = true } = {}) {
    const subRows = (card.subjects || []).map(s => {
      const prVal = s.pr != null ? Math.max(0, Math.min(100, Number(s.pr))) : null;
      const diffTxt = s.mean_diff == null ? '—' : `${s.mean_diff >= 0 ? '+' : ''}${n(s.mean_diff, 1)}`;
      const diffCls = s.mean_diff == null ? '' : s.mean_diff >= 0 ? 'pos' : 'neg';
      return `<tr>
        <td class="sub-name">${e(s.subject)}</td>
        <td class="num"><b>${s.score == null ? '缺' : n(s.score, 1)}</b>${s.full_mark ? `<small>/${n(s.full_mark, 0)}</small>` : ''}</td>
        <td class="center"><span class="lvl-pill">${e(s.level !== '—' ? s.level : s.grade)}</span></td>
        <td class="pr-cell">${prVal == null ? '—' : `<span class="pr-bar"><i style="width:${prVal}%"></i></span><span class="pr-num">${n(prVal, 0)}%</span>`}</td>
        <td class="num ${diffCls}">${diffTxt}</td>
      </tr>`;
    }).join('');

    const adv = card.advice || {};
    return `<article class="student-card ${compact ? 'is-compact' : 'is-full'}">
      <header class="sc-header">
        <div>
          <div class="sc-school">融侨学迹 · 学生个人学业诊断成长卡</div>
          <h2>${e(card.name)} <span class="sc-cls">${e(meta.grade)} ${e(card.class)}班</span></h2>
        </div>
        <div class="sc-exam-meta">
          <strong>${e(meta.exam_name)}</strong>
          <span>${e(meta.date)} · 仅含本人成绩（隐私保护版）</span>
        </div>
      </header>
      <div class="sc-kpis">
        <div class="sc-kpi">
          <small>总分</small>
          <strong>${card.total == null ? '—' : n(card.total, 1)}${card.full_total ? `<em>/${n(card.full_total, 0)}</em>` : '<em>分</em>'}</strong>
        </div>
        <div class="sc-kpi">
          <small>学业等级</small>
          <strong>${e(card.total_level !== '—' ? card.total_level : card.total_grade)}</strong>
        </div>
        <div class="sc-kpi accent">
          <small>年级百分位（PR）</small>
          <strong>${card.pr == null ? '—' : `超越 ${n(card.pr, 1)}%`}</strong>
        </div>
        <div class="sc-kpi">
          <small>${hideRank ? '标准分（T分）' : '年级参考位次'}</small>
          <strong>${hideRank ? (card.t_score == null ? '—' : n(card.t_score, 1)) : (card.rank == null ? '—' : `${n(card.rank, 0)} / ${n(card.participants, 0)}`)}</strong>
        </div>
      </div>
      <div class="sc-body">
        <div class="sc-table-col">
          <table>
            <thead><tr><th>学科</th><th class="num">得分</th><th class="center">等级</th><th>学科年级百分位</th><th class="num">较均分</th></tr></thead>
            <tbody>${subRows}</tbody>
          </table>
        </div>
        <div class="sc-visual-col">
          <div class="sc-chart-box">
            <div class="sc-chart-title">学科均衡雷达图<span>按学科年级百分位绘制，越向外越强</span></div>
            ${radarSVG(card.subjects)}
          </div>
          ${!compact || (card.history || []).length >= 2 ? `<div class="sc-chart-box">
            <div class="sc-chart-title">历次成长曲线<span>年级百分位（已消除试卷难易波动）</span></div>
            ${historySparkSVG(card.history)}
          </div>` : ''}
        </div>
      </div>
      <div class="sc-advice">
        <p><b>优势肯定：</b>${e(adv.strength_text || '')}</p>
        <p><b>提分抓手：</b>${e(adv.focus_text || '')}${adv.trend_text ? ` ${e(adv.trend_text)}` : ''}</p>
      </div>
      <footer class="sc-sign">
        <span>学生反思 / 近期目标：</span>
        <span class="sc-sign-right">家长签字：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u> &nbsp;日期：<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
      </footer>
    </article>`;
  }

  function printStudentCards(payload, { layout = 'two-up', hideRank = true } = {}) {
    const cards = payload?.cards || [];
    const meta = payload?.meta || {};
    if (!cards.length) {
      Z.notice('没有可打印的学生诊断卡。', true);
      return;
    }
    const compact = layout === 'two-up';
    const pages = [];
    const perPage = compact ? 2 : 1;
    for (let i = 0; i < cards.length; i += perPage) {
      const slice = cards.slice(i, i + perPage);
      pages.push(`<section class="a4-sheet ${compact ? 'sheet-two' : 'sheet-one'}">${slice.map(c => singleCardHTML(c, meta, { hideRank, compact })).join(compact && slice.length === 2 ? '<div class="cut-line"><span>沿此虚线裁切</span></div>' : '')}</section>`);
    }

    const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${e(meta.grade)} ${e(meta.class ? meta.class + '班' : '')} · 学生个人学业诊断卡（${e(meta.exam_name)}）</title>
<style>
  @page { size: A4 portrait; margin: 9mm 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif; color: #221c2e; background: #edeaf4; font-size: 11px; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; background: #261e38; color: #fff; font-size: 13px; }
  .print-bar button { background: #6f4eb8; color: #fff; border: 0; border-radius: 6px; padding: 7px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .print-bar button:hover { background: #5c3da0; }
  .print-canvas { padding: 16px 0 32px; display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .a4-sheet { width: 210mm; min-height: 297mm; background: #fff; padding: 8mm 10mm; box-shadow: 0 8px 28px rgba(34,24,60,.16); display: flex; flex-direction: column; justify-content: space-between; }
  .student-card { border: 1.2px solid #cfc5e2; border-radius: 8px; padding: 9px 12px; display: flex; flex-direction: column; gap: 6px; break-inside: avoid; }
  .student-card.is-compact { height: 133mm; padding: 8px 11px; gap: 5px; overflow: hidden; }
  .student-card.is-full { min-height: 274mm; padding: 16px 18px; gap: 12px; font-size: 12px; }
  .cut-line { border-top: 1px dashed #b9aecb; text-align: center; position: relative; margin: 1.5mm 0; height: 0; }
  .cut-line span { position: relative; top: -7px; background: #fff; padding: 0 8px; font-size: 9.5px; color: #8c819e; }
  .sc-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.8px solid #6f4eb8; padding-bottom: 4px; }
  .sc-school { font-size: 9.5px; color: #6f4eb8; font-weight: 650; letter-spacing: 0.04em; }
  .sc-header h2 { margin: 1px 0 0; font-size: 15.5px; color: #1e182a; }
  .sc-cls { font-size: 11px; font-weight: 500; color: #5b5170; margin-left: 6px; }
  .sc-exam-meta { text-align: right; }
  .sc-exam-meta strong { display: block; font-size: 11.5px; color: #2b233a; }
  .sc-exam-meta span { font-size: 9px; color: #716784; }
  .sc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .sc-kpi { border: 1px solid #dfd8ed; border-radius: 6px; padding: 4px 8px; background: #faf8fd; }
  .sc-kpi.accent { background: #f2ecfa; border-color: #c5b4e3; }
  .sc-kpi small { display: block; font-size: 9px; color: #6a607c; }
  .sc-kpi strong { display: block; font-size: 13.5px; color: #2a213d; font-variant-numeric: tabular-nums; margin-top: 1px; }
  .sc-kpi strong em { font-style: normal; font-size: 9.5px; font-weight: 500; color: #6f6482; margin-left: 2px; }
  .sc-body { display: grid; grid-template-columns: 1.32fr 0.92fr; gap: 9px; align-items: start; flex: 1; min-height: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .is-full table { font-size: 11.5px; }
  th, td { border: 1px solid #dfd9eb; padding: 3px 5.5px; text-align: left; }
  .is-full th, .is-full td { padding: 6px 8px; }
  th { background: #f3eefb; color: #3c2b63; font-weight: 650; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .center { text-align: center; }
  .sub-name { font-weight: 600; color: #2a223b; }
  td small { color: #7c7290; font-weight: 400; font-size: 9px; }
  .lvl-pill { display: inline-block; padding: 0 5px; border-radius: 3px; background: #f0eaf9; color: #4f358c; font-weight: 650; font-size: 9.5px; }
  .pr-cell { white-space: nowrap; width: 88px; }
  .pr-bar { display: inline-block; width: 44px; height: 5.5px; background: #ebe6f4; border-radius: 3px; vertical-align: middle; overflow: hidden; margin-right: 4px; }
  .pr-bar i { display: block; height: 100%; background: #6f4eb8; }
  .pr-num { font-size: 9px; color: #544969; font-variant-numeric: tabular-nums; }
  .pos { color: #24684c; font-weight: 600; }
  .neg { color: #a83c3c; font-weight: 600; }
  .sc-visual-col { display: flex; flex-direction: column; gap: 5px; }
  .sc-chart-box { border: 1px solid #e4def0; border-radius: 6px; padding: 4px 6px; background: #fcfbfe; text-align: center; }
  .sc-chart-title { display: flex; justify-content: space-between; align-items: baseline; font-size: 9.5px; font-weight: 650; color: #3f2f63; margin-bottom: 1px; text-align: left; }
  .sc-chart-title span { font-size: 8px; font-weight: 400; color: #7e7491; }
  .sc-radar { width: 100%; max-width: 122px; height: auto; display: block; margin: 0 auto; }
  .is-full .sc-radar { max-width: 220px; }
  .sc-spark { width: 100%; max-width: 184px; max-height: 76px; height: auto; display: block; margin: 0 auto; }
  .is-full .sc-spark { max-width: 240px; max-height: 120px; }
  .sc-chart-empty { padding: 12px 6px; color: #847a96; font-size: 9px; }
  .sc-advice { border-left: 3px solid #6f4eb8; background: #faf8fd; border-radius: 0 5px 5px 0; padding: 4.5px 8px; font-size: 9.8px; line-height: 1.38; }
  .is-full .sc-advice { padding: 10px 12px; font-size: 11.5px; line-height: 1.5; }
  .sc-advice p { margin: 1.5px 0; }
  .sc-sign { display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px dashed #d1c8e2; padding-top: 4px; font-size: 9.5px; color: #5c526e; flex-shrink: 0; }
  .is-full .sc-sign { min-height: 58px; padding-top: 10px; font-size: 11px; }
  .print-bar-actions { display: flex; align-items: center; gap: 14px; }
  .bw-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #e5dff2; cursor: pointer; user-select: none; }
  body.bw-preview .print-canvas { filter: grayscale(100%) contrast(1.08); }
  @media print {
    body { background: #fff; }
    .print-bar { display: none; }
    .print-canvas { padding: 0; gap: 0; display: block; filter: none !important; }
    .a4-sheet { width: auto; min-height: 0; padding: 0; box-shadow: none; page-break-after: always; break-after: page; }
    .a4-sheet:last-child { page-break-after: auto; break-after: auto; }
  }
</style>
</head>
<body>
  <div class="print-bar">
    <span>学生个人学业诊断卡 · 共 ${cards.length} 份（${compact ? 'A4 一页两生' : 'A4 一页一生'} · ${hideRank ? '已隐藏具体名次' : '含年级参考位次'}）</span>
    <div class="print-bar-actions">
      <label class="bw-toggle"><input type="checkbox" onchange="document.body.classList.toggle('bw-preview',this.checked)">黑白打印预览</label>
      <button type="button" onclick="window.print()">打印 / 另存为 PDF</button>
    </div>
  </div>
  <div class="print-canvas">${pages.join('')}</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=960,height=860');
    if (!win) {
      Z.notice('浏览器拦截了打印预览窗口，请允许本机弹窗后重试。', true);
      return;
    }
    win.document.open();
    win.document.write(doc);
    win.document.close();
  }

  function cardsDrawerHTML(analysis, defaultClass = '') {
    const classes = analysis?.classes || [];
    const selected = defaultClass && classes.includes(defaultClass) ? defaultClass : (classes[0] || '');
    return `<form id="student-cards-form" class="s3-form">
      <div class="drawer-intro">
        <p>面向<strong>家长会与学生个人复盘</strong>设计的零隐私泄露诊断卡：每张卡片仅包含该生本人成绩、学科均衡雷达图、年级百分位（PR）及个性化提分建议，<strong>绝不出现其他任何同学信息</strong>。</p>
      </div>
      <div class="rules-row-list">
        <label class="field">
          <span>选择导出范围</span>
          <select name="class_name" id="cards-class-select">
            ${classes.map(c => `<option value="${e(c)}" ${c === selected ? 'selected' : ''}>${e(c)}班（全班批量打印）</option>`).join('')}
            <option value="">全年级全部学生（${(analysis?.students || []).length} 人）</option>
          </select>
        </label>
        <label class="field">
          <span>A4 排版密度</span>
          <select name="layout" id="cards-layout-select">
            <option value="two-up">A4 一页两生（带裁切虚线，最省纸，推荐）</option>
            <option value="one-up">A4 一页一生（宽松版，预留大段学生反思与家长寄语区）</option>
          </select>
        </label>
        <div class="rules-scope-options">
          <label class="rules-scope-check">
            <input type="checkbox" name="hide_rank" id="cards-hide-rank" checked>
            <span>隐藏具体名次（仅展示等级、年级百分位 PR 与标准分 T 分，符合双减隐私规范）</span>
          </label>
        </div>
      </div>
      <div id="cards-error" class="error" hidden></div>
      <div class="form-actions">
        <button type="submit" class="btn primary">生成并预览打印</button>
        <button type="button" class="btn secondary" data-action="close-drawer">取消</button>
      </div>
    </form>`;
  }

  window.LeaderCards = {
    radarSVG,
    historySparkSVG,
    printStudentCards,
    cardsDrawerHTML,
  };
})();

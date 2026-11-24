'use strict';
/* Pure rendering helpers for 融侨学迹 leader charts, class trends and student identities. */
(() => {
  const e = value => Z.escape(value);
  const n = (value, digits = 1) => Z.num(value, digits);
  const option = (value, label, chosen) => `<option value="${e(value)}"${value === chosen ? ' selected' : ''}>${e(label)}</option>`;
  const btn = (label, action, attrs = '', style = 'secondary') => `<button class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;

  function identityCell(id) {
    const text = String(id || '');
    if (text.startsWith('student:')) return text.slice(8);
    if (text.startsWith('name:')) return '班级+姓名';
    return '未提供';
  }

  function identityLabel(id) {
    const text = String(id || '');
    if (text.startsWith('student:')) return `稳定编码 ${text.slice(8)}`;
    if (text.startsWith('name:')) return '按班级和姓名关联';
    return '原表行号（匿名）';
  }

  function trendSVG(exams) {
    const valid = exams.filter(x => x.summary.mean !== null && x.summary.mean !== undefined);
    if (!valid.length) return '<p class="muted">没有可计算的总分均分。</p>';
    const width = 780, height = 235, padLeft = 58, padRight = 42, plotLeft = padLeft + 24, plotRight = width - padRight;
    const values = valid.map(x => x.summary.mean);
    const lo = Math.min(...values), hi = Math.max(...values);
    const range = Math.max(hi - lo, 10), low = Math.max(0, lo - range * 0.2), high = hi + range * 0.2;
    const point = (v, i) => [
      valid.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + i * (plotRight - plotLeft) / (valid.length - 1),
      height - 44 - (v - low) / (high - low) * (height - 75),
    ];
    const points = values.map(point);
    const axes = [0, 0.5, 1].map(t => {
      const y = height - 44 - t * (height - 75);
      return `<line class="axis" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"/><text x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${n(low + t * (high - low), 0)}</text>`;
    }).join('');
    const dots = points.map(([x, y], i) => (
      `<circle class="dot" cx="${x}" cy="${y}" r="5"><title>${e(valid[i].name)}：${n(values[i])}</title></circle>`
      + `<text x="${x}" y="${y - 14}" text-anchor="middle">${n(values[i])}</text>`
      + `<text x="${x}" y="${height - 16}" text-anchor="middle">${e(valid[i].date?.slice(5) || '')}</text>`
    )).join('');
    return `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="同年级历次总分均分趋势">${axes}<polyline class="line" points="${points.map(x => x.join(',')).join(' ')}"/>${dots}</svg>`;
  }

  function growthChartSVG(ordered, key, { title, hint, invert = false, digits = 1, lineClass = '', dotClass = '' }) {
    const valid = ordered.filter(item => item[key] !== null && item[key] !== undefined);
    if (valid.length < 2) return '';
    const width = 360, height = 175, padLeft = 46, padRight = 24, plotLeft = padLeft + 18, plotRight = width - padRight, topY = 26, bottomY = height - 34;
    const values = valid.map(item => Number(item[key]));
    const lo = Math.min(...values), hi = Math.max(...values);
    const span = Math.max(hi - lo, invert ? 2 : 10);
    const low = invert ? Math.max(1, Math.floor(lo - span * 0.15)) : Math.max(0, lo - span * 0.2);
    const high = invert ? Math.max(low + 2, Math.ceil(hi + span * 0.15)) : hi + span * 0.2;
    const yFor = val => {
      const ratio = high === low ? 0.5 : (val - low) / (high - low);
      return invert ? topY + ratio * (bottomY - topY) : bottomY - ratio * (bottomY - topY);
    };
    const points = valid.map((item, i) => [plotLeft + i * (plotRight - plotLeft) / (valid.length - 1), yFor(Number(item[key]))]);
    const tickValues = invert ? [...new Set([low, Math.round((low + high) / 2), high])] : [0, 0.5, 1].map(t => low + t * (high - low));
    const ticks = tickValues.map(val => {
      const y = yFor(val);
      return `<line class="axis" x1="${padLeft}" y1="${y}" x2="${plotRight}" y2="${y}"/><text x="${padLeft - 6}" y="${y + 4}" text-anchor="end">${n(val, 0)}</text>`;
    }).join('');
    const dots = points.map(([x, y], i) => (
      `<circle class="dot ${dotClass}" cx="${x}" cy="${y}" r="4.5"><title>${e(valid[i].name)}：${n(values[i], digits)}</title></circle>`
      + `<text x="${x}" y="${y - 10}" text-anchor="middle">${n(values[i], digits)}</text>`
      + `<text x="${x}" y="${height - 12}" text-anchor="middle">${e(valid[i].date?.slice(5) || '')}</text>`
    )).join('');
    return `<div class="growth-chart-card"><h4>${e(title)}<small>${e(hint)}</small></h4><svg class="mini-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(title)}">${ticks}<polyline class="line ${lineClass}" points="${points.map(p => p.join(',')).join(' ')}"/>${dots}</svg></div>`;
  }

  function subjectTrendSummary(history) {
    const trends = history?.subject_trends || [];
    if (!trends.length) return '<p class="muted">选择考试并生成结果后，这里会显示各学科变化。</p>';
    const series = new Map();
    trends.forEach(exam => exam.subjects.forEach(item => {
      const current = series.get(item.subject) || { first: item, last: item, firstExam: exam, lastExam: exam };
      if (!series.has(item.subject)) series.set(item.subject, current);
      else { current.last = item; current.lastExam = exam; }
    }));
    return `<div class="subject-trend-grid">${Array.from(series.values()).map(item => {
      const delta = item.first.mean != null && item.last.mean != null ? item.last.mean - item.first.mean : null;
      const tone = delta == null ? '' : delta >= 0 ? 'positive' : 'negative';
      return `<div class="subject-trend-card"><span>${e(item.last.subject)}</span><strong class="${tone}">${delta == null ? '—' : `${delta >= 0 ? '+' : ''}${n(delta)}分`}</strong><small>${e(item.firstExam.name)} → ${e(item.lastExam.name)} · ${n(item.last.mean)}均分</small></div>`;
    }).join('')}</div>`;
  }

  const SCALE_META = {
    raw: {
      id: 'raw',
      label: '原始分',
      suffix: '',
      note: '按各场考试实际原始分统计；不同试卷难度和满分可能变化，建议切换「标准分 T 分」或「年级百分位 PR」观察真实增值。',
    },
    t_score: {
      id: 't_score',
      label: '标准分 T 分',
      suffix: '',
      note: 'T 分以当次年级均值为 50、标准差为 10（50 + 10×Z），可消除试卷难易波动；首末变化 > 0 表示相对年级实现真实增值。',
    },
    pr: {
      id: 'pr',
      label: '年级百分位 PR',
      suffix: '',
      note: '年级百分位 PR（0–100，越高越靠前）取本班参评学生的平均年级百分位，消除人数、满分与难度差异，跨考纵向可比。',
    },
  };

  function classTrendMetrics(exams, scale = 'raw') {
    const subjects = [...new Set(exams.flatMap(exam => (exam.subject_stats || []).map(item => item.subject)))];
    if (scale === 't_score') {
      return [
        { id: 'mean', label: '总分 T 分', digits: 1, read: cls => cls?.t_score ?? null },
        ...subjects.map(sub => ({ id: `sub:${sub}`, label: `${sub} T 分`, digits: 1, read: cls => cls?.subjects?.[sub]?.t_score ?? null })),
      ];
    }
    if (scale === 'pr') {
      return [
        { id: 'mean', label: '总分平均 PR', digits: 1, read: cls => cls?.pr ?? null },
        ...subjects.map(sub => ({ id: `sub:${sub}`, label: `${sub}平均 PR`, digits: 1, read: cls => cls?.subjects?.[sub]?.pr ?? null })),
      ];
    }
    return [
      { id: 'mean', label: '总分均分', digits: 1, read: cls => cls?.mean ?? null },
      { id: 'elite', label: '总分优生数', digits: 0, read: cls => cls?.elite_count ?? null },
      { id: 'top100', label: '总分前100名', digits: 0, read: cls => cls?.top?.['100'] ?? null },
      ...subjects.map(sub => ({ id: `sub:${sub}`, label: `${sub}均分`, digits: 1, read: cls => cls?.subjects?.[sub]?.mean ?? null })),
    ];
  }

  function classTrendTable(exams, metricId, gradeName = '', scale = 'raw') {
    const scaleInfo = SCALE_META[scale] || SCALE_META.raw;
    const metrics = classTrendMetrics(exams, scaleInfo.id);
    const metric = metrics.find(item => item.id === metricId) || metrics[0];
    const classNames = [...new Set(exams.flatMap(exam => (exam.class_stats || []).map(c => c.class)))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
    const rows = classNames.map(clsName => {
      const series = exams.map(exam => {
        const found = (exam.class_stats || []).find(c => c.class === clsName);
        return found ? metric.read(found) : null;
      });
      const valid = series.filter(v => v !== null && v !== undefined);
      const delta = valid.length >= 2 ? Number((valid[valid.length - 1] - valid[0]).toFixed(2)) : null;
      return { clsName, series, delta, latest: series[series.length - 1] };
    }).sort((a, b) => (b.latest ?? -Infinity) - (a.latest ?? -Infinity) || a.clsName.localeCompare(b.clsName, 'zh-CN', { numeric: true }));
    return {
      metric,
      metrics,
      scaleInfo,
      table: {
        title: `${gradeName}班级历次趋势 · ${metric.label}`,
        columns: ['班级', ...exams.map(x => `${x.name}（${x.date?.slice(5) || ''}）`), '首末变化'],
        rows: rows.map(r => [`${r.clsName}班`, ...r.series, r.delta]),
        note: `按${metric.label}最新一场降序排列。${scaleInfo.note}`,
      },
      rows,
    };
  }

  function classTrendSection(exams, metricId, gradeName = '', scale = 'raw') {
    if (exams.length < 2) return '';
    const { metric, metrics, scaleInfo, rows } = classTrendTable(exams, metricId, gradeName, scale);
    const headCols = exams.map(x => `<th class="number">${e(x.name)}<br><small class="muted">${e(x.date?.slice(5) || '')}</small></th>`).join('');
    const bodyRows = rows.map(r => {
      const deltaClass = r.delta == null || r.delta === 0 ? '' : r.delta > 0 ? 'delta-positive' : 'delta-negative';
      const deltaText = r.delta == null ? '—' : r.delta === 0 ? '0' : `${r.delta > 0 ? '+' : ''}${n(r.delta, metric.digits)}`;
      return `<tr><td>${e(r.clsName)}班</td>${r.series.map(v => `<td class="number">${n(v, metric.digits)}</td>`).join('')}<td class="number ${deltaClass}">${deltaText}</td></tr>`;
    }).join('');
    const scaleBtns = ['raw', 't_score', 'pr'].map(id => {
      const m = SCALE_META[id];
      return `<button type="button" class="scale-pill${scaleInfo.id === id ? ' active' : ''}" data-action="trend-scale" data-scale="${id}">${e(m.label)}</button>`;
    }).join('');
    return `<section class="panel"><div class="section-title"><div><h2>班级历次趋势对比</h2><p>支持在原始分、标准分 T 分与年级百分位 PR 之间一键切换</p></div><div class="toolbar-inline"><div class="scale-switch" role="group" aria-label="评价尺度">${scaleBtns}</div><label class="small-text">对比指标 <select id="class-trend-metric" aria-label="班级趋势指标">${metrics.map(m => option(m.id, m.label, metric.id)).join('')}</select></label>${btn('复制班级趋势', 'copy-class-trends', '', 'secondary small')}${btn('下载 CSV', 'csv-class-trends', '', 'secondary small')}</div></div><div class="table-wrap"><table><thead><tr><th>班级</th>${headCols}<th class="number">首末变化</th></tr></thead><tbody>${bodyRows}</tbody></table></div><p class="table-note">${e(scaleInfo.note)}</p></section>`;
  }

  window.LeaderCharts = { identityCell, identityLabel, trendSVG, growthChartSVG, subjectTrendSummary, classTrendMetrics, classTrendTable, classTrendSection };
})();

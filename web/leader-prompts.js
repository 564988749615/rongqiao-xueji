'use strict';
/* 融侨学迹 · 一键复制脱敏分析提示词（离线零外网、确定性指标绑定、防 AI 编造） */
(() => {
  const e = v => Z.escape(v ?? '');
  const n = (v, d = 1) => Z.num(v, d);
  const signed = (v, d = 1, sfx = '') => {
    if (v === null || v === undefined || v === '') return '—';
    const num = Number(v);
    if (!Number.isFinite(num)) return '—';
    if (num === 0) return `0${sfx}`;
    return `${num > 0 ? '+' : ''}${n(num, d)}${sfx}`;
  };
  const pct = v => (v === null || v === undefined ? '—' : `${n(v, 1)}%`);

  const BRIEF_SCENARIOS = [
    { id: 'meeting', name: '班情会发言稿', desc: '面向年级/校领导：增值亮点、分布形态、学科贡献与盯人抓手' },
    { id: 'parent_meeting', name: '家长会班级总结', desc: '温和建设性：自动隐去具体排名与个人隐私，聚焦整体态势与家校配合' },
    { id: 'subject_clinic', name: '单科短板会诊提纲', desc: '聚焦拖累学科、双线达标集中差与同师跨班对照' },
  ];

  const STUDENT_SCENARIOS = [
    { id: 'talk', name: '考后个别生谈心提纲', desc: '先肯定优势再聚焦 1–2 个提分抓手，附可落地的两周行动建议' },
    { id: 'parent', name: '家校沟通微信草稿', desc: '客观温和、不含他人对比，突出进步点、优先夯实科目与家长配合方式' },
  ];

  function makeAnonymizer(prefix) {
    const map = new Map();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return name => {
      const key = String(name || '').trim();
      if (!key) return `${prefix}—`;
      if (!map.has(key)) {
        const idx = map.size;
        const code = idx < 26 ? letters[idx] : `${letters[Math.floor(idx / 26) - 1]}${letters[idx % 26]}`;
        map.set(key, `${prefix}${code}`);
      }
      return map.get(key);
    };
  }

  function buildBriefPrompt(brief, opts = {}) {
    if (!brief) return '';
    const scenario = opts.scenario || 'meeting';
    const anonStudents = opts.anonStudents !== false;
    const anonTeachers = Boolean(opts.anonTeachers);
    const includeLists = scenario !== 'parent_meeting' && opts.includeLists !== false;

    const m = brief.meta || {};
    const h = brief.headline || {};
    const shape = h.distribution_shape || {};
    const stuName = anonStudents ? makeAnonymizer('学生') : (v => String(v || '—'));
    const teacherName = (sub, raw) => {
      if (!raw) return '未录入';
      return anonTeachers ? `${sub}任课教师` : raw;
    };
    const homeroomText = m.homeroom ? (anonTeachers ? '本班班主任' : m.homeroom) : '未录入';

    const roleHeader = scenario === 'parent_meeting'
      ? '请你扮演资深中学班主任，根据下方经过校内系统核验的班级学情数据，起草一份【家长会班级学情总结与家校共育建议】（约 500–700 字）。要求：语气真诚、建设性、给家长信心；绝对不要出现任何具体排名或单个学生姓名；重点讲清整体态势、学科均衡情况和接下来家庭可配合的具体做法。'
      : scenario === 'subject_clinic'
        ? '请你扮演中学教研组长，根据下方经过核验的班级双线学科数据，起草一份【学科短板会诊与课堂整改提纲】（约 400–600 字）。要求：先肯定托举学科，再重点剖析贡献差为负或集中率偏低的学科，结合同师另班对照区分“共性难度”与“本班执行”，给出可落地的讲评与分层作业建议。'
        : '请你扮演中学班主任/年级组长，根据下方经过核验的班情分析数据，起草一份【班情分析会发言稿】（约 500–800 字）。要求：结构清晰（①整体定位与分布形态 ②学科托举与短板 ③分层盯人抓手 ④下阶段整改动作），语言克制务实、数据准确、可直接照稿发言。';

    const lines = [
      roleHeader,
      '',
      '【严格约束（必须遵守）】',
      '1. 所有事实、人数、分数、占比与结论必须严格来源于下方【已核验数据】，严禁编造任何未提供的数字、学科或学生信息。',
      '2. 遇到未提供的数据直接略过，不要猜测或自行补齐。',
      '',
      '【已核验数据】',
      `- 考试与班级：${m.grade || ''} · ${m.class || ''}班 ｜ ${m.exam_name || ''}（${m.exam_date || ''}）｜ 班主任：${homeroomText}`,
      `- 实考人数：${n(h.participants, 0)} / ${n(h.registered, 0)} 人 ｜ 数据版本：v${m.data_version || 1}${m.edit_count ? `（含 ${m.edit_count} 处更正）` : '（原始导入）'}`,
    ];

    if (scenario === 'parent_meeting') {
      lines.push(`- 整体结构形态：${shape.label || '均衡'}（建议工作重心：${shape.focus || '整体稳步推进'}）`);
      lines.push(`- 班级均分相对年级：${signed(h.mean_diff, 1, ' 分')} ｜ 离散度（标准差）：${n(h.std, 1)}`);
    } else {
      lines.push(
        `- 总分概览：班均分 ${n(h.mean, 1)}（较年级 ${signed(h.mean_diff, 1)}），中位数 ${n(h.median, 1)}（均分−中位数 ${signed(h.mean_median_gap, 1)}），标准差 ${n(h.std, 1)}，后20% ${n(h.bottom20_count, 0)} 人（${pct(h.bottom20_rate)}）`
      );
      lines.push(`- 分布形态判型：${shape.label || '—'} ｜ 建议重心：${shape.focus || '—'}`);
      lines.push(
        `- 双线达标：${h.high?.label || '前20%'} ${n(h.high?.count, 0)} 人（${pct(h.high?.rate)}，较上次 ${signed(h.high?.delta_prev_count, 0, '人')}，较首考 ${signed(h.high?.delta_entry_count, 0, '人')}）；`
        + `${h.main?.label || '前40%'} ${n(h.main?.count, 0)} 人（${pct(h.main?.rate)}，较上次 ${signed(h.main?.delta_prev_count, 0, '人')}，较首考 ${signed(h.main?.delta_entry_count, 0, '人')}）；`
        + `尖优含金量 ${pct(h.elite_ratio)}`
      );
    }

    if (brief.flow?.available && scenario !== 'parent_meeting') {
      const f = brief.flow;
      lines.push(
        `- 跨次流动（较 ${f.prev_exam_name}，匹配 ${f.matched_count} 人）：`
        + `${h.high?.label || '前20%'}保尖率 ${pct(f.high_keep_rate)}（稳 ${f.high_keep}/${f.high_prev}、掉 ${f.high_drop_count}、冲 +${f.high_rise_count}）；`
        + `${h.main?.label || '前40%'}守线率 ${pct(f.main_keep_rate)}（稳 ${f.main_keep}/${f.main_prev}、跌 ${f.main_drop_count}、突围 +${f.main_rise_count}）`
      );
    }

    lines.push('', '【分学科诊断】');
    (brief.subject_diagnosis || []).forEach(s => {
      if (scenario === 'parent_meeting') {
        const trendWord = (s.mean_diff || 0) >= 2 ? '表现突出' : (s.mean_diff || 0) <= -2 ? '需重点夯实' : '整体平稳';
        lines.push(`- ${s.subject}：较年级均分 ${signed(s.mean_diff, 1)}（${trendWord}，结构定位：${s.mismatch_label || '平稳'}）`);
      } else {
        const others = (s.same_teacher_other_classes || []).map(o => `${o.class}班均${n(o.mean, 1)}/${pct(o.main_rate)}`).join('、');
        lines.push(
          `- ${s.subject}（${teacherName(s.subject, s.teacher)}）：均分 ${n(s.mean, 1)}（离均差 ${signed(s.mean_diff, 1)}），`
          + `${h.high?.label || '前20%'} 达${s.high?.achievers ?? 0}/集${s.high?.concentrated ?? 0}（差${signed(s.high?.gap, 0)}），`
          + `${h.main?.label || '前40%'} 达${s.main?.achievers ?? 0}/集${s.main?.concentrated ?? 0}（差${signed(s.main?.gap, 0)}），`
          + `诊断：${s.mismatch_label || '均衡'}${others ? `；同师另班：${others}` : ''}`
        );
      }
    });

    if (includeLists) {
      const lists = brief.action_lists || {};
      const bHigh = (lists.borderline_high || []).slice(0, 6);
      const bMain = (lists.borderline_main || []).slice(0, 6);
      const drops = (lists.drop_alerts || []).slice(0, 5);
      const pWeak = (lists.persistent_weak || []).slice(0, 5);
      lines.push('', `【分层盯人抓手（${anonStudents ? '已匿名化代号' : '实名'}）】`);
      lines.push(
        `- 冲${h.high?.label || '前20%'}临界（${(lists.borderline_high || []).length}人）：`
        + (bHigh.length ? bHigh.map(s => `${stuName(s.name)}(差${n(s.score_gap, 1)}分:${(s.missing_subjects || []).slice(0, 2).map(x => x.subject).join('/') || '全达'})`).join('；') : '无')
      );
      lines.push(
        `- 保冲${h.main?.label || '前40%'}临界（${(lists.borderline_main || []).length}人）：`
        + (bMain.length ? bMain.map(s => `${stuName(s.name)}(差${n(s.score_gap, 1)}分:${(s.missing_subjects || []).slice(0, 2).map(x => x.subject).join('/') || '全达'})`).join('；') : '无')
      );
      if (drops.length) {
        lines.push(`- 流失预警（${(lists.drop_alerts || []).length}人）：` + drops.map(s => `${stuName(s.name)}(${s.prev_tier}→${s.curr_tier})`).join('；'));
      }
      if (pWeak.length) {
        lines.push(`- 连续偏科（${(lists.persistent_weak || []).length}人）：` + pWeak.map(s => `${stuName(s.name)}(${s.subject} ${s.hits}/${s.exams_checked}次)`).join('；'));
      }
    }

    return lines.join('\n');
  }

  function buildStudentPrompt(profileData, opts = {}) {
    if (!profileData || !profileData.student) return '';
    const scenario = opts.scenario || 'talk';
    const anonStudent = opts.anonStudent !== false;
    const st = profileData.student;
    const hist = profileData.history || [];
    const pWeak = profileData.persistent_weak || [];
    const displayName = anonStudent ? '该生' : (st.name || '该生');

    const roleHeader = scenario === 'parent'
      ? `请你扮演班主任，根据下方经过核验的个人学业数据，为【${displayName}】起草一段发给家长的【考后家校沟通微信】（约 250–350 字）。要求：温和真诚、先肯定具体亮点、不出现具体排名数字也不与他人攀比、指出 1–2 个优先夯实科目并给出家长在家可配合的一条小建议。`
      : `请你扮演班主任，根据下方经过核验的个人学业数据，为【${displayName}】起草一份【考后 5 分钟一对一谈心提纲】（约 300–450 字）。要求：①开场肯定进步或优势学科 ②结合历次走势拆解 1–2 个最易提分的短板科 ③给出未来两周可执行的具体微目标（每日 15 分钟级别）。`;

    const lines = [
      roleHeader,
      '',
      '【严格约束】所有结论必须严格基于下方已核验数据，禁止编造未提供的分数、名次或学科表现。',
      '',
      '【学生学业档案（已核验）】',
      `- 学生：${displayName}（${st.grade || ''} ${st.class_name || ''}班）｜ 已关联 ${st.exam_count || hist.length} 场考试`,
      `- 最近一次等级：${st.latest_level || '—'} ｜ 年级百分位（PR）：${st.latest_pr != null ? `超越 ${n(st.latest_pr, 1)}%` : '—'} ｜ 首末百分位变化：${signed(st.pr_delta, 1)}`,
      `- 持续薄弱学科：${pWeak.length ? pWeak.map(w => `${w.subject}（${w.hits}/${w.total_exams}次）`).join('、') : '各科相对均衡'}`,
    ];

    if (hist.length) {
      lines.push('', '【历次考试轨迹】');
      hist.forEach(item => {
        const subPairs = Object.entries(item.scores || {})
          .map(([sub, sc]) => {
            const lv = item.levels?.[sub];
            return scenario === 'parent'
              ? `${sub}:${lv || (sc != null ? sc : '缺')}`
              : `${sub}:${sc != null ? sc : '缺'}${lv ? `(${lv})` : ''}`;
          })
          .join('，');
        if (scenario === 'parent') {
          lines.push(`- ${item.exam_name}（${item.date}）：总评 ${item.total_level || '—'}，年级百分位 ${item.pr != null ? n(item.pr, 1) : '—'}；各科：${subPairs || '—'}`);
        } else {
          lines.push(`- ${item.exam_name}（${item.date}）：总分 ${n(item.total, 1)}，年级百分位 ${item.pr != null ? n(item.pr, 1) : '—'}，T分 ${item.t_score != null ? n(item.t_score, 1) : '—'}，总评 ${item.total_level || '—'}；薄弱科：${(item.weak || []).slice(0, 2).join('、') || '无'}；各科：${subPairs || '—'}`);
        }
      });
    }

    return lines.join('\n');
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        Z.notice('已复制脱敏分析提示词，可直接粘贴到常用 AI 工具生成草稿。');
        return true;
      }
    } catch (_) {}
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    if (ok) {
      Z.notice('已复制脱敏分析提示词，可直接粘贴到常用 AI 工具生成草稿。');
    } else {
      Z.notice('自动复制失败，请手动全选下方文本框内容复制。', true);
    }
    return ok;
  }

  function briefPromptDrawerHTML(brief, opts = {}) {
    const scenario = opts.scenario || 'meeting';
    const anonStudents = opts.anonStudents !== false;
    const anonTeachers = Boolean(opts.anonTeachers);
    const includeLists = opts.includeLists !== false;
    const text = buildBriefPrompt(brief, { scenario, anonStudents, anonTeachers, includeLists });

    return `<div class="prompt-studio-wrap">
      <div class="drawer-intro">
        <p>将程序已核验的确定性指标自动整理为结构化提示词，并内置<strong>「禁止编造未提供数字」</strong>约束。本软件完全离线运行、不调用外部接口，复制后可粘贴到你常用的 AI 工具快速起草文稿。</p>
      </div>
      <div class="studio-section-label">一、选择写作场景</div>
      <div class="prompt-scenario-grid">
        ${BRIEF_SCENARIOS.map(sc => `<button type="button" class="studio-preset-card${scenario === sc.id ? ' active' : ''}" data-action="prompt-scenario" data-target="brief" data-scenario="${sc.id}">
          <strong>${e(sc.name)}</strong>
          <span>${e(sc.desc)}</span>
        </button>`).join('')}
      </div>
      <div class="studio-section-label">二、隐私脱敏设置</div>
      <div class="prompt-opt-row">
        <label class="studio-inline-check"><input type="checkbox" data-prompt-opt="anonStudents"${anonStudents ? ' checked' : ''}><span>学生姓名匿名化（替换为学生A/B/C，推荐）</span></label>
        <label class="studio-inline-check"><input type="checkbox" data-prompt-opt="anonTeachers"${anonTeachers ? ' checked' : ''}><span>任课教师姓名匿名化</span></label>
        ${scenario !== 'parent_meeting' ? `<label class="studio-inline-check"><input type="checkbox" data-prompt-opt="includeLists"${includeLists ? ' checked' : ''}><span>附带临界与流失盯人名单</span></label>` : ''}
      </div>
      <div class="studio-section-label">三、提示词预览（共 ${text.length} 字）</div>
      <textarea id="prompt-preview-box" class="prompt-preview-box" rows="15" readonly>${e(text)}</textarea>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn primary" data-action="prompt-copy">一键复制提示词</button>
        <button type="button" class="btn secondary" data-action="close-drawer">关闭</button>
      </div>
    </div>`;
  }

  function studentPromptDrawerHTML(profileData, opts = {}) {
    const scenario = opts.scenario || 'talk';
    const anonStudent = opts.anonStudent !== false;
    const text = buildStudentPrompt(profileData, { scenario, anonStudent });

    return `<div class="prompt-studio-wrap">
      <div class="drawer-intro">
        <p>基于该生已核验的历次百分位、标准分与薄弱学科自动组装谈话提示词，<strong>默认将姓名替换为「该生」</strong>，零隐私外泄。</p>
      </div>
      <div class="studio-section-label">一、选择沟通场景</div>
      <div class="abc-mode-grid">
        ${STUDENT_SCENARIOS.map(sc => `<button type="button" class="studio-preset-card${scenario === sc.id ? ' active' : ''}" data-action="prompt-scenario" data-target="student" data-scenario="${sc.id}">
          <strong>${e(sc.name)}</strong>
          <span>${e(sc.desc)}</span>
        </button>`).join('')}
      </div>
      <div class="prompt-opt-row" style="margin-top:10px">
        <label class="studio-inline-check"><input type="checkbox" data-prompt-opt="anonStudent"${anonStudent ? ' checked' : ''}><span>匿名化学生姓名（替换为「该生」，推荐）</span></label>
      </div>
      <div class="studio-section-label">二、提示词预览（共 ${text.length} 字）</div>
      <textarea id="prompt-preview-box" class="prompt-preview-box" rows="14" readonly>${e(text)}</textarea>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn primary" data-action="prompt-copy">一键复制提示词</button>
        <button type="button" class="btn secondary" data-action="close-drawer">关闭</button>
      </div>
    </div>`;
  }

  window.LeaderPrompts = {
    BRIEF_SCENARIOS,
    STUDENT_SCENARIOS,
    buildBriefPrompt,
    buildStudentPrompt,
    briefPromptDrawerHTML,
    studentPromptDrawerHTML,
    copyText,
  };
})();

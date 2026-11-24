'use strict';
/* 融侨学迹 · S3 兼容对象存储（内置缤纷云 Bitiful S4 预设、快照浏览与一键恢复） */
(() => {
  const e = v => Z.escape(v ?? '');
  const formatSize = bytes => {
    const num = Number(bytes || 0);
    if (!num) return '0 B';
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  };
  const formatTime = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('zh-CN', { hour12: false });
  };

  const PRESETS = {
    bitiful: {
      provider: 'bitiful',
      label: '缤纷云 Bitiful S4',
      endpoint: 'https://s3.bitiful.net',
      region: 'cn-east-1',
      path_style: true,
    },
    r2: {
      provider: 'r2',
      label: 'Cloudflare R2',
      endpoint: 'https://<AccountID>.r2.cloudflarestorage.com',
      region: 'auto',
      path_style: true,
    },
    custom: {
      provider: 'custom',
      label: '自定义 S3 兼容',
      endpoint: '',
      region: 'cn-east-1',
      path_style: true,
    },
  };

  function renderS3CardHTML(s3State) {
    const cfg = s3State?.config || {};
    const status = s3State?.status || {};
    const configured = !!cfg.configured;
    const providerLabel = PRESETS[cfg.provider]?.label || 'S3 兼容存储';
    return `<section class="panel s3-panel">
      <div class="section-title">
        <div>
          <h2>S3 云端存储（支持缤纷云 Bitiful）</h2>
          <p>将考试档案、自定义口径、任课教师与教研记录压缩同步至私有对象存储</p>
        </div>
        <span class="badge ${configured ? 'success' : ''}">${configured ? `已配置 · ${e(cfg.bucket)}` : '未配置'}</span>
      </div>
      ${configured ? `
        <div class="s3-meta-strip">
          <span><b>服务：</b>${e(providerLabel)}（${e(cfg.endpoint)}）</span>
          <span><b>目录：</b>${e(cfg.prefix)}</span>
          <span><b>自动同步：</b>${cfg.auto_sync ? '已开启' : '手动'}</span>
          <span><b>上次同步：</b>${e(formatTime(status.last_sync_at))}</span>
        </div>
        ${status.last_error ? `<div class="error" style="margin:0 0 12px">上次后台同步失败：${e(status.last_error)}</div>` : ''}
        <div class="storage-actions">
          <button type="button" class="btn primary" data-action="s3-backup">立即同步到云端</button>
          <button type="button" class="btn secondary" data-action="s3-snapshots">云端快照与恢复</button>
          <button type="button" class="btn secondary" data-action="s3-config">连接设置</button>
        </div>
      ` : `
        <p class="inline-help" style="margin:0 0 14px">内置 <strong>缤纷云 Bitiful S4</strong>（<code>https://s3.bitiful.net</code>）一键预设，也兼容 Cloudflare R2、阿里云 OSS、腾讯云 COS 与 MinIO。适合办公室电脑与家用 Mac 之间安全同步数据。</p>
        <div class="storage-actions">
          <button type="button" class="btn primary" data-action="s3-config">配置缤纷云 / S3 存储</button>
        </div>
      `}
      <div id="s3-card-result" role="status"></div>
    </section>`;
  }

  function configDrawerHTML(cfg) {
    const c = { ...PRESETS.bitiful, prefix: 'rongqiao-xueji/', auto_sync: false, ...(cfg || {}) };
    return `<form id="s3-config-form" class="s3-form">
      <div class="drawer-intro">
        <p>密钥仅保存在本机 SQLite 数据库中，<strong>绝不会</strong>写入本地或云端备份文件。为保护学生隐私，请务必在缤纷云控制台将对应存储桶设为<strong>「私有读写」</strong>。</p>
      </div>
      <div class="mark-presets" style="margin-bottom:14px">
        <button type="button" data-s3-preset="bitiful">缤纷云 Bitiful S4（推荐）</button>
        <button type="button" data-s3-preset="r2">Cloudflare R2</button>
        <button type="button" data-s3-preset="custom">自定义 S3 兼容</button>
      </div>
      <input type="hidden" name="provider" value="${e(c.provider || 'bitiful')}">
      <div class="rules-row-list">
        <label class="field">
          <span>S3 Endpoint 地址</span>
          <input name="endpoint" type="url" required value="${e(c.endpoint)}" placeholder="https://s3.bitiful.net">
        </label>
        <div class="form-grid two">
          <label class="field">
            <span>Region 区域</span>
            <input name="region" type="text" required value="${e(c.region || 'cn-east-1')}" placeholder="cn-east-1">
          </label>
          <label class="field">
            <span>存储桶名称（Bucket）</span>
            <input name="bucket" type="text" required value="${e(c.bucket || '')}" placeholder="例如：my-school-scores">
          </label>
        </div>
        <div class="form-grid two">
          <label class="field">
            <span>Access Key</span>
            <input name="access_key" type="text" required autocomplete="off" value="${e(c.access_key || '')}" placeholder="在缤纷云控制台 → 密钥管理获取">
          </label>
          <label class="field">
            <span>Secret Key</span>
            <input name="secret_key" type="password" autocomplete="new-password" ${c.has_secret ? '' : 'required'} placeholder="${c.has_secret ? `已保存（${e(c.secret_key_masked)}），留空保持不变` : '填写 Secret Key'}">
          </label>
        </div>
        <label class="field">
          <span>存储目录前缀</span>
          <input name="prefix" type="text" value="${e(c.prefix || 'rongqiao-xueji/')}" placeholder="rongqiao-xueji/">
        </label>
        <div class="rules-scope-options" style="margin-top:2px">
          <label class="rules-scope-check"><input type="checkbox" name="path_style" ${c.path_style !== false ? 'checked' : ''}><span>使用 Path-Style 路径样式（缤纷云 S4 / MinIO 推荐开启）</span></label>
          <label class="rules-scope-check"><input type="checkbox" name="auto_sync" ${c.auto_sync ? 'checked' : ''}><span>保存考试或修改口径时自动在后台同步到云端（断网不影响本地保存）</span></label>
        </div>
      </div>
      <div id="s3-test-result" class="support-note" hidden></div>
      <div id="s3-config-error" class="error" hidden></div>
      <div class="rules-footer-bar">
        <div class="rules-footer-left">
          <button type="button" class="btn secondary small" data-action="s3-test">测试连接</button>
          ${c.configured ? '<button type="button" class="btn danger small" data-action="s3-clear">清除配置</button>' : ''}
        </div>
        <div class="rules-footer-right">
          <button type="button" class="btn secondary" data-action="close-drawer">取消</button>
          <button type="submit" class="btn primary">保存配置</button>
        </div>
      </div>
    </form>`;
  }

  function readConfigForm(form) {
    const fd = new FormData(form);
    return {
      provider: String(fd.get('provider') || 'bitiful').trim(),
      endpoint: String(fd.get('endpoint') || '').trim(),
      region: String(fd.get('region') || 'cn-east-1').trim(),
      bucket: String(fd.get('bucket') || '').trim(),
      access_key: String(fd.get('access_key') || '').trim(),
      secret_key: String(fd.get('secret_key') || '').trim(),
      prefix: String(fd.get('prefix') || 'rongqiao-xueji/').trim(),
      path_style: !!form.querySelector('[name="path_style"]')?.checked,
      auto_sync: !!form.querySelector('[name="auto_sync"]')?.checked,
    };
  }

  function bindConfigForm(form) {
    if (!form) return;
    form.querySelectorAll('[data-s3-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = PRESETS[btn.dataset.s3Preset];
        if (!p) return;
        form.querySelector('[name="provider"]').value = p.provider;
        form.querySelector('[name="endpoint"]').value = p.endpoint;
        form.querySelector('[name="region"]').value = p.region;
        form.querySelector('[name="path_style"]').checked = !!p.path_style;
        Z.notice(`已填入 ${p.label} 推荐连接参数，请补充存储桶与密钥。`);
      });
    });
  }

  function diffPreviewHTML(diff) {
    if (!diff) return '';
    const exAdd = diff.exams?.only_cloud || [];
    const exUpd = diff.exams?.updated_in_cloud || [];
    const exLoc = diff.exams?.only_local || [];
    const nAdd = diff.notes?.only_cloud || 0;
    const nUpd = diff.notes?.updated_in_cloud || 0;
    const tAdd = diff.teachers?.only_cloud || 0;
    const tUpd = diff.teachers?.updated_in_cloud || 0;
    const defNewer = !!diff.default_rules_diff?.cloud_newer;
    const hasAnyUpdate = exAdd.length || exUpd.length || nAdd || nUpd || tAdd || tUpd || defNewer;

    return `<div class="s3-diff-box">
      <div class="hygiene-head">
        <div>
          <h4>云端快照差异预览</h4>
          <p>快照导出时间：${e(formatTime(diff.exported_at))} · 云端 ${diff.cloud_exam_count} 场 / 本机 ${diff.local_exam_count} 场</p>
        </div>
        <button type="button" class="text-button" data-action="s3-diff-close">收起预览</button>
      </div>
      <div class="s3-diff-grid">
        <div class="s3-diff-stat"><small>云端新增考试</small><strong>+${exAdd.length}</strong></div>
        <div class="s3-diff-stat"><small>云端更新（口径/信息）</small><strong>${exUpd.length}</strong></div>
        <div class="s3-diff-stat"><small>教研记录新增 / 更新</small><strong>+${nAdd} / ${nUpd}</strong></div>
        <div class="s3-diff-stat"><small>教师配置新增 / 更新</small><strong>+${tAdd} / ${tUpd}</strong></div>
      </div>
      ${exAdd.length ? `<p class="inline-help" style="margin:6px 0 0"><b>将新增的考试：</b>${exAdd.slice(0, 8).map(x => `${e(x.grade)}·${e(x.name)}`).join('、')}${exAdd.length > 8 ? ` 等 ${exAdd.length} 场` : ''}</p>` : ''}
      ${exUpd.length ? `<p class="inline-help" style="margin:4px 0 0"><b>云端较新待合并的考试：</b>${exUpd.slice(0, 6).map(x => `${e(x.name)}（${e((x.changes || []).join('/'))}）`).join('、')}</p>` : ''}
      ${defNewer ? '<p class="inline-help" style="margin:4px 0 0"><b>全校默认口径：</b>云端版本较本机更新，智能合并时将同步更新。</p>' : ''}
      ${exLoc.length ? `<p class="inline-help" style="margin:4px 0 0"><b>仅本机保留：</b>${exLoc.length} 场本机独有考试（合并恢复<b>绝不会删除</b>本机独有数据）。</p>` : ''}
      ${!hasAnyUpdate ? '<p class="inline-help" style="margin:6px 0 0">本机数据已是最新，与该云端快照没有需要拉取的新增或更新项。</p>' : ''}
      <div class="storage-actions" style="margin-top:12px">
        <button type="button" class="btn primary small" data-action="s3-restore" data-mode="smart_merge" data-key="${e(diff.key)}">智能增量合并（推荐）</button>
        <button type="button" class="btn secondary small" data-action="s3-restore" data-mode="append_only" data-key="${e(diff.key)}">仅补充本机缺失</button>
      </div>
    </div>`;
  }

  function snapshotsDrawerHTML(snapshots, cfg, confirmDeleteKey, diffPreview = null) {
    const list = snapshots || [];
    return `<div class="drawer-intro">
      <p>当前存储桶：<strong>${e(cfg?.bucket || '—')}</strong>（目录 <code>${e(cfg?.prefix || '')}</code>）。支持先预览云端与本机差异，再按时间戳<strong>智能增量合并</strong>（新增考试 + 合并更新后的口径、教师与教研记录，绝不删除本机独有考试）。</p>
    </div>
    <div class="drawer-actions">
      <button type="button" class="btn primary" data-action="s3-backup-drawer">立即上传新快照</button>
      <button type="button" class="btn secondary" data-action="s3-snapshots">刷新云端列表</button>
    </div>
    <div id="s3-snap-error" class="error" hidden></div>
    ${diffPreviewHTML(diffPreview)}
    ${list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>云端快照</th><th class="number">大小</th><th>上传时间</th><th>操作</th></tr></thead>
      <tbody>${list.map(item => `<tr>
        <td>${item.is_latest ? '<span class="badge success" style="margin-right:6px">最新</span>' : ''}<strong>${e(item.name)}</strong></td>
        <td class="number">${e(formatSize(item.size))}</td>
        <td>${e(formatTime(item.last_modified))}</td>
        <td>
          <button type="button" class="text-button" data-action="s3-diff" data-key="${e(item.key)}">对比并恢复</button>
          ${item.is_latest ? '' : `<button type="button" class="text-button danger" data-action="s3-delete" data-key="${e(item.key)}">${confirmDeleteKey === item.key ? '确认删除' : '删除'}</button>`}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">云端目录下还没有备份快照。点击上方「立即上传新快照」即可将当前全部考试档案同步到云端。</p>'}`;
  }

  window.LeaderS3 = { PRESETS, renderS3CardHTML, configDrawerHTML, readConfigForm, bindConfigForm, snapshotsDrawerHTML };
})();

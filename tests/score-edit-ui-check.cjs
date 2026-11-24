'use strict';
const fs = require('fs');
const path = require('path');

let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  playwright = require('/Users/zkw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}

const BASE = process.env.ZHIXU_TEST_URL || 'http://127.0.0.1:8880';

async function apiJson(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${endpoint} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function seedExam() {
  const rows = [];
  const names = ['陈晨', '林晓', '周宇', '吴桐', '郑涵', '王硕', '李然', '张宁', '赵越', '孙悦'];
  names.forEach((name, idx) => {
    rows.push({
      id: `S${String(idx + 1).padStart(3, '0')}`,
      source_row: idx + 2,
      class: idx < 5 ? '1' : '2',
      name,
      scores: {
        语文: 85 + (idx % 5) * 3,
        数学: 80 + idx * 2,
        英语: 90 - (idx % 4) * 4,
      },
      identity_reliable: true,
    });
  });
  const dataset = {
    name: '成绩更正UI验收测试',
    grade: '初三',
    date: '2026-11-24',
    subjects: ['语文', '数学', '英语'],
    rows,
  };
  return await apiJson('/api/exams', { dataset });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function run() {
  const exam = await seedExam();
  console.log('Seeded exam:', exam.id);

  const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];

  try {
    // 1. Desktop 1440x1000 full edit -> preview -> save -> badge -> revoke flow
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`desktop console: ${msg.text()}`); });
    page.on('pageerror', err => errors.push(`desktop pageerror: ${err.message}`));

    await page.goto(`${BASE}/leader.html?exam=${encodeURIComponent(exam.id)}&view=compare`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-action="compare-tab"][data-tab="students"]');
    await page.click('[data-action="compare-tab"][data-tab="students"]');
    await page.waitForSelector('td[data-edit-cell]');

    // Pick first student's 数学 cell
    const cellSel = 'td[data-edit-cell][data-row-id="S001"][data-subject="数学"]';
    await page.waitForSelector(cellSel);
    const origText = (await page.textContent(cellSel)).trim();
    assert(origText === '80', `expected initial 数学 score 80, got ${origText}`);

    // Click cell -> inline editor -> enter 118 -> Enter
    await page.click(cellSel);
    await page.waitForSelector(`${cellSel} .score-inline-editor input`);
    await page.fill(`${cellSel} .score-inline-editor input`, '118');
    await page.keyboard.press('Enter');

    // Verify staging bar appears
    await page.waitForSelector('#score-edit-staging-bar');
    const barText = await page.textContent('#score-edit-staging-bar');
    assert(barText.includes('已暂存') && barText.includes('1'), `unexpected staging bar text: ${barText}`);
    assert(await page.locator(cellSel).evaluate(el => el.classList.contains('is-staged')), 'cell should have .is-staged');

    // Open impact preview drawer
    await page.click('[data-action="score-edit-preview"]');
    await page.waitForSelector('#score-edit-confirm-form');

    // Confirm button must be disabled when reason is empty
    const initiallyDisabled = await page.locator('#score-edit-confirm-btn').isDisabled();
    assert(initiallyDisabled, 'confirm button must be disabled when reason is empty');

    // Click quick reason chip and confirm
    await page.click('[data-action="score-reason-chip"][data-reason="复核更正"]');
    const enabledAfterReason = !(await page.locator('#score-edit-confirm-btn').isDisabled());
    assert(enabledAfterReason, 'confirm button must be enabled after filling reason');

    await page.click('#score-edit-confirm-btn');
    await page.waitForFunction(() => document.getElementById('drawer-overlay')?.hidden === true);
    await page.waitForSelector(`${cellSel}.is-edited`);

    const updatedText = (await page.textContent(cellSel)).trim();
    assert(updatedText === '118', `expected updated score 118, got ${updatedText}`);

    const badgeText = (await page.textContent('#exam-edits-badge')).trim();
    assert(badgeText.includes('已更正 1 处'), `expected badge 已更正 1 处, got ${badgeText}`);

    // Open score edits drawer & revoke
    await page.click('#exam-edits-badge');
    await page.waitForSelector('[data-action="score-edit-revoke-preview"]');
    await page.click('[data-action="score-edit-revoke-preview"]');
    await page.waitForSelector('[data-action="score-edit-confirm-revoke"]');
    await page.click('[data-action="score-edit-confirm-revoke"]');
    await page.waitForFunction(() => document.getElementById('drawer-overlay')?.hidden === true);
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      return el && el.textContent.trim() === '80' && !el.classList.contains('is-edited');
    }, cellSel);

    const badgeAfterRevoke = (await page.textContent('#exam-edits-badge')).trim();
    assert(badgeAfterRevoke === '更正记录', `expected badge 更正记录 after revoke, got ${badgeAfterRevoke}`);

    // Verify stale export notice behavior
    await page.evaluate((eid) => {
      window.LeaderEdits.recordExportVersion(eid, 1);
    }, exam.id);
    await page.click('[data-action="navigate"][data-view="reports"]');
    await page.waitForSelector('.stale-export-banner');
    const staleText = await page.textContent('.stale-export-banner');
    assert(staleText.includes('v1') && staleText.includes('v3'), `unexpected stale banner: ${staleText}`);

    console.log('Desktop 1440x1000 checks PASSED');
    await ctx.close();

    // 2. Mobile 390x844 layout & interaction check
    const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mPage = await mCtx.newPage();
    mPage.on('console', msg => { if (msg.type() === 'error') errors.push(`mobile console: ${msg.text()}`); });
    mPage.on('pageerror', err => errors.push(`mobile pageerror: ${err.message}`));

    await mPage.goto(`${BASE}/leader.html?exam=${encodeURIComponent(exam.id)}&view=compare`, { waitUntil: 'networkidle' });
    await mPage.waitForSelector('[data-action="compare-tab"][data-tab="students"]');
    await mPage.click('[data-action="compare-tab"][data-tab="students"]');
    await mPage.waitForSelector('td[data-edit-cell]');

    const overflow1 = await mPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow1 <= 2, `mobile 390px horizontal overflow detected: ${overflow1}px`);

    await mPage.click(cellSel);
    await mPage.waitForSelector(`${cellSel} .score-inline-editor input`);
    await mPage.fill(`${cellSel} .score-inline-editor input`, '95');
    await mPage.keyboard.press('Enter');
    await mPage.waitForSelector('#score-edit-staging-bar');
    await mPage.click('[data-action="score-edit-preview"]');
    await mPage.waitForSelector('#score-edit-confirm-form');

    const overflow2 = await mPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow2 <= 2, `mobile 390px preview drawer horizontal overflow detected: ${overflow2}px`);

    console.log('Mobile 390x844 checks PASSED');
    await mCtx.close();

    assert(errors.length === 0, `Browser errors found:\n${errors.join('\n')}`);
    console.log('ALL SCORE-EDIT UI CHECKS PASSED');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/zkw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.ZHIXU_TEST_URL || 'http://127.0.0.1:8880';
const evidence = path.resolve(__dirname, '../../.oil-ui/dual-products/leader-history');
fs.mkdirSync(evidence, { recursive: true });

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const stamp = Date.now();
  const examNames = [`增长验收一-${stamp}`, `增长验收二-${stamp}`];
  const rows = [
    '班级,学号,姓名,语文,数学\n01,001,测试甲,80,90\n01,002,测试乙,70,80\n',
    '班级,学号,姓名,语文,数学\n02,001,测试甲,90,95\n01,002,测试乙,75,85\n',
  ];
  await page.goto(`${base}/leader.html`);
  for (let index = 0; index < examNames.length; index += 1) {
    const content = Buffer.from(rows[index]).toString('base64');
    await page.evaluate(async ({ content, name, date }) => {
      const imported = await fetch('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `${name}.csv`, content, metadata: { name, grade: '初三', date } }),
      });
      if (!imported.ok) throw new Error((await imported.json()).error);
      const dataset = await imported.json();
      const saved = await fetch('/api/exams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset }),
      });
      if (!saved.ok) throw new Error((await saved.json()).error);
    }, { content, name: examNames[index], date: `2026-11-${String(index + 10).padStart(2, '0')}` });
  }

  await page.goto(`${base}/leader.html`);
  await page.locator('[data-view="trends"]').first().click();
  await page.locator('[data-history-exam]').first().waitFor();
  const labels = await page.locator('.history-exam-card').allTextContents();
  for (let index = 0; index < labels.length; index += 1) {
    if (!examNames.some(name => labels[index].includes(name))) {
      const checkbox = page.locator('[data-history-exam]').nth(index);
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
  }
  assert.match(await page.locator('.history-selection-count').innerText(), /已选择 2 场/);
  await page.locator('[data-action="history"]').click();
  await page.locator('tr[data-action="growth-detail"]').first().waitFor();
  assert.match(await page.locator('.history-result-summary').innerText(), /已关联学生\s*2人/);
  const firstRow = page.locator('tr[data-action="growth-detail"]').first();
  await firstRow.focus();
  await firstRow.click();
  await page.locator('#drawer-title').filter({ hasText: '成长轨迹' }).waitFor();
  assert.match(await page.locator('#drawer-content').innerText(), /各学科分数变化/);
  assert.match(await page.locator('#drawer-content').innerText(), /02班/);
  await page.locator('[data-action="close-drawer"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.action), 'growth-detail');
  await page.screenshot({ path: path.join(evidence, 'history-growth-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(evidence, 'history-growth-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'check-results.json'), JSON.stringify({ base, examNames, errors }, null, 2));
  console.log('PASS 多次分析选择考试并生成结果');
  console.log('PASS 学生成长轨迹抽屉与焦点恢复');
  console.log('PASS 390px 多次分析无横向溢出');
  console.log('PASS 页面脚本异常为0');
  await browser.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });

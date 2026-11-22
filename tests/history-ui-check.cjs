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
  await page.getByRole('heading', { name: '班级历次趋势对比', exact: true }).waitFor();
  await page.selectOption('#class-trend-metric', 'sub:语文');
  assert.match(await page.locator('#class-trend-metric').inputValue(), /sub:语文/);
  const labels = await page.locator('.history-exam-card').allTextContents();
  for (let index = 0; index < labels.length; index += 1) {
    if (!examNames.some(name => labels[index].includes(name))) {
      const checkbox = page.locator('[data-history-exam]').nth(index);
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
  }
  assert.match(await page.locator('.history-selection-count').innerText(), /已选择 2 场/);
  assert.equal(await page.locator('[data-weight]').count(), 2);
  await page.locator('[data-action="history"]').click();
  await page.locator('tr[data-action="growth-detail"]').first().waitFor();
  assert.match(await page.locator('.history-result-summary').innerText(), /已关联学生\s*2人/);
  const firstRow = page.locator('tr[data-action="growth-detail"]').first();
  await firstRow.focus();
  await firstRow.click();
  await page.locator('#drawer-title').filter({ hasText: '成长轨迹' }).waitFor();
  assert.equal(await page.locator('.growth-charts svg.mini-chart').count(), 2);
  assert.match(await page.locator('#drawer-content').innerText(), /年级名次走势/);
  assert.match(await page.locator('#drawer-content').innerText(), /各学科分数变化/);
  assert.match(await page.locator('#drawer-content').innerText(), /02班/);
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map(a => a.finished)));
  await page.screenshot({ path: path.join(evidence, 'growth-drawer.png') });
  await page.locator('[data-action="close-drawer"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.action), 'growth-detail');
  await page.screenshot({ path: path.join(evidence, 'history-growth-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(evidence, 'history-growth-mobile.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-view="brief"]').first().click();
  await page.getByText('班情会谈话要点（领导可直接开口）').waitFor();
  assert.match(await page.locator('#view-content').innerText(), /前20%尖优/);
  assert.match(await page.locator('#view-content').innerText(), /前40%基本盘/);
  await page.locator('[data-action="brief-tpl-tab"][data-tab="tpl1-teacher"]').click();
  assert.match(await page.locator('.tpl-preview-box').innerText(), /教师版/);
  await page.locator('[data-action="brief-tpl-tab"][data-tab="tpl2"]').click();
  assert.match(await page.locator('.tpl-preview-box').innerText(), /历次测试有效分达标数/);
  await page.screenshot({ path: path.join(evidence, 'class-brief-desktop.png'), fullPage: true });
  const [printWin] = await Promise.all([
    page.waitForEvent('popup'),
    page.locator('[data-action="print-brief-card"]').click(),
  ]);
  await printWin.getByRole('button', { name: '打印 / 存为 PDF' }).waitFor();
  assert.match(await printWin.locator('body').innerText(), /班情双线谈话卡/);
  await printWin.close();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'check-results.json'), JSON.stringify({ base, examNames, errors }, null, 2));
  console.log('PASS 多次分析选择考试并生成结果');
  console.log('PASS 学生成长轨迹抽屉与焦点恢复');
  console.log('PASS 班情分析20%/40%双线诊断、教师/领导打印模板与谈话卡打印');
  console.log('PASS 390px 多次分析与班情分析无横向溢出');
  console.log('PASS 页面脚本异常为0');
  await browser.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });

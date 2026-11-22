/* Preserved from the successful three-run browser verification.
 * Usage: node tests/quick-ui-check.cjs [baseURL] [evidenceDir] [rawWorkbook]
 * Start the app before running. This check does not save exams to the database.
 * Requires Playwright and a local Chrome installation.
 */
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/zkw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:8877';
const evidence = process.argv[3] || path.join(__dirname, 'evidence-quick');
const raw = process.argv[4] || path.resolve(__dirname, '..', '..', '原始数据.xlsx');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/quick.html`);
      await page.locator('#file-input').setInputFiles(raw);
      await page.waitForSelector('#rules-section:not([hidden])');
      assert((await page.locator('#dataset-summary').innerText()).includes('967'));
      await page.locator('#generate-button').click();
      await page.waitForFunction(() => !document.querySelector('#generate-button').disabled && !document.querySelector('#results-section').hidden);
      assert((await page.locator('#result-summary').innerText()).includes('942'));
      await page.locator('#table-search').fill('不存在的学生');
      assert.equal(await page.locator('#table-container tbody tr').count(), 0);
      await page.locator('#clear-table-filters').click();
      assert.equal(await page.locator('#table-container tbody tr').count(), 30);
      await page.locator('#page-size').selectOption('50');
      assert.equal(await page.locator('#table-container tbody tr').count(), 50);
      await page.locator('#next-page').click();
      assert.equal(await page.locator('#page-label').innerText(), '2 / 20');
      await page.locator('[data-scope="custom"]').click();
      await page.locator('#class-options input').evaluateAll(elements => {
        elements.forEach(element => { element.checked = false; });
        elements[0].dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.locator('#generate-button').click();
      assert((await page.locator('#page-error').innerText()).includes('至少选择一个班级'));
      assert.equal(await page.locator('#file-input').isDisabled(), false);
      await page.locator('#class-options input').first().check();
      await page.locator('#generate-button').click();
      await page.waitForFunction(() => !document.querySelector('#generate-button').disabled);
      assert((await page.locator('#result-summary').innerText()).includes('45'));
      assert.equal(await page.locator('#page-error').isVisible(), false);
      await page.locator('[data-table="rules"]').click();
      assert.equal(await page.locator('#table-class').isVisible(), false);
      assert.equal(errors.length, 0, errors.join('\n'));
      if (run === 3) {
        await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
        await page.screenshot({ path: path.join(evidence, 'quick-final-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: path.join(evidence, 'quick-final-mobile.png'), fullPage: true });
      }
      console.log(`真实上传与失败恢复 ${run}/3 通过`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

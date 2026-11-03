// Takes UI screenshots with Playwright (run `npm run build && npx vite preview --port 4173` first).
// Usage: node scripts/screenshots.cjs [baseUrl]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const base = process.argv[2] || 'http://localhost:4173';
const out = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });

async function settle(page, ms = 400) {
  await page.waitForTimeout(ms);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'cs-CZ', colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`${base}/?engine=mock`);
  await page.waitForSelector('.start');
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 800);
  await page.screenshot({ path: path.join(out, '01-start.png') });

  // sample dataset → data view
  await page.click('.tpl:nth-child(2)');
  await page.waitForSelector('.grid-wrap canvas');
  await settle(page, 800);
  await page.screenshot({ path: path.join(out, '02-data-view.png') });

  // value labels on + select a cell
  await page.keyboard.press('Control+l');
  await page.mouse.click(420, 300);
  await settle(page);
  await page.screenshot({ path: path.join(out, '03-data-value-labels.png') });

  // variable view
  await page.click('.view-tab:has-text("Proměnné")');
  await page.waitForSelector('.grid-wrap canvas');
  await settle(page, 600);
  await page.screenshot({ path: path.join(out, '04-variable-view.png') });

  // menu open
  await page.click('.menubar-item:has-text("Analýza")');
  await settle(page, 200);
  await page.hover('.menu-item:has-text("Popisná statistika")');
  await settle(page, 400);
  await page.screenshot({ path: path.join(out, '05-menu.png') });
  await page.click('.menu-item:has-text("Četnosti")');
  await page.waitForSelector('.analysis-dialog');
  // move two variables
  await page.dblclick('.var-list.source li:has-text("faculty")');
  await page.dblclick('.var-list.source li:has-text("satisf")');
  await settle(page, 300);
  await page.screenshot({ path: path.join(out, '06-frequencies-dialog.png') });
  await page.click('.dlg-subbuttons button:nth-child(2)');
  await settle(page, 300);
  await page.click('label.radio:has-text("Sloupcový graf")');
  await page.screenshot({ path: path.join(out, '07-frequencies-charts.png') });
  await page.click('.dialog-footer .btn-filled >> nth=-1');
  await settle(page, 200);
  await page.click('.analysis-dialog .dialog-footer .btn-filled');
  await page.waitForSelector('.paper');
  await settle(page, 900);
  await page.screenshot({ path: path.join(out, '08-output.png') });

  // syntax view
  await page.click('.syntax-tab-btn');
  await page.waitForSelector('.cm-editor');
  await page.click('.cm-content');
  await page.keyboard.type("* Ukázková syntaxe.\nDESCRIPTIVES /VARIABLES=age hours sleep gpa\n  /STATISTICS=MEAN STDDEV MIN MAX.\nFREQUNCIES /VARIABLES=gender.\n", { delay: 2 });
  await page.click('.syntax-bar .btn-filled');
  await settle(page, 600);
  await page.click('.syntax-tab-btn');
  await settle(page, 500);
  await page.screenshot({ path: path.join(out, '09-syntax.png') });

  // settings dialog
  await page.click('.avatar-btn');
  await settle(page, 300);
  await page.screenshot({ path: path.join(out, '10-profile.png') });
  await page.click('.profile-foot .btn:first-child');
  await page.waitForSelector('.settings-dialog');
  await page.click('.settings-nav-item:nth-child(2)');
  await settle(page, 400);
  await page.screenshot({ path: path.join(out, '11-settings.png') });
  await page.keyboard.press('Escape');

  // command palette
  await page.keyboard.press('Control+k');
  await page.keyboard.type('t test');
  await settle(page, 300);
  await page.screenshot({ path: path.join(out, '12-palette.png') });
  await page.keyboard.press('Escape');

  // dark theme
  await page.evaluate(() => {
    document.querySelector('.appbar-actions .icon-btn:not(.search-icon-only)')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.click('.view-tab:has-text("Výstup")');
  await settle(page, 800);
  await page.screenshot({ path: path.join(out, '13-dark-output.png') });
  await page.click('.view-tab:has-text("Data")');
  await page.waitForSelector('.grid-wrap canvas');
  await settle(page, 800);
  await page.screenshot({ path: path.join(out, '14-dark-data.png') });
  await ctx.close();

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ', deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mp.goto(`${base}/?engine=mock`);
  await mp.waitForSelector('.start');
  await mp.evaluate(() => document.fonts.ready);
  await settle(mp, 600);
  await mp.screenshot({ path: path.join(out, '15-mobile-start.png') });
  await mp.click('.tpl:nth-child(3)');
  await mp.waitForSelector('.grid-wrap canvas');
  await settle(mp, 800);
  await mp.screenshot({ path: path.join(out, '16-mobile-data.png') });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mp.click('.hamburger');
  await settle(mp, 400);
  await mp.click('.drawer-item.top:has-text("Analýza")');
  await settle(mp, 300);
  await mp.screenshot({ path: path.join(out, '17-mobile-menu.png') });
  await mp.click('.drawer-item:has-text("Popisná statistika")');
  await mp.click('.drawer-item:has-text("Popisné statistiky")');
  await mp.waitForSelector('.analysis-dialog');
  await settle(mp, 400);
  await mp.screenshot({ path: path.join(out, '18-mobile-dialog.png') });
  await mp.keyboard.press('Escape');
  await m.close();

  await browser.close();
  console.log('horizontal overflow at 390px:', overflow);
  console.log(errors.length ? errors.join('\n') : 'no page errors');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

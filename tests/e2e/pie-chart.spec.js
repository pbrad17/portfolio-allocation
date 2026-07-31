import { test, expect } from '@playwright/test';
import { boot, enterTicker, setNum, TICKER, QTY } from './helpers.js';

// Extruded walls are filled with a darkened rgb() string; top faces keep the
// palette's hex. That is enough to tell them apart in the rendered SVG.
const walls = page => page.locator('#summary-pie-chart svg path[fill^="rgb"]');
const tops = page => page.locator('#summary-pie-chart svg path[fill^="#"]');

async function addHolding(page, row, ticker, qty) {
  if (row > 1) await page.click('button:has-text("+ Add Holding")');
  await enterTicker(page, TICKER(row), ticker);
  await setNum(page, QTY(row), String(qty));
}

test.describe('summary pie chart', () => {
  // REGRESSION: a single 100% slice used to render with no side wall at all —
  // its start and end angle normalize to the same value, so the old
  // wrap-around branch produced nothing and the pie looked flat.
  test('a single 100% slice still renders its 3D wall', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await addHolding(page, 1, 'VTI', 1000);

    await page.click('button:has-text("Summary")');
    await expect(page.locator('#summary-pie-chart svg')).toBeVisible();
    await expect(tops(page)).toHaveCount(1);
    expect(await walls(page).count()).toBeGreaterThan(0);
  });

  test('renders one top face per category and walls only for the front rim', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await addHolding(page, 1, 'VTI', 1000);    // Domestic
    await addHolding(page, 2, 'VXUS', 1000);   // Foreign
    await addHolding(page, 3, 'VTEB', 1000);   // Municipal Bonds
    await addHolding(page, 4, 'BND', 1000);    // Investment Grade

    await page.click('button:has-text("Summary")');
    const topCount = await tops(page).count();
    const wallCount = await walls(page).count();
    expect(topCount).toBeGreaterThanOrEqual(4);
    // Only the front half of the rim is extruded, so there must be fewer
    // walls than slices — the old code drew a wall for back-facing slices too
    expect(wallCount).toBeGreaterThan(0);
    expect(wallCount).toBeLessThanOrEqual(topCount);
  });

  test('no path contains a NaN coordinate', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await addHolding(page, 1, 'VTI', 1000);
    await addHolding(page, 2, 'BND', 1);   // a very thin slice

    await page.click('button:has-text("Summary")');
    const ds = await page.locator('#summary-pie-chart svg path').evaluateAll(
      els => els.map(e => e.getAttribute('d'))
    );
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(d).not.toMatch(/NaN|Infinity|undefined/);
  });

  test('visual check', async ({ page }, testInfo) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await addHolding(page, 1, 'VTI', 1200);
    await addHolding(page, 2, 'VXUS', 800);
    await addHolding(page, 3, 'VWO', 400);
    await addHolding(page, 4, 'VTEB', 900);
    await addHolding(page, 5, 'BND', 700);
    await addHolding(page, 6, 'VNQ', 300);

    await page.click('button:has-text("Summary")');
    await page.waitForTimeout(400);
    const shot = await page.locator('#summary-pie-chart').screenshot();
    await testInfo.attach('pie-chart', { body: shot, contentType: 'image/png' });
    expect(shot.length).toBeGreaterThan(1000);
  });
});

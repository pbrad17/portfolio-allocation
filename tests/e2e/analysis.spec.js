import { test, expect } from '@playwright/test';
import { boot, enterTicker, setNum, TICKER, QTY, BASIS, CHANGE } from './helpers.js';

const goAnalysis = async page => {
  await page.click('button:has-text("Analysis")');
  await page.waitForTimeout(200);
};

test.describe('Analysis tab', () => {
  test('renders every section and reports drift against the target profile', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');
    await setNum(page, QTY(1), '1000');

    await goAnalysis(page);
    await expect(page.locator('h2:has-text("Portfolio Analysis")')).toBeVisible();
    // These phrases appear in both a card heading and the intro copy
    await expect(page.locator('h3:has-text("Rebalancing tolerance")')).toBeVisible();
    await expect(page.locator('h3:has-text("Concentration")')).toBeVisible();
    await expect(page.locator('h3:has-text("Projected income")')).toBeVisible();

    // A single all-equity position against a 75/25 target must breach
    await expect(page.locator('text=/sleeves outside tolerance/')).toBeVisible();
    await expect(page.locator('text=/5\\/25 rule/')).toBeVisible();
  });

  test('flags a concentrated position', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');
    await setNum(page, QTY(1), '1000');

    await goAnalysis(page);
    // One holding is 100% of the household
    await expect(page.locator('text=/position.* above /')).toBeVisible();
    await expect(page.locator('table >> text=VTI').first()).toBeVisible();
  });

  test('tolerance bands are configurable and persist', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');
    await setNum(page, QTY(1), '1000');
    await goAnalysis(page);

    const absolute = page.locator('label:has-text("Absolute") input');
    await expect(absolute).toHaveValue('5');
    await absolute.fill('12');
    await page.waitForTimeout(150);

    await page.click('button:has-text("Securities")');
    await goAnalysis(page);
    await expect(page.locator('label:has-text("Absolute") input')).toHaveValue('12');

    await page.reload({ waitUntil: 'networkidle' });
    await goAnalysis(page);
    await expect(page.locator('label:has-text("Absolute") input')).toHaveValue('12');
  });

  test('warns about a wash sale created by the proposal', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');

    // Taxable account: sell VTI at a loss
    await enterTicker(page, TICKER(1), 'VTI');
    await setNum(page, QTY(1), '100');
    await setNum(page, BASIS(1), '999999');   // guarantees a loss
    await setNum(page, CHANGE(1), '-5000');

    // Second account, tax-deferred, buying the same ticker back
    await page.click('button:has-text("+ Add Account")');
    await page.click('button:has-text("Account 2")');
    await page.locator('label:has-text("Tax") select').selectOption('deferred');
    await enterTicker(page, TICKER(1), 'VTI');
    await setNum(page, QTY(1), '10');
    await setNum(page, CHANGE(1), '4000');

    await goAnalysis(page);
    await expect(page.locator('text=Wash-sale exposure in the proposed trades')).toBeVisible();
    await expect(page.locator('text=Permanently disallowed')).toBeVisible();
    await expect(page.locator('text=/Rev. Rul. 2008-5/')).toBeVisible();
  });

  test('flags municipal bonds parked in a retirement account', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await page.locator('label:has-text("Tax") select').selectOption('deferred');
    await enterTicker(page, TICKER(1), 'VTEB');   // Municipal Bonds in TICKER_DB
    await setNum(page, QTY(1), '1000');

    await goAnalysis(page);
    await expect(page.locator('text=Asset location review')).toBeVisible();
    await expect(page.locator('text=/give up their tax exemption/')).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { boot, enterTicker, setNum, dropFiles, TICKER, QTY, BASIS, CHANGE, CSV_IRA } from './helpers.js';

const taxSelect = page => page.locator('label:has-text("Tax") select');
// The account-name editor replaces the <h3> with an autofocused input
const nameEditor = page => page.locator('input:focus');

/** A position with real market value, known basis, and a proposed sell. */
async function positionWithSell(page) {
  await enterTicker(page, TICKER(1), 'VTI');
  await setNum(page, QTY(1), '100');      // without a quantity there is no
  await setNum(page, BASIS(1), '20000');  // market value and nothing to realize
  await setNum(page, CHANGE(1), '-5000');
}

test.describe('account tax treatment', () => {
  test('a taxable account still reports a realized gain', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await expect(taxSelect(page)).toHaveValue('taxable');

    await positionWithSell(page);

    await expect(page.locator('text=/Proposed sells realize/')).toBeVisible();
  });

  test('a sheltered account reports no taxable gain', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');

    await positionWithSell(page);
    await expect(page.locator('text=/Proposed sells realize/')).toBeVisible();

    // Flip to tax-deferred: the capital-gain claim must disappear
    await taxSelect(page).selectOption('deferred');
    await expect(page.locator('text=/Proposed sells realize/')).toHaveCount(0);
    await expect(page.locator('text=/realize.*no taxable gain/')).toBeVisible();
    await expect(page.locator('text=Tax-deferred account')).toBeVisible();
  });

  test('tax treatment is inferred from the account name', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');

    // Rename the account to a retirement registration
    await page.click('h3:has-text("Account 1")');
    await nameEditor(page).fill('Angela - Rollover IRA');
    await nameEditor(page).press('Enter');

    await expect(taxSelect(page)).toHaveValue('deferred');
  });

  test('an explicit choice survives a later rename', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');

    await taxSelect(page).selectOption('free');
    await page.click('h3:has-text("Account 1")');
    await nameEditor(page).fill('Angela - Rollover IRA');
    await nameEditor(page).press('Enter');

    // Inference would say 'deferred' - the advisor's choice must win
    await expect(taxSelect(page)).toHaveValue('free');
  });

  test('an imported IRA is classified on arrival', async ({ page }) => {
    await boot(page, { quotes: {} });
    await dropFiles(page, [{ name: 'ira.csv', content: CSV_IRA, mime: 'text/csv' }]);
    await page.click('button:has-text("Securities")');
    await expect(page.locator('button:has-text("Angela - Rollover IRA")')).toHaveCount(1);
    await expect(taxSelect(page)).toHaveValue('deferred');
  });

  test('the household summary excludes sheltered sells from the tax figure', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await positionWithSell(page);
    await taxSelect(page).selectOption('deferred');

    await page.click('button:has-text("Summary")');
    await expect(page.locator('text=/Est. taxable gains realized/')).toBeVisible();
    await expect(page.locator('text=/realize.*no taxable gain/')).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

// Anchor on each box's own <p> label, then its sibling list - several boxes
// share the same utility classes, so class-based selectors are ambiguous.
const listAfter = (page, label) =>
  page.locator(`xpath=//p[contains(text(),"${label}")]/following-sibling::div[1]`);

test.describe('PDF report options persist', () => {
  test('survive a tab switch, a reload, and reset cleanly', async ({ page }) => {
    await boot(page, { quotes: {} });

    const goPdf = async () => {
      await page.click('button:has-text("PDF Report")');
      await page.waitForTimeout(250);
    };
    const cb = label => page.locator('label')
      .filter({ hasText: new RegExp(`^${label}`) })
      .locator('input[type=checkbox]').first();
    const sectionCb = i => listAfter(page, 'Select sections to include').locator('input[type=checkbox]').nth(i);
    const sumRows = () => listAfter(page, 'Select and reorder columns for Summary page').locator('> div');
    const sumLabels = async () => (await sumRows().allInnerTexts()).map(t => t.split('\n')[0].trim());
    const moveDown = row => sumRows().nth(row).locator('button').nth(1);

    await goPdf();
    await expect(sectionCb(1)).toBeChecked();          // Capitalization
    await expect(sectionCb(3)).not.toBeChecked();      // Expenses
    await expect(cb('Cost Basis')).not.toBeChecked();

    await sectionCb(1).uncheck();
    await sectionCb(3).check();
    await cb('Cost Basis').check();
    await cb('Unrl. G/L').check();

    await expect(sumRows()).toHaveCount(7);
    const before = await sumLabels();
    await moveDown(0).click();
    const after = await sumLabels();
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[0]);

    // The panel unmounts on every tab change
    await page.click('button:has-text("Securities")');
    await goPdf();
    await expect(sectionCb(1)).not.toBeChecked();
    await expect(sectionCb(3)).toBeChecked();
    await expect(cb('Cost Basis')).toBeChecked();
    await expect(cb('Unrl. G/L')).toBeChecked();
    expect(await sumLabels()).toEqual(after);

    await page.reload({ waitUntil: 'networkidle' });
    await goPdf();
    await expect(sectionCb(1)).not.toBeChecked();
    await expect(cb('Cost Basis')).toBeChecked();
    expect(await sumLabels()).toEqual(after);

    await page.click('button:has-text("Reset to defaults")');
    await expect(sectionCb(1)).toBeChecked();
    await expect(sectionCb(3)).not.toBeChecked();
    await expect(cb('Cost Basis')).not.toBeChecked();
    expect(await sumLabels()).toEqual(before);

    await page.click('button:has-text("Securities")');
    await goPdf();
    await expect(cb('Cost Basis')).not.toBeChecked();
    expect(await sumLabels()).toEqual(before);
  });
});

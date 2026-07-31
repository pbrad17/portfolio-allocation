import { test, expect } from '@playwright/test';
import { boot, enterTicker, dropFiles, TICKER, CSV_A, CSV_B, sessionJson } from './helpers.js';

test.describe('drag-and-drop import', () => {
  test('overlay appears for a file drag and not for an internal drag', async ({ page }) => {
    await boot(page, { quotes: {} });
    await expect(page.locator('text=Drop to import')).toHaveCount(0);

    await dropFiles(page, [{ name: 'holdings.csv', content: CSV_A, mime: 'text/csv' }], { only: 'enter' });
    const overlay = page.locator('text=Drop to import');
    await expect(overlay).toBeVisible();
    const text = await overlay.locator('xpath=..').innerText();
    expect(text).toMatch(/\.json/);
    expect(text).toMatch(/\.xlsx/);
    expect(text).toMatch(/\.csv/);

    // Holding-row / account-tab reordering drags text/plain - must not trigger
    await page.evaluate(() => {
      document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      const dt = new DataTransfer();
      dt.setData('text/plain', '0');
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('text=Drop to import')).toHaveCount(0);
  });

  test('CSV drop opens the Add-vs-Replace modal and Add keeps existing accounts', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');

    await dropFiles(page, [{ name: 'holdings.csv', content: CSV_A, mime: 'text/csv' }]);
    await expect(page.locator('text=/Import 2 holdings/')).toBeVisible();
    await expect(page.locator('text=Drop Test Brokerage ...123').first()).toBeVisible();

    await page.click('button:has-text("Add to existing")');
    await expect(page.locator('button:has-text("Drop Test Brokerage ...123")')).toHaveCount(1);
    await expect(page.locator('button:has-text("Account 1")')).toHaveCount(1);
  });

  test('multiple files merge into one import decision', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');

    await dropFiles(page, [
      { name: 'a.csv', content: CSV_A, mime: 'text/csv' },
      { name: 'b.csv', content: CSV_B, mime: 'text/csv' },
    ]);
    await expect(page.locator('text=/Import 3 holdings/')).toBeVisible();
    await expect(page.locator('text=2 files')).toBeVisible();
    await page.click('button:has-text("Add to existing")');
    await expect(page.locator('button:has-text("Drop Test Brokerage ...123")')).toHaveCount(1);
    await expect(page.locator('button:has-text("Second Custodian ...987")')).toHaveCount(1);
  });

  test('a fresh session imports straight in with no modal', async ({ page }) => {
    await boot(page, { quotes: {} });
    await dropFiles(page, [{ name: 'holdings.csv', content: CSV_A, mime: 'text/csv' }]);
    await expect(page.locator('text=/Import 2 holdings/')).toHaveCount(0);
    await page.click('button:has-text("Securities")');
    await expect(page.locator('button:has-text("Drop Test Brokerage ...123")')).toHaveCount(1);
  });

  test('a .json drop loads the session', async ({ page }) => {
    const { dialogs } = await boot(page, { quotes: {} });
    await dropFiles(page, [{ name: 'session.json', content: sessionJson(), mime: 'application/json' }]);
    await expect(page.locator('text=Dropped Session Client')).toHaveCount(1);
    expect(dialogs.some(m => /Session loaded/.test(m))).toBe(true);
    await page.click('button:has-text("Securities")');
    await expect(page.locator('button:has-text("Dropped Acct")')).toHaveCount(1);
  });

  test('unsupported and mixed drops are explained, never silent', async ({ page }) => {
    const { dialogs } = await boot(page, { quotes: {} });
    await dropFiles(page, [{ name: 'notes.txt', content: 'hello', mime: 'text/plain' }]);
    await expect.poll(() => dialogs.some(m => /Unsupported file/.test(m))).toBe(true);
    await expect(page.locator('text=Drop to import')).toHaveCount(0);

    await dropFiles(page, [
      { name: 'session.json', content: sessionJson({ assumptions: { clientName: 'Mixed Drop Client', asOfDate: '2026-07-30', targetProfile: '75/25' } }), mime: 'application/json' },
      { name: 'a.csv', content: CSV_A, mime: 'text/csv' },
    ]);
    await expect.poll(() => dialogs.some(m => /other dropped file/i.test(m))).toBe(true);
    await expect(page.locator('text=Mixed Drop Client')).toHaveCount(1);
  });
});

import { test, expect } from '@playwright/test';
import { boot, enterTicker, setNum, ROW, TICKER, NAME, STYLE, QTY, PRICE, BASIS, CHANGE } from './helpers.js';

test.describe('cross-account autofill', () => {
  test('an edited session row outranks the static database', async ({ page }) => {
    // Empty quote map so the autofilled price survives and stays observable
    const { apiCalls } = await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');

    await enterTicker(page, TICKER(1), 'VTI');
    const dbName = await page.inputValue(NAME(1));
    expect(dbName.length).toBeGreaterThan(0);

    await page.fill(NAME(1), 'Vanguard TSM ADVISOR EDIT');
    await page.selectOption(STYLE(1), 'Domestic Mid Value');
    await setNum(page, PRICE(1), '777.77');
    await setNum(page, QTY(1), '100');
    await setNum(page, BASIS(1), '20000');
    await setNum(page, CHANGE(1), '-5000');

    const before = apiCalls.filter(u => u.includes('symbols=VTI')).length;

    await page.click('button:has-text("+ Add Account")');
    await page.click('button:has-text("Account 2")');
    await enterTicker(page, TICKER(1), 'VTI');

    await expect(page.locator(NAME(1))).toHaveValue('Vanguard TSM ADVISOR EDIT');
    await expect(page.locator(STYLE(1))).toHaveValue('Domestic Mid Value');
    await expect(page.locator(PRICE(1))).toHaveValue('777.77');
    expect(dbName).not.toBe('Vanguard TSM ADVISOR EDIT');

    // Position-specific fields must never travel between lots
    await expect(page.locator(QTY(1))).toHaveValue('');
    await expect(page.locator(BASIS(1))).toHaveValue('');
    await expect(page.locator(CHANGE(1))).toHaveValue('');

    expect(apiCalls.filter(u => u.includes('symbols=VTI')).length).toBeGreaterThan(before);
  });

  test('a live quote still lands on an autofilled row', async ({ page }) => {
    await boot(page, {
      quotes: { VTI: { price: 321.45, name: 'Vanguard Total Stock Market ETF', date: '2026-07-30' } },
    });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');
    await page.fill(NAME(1), 'Advisor Renamed VTI');
    await page.click('button:has-text("+ Add Account")');
    await page.click('button:has-text("Account 2")');
    await enterTicker(page, TICKER(1), 'VTI');

    await expect(page.locator(NAME(1))).toHaveValue('Advisor Renamed VTI');
    await expect(page.locator(PRICE(1))).toHaveValue('321.45');
    await expect(page.locator(`${ROW(1)} td:nth-child(6) span.bg-positive`)).toHaveCount(1);
  });

  test('custom securities still outrank a session row', async ({ page }) => {
    await boot(page, { quotes: {} });
    await page.click('button:has-text("Securities")');
    await enterTicker(page, TICKER(1), 'VTI');
    await page.fill(NAME(1), 'VTI As Custom');
    await page.click(`${ROW(1)} td:last-child button`); // sparkle -> save to custom
    await expect(page.locator(STYLE(1))).toHaveValue('Custom: VTI');

    // Put the session row on a plain style so the two sources differ
    await page.selectOption(STYLE(1), 'Domestic Mid Value');
    await page.click('button:has-text("+ Add Account")');
    await page.click('button:has-text("Account 2")');
    await enterTicker(page, TICKER(1), 'VTI');
    await expect(page.locator(STYLE(1))).toHaveValue('Custom: VTI');
  });
});

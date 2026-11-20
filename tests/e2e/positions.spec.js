import { test, expect } from '@playwright/test';
import { boot, dropFiles } from './helpers.js';

const goPositions = async page => {
  await page.click('nav button:has-text("Positions")');
  await expect(page.locator('h2:has-text("Household Positions")')).toBeVisible();
};

const holding = (over = {}) => ({
  ticker: 'AAPL', securityName: 'Apple Inc.', style: 'Domestic Large Blend',
  quantity: 100, price: 200, costBasis: 0, acquiredDate: '', proposedChange: 0, ...over,
});

const session = accounts => JSON.stringify({
  version: '1.5',
  assumptions: { clientName: 'Positions Test Client', asOfDate: '2026-07-30', targetProfile: '75/25' },
  customSecurities: {}, resolvedSecurities: {},
  accounts,
});

// Apple in a taxable brokerage account AND in a rollover IRA — the exact case
// the page exists for. Basis is present on the taxable lot only, so the same
// fixture also covers the partial-basis rule.
const APPLE_IN_TWO_ACCOUNTS = session([
  {
    id: 1, name: 'Jay - Taxable Brokerage', managed: true, taxStatus: 'taxable',
    holdings: [
      holding({ quantity: 100, price: 200, costBasis: 15000 }),
      holding({ ticker: 'VTEB', securityName: 'Vanguard Tax-Exempt Bond ETF', style: 'Municipal Bonds', quantity: 100, price: 50 }),
    ],
  },
  {
    id: 2, name: 'Angela - Rollover IRA', managed: true, taxStatus: 'deferred',
    holdings: [holding({ quantity: 50, price: 200 })],
  },
]);

const load = async (page, json) => {
  await dropFiles(page, [{ name: 'session.json', content: json, mime: 'application/json' }]);
  await expect(page.locator('text=Positions Test Client')).toHaveCount(1);
};

/** A headline stat tile, by its exact label — the footnotes below the table reuse some of the same words. */
const stat = (page, label) => page.getByText(label, { exact: true }).locator('..');

/** The data row for a ticker (its own <tr>, not the expanded lot table). */
const row = (page, ticker) =>
  page.locator('tbody tr', { has: page.locator(`td:nth-child(2):text-is("${ticker}")`) });

test.describe('Household Positions tab', () => {
  test('sums one security held in two accounts into a single row', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    // One row, not one per account
    const aapl = row(page, 'AAPL');
    await expect(aapl).toHaveCount(1);

    const cells = await aapl.locator('td').allInnerTexts();
    expect(cells[1]).toBe('AAPL');
    expect(cells[4]).toBe('2');             // accounts
    expect(cells[5]).toBe('150.00');        // 100 + 50 shares
    expect(cells[7]).toBe('$30,000');       // current value, both lots
    expect(cells[9]).toBe('$30,000');       // post value

    // Household is 30,000 of Apple + 5,000 of VTEB
    await expect(stat(page, 'Household value')).toContainText('$35,000');
  });

  test('headline counts securities and the overlap between accounts', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    const held = stat(page, 'Securities held');
    await expect(held).toContainText('2');
    await expect(held).toContainText('3 positions across accounts');

    await expect(stat(page, 'Held in more than one account')).toContainText('1');
  });

  test('expanding a position shows the account behind each lot', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    await expect(page.locator('text=Angela - Rollover IRA')).toHaveCount(0);
    await row(page, 'AAPL').locator('button[aria-expanded]').click();

    await expect(page.locator('text=Jay - Taxable Brokerage')).toBeVisible();
    await expect(page.locator('text=Angela - Rollover IRA')).toBeVisible();
    // The IRA lot is labelled as sheltered
    await expect(page.locator('td:text-is("Tax-deferred")')).toBeVisible();
  });

  test('a missing cost basis is an em-dash, and partial basis is marked', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    // VTEB has no basis anywhere -> no gain figure at all
    const vtebCells = await row(page, 'VTEB').locator('td').allInnerTexts();
    expect(vtebCells[12]).toBe('—');

    // Apple has basis on one of its two lots -> the gain on that lot, flagged
    const aaplCells = await row(page, 'AAPL').locator('td').allInnerTexts();
    expect(aaplCells[12]).toBe('+$5,000*');
    await expect(page.locator('text=/covers.*only the lots that do have basis/')).toBeVisible();
  });

  test('filters to securities held in more than one account', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    await expect(row(page, 'VTEB')).toHaveCount(1);
    await page.click('text=Only securities in more than one account');
    await expect(row(page, 'VTEB')).toHaveCount(0);
    await expect(row(page, 'AAPL')).toHaveCount(1);
    await expect(page.locator('text=Showing 1 of 2')).toBeVisible();
  });

  test('search matches ticker, name and sleeve', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    const search = page.locator('input[type="search"]');
    await search.fill('vteb');
    await expect(row(page, 'AAPL')).toHaveCount(0);
    await expect(row(page, 'VTEB')).toHaveCount(1);

    await search.fill('municipal');
    await expect(row(page, 'VTEB')).toHaveCount(1);

    await search.fill('apple');
    await expect(row(page, 'AAPL')).toHaveCount(1);
    await expect(row(page, 'VTEB')).toHaveCount(0);

    await search.fill('nothing here');
    await expect(page.locator('text=No securities match this filter')).toBeVisible();
  });

  test('flags one security styled two different ways', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, session([
      {
        id: 1, name: 'Brokerage', managed: true, taxStatus: 'taxable',
        holdings: [holding({ style: 'Domestic Large Blend' })],
      },
      {
        id: 2, name: 'Trust', managed: true, taxStatus: 'taxable',
        holdings: [holding({ style: 'Domestic Large Growth' })],
      },
    ]));
    await goPositions(page);

    await expect(page.locator('text=1 with mismatched data')).toBeVisible();
    await expect(row(page, 'AAPL').locator('text=style')).toBeVisible();

    await row(page, 'AAPL').locator('button[aria-expanded]').click();
    await expect(page.locator('text=/Summary counts parts of this one security in different sleeves/')).toBeVisible();
  });

  test('flags a stale price in one account', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, session([
      { id: 1, name: 'Brokerage', managed: true, taxStatus: 'taxable', holdings: [holding({ price: 200 })] },
      { id: 2, name: 'Trust', managed: true, taxStatus: 'taxable', holdings: [holding({ price: 150 })] },
    ]));
    await goPositions(page);

    const cells = await row(page, 'AAPL').locator('td').allInnerTexts();
    expect(cells[6]).toBe('mixed');
    // Each lot is still valued at its own price, so the total ties out
    expect(cells[7]).toBe('$35,000');
  });

  test('keeps cash as a household position', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, session([
      {
        id: 1, name: 'Brokerage', managed: true, taxStatus: 'taxable',
        holdings: [
          holding({ ticker: '$$$$', securityName: 'Cash', style: 'Cash', quantity: 1, price: 5000 }),
          holding({ quantity: 10, price: 200 }),
        ],
      },
      {
        id: 2, name: 'IRA', managed: true, taxStatus: 'deferred',
        holdings: [holding({ ticker: '$$$$', securityName: 'Cash', style: 'Cash', quantity: 1, price: 3000 })],
      },
    ]));
    await goPositions(page);

    await expect(stat(page, 'Cash across accounts')).toContainText('$8,000');
    // Cash is a position here, but never the "largest holding" headline
    await expect(stat(page, 'Largest holding')).toContainText('AAPL');
  });

  test('shows an empty state before any holdings exist', async ({ page }) => {
    await boot(page, { quotes: {} });
    await goPositions(page);
    await expect(page.locator('text=Nothing to consolidate yet')).toBeVisible();
  });

  test('leaves the other tabs working', async ({ page }) => {
    await boot(page, { quotes: {} });
    await load(page, APPLE_IN_TWO_ACCOUNTS);
    await goPositions(page);

    // The new tab sits between Securities and Summary; both still resolve
    await page.click('nav button:has-text("Securities")');
    await expect(page.locator('button:has-text("Jay - Taxable Brokerage")')).toHaveCount(1);
    await page.click('nav button:has-text("Summary")');
    await expect(page.locator('h2')).toBeVisible();
  });
});

// Shared fixtures for the end-to-end suite.
//
// Bare `npm run dev` has no /api (those are Vercel serverless functions), so
// every test mocks the quote and lookup endpoints. Tests that want to observe
// a value the app wrote locally pass an empty quote map so nothing overwrites
// it; tests that want live-quote behaviour pass explicit prices.

export const ROW = n => `table tbody tr:nth-child(${n})`;
export const TICKER = n => `${ROW(n)} td:nth-child(2) input`;
export const NAME = n => `${ROW(n)} td:nth-child(3) input`;
export const STYLE = n => `${ROW(n)} td:nth-child(4) select`;
export const QTY = n => `${ROW(n)} td:nth-child(5) input`;
export const PRICE = n => `${ROW(n)} td:nth-child(6) input`;
export const BASIS = n => `${ROW(n)} td:nth-child(8) input[inputmode="decimal"]`;
export const CHANGE = n => `${ROW(n)} td:nth-child(10) input`;

/** Mock /api, collect requests and dialogs, and load the app. */
export async function boot(page, { quotes = {} } = {}) {
  const apiCalls = [];
  const dialogs = [];
  page.on('request', r => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  await page.route('**/api/quotes*', route => {
    const symbols = (new URL(route.request().url()).searchParams.get('symbols') || '')
      .split(',').filter(Boolean);
    const body = {};
    for (const s of symbols) if (quotes[s]) body[s] = quotes[s];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/lookup*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/', { waitUntil: 'networkidle' });
  return { apiCalls, dialogs };
}

export async function setNum(page, selector, value) {
  await page.click(selector);
  await page.fill(selector, String(value));
  await page.keyboard.press('Tab');
}

export async function enterTicker(page, selector, value) {
  await page.click(selector);
  await page.fill(selector, value);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(350);
}

/** Synthesize a real file drag/drop - Playwright cannot drag OS files. */
export async function dropFiles(page, files, { only = 'drop' } = {}) {
  await page.evaluate(({ files, only }) => {
    const dt = new DataTransfer();
    for (const f of files) {
      dt.items.add(new File([f.content], f.name, { type: f.mime || 'text/plain' }));
    }
    const fire = t => document.body.dispatchEvent(
      new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })
    );
    if (only === 'enter') { fire('dragenter'); fire('dragover'); }
    else { fire('dragenter'); fire('dragover'); fire('drop'); }
  }, { files, only });
}

export const CSV_A = [
  '"Positions for account Drop Test Brokerage ...123 as of 07/30/2026"',
  '""',
  '"Symbol","Description","Quantity","Price","Cost Basis"',
  '"VTI","VANGUARD TOTAL STOCK MKT ETF","100","$300.00","$20,000.00"',
  '"VTEB","VANGUARD TAX-EXEMPT BOND ETF","200","$50.00","$9,500.00"',
].join('\n');

export const CSV_IRA = [
  '"Positions for account Angela - Rollover IRA as of 07/30/2026"',
  '""',
  '"Symbol","Description","Quantity","Price","Cost Basis"',
  '"VTI","VANGUARD TOTAL STOCK MKT ETF","100","$300.00","$20,000.00"',
].join('\n');

export const CSV_B = [
  '"Positions for account Second Custodian ...987 as of 07/30/2026"',
  '""',
  '"Symbol","Description","Quantity","Price"',
  '"VOO","VANGUARD S&P 500 ETF","10","$500.00"',
].join('\n');

export const sessionJson = (over = {}) => JSON.stringify({
  version: '1.5',
  assumptions: { clientName: 'Dropped Session Client', asOfDate: '2026-07-30', targetProfile: '75/25' },
  customSecurities: {}, resolvedSecurities: {},
  accounts: [{
    id: 1, name: 'Dropped Acct', managed: true, sweepToCash: false,
    holdings: [{
      ticker: 'VTI', securityName: 'Vanguard Total Stock Market ETF',
      style: 'Domestic Large Blend', quantity: 10, price: 300,
      costBasis: 2000, acquiredDate: '', proposedChange: 0,
    }],
  }],
  ...over,
});

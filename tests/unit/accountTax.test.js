import { describe, it, expect } from 'vitest';
import {
  inferTaxStatus, getTaxStatus, isSheltered, taxStatusLabel, withInferredTaxStatus,
} from '../../src/data/accountTax.js';

describe('inferTaxStatus', () => {
  // Real account names from the Norman household - the case that motivated
  // this whole field.
  it.each([
    ['Angela - Rollover IRA', 'deferred'],
    ['Jay - IQVIA 401(K) Plan', 'deferred'],
    ['Jay - IRA (1919 Advisors)', 'deferred'],
    ['Angela - Revocable Trust (TR-CMAP)', 'taxable'],
    ['Angela - Trust Account', 'taxable'],
    ['Angela - Brokerage Account #0282', 'taxable'],
    ['Jay - E*Trade Restricted Stock', 'taxable'],
    ['Joint - Janus funds *7741', 'taxable'],
  ])('%s -> %s', (name, expected) => {
    expect(inferTaxStatus(name)).toBe(expected);
  });

  it.each([
    ['Jay Roth IRA', 'free'],
    ['Roth 401(k)', 'free'],
    ['Angela ROTH Conversion', 'free'],
    ['Family HSA', 'free'],
    ['Kids 529 Plan', 'free'],
  ])('tax-free wins over tax-deferred: %s -> %s', (name, expected) => {
    expect(inferTaxStatus(name)).toBe(expected);
  });

  it.each([
    ['Traditional IRA', 'deferred'],
    ['SEP IRA', 'deferred'],
    ['SIMPLE IRA', 'deferred'],
    ['403(b) Plan', 'deferred'],
    ['403b Plan', 'deferred'],
    ['401k Rollover', 'deferred'],
    ['457 Deferred Comp', 'deferred'],
    ['Company Pension', 'deferred'],
    ['Profit Sharing Plan', 'deferred'],
    ['Variable Annuity', 'deferred'],
  ])('%s -> %s', (name, expected) => {
    expect(inferTaxStatus(name)).toBe(expected);
  });

  it.each([
    ['', 'taxable'],
    [null, 'taxable'],
    [undefined, 'taxable'],
    ['Account 3', 'taxable'],
    ['Joint WROS', 'taxable'],
    ['Living Trust', 'taxable'],
  ])('defaults to taxable for %s', (name, expected) => {
    expect(inferTaxStatus(name)).toBe(expected);
  });

  // "IRA" must be a whole word - these should NOT be caught
  it.each(['Kiraly Family Trust', 'Miranda Brokerage', 'Admiral Shares Account'])(
    'does not match a substring inside a word: %s',
    (name) => expect(inferTaxStatus(name)).toBe('taxable')
  );
});

describe('getTaxStatus / isSheltered', () => {
  it('normalizes a missing or unknown status to taxable', () => {
    expect(getTaxStatus(undefined)).toBe('taxable');
    expect(getTaxStatus({})).toBe('taxable');
    expect(getTaxStatus({ taxStatus: 'nonsense' })).toBe('taxable');
  });

  it('honours an explicit status', () => {
    expect(getTaxStatus({ taxStatus: 'deferred' })).toBe('deferred');
  });

  it.each([
    ['taxable', false],
    ['deferred', true],
    ['free', true],
  ])('%s sheltered = %s', (taxStatus, expected) => {
    expect(isSheltered({ taxStatus })).toBe(expected);
  });

  it('labels each status', () => {
    expect(taxStatusLabel({ taxStatus: 'taxable' })).toBe('Taxable');
    expect(taxStatusLabel({ taxStatus: 'deferred' })).toBe('Tax-deferred');
    expect(taxStatusLabel({ taxStatus: 'free' })).toBe('Tax-free');
  });
});

describe('withInferredTaxStatus', () => {
  it('fills in a missing status from the name', () => {
    expect(withInferredTaxStatus({ name: 'Angela - Rollover IRA' }).taxStatus).toBe('deferred');
  });

  it('never overwrites an explicit status', () => {
    const account = { name: 'Angela - Rollover IRA', taxStatus: 'taxable' };
    expect(withInferredTaxStatus(account)).toBe(account);
  });

  it('leaves other account fields untouched', () => {
    const result = withInferredTaxStatus({ name: 'Joint Brokerage', id: 7, holdings: [] });
    expect(result).toMatchObject({ id: 7, name: 'Joint Brokerage', taxStatus: 'taxable' });
  });
});

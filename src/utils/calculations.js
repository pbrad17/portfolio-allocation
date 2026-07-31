import { STYLE_TO_CATEGORY, SUMMARY_SECTIONS, TARGET_ROLLUP } from '../data/styleMapping';
import { isSheltered } from '../data/accountTax';

export function getMarketValue(holding) {
  return (holding.quantity || 0) * (holding.price || 0);
}

export function getPostValue(holding) {
  return getMarketValue(holding) + (holding.proposedChange || 0);
}

export function getAccountTotal(holdings) {
  return holdings.reduce((sum, h) => sum + getPostValue(h), 0);
}

// ---------------------------------------------------------------------------
// Cost basis / capital gains
//
// costBasis is the TOTAL dollar basis for the position (not per share) and is
// OPTIONAL: 0/blank means "unknown" — every gain function returns null in
// that case so the UI can render an em-dash instead of a fake $0 gain.
// acquiredDate (ISO string, optional) drives the short/long-term split.
// ---------------------------------------------------------------------------

const CASH_TICKER_RE = /^\$+$/;

export function hasKnownBasis(holding) {
  return (holding.costBasis || 0) > 0;
}

export function getUnrealizedGain(holding) {
  if (!hasKnownBasis(holding)) return null;
  return getMarketValue(holding) - holding.costBasis;
}

// Coerce an as-of value to a local-midnight Date. Accepts a Date or the
// 'YYYY-MM-DD' string the Assumptions tab stores; anything unusable falls back
// to today so a blank as-of date never breaks the gain columns.
export function toAsOfDate(asOf) {
  if (asOf instanceof Date && !isNaN(asOf.getTime())) return asOf;
  if (typeof asOf === 'string' && asOf) {
    const parsed = new Date(asOf + 'T00:00:00');
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// true = long-term (held MORE than 1 year), false = short-term, null =
// unknown date. IRS rule: a sale on or before the one-year anniversary of
// the acquisition date is short-term; long-term starts the day after.
//
// asOf defaults to today but callers should pass the session's as-of date:
// a report run for a past quarter must classify holding periods as of THAT
// date, not as of whenever the PDF happens to be generated.
export function isLongTerm(acquiredDate, asOf = new Date()) {
  if (!acquiredDate) return null;
  const d = new Date(acquiredDate + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const oneYearLater = new Date(d);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  // Compare calendar days, not timestamps — the anniversary day itself is ST
  const asOfRef = toAsOfDate(asOf);
  const asOfDay = new Date(asOfRef.getFullYear(), asOfRef.getMonth(), asOfRef.getDate());
  return asOfDay > oneYearLater;
}

// Estimated realized gain if the proposed sell is executed, using the
// average-cost method: the sold fraction of market value carries the same
// fraction of total basis. Returns null unless this row is a sell
// (proposedChange < 0) with a known basis and positive market value.
export function getRealizedGain(holding, asOf) {
  const mv = getMarketValue(holding);
  const change = holding.proposedChange || 0;
  if (change >= 0 || mv <= 0 || !hasKnownBasis(holding)) return null;
  const fraction = Math.min(1, -change / mv);
  return {
    amount: fraction * (mv - holding.costBasis),
    fraction,
    term: isLongTerm(holding.acquiredDate, asOf), // true LT / false ST / null unknown
  };
}

// Household-level gain rollup across accounts (managed + unmanaged alike —
// capital gains are a tax question, not a management-scope question).
//
// TAX AWARENESS: the top-level realized/unrealized fields keep their original
// meaning (every account, so nothing that already consumes them changes), and
// the summary additionally carries `taxable` and `sheltered` splits. Anything
// presenting a realized figure as a TAX consequence must read `.taxable` —
// a sell inside an IRA or 401(k) realizes nothing the client will ever be
// taxed on, and reporting it as a capital gain is simply wrong.
export function getGainSummary(accounts, asOf) {
  const bucket = () => ({
    unrealized: 0,
    realized: 0,
    realizedLT: 0,
    realizedST: 0,
    realizedUnknownTerm: 0,
    sellCount: 0,
    positionsWithBasis: 0,
  });
  const summary = {
    unrealized: 0,
    positionsWithBasis: 0,
    positionsWithoutBasis: 0, // non-cash positions with value but no basis
    realized: 0,
    realizedLT: 0,
    realizedST: 0,
    realizedUnknownTerm: 0,
    sellCount: 0,
    sellsWithoutBasis: 0, // proposed sells whose gain can't be estimated
    taxable: bucket(),
    sheltered: bucket(),
    shelteredAccountCount: 0,
  };
  for (const acct of accounts) {
    const side = isSheltered(acct) ? summary.sheltered : summary.taxable;
    if (isSheltered(acct)) summary.shelteredAccountCount += 1;
    for (const h of acct.holdings) {
      const isCash = CASH_TICKER_RE.test(h.ticker || '');
      const mv = getMarketValue(h);
      const unrealized = getUnrealizedGain(h);
      if (unrealized != null) {
        summary.unrealized += unrealized;
        summary.positionsWithBasis += 1;
        side.unrealized += unrealized;
        side.positionsWithBasis += 1;
      } else if (!isCash && mv > 0) {
        summary.positionsWithoutBasis += 1;
      }
      const realized = getRealizedGain(h, asOf);
      if (realized != null) {
        summary.realized += realized.amount;
        summary.sellCount += 1;
        side.realized += realized.amount;
        side.sellCount += 1;
        if (realized.term === true) { summary.realizedLT += realized.amount; side.realizedLT += realized.amount; }
        else if (realized.term === false) { summary.realizedST += realized.amount; side.realizedST += realized.amount; }
        else { summary.realizedUnknownTerm += realized.amount; side.realizedUnknownTerm += realized.amount; }
      } else if (!isCash && (h.proposedChange || 0) < 0 && mv > 0 && !hasKnownBasis(h)) {
        summary.sellsWithoutBasis += 1;
      }
    }
  }
  return summary;
}

export function getPortfolioTotal(accounts) {
  return accounts.reduce((sum, acct) => sum + getAccountTotal(acct.holdings), 0);
}

// Sum post values by category for a set of accounts
function getCategoryTotals(accounts, customSecurities) {
  const categoryTotals = {};
  for (const acct of accounts) {
    for (const h of acct.holdings) {
      const postVal = getPostValue(h);
      if (h.style && h.style.startsWith('Custom: ')) {
        const csTicker = h.style.slice(8);
        const cs = customSecurities[csTicker];
        if (cs) {
          for (const [cat, pct] of Object.entries(cs.allocations)) {
            categoryTotals[cat] = (categoryTotals[cat] || 0) + postVal * pct;
          }
        } else {
          categoryTotals['Other Equity'] = (categoryTotals['Other Equity'] || 0) + postVal;
        }
      } else {
        const category = STYLE_TO_CATEGORY[h.style] || 'Other Equity';
        categoryTotals[category] = (categoryTotals[category] || 0) + postVal;
      }
    }
  }
  return categoryTotals;
}

// Portfolio columns / targets / reallocation are computed on the managed
// basis (accounts where managed !== false); Overall columns include every
// account. `total` keeps its old meaning (managed total) for compatibility.
export function getSummaryData(accounts, targetProfile, customSecurities = {}) {
  const managedAccounts = accounts.filter(a => a.managed !== false);
  const total = getPortfolioTotal(managedAccounts);
  const overallTotal = getPortfolioTotal(accounts);

  const categoryTotals = getCategoryTotals(managedAccounts, customSecurities);
  const overallCategoryTotals = getCategoryTotals(accounts, customSecurities);

  const rows = [];
  const allCategories = [
    ...SUMMARY_SECTIONS.Equities,
    ...SUMMARY_SECTIONS['Fixed Income'],
    ...SUMMARY_SECTIONS.Alternatives,
  ];

  for (const cat of allCategories) {
    const portfolioDollar = categoryTotals[cat] || 0;
    const portfolioPct = total > 0 ? portfolioDollar / total : 0;
    const overallDollar = overallCategoryTotals[cat] || 0;
    const overallPct = overallTotal > 0 ? overallDollar / overallTotal : 0;

    // Target rollup: child categories (e.g. Municipal Bonds → Investment
    // Grade) render as INDENTED SUB-ROWS under their parent: they display
    // their own $ / % for visibility but carry no target columns, and the
    // parent row displays the COMBINED position so its Portfolio % reads
    // consistently against its target. Section/grand totals and the pie
    // chart must not double-count: totals skip subRow rows (the parent's
    // combined figures already include them), and the pie uses the own*
    // fields so parent and child appear as separate, non-overlapping slices.
    if (TARGET_ROLLUP[cat]) {
      rows.push({
        category: cat,
        subRow: true,
        portfolioDollar,
        portfolioPct,
        overallDollar,
        overallPct,
        ownPortfolioPct: portfolioPct,
        ownOverallPct: overallPct,
        targetPct: null,
        reallocation: null,
        difference: null,
        rollsInto: TARGET_ROLLUP[cat],
      });
      continue;
    }

    const children = Object.keys(TARGET_ROLLUP).filter(child => TARGET_ROLLUP[child] === cat);
    const combinedDollar = portfolioDollar + children.reduce((s, child) => s + (categoryTotals[child] || 0), 0);
    const combinedPct = total > 0 ? combinedDollar / total : 0;
    const combinedOverallDollar = overallDollar + children.reduce((s, child) => s + (overallCategoryTotals[child] || 0), 0);
    const combinedOverallPct = overallTotal > 0 ? combinedOverallDollar / overallTotal : 0;

    const targetPct = targetProfile[cat] || 0;
    const reallocation = total > 0 ? (targetPct - combinedPct) * total : 0;
    const difference = combinedPct - targetPct;

    rows.push({
      category: cat,
      // Display values: combined when this category has rollup children
      portfolioDollar: children.length > 0 ? combinedDollar : portfolioDollar,
      portfolioPct: children.length > 0 ? combinedPct : portfolioPct,
      overallDollar: children.length > 0 ? combinedOverallDollar : overallDollar,
      overallPct: children.length > 0 ? combinedOverallPct : overallPct,
      // Own-only values (pie chart slices, breakdowns)
      ownPortfolioPct: portfolioPct,
      ownOverallPct: overallPct,
      targetPct,
      reallocation,
      difference,
      ...(children.length > 0 ? { includesRollup: children } : {}),
    });
  }

  return { rows, total, overallTotal };
}

export function getSectionTotal(rows, categories) {
  return categories.reduce(
    (acc, cat) => {
      const row = rows.find(r => r.category === cat);
      // Sub-rows are already inside their parent's combined figures —
      // adding them again would double-count
      if (row && !row.subRow) {
        acc.portfolioDollar += row.portfolioDollar;
        acc.portfolioPct += row.portfolioPct;
        acc.overallDollar += row.overallDollar;
        acc.overallPct += row.overallPct;
        acc.targetPct += row.targetPct;
        acc.reallocation += row.reallocation;
        acc.difference += row.difference;
      }
      return acc;
    },
    { portfolioDollar: 0, portfolioPct: 0, overallDollar: 0, overallPct: 0, targetPct: 0, reallocation: 0, difference: 0 }
  );
}

export function getCapitalizationData(accounts, targetProfile) {
  const total = getPortfolioTotal(accounts);

  const domesticPrefix = 'Domestic';
  const foreignPrefix = 'Foreign';
  const caps = ['Large', 'Mid', 'Small'];
  const vgStyles = ['Value', 'Growth'];

  // All styles including Blend (for aggregation)
  const allStylesFor = (prefix) => caps.flatMap(cap =>
    ['Value', 'Blend', 'Growth'].map(s => `${prefix} ${cap} ${s}`)
  );
  // Output styles (Value/Growth only, 6 rows)
  const outputStylesFor = (prefix) => caps.flatMap(cap =>
    vgStyles.map(s => `${prefix} ${cap} ${s}`)
  );

  const domesticAllStyles = allStylesFor(domesticPrefix);
  const foreignAllStyles = allStylesFor(foreignPrefix);
  const domesticOutputStyles = outputStylesFor(domesticPrefix);
  const foreignOutputStyles = outputStylesFor(foreignPrefix);

  function calcSection(allStyles, outputStyles, sectionTarget) {
    const currentByStyle = {};
    const postByStyle = {};

    for (const acct of accounts) {
      for (const h of acct.holdings) {
        if (allStyles.includes(h.style)) {
          currentByStyle[h.style] = (currentByStyle[h.style] || 0) + getMarketValue(h);
          postByStyle[h.style] = (postByStyle[h.style] || 0) + getPostValue(h);
        }
      }
    }

    // Split Blend 50/50 into Value and Growth
    const prefix = allStyles[0].split(' ')[0]; // Domestic or Foreign
    for (const cap of caps) {
      const blendKey = `${prefix} ${cap} Blend`;
      const valueKey = `${prefix} ${cap} Value`;
      const growthKey = `${prefix} ${cap} Growth`;
      const blendCurrent = currentByStyle[blendKey] || 0;
      const blendPost = postByStyle[blendKey] || 0;
      if (blendCurrent || blendPost) {
        currentByStyle[valueKey] = (currentByStyle[valueKey] || 0) + blendCurrent / 2;
        currentByStyle[growthKey] = (currentByStyle[growthKey] || 0) + blendCurrent / 2;
        postByStyle[valueKey] = (postByStyle[valueKey] || 0) + blendPost / 2;
        postByStyle[growthKey] = (postByStyle[growthKey] || 0) + blendPost / 2;
      }
    }

    const currentTotal = outputStyles.reduce((s, st) => s + (currentByStyle[st] || 0), 0);
    const postTotal = outputStyles.reduce((s, st) => s + (postByStyle[st] || 0), 0);

    // Cap split: Large 50%, Mid 30%, Small 20%
    // Within each: Value 60%, Growth 40% — reflects the March 2026 model's
    // dedicated value sleeves (22% of domestic equity, 20% of foreign;
    // core All Cap counted 50/50 ≈ 61/39 & 60/40, advisor rounded both to
    // 60/40 on 2026-07-29)
    const capSplit = { Large: 0.5, Mid: 0.3, Small: 0.2 };
    const styleSplit = { Value: 0.6, Growth: 0.4 };

    const rows = outputStyles.map(style => {
      const parts = style.split(' ');
      const cap = parts[1]; // Large/Mid/Small
      const valStyle = parts[2]; // Value/Growth
      const targetPct = sectionTarget * capSplit[cap] * styleSplit[valStyle];

      const currentDollar = currentByStyle[style] || 0;
      const postDollar = postByStyle[style] || 0;
      const currentPct = total > 0 ? currentDollar / total : 0;
      const postPct = total > 0 ? postDollar / total : 0;
      const difference = postPct - targetPct;

      return {
        style: style.replace('Domestic ', '').replace('Foreign ', ''),
        fullStyle: style,
        currentDollar,
        currentPct,
        changeDollar: postDollar - currentDollar,
        postDollar,
        postPct,
        targetPct,
        difference,
      };
    });

    return {
      rows,
      currentTotal,
      postTotal,
      changeTotal: postTotal - currentTotal,
      currentTotalPct: total > 0 ? currentTotal / total : 0,
      postTotalPct: total > 0 ? postTotal / total : 0,
      targetTotalPct: sectionTarget,
    };
  }

  const domesticTarget = targetProfile['Domestic'] || 0;
  const foreignTarget = targetProfile['Foreign'] || 0;

  const domestic = calcSection(domesticAllStyles, domesticOutputStyles, domesticTarget);
  const foreign = calcSection(foreignAllStyles, foreignOutputStyles, foreignTarget);

  // Recompute all percentages relative to total equity (not full portfolio)
  const currentEquityTotal = domestic.currentTotal + foreign.currentTotal;
  const postEquityTotal = domestic.postTotal + foreign.postTotal;
  const equityTargetTotal = domesticTarget + foreignTarget;

  function applyEquityPcts(section, sectionTarget) {
    // Keep in sync with calcSection above (60/40 Value/Growth per the
    // March 2026 model's value tilt)
    const capSplit = { Large: 0.5, Mid: 0.3, Small: 0.2 };
    const styleSplit = { Value: 0.6, Growth: 0.4 };

    for (const row of section.rows) {
      const parts = row.fullStyle.split(' ');
      const cap = parts[1];
      const valStyle = parts[2];
      row.currentPct = currentEquityTotal > 0 ? row.currentDollar / currentEquityTotal : 0;
      row.postPct = postEquityTotal > 0 ? row.postDollar / postEquityTotal : 0;
      row.targetPct = equityTargetTotal > 0
        ? (sectionTarget / equityTargetTotal) * capSplit[cap] * styleSplit[valStyle]
        : 0;
      row.difference = row.postPct - row.targetPct;
    }
    section.currentTotalPct = currentEquityTotal > 0 ? section.currentTotal / currentEquityTotal : 0;
    section.postTotalPct = postEquityTotal > 0 ? section.postTotal / postEquityTotal : 0;
    section.targetTotalPct = equityTargetTotal > 0 ? sectionTarget / equityTargetTotal : 0;
  }

  applyEquityPcts(domestic, domesticTarget);
  applyEquityPcts(foreign, foreignTarget);

  // Combined
  const combinedRows = domestic.rows.map((dRow, i) => {
    const fRow = foreign.rows[i];
    const currentDollar = dRow.currentDollar + fRow.currentDollar;
    const postDollar = dRow.postDollar + fRow.postDollar;
    const currentPct = dRow.currentPct + fRow.currentPct;
    const postPct = dRow.postPct + fRow.postPct;
    const targetPct = dRow.targetPct + fRow.targetPct;
    return {
      style: dRow.style,
      currentDollar,
      currentPct,
      changeDollar: dRow.changeDollar + fRow.changeDollar,
      postDollar,
      postPct,
      targetPct,
      difference: postPct - targetPct,
    };
  });

  const combined = {
    rows: combinedRows,
    currentTotal: domestic.currentTotal + foreign.currentTotal,
    postTotal: domestic.postTotal + foreign.postTotal,
    changeTotal: domestic.changeTotal + foreign.changeTotal,
    currentTotalPct: domestic.currentTotalPct + foreign.currentTotalPct,
    postTotalPct: domestic.postTotalPct + foreign.postTotalPct,
    targetTotalPct: equityTargetTotal > 0 ? 1 : 0,
  };

  return { domestic, foreign, combined, portfolioTotal: total };
}

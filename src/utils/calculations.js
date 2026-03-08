import { STYLE_TO_CATEGORY, SUMMARY_SECTIONS } from '../data/styleMapping';

export function getMarketValue(holding) {
  return (holding.quantity || 0) * (holding.price || 0);
}

export function getPostValue(holding) {
  return getMarketValue(holding) + (holding.proposedChange || 0);
}

export function getAccountTotal(holdings) {
  return holdings.reduce((sum, h) => sum + getPostValue(h), 0);
}

export function getPortfolioTotal(accounts) {
  return accounts.reduce((sum, acct) => sum + getAccountTotal(acct.holdings), 0);
}

export function getSummaryData(accounts, targetProfile) {
  const total = getPortfolioTotal(accounts);
  const categoryTotals = {};

  // Sum post values by category
  for (const acct of accounts) {
    for (const h of acct.holdings) {
      const category = STYLE_TO_CATEGORY[h.style] || 'Other Equity';
      const postVal = getPostValue(h);
      categoryTotals[category] = (categoryTotals[category] || 0) + postVal;
    }
  }

  const rows = [];
  const allCategories = [
    ...SUMMARY_SECTIONS.Equities,
    ...SUMMARY_SECTIONS['Fixed Income'],
    ...SUMMARY_SECTIONS.Alternatives,
  ];

  for (const cat of allCategories) {
    const portfolioDollar = categoryTotals[cat] || 0;
    const portfolioPct = total > 0 ? portfolioDollar / total : 0;
    const targetPct = targetProfile[cat] || 0;
    const reallocation = total > 0 ? (targetPct - portfolioPct) * total : 0;
    const difference = portfolioPct - targetPct;

    rows.push({
      category: cat,
      portfolioDollar,
      portfolioPct,
      targetPct,
      reallocation,
      difference,
    });
  }

  return { rows, total };
}

export function getSectionTotal(rows, categories) {
  return categories.reduce(
    (acc, cat) => {
      const row = rows.find(r => r.category === cat);
      if (row) {
        acc.portfolioDollar += row.portfolioDollar;
        acc.portfolioPct += row.portfolioPct;
        acc.targetPct += row.targetPct;
        acc.reallocation += row.reallocation;
        acc.difference += row.difference;
      }
      return acc;
    },
    { portfolioDollar: 0, portfolioPct: 0, targetPct: 0, reallocation: 0, difference: 0 }
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
    // Within each: Value 50%, Growth 50%
    const capSplit = { Large: 0.5, Mid: 0.3, Small: 0.2 };
    const styleSplit = { Value: 0.5, Growth: 0.5 };

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
    targetTotalPct: domesticTarget + foreignTarget,
  };

  return { domestic, foreign, combined, portfolioTotal: total };
}

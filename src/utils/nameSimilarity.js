// Fuzzy comparison of security names — used by the database audit and the
// price-refresh name-mismatch alerts to decide whether a stored name and a
// live (Yahoo) name plausibly refer to the same security.

const STOP_TOKENS = new Set([
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc',
  'sa', 'ag', 'nv', 'se', 'adr', 'the', 'fund', 'etf', 'index', 'class',
  'shares', 'share', 'institutional', 'portfolio', 'group', 'holdings',
  'holding', 'trust', 'admiral', 'investor', 'instl', 'i', 'ii', 'iii',
  'of', 'and',
]);

// Normalize a security name to a Set of meaningful tokens:
// lowercase, '&' → 'and', non-alphanumerics become separators, stop tokens dropped.
export function norm(name) {
  if (!name) return new Set();
  const tokens = String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics: Møller → Moller, Société → Societe
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t && !STOP_TOKENS.has(t));
  return new Set(tokens);
}

// Token-overlap similarity: |A ∩ B| / min(|A|, |B|).
// If either name normalizes to nothing, there's no evidence of a mismatch → 1.
export function nameSimilarity(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (A.size === 0 || B.size === 0) return 1;
  let intersection = 0;
  for (const token of A) {
    if (B.has(token)) intersection++;
  }
  return intersection / Math.min(A.size, B.size);
}

// Below this, a stored name and a live name are considered a mismatch.
export const SIMILARITY_THRESHOLD = 0.5;

export function formatCurrency(value) {
  if (value == null || isNaN(value)) return '$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  return sign + '$' + abs.toLocaleString('en-US');
}

export function formatPercent(value) {
  if (value == null || isNaN(value)) return '0.0%';
  return (value * 100).toFixed(1) + '%';
}

export function formatQuantity(value) {
  if (value == null || isNaN(value)) return '0.00';
  return Number(value).toFixed(2);
}

export function formatPrice(value) {
  if (value == null || isNaN(value)) return '0.00';
  return Number(value).toFixed(2);
}

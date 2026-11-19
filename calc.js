(function(root) {
  'use strict';
  // Exact decimal arithmetic; round half up at the selected quote precision.
  function decimal(value) {
    const text = String(value ?? '').trim();
    if (!/^(?:\d{1,12}(?:\.\d{0,6})?|\.\d{1,6})$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    return { n: BigInt((whole || '0') + fraction), d: 10n ** BigInt(fraction.length) };
  }
  function positive(value) { const v = decimal(value); return Boolean(v && v.n > 0n); }
  function precisionFor(category) {
    if (category === 'solar') return 3;
    if (['battery','inverter','accessory'].includes(category)) return 0;
    return 2;
  }
  function round(n, d) { return (n * 2n + d) / (d * 2n); }
  function factor(value) {
    const p = decimal(value); if (!p) return null;
    const digits = (p.d * 100n).toString().length - 1;
    const raw = (p.d * 100n + p.n).toString().padStart(digits + 1, '0');
    const whole = raw.slice(0, -digits), fraction = raw.slice(-digits).replace(/0+$/, '').padEnd(2, '0');
    return whole + '.' + fraction;
  }
  function calculate(cost, rate, profit, mode, precision = 2) {
    const c = decimal(cost), r = decimal(rate), p = decimal(profit);
    if (!c || !r || !p || r.n <= 0n || !['direct','tax'].includes(mode)) return null;
    let n = c.n * r.d * (100n * p.d + p.n) * (10n ** BigInt(precision)), d = c.d * r.n * p.d * 100n;
    if (mode === 'tax') { n *= 100n; d *= 113n; }
    return round(n, d);
  }
  function money(units, grouping = true, precision = 2) {
    const n = BigInt(units), scale = 10n ** BigInt(precision); const whole = (n / scale).toString();
    return (grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole) + (precision ? '.' + (n % scale).toString().padStart(precision, '0') : '');
  }
  function panelAmount(quoteUnits, watts) {
    const w = decimal(watts);
    if (quoteUnits === null || !w || w.n <= 0n) return null;
    // Use the displayed per-watt quote so the visible multiplication reconciles.
    return round(BigInt(quoteUnits) * w.n, w.d);
  }
  function lineCost(cost, watts = '1') {
    const c = decimal(cost), w = decimal(watts);
    if (!c || !w || w.n <= 0n) return null;
    return round(c.n * w.n * 100n, c.d * w.d);
  }
  function sumCosts(values) {
    let total = 0n;
    for (const v of values) { const d = decimal(v); if (d) total += d.n * (1000000n / d.d); }
    return round(total * 100n, 1000000n);
  }
  const api = { decimal, positive, precisionFor, factor, calculate, money, sumCosts, panelAmount, lineCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuoteMath = api;
})(globalThis);

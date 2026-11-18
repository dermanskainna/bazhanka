export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function money(amount, currency = 'UAH') {
  if (amount === null || amount === undefined) return '';
  const symbol = { UAH: '₴', USD: '$', EUR: '€', PLN: 'zł', GBP: '£' }[currency] || currency + ' ';
  const n = Number(amount).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
  return currency === 'UAH' || currency === 'PLN' ? `${n} ${symbol}` : `${symbol}${n}`;
}

export function niceDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

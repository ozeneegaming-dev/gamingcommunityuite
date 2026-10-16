/**
 * Sumele donațiilor pe ecran (server și browser): subunitățile în moneda lor, cu simbolul scurt al limbii („640 lei”,
 * „25,50 €”); zecimalele apar doar când suma nu e întreagă.
 */
function moneyFormat(amount: number, currency: string, locale: string): Intl.NumberFormat {
  const digits = amount % 100 === 0 ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  return moneyFormat(amount, currency, locale).format(amount / 100);
}

/** Doar numărul (fără monedă), cu zecimale doar când e cazul. */
export function formatAmount(amount: number, locale: string): string {
  const digits = amount % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount / 100);
}

/**
 * Progresul „640 / 1.000 lei”: când simbolul monedei stă după număr, apare o singură dată, la țintă; când stă înainte
 * („€640 / €1,000”), apare la ambele sume.
 */
export function formatProgress(raised: number, target: number, currency: string, locale: string): string {
  const parts = moneyFormat(target, currency, locale).formatToParts(target / 100);
  const symbolFirst = parts.findIndex((p) => p.type === "currency") < parts.findIndex((p) => p.type === "integer");
  return `${symbolFirst ? formatMoney(raised, currency, locale) : formatAmount(raised, locale)} / ${formatMoney(target, currency, locale)}`;
}

export function money(n: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function num(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n || 0);
}

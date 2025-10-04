export function formatCurrencyFromCents(valueInCents: number): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

  return formatter.format(valueInCents / 100);
}

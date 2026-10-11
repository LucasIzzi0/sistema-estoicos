/**
 * Dinero en centavos de ARS (enteros). En la base es BigInt; en JSON viaja como número entero
 * (seguro hasta 2^53 centavos). Nunca se usan decimales para calcular.
 */

/** "15.000", "15000,50", "$ 1.234.567,8" → centavos. Devuelve null si no es un monto válido. */
export function parsePesosToCents(input: string): number | null {
  const clean = input.replace(/\$|\s/g, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(clean)) return null;
  const [intPart = '0', decPart = ''] = clean.replace(/\./g, '').split(',');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

const pesosFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 1500000 → "$ 15.000"; 1500050 → "$ 15.000,5". */
export function formatCents(cents: number | bigint): string {
  const value = typeof cents === 'bigint' ? Number(cents) : cents;
  return pesosFormatter.format(value / 100);
}

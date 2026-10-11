import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Normaliza un celular al formato E.164 que usa WhatsApp (+549…).
 *
 * En Argentina la gente escribe su celular sin el 9 ni el 15 ("11 2233-4455"), que formalmente
 * es una línea fija. Como este campo siempre es "celular / WhatsApp", un número argentino de
 * 10 dígitos se interpreta como celular y se le agrega el 9.
 * Devuelve null si no es un celular válido (por ejemplo, si falta la característica).
 */
export function normalizeMobilePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, 'AR');
  if (!parsed || !parsed.isValid()) return null;

  const type = parsed.getType();
  if (type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE') return parsed.number;

  if (parsed.country === 'AR' && type === 'FIXED_LINE') {
    const asMobile = parsePhoneNumberFromString(`+549${parsed.nationalNumber}`);
    if (asMobile?.isValid() && asMobile.getType() === 'MOBILE') return asMobile.number;
  }
  return null;
}

/** "+5491122334455" → "+54 9 11 2233-4455". */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

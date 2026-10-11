/** "Martín  GÓMEZ" → "martin gomez": sin acentos, minúsculas y espacios simples. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto buscable de un cliente: nombre, email, dígitos del celular y DNI. */
export function customerSearchText(c: {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  dni?: string | null;
}): string {
  return normalizeSearchText(
    [c.firstName, c.lastName, c.email ?? '', (c.phone ?? '').replace(/\D/g, ''), c.dni ?? ''].join(' '),
  );
}

/**
 * Convierte lo que escribe el usuario en términos de búsqueda. Si parece un teléfono o DNI
 * ("11 2233-4455", "30.111.222") se busca por sus dígitos; si no, por cada palabra.
 */
export function searchTerms(query: string): string[] {
  const compact = query.replace(/[\s.\-()+]/g, '');
  const digits = compact.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length === compact.length) {
    // Teléfonos: los últimos 8 dígitos alcanzan (evita problemas con 0, 15, 54 y 9).
    return [digits.length > 8 ? digits.slice(-8) : digits];
  }
  return normalizeSearchText(query)
    .split(' ')
    .filter((t) => t.length > 0)
    .slice(0, 5);
}

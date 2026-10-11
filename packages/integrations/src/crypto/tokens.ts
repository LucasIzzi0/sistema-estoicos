import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Token aleatorio en base64url (32 bytes = 256 bits por defecto). Para sesiones y links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Código numérico de un solo uso (ej. "048213"), generado con un RNG criptográfico. */
export function numericCode(length = 6): string {
  return randomInt(0, 10 ** length)
    .toString()
    .padStart(length, '0');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Comparación en tiempo constante (evita filtrar información por tiempos de respuesta). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

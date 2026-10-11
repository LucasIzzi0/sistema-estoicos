import argon2 from 'argon2';

/** Parámetros argon2id recomendados por OWASP (19 MiB, 2 iteraciones, 1 hilo). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifica contra un hash descartable. Se usa cuando el email no existe, para que la respuesta
 * tarde lo mismo y no revele qué emails están registrados.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('no-es-una-contraseña-real');
  await verifyPassword(await dummyHash, password);
}

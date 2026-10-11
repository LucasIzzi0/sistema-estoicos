import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEncryptor } from './crypto/encryption';
import { hashPassword, verifyPassword } from './crypto/passwords';
import { hmacSha256Hex, numericCode, randomToken, safeEqual } from './crypto/tokens';

const key = () => randomBytes(32).toString('base64');

describe('cifrado de secretos', () => {
  it('cifra y descifra, y el texto cifrado no contiene el original', () => {
    const enc = createEncryptor(key());
    const secret = 'APP_USR-1234567890-token-de-mercado-pago';
    const payload = enc.encrypt(secret);
    expect(payload).not.toContain(secret);
    expect(payload.startsWith('enc1.')).toBe(true);
    expect(enc.decrypt(payload)).toBe(secret);
  });
  it('dos cifrados del mismo texto son distintos (IV aleatorio)', () => {
    const enc = createEncryptor(key());
    expect(enc.encrypt('x')).not.toBe(enc.encrypt('x'));
  });
  it('rotación: lo cifrado con la clave anterior se sigue pudiendo leer', () => {
    const oldKey = key();
    const payload = createEncryptor(oldKey).encrypt('dato');
    expect(createEncryptor(key(), oldKey).decrypt(payload)).toBe('dato');
    expect(() => createEncryptor(key()).decrypt(payload)).toThrow();
  });
  it('detecta alteraciones', () => {
    const enc = createEncryptor(key());
    const parts = enc.encrypt('dato').split('.');
    parts[4] = Buffer.from('otro').toString('base64url');
    expect(() => enc.decrypt(parts.join('.'))).toThrow();
  });
});

describe('tokens y códigos', () => {
  it('genera códigos de 6 dígitos', () => {
    for (let i = 0; i < 200; i++) expect(numericCode()).toMatch(/^\d{6}$/);
  });
  it('genera tokens únicos', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });
  it('compara en tiempo constante', () => {
    const h = hmacSha256Hex('secreto', 'abc');
    expect(safeEqual(h, hmacSha256Hex('secreto', 'abc'))).toBe(true);
    expect(safeEqual(h, hmacSha256Hex('secreto', 'abd'))).toBe(false);
    expect(safeEqual(h, 'corto')).toBe(false);
  });
});

describe('contraseñas', () => {
  it('usa argon2id y verifica', async () => {
    const hash = await hashPassword('una contraseña larga');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'una contraseña larga')).toBe(true);
    expect(await verifyPassword(hash, 'otra')).toBe(false);
    expect(await verifyPassword('no-es-un-hash', 'x')).toBe(false);
  });
});

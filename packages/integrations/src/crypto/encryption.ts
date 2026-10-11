import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado de secretos de terceros en la base (tokens de Mercado Pago, etc.): AES-256-GCM.
 * Formato: "enc1.<huella de la clave>.<iv>.<tag>.<texto cifrado>" (base64url).
 * La huella permite rotar la clave: se cifra con la actual y se descifra con cualquiera
 * de las configuradas (actual o anterior).
 */
export interface Encryptor {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

interface Key {
  fingerprint: string;
  bytes: Buffer;
}

function parseKey(base64: string): Key {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes en base64');
  return { bytes, fingerprint: createHash('sha256').update(bytes).digest('hex').slice(0, 8) };
}

export function createEncryptor(currentKeyBase64: string, previousKeyBase64?: string): Encryptor {
  const current = parseKey(currentKeyBase64);
  const keys = [current, ...(previousKeyBase64 ? [parseKey(previousKeyBase64)] : [])];

  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current.bytes, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return ['enc1', current.fingerprint, iv, tag, ciphertext]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },
    decrypt(payload) {
      const [version, fingerprint, iv, tag, ciphertext] = payload.split('.');
      if (version !== 'enc1' || !fingerprint || !iv || !tag || !ciphertext) {
        throw new Error('Formato de dato cifrado inválido');
      }
      const key = keys.find((k) => k.fingerprint === fingerprint);
      if (!key) throw new Error('No hay una clave configurada para descifrar este dato');
      const decipher = createDecipheriv('aes-256-gcm', key.bytes, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

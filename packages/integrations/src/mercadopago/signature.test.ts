import { describe, expect, it } from 'vitest';
import { buildSignedManifest, parseSignatureHeader, signManifest, verifyWebhookSignature } from './signature';

const SECRET = 'clave-secreta-de-webhooks-de-prueba';

function header(input: { dataId?: string; requestId?: string; ts?: string; secret?: string }) {
  const ts = input.ts ?? '1704908010';
  const manifest = buildSignedManifest({ dataId: input.dataId, requestId: input.requestId, ts });
  return `ts=${ts},v1=${signManifest(manifest, input.secret ?? SECRET)}`;
}

describe('manifiesto firmado', () => {
  it('arma el texto en el orden documentado', () => {
    expect(buildSignedManifest({ dataId: '123456', requestId: 'req-1', ts: '10' })).toBe(
      'id:123456;request-id:req-1;ts:10;',
    );
  });

  it('un id alfanumérico va en minúsculas; uno numérico queda igual', () => {
    expect(buildSignedManifest({ dataId: 'ORD01ABC', ts: '10' })).toBe('id:ord01abc;ts:10;');
    expect(buildSignedManifest({ dataId: '99', ts: '10' })).toBe('id:99;ts:10;');
  });

  it('omite los tramos que no vienen', () => {
    expect(buildSignedManifest({ ts: '10' })).toBe('ts:10;');
    expect(buildSignedManifest({ requestId: 'req-1', ts: '10' })).toBe('request-id:req-1;ts:10;');
  });
});

describe('parseo del header x-signature', () => {
  it('lee ts y v1, con o sin espacios', () => {
    expect(parseSignatureHeader('ts=1,v1=abc')).toEqual({ ts: '1', v1: 'abc' });
    expect(parseSignatureHeader(' ts=1 , v1=abc ')).toEqual({ ts: '1', v1: 'abc' });
  });

  it('devuelve null si falta algo', () => {
    expect(parseSignatureHeader(undefined)).toBeNull();
    expect(parseSignatureHeader('v1=abc')).toBeNull();
    expect(parseSignatureHeader('ts=1')).toBeNull();
    expect(parseSignatureHeader('cualquier cosa')).toBeNull();
  });
});

describe('verificación de la firma', () => {
  const base = { dataId: '123456', requestId: 'req-1', secret: SECRET };

  it('acepta una firma válida', () => {
    expect(
      verifyWebhookSignature({ ...base, signatureHeader: header({ dataId: '123456', requestId: 'req-1' }) }),
    ).toBe(true);
  });

  it('rechaza una firma alterada', () => {
    const valid = header({ dataId: '123456', requestId: 'req-1' });
    const tampered = valid.slice(0, -1) + (valid.at(-1) === 'a' ? 'b' : 'a');
    expect(verifyWebhookSignature({ ...base, signatureHeader: tampered })).toBe(false);
  });

  it('rechaza si cambia el id, el request-id o el ts', () => {
    const valid = header({ dataId: '123456', requestId: 'req-1' });
    expect(verifyWebhookSignature({ ...base, dataId: '999', signatureHeader: valid })).toBe(false);
    expect(verifyWebhookSignature({ ...base, requestId: 'otro', signatureHeader: valid })).toBe(false);
    expect(
      verifyWebhookSignature({ ...base, signatureHeader: valid.replace('ts=1704908010', 'ts=1704908011') }),
    ).toBe(false);
  });

  it('rechaza sin header y con un header basura', () => {
    expect(verifyWebhookSignature({ ...base, signatureHeader: undefined })).toBe(false);
    expect(verifyWebhookSignature({ ...base, signatureHeader: 'ts=1,v1=' })).toBe(false);
    expect(verifyWebhookSignature({ ...base, signatureHeader: 'ts=1,v1=deadbeef' })).toBe(false);
  });

  it('rechaza una firma hecha con otra clave', () => {
    const otra = header({ dataId: '123456', requestId: 'req-1', secret: 'otra-clave' });
    expect(verifyWebhookSignature({ ...base, signatureHeader: otra })).toBe(false);
  });

  it('funciona con id alfanumérico de orden (Point) en cualquier capitalización', () => {
    const firmado = header({ dataId: 'ORD0123456789', requestId: 'req-2' });
    expect(
      verifyWebhookSignature({
        dataId: 'ORD0123456789',
        requestId: 'req-2',
        secret: SECRET,
        signatureHeader: firmado,
      }),
    ).toBe(true);
    // MP puede mandarlo con otra capitalización en la query: igual valida.
    expect(
      verifyWebhookSignature({
        dataId: 'ord0123456789',
        requestId: 'req-2',
        secret: SECRET,
        signatureHeader: firmado,
      }),
    ).toBe(true);
  });

  it('acepta un ts viejo: MP reintenta y descartarlo perdería pagos', () => {
    const viejo = header({ dataId: '123456', requestId: 'req-1', ts: '1000000000' });
    expect(verifyWebhookSignature({ ...base, signatureHeader: viejo })).toBe(true);
  });
});

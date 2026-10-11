import { describe, expect, it } from 'vitest';
import {
  chooseChannel,
  fallbackChannel,
  inQuietHours,
  type ChannelAvailability,
  type RecipientState,
} from './router';

const consents = (granted: { channel: 'EMAIL' | 'WHATSAPP'; scope: 'TRANSACTIONAL' | 'MARKETING' }[]) =>
  granted.map((g) => ({ ...g, granted: true }));

const ALL = consents([
  { channel: 'EMAIL', scope: 'TRANSACTIONAL' },
  { channel: 'WHATSAPP', scope: 'TRANSACTIONAL' },
  { channel: 'EMAIL', scope: 'MARKETING' },
  { channel: 'WHATSAPP', scope: 'MARKETING' },
]);

const customer = (over: Partial<RecipientState> = {}): RecipientState => ({
  email: 'cliente@example.com',
  phone: '+5491122334455',
  preferredChannel: 'WHATSAPP',
  emailBouncedAt: null,
  whatsappUnreachableAt: null,
  consents: ALL,
  ...over,
});

const available = (over: Partial<ChannelAvailability> = {}): ChannelAvailability => ({
  whatsappEnabled: true,
  whatsappTemplate: 'recordatorio_turno',
  // Sin mensajes de marketing de 21:00 a 09:00.
  quiet: { startMinute: 1260, endMinute: 540 },
  nowMinute: 15 * 60,
  ...over,
});

describe('franja sin marketing', () => {
  it('reconoce la franja aunque cruce la medianoche', () => {
    const quiet = { startMinute: 1260, endMinute: 540 };
    expect(inQuietHours(quiet, 22 * 60)).toBe(true);
    expect(inQuietHours(quiet, 3 * 60)).toBe(true);
    expect(inQuietHours(quiet, 8 * 60 + 59)).toBe(true);
    expect(inQuietHours(quiet, 9 * 60)).toBe(false);
    expect(inQuietHours(quiet, 15 * 60)).toBe(false);
  });
});

describe('elección de canal', () => {
  it('con todo en orden, va por WhatsApp con su plantilla', () => {
    expect(chooseChannel('BOOKING_REMINDER', customer(), available())).toEqual({
      send: true,
      channel: 'WHATSAPP',
      templateName: 'recordatorio_turno',
    });
  });

  it('respeta la preferencia del cliente', () => {
    expect(
      chooseChannel('BOOKING_REMINDER', customer({ preferredChannel: 'EMAIL' }), available()),
    ).toMatchObject({
      channel: 'EMAIL',
    });
  });

  it('sin plantilla aprobada o con WhatsApp apagado, sale por email', () => {
    expect(
      chooseChannel('BOOKING_REMINDER', customer(), available({ whatsappTemplate: null })),
    ).toMatchObject({
      channel: 'EMAIL',
    });
    expect(
      chooseChannel('BOOKING_REMINDER', customer(), available({ whatsappEnabled: false })),
    ).toMatchObject({
      channel: 'EMAIL',
    });
  });

  it('un número sin WhatsApp pasa a email', () => {
    expect(
      chooseChannel('BOOKING_REMINDER', customer({ whatsappUnreachableAt: new Date() }), available()),
    ).toMatchObject({ channel: 'EMAIL' });
  });

  it('un email que rebotó no se vuelve a usar', () => {
    const bounced = customer({ emailBouncedAt: new Date(), preferredChannel: 'EMAIL' });
    expect(chooseChannel('BOOKING_REMINDER', bounced, available())).toMatchObject({ channel: 'WHATSAPP' });
    expect(
      chooseChannel('BOOKING_REMINDER', { ...bounced, whatsappUnreachableAt: new Date() }, available()),
    ).toEqual({ send: false, reason: 'El email rebotó' });
  });

  it('sin consentimiento no se manda nada', () => {
    const noConsent = customer({ consents: [] });
    expect(chooseChannel('BOOKING_REMINDER', noConsent, available())).toEqual({
      send: false,
      reason: 'No acepta avisos de turnos',
    });
    expect(chooseChannel('REVIEW_REQUEST', noConsent, available())).toEqual({
      send: false,
      reason: 'No acepta promociones',
    });
  });

  it('el consentimiento es por canal: solo email transaccional → email', () => {
    const soloEmail = customer({ consents: consents([{ channel: 'EMAIL', scope: 'TRANSACTIONAL' }]) });
    expect(chooseChannel('BOOKING_REMINDER', soloEmail, available())).toMatchObject({ channel: 'EMAIL' });
    expect(chooseChannel('REACTIVATION', soloEmail, available())).toEqual({
      send: false,
      reason: 'No acepta promociones',
    });
  });

  it('el marketing respeta la franja; lo transaccional no', () => {
    const night = available({ nowMinute: 23 * 60 });
    expect(chooseChannel('REVIEW_REQUEST', customer(), night)).toEqual({
      send: false,
      reason: 'Franja sin mensajes de marketing',
    });
    expect(chooseChannel('REACTIVATION', customer(), night)).toMatchObject({ send: false });
    // Un recordatorio de turno sí sale de noche.
    expect(chooseChannel('BOOKING_REMINDER', customer(), night)).toMatchObject({ send: true });
  });

  it('el código de login va siempre por email, sin importar preferencias ni consentimientos', () => {
    expect(
      chooseChannel('LOGIN_CODE', customer({ consents: [], preferredChannel: 'WHATSAPP' }), available()),
    ).toEqual({
      send: true,
      channel: 'EMAIL',
      templateName: null,
    });
    expect(chooseChannel('LOGIN_CODE', customer({ email: null }), available())).toEqual({
      send: false,
      reason: 'Sin email',
    });
  });

  it('sin email ni celular no hay a dónde mandar', () => {
    expect(chooseChannel('BOOKING_REMINDER', customer({ email: null, phone: null }), available())).toEqual({
      send: false,
      reason: 'Sin email ni celular',
    });
  });
});

describe('fallback cuando WhatsApp falla', () => {
  it('cae a email si el cliente lo acepta', () => {
    expect(fallbackChannel('BOOKING_REMINDER', customer())).toEqual({ channel: 'EMAIL' });
  });

  it('no cae a email si rebotó o si no lo acepta', () => {
    expect(fallbackChannel('BOOKING_REMINDER', customer({ emailBouncedAt: new Date() }))).toBeNull();
    expect(fallbackChannel('BOOKING_REMINDER', customer({ consents: [] }))).toBeNull();
    expect(fallbackChannel('BOOKING_REMINDER', customer({ email: null }))).toBeNull();
  });
});

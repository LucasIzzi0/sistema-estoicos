import { describe, expect, it } from 'vitest';
import { customerProfileBody, emailSchema } from './contracts';
import { formatCents, parsePesosToCents } from './money';
import { accessLevelOf, hasPermission, PERMISSIONS } from './permissions';
import { normalizeMobilePhone } from './phone';

describe('dinero', () => {
  it('convierte pesos escritos a la argentina en centavos', () => {
    expect(parsePesosToCents('15.000')).toBe(1_500_000);
    expect(parsePesosToCents('$ 15.000,50')).toBe(1_500_050);
    expect(parsePesosToCents('15000,5')).toBe(1_500_050);
    expect(parsePesosToCents('1.234.567')).toBe(123_456_700);
  });
  it('rechaza montos inválidos', () => {
    expect(parsePesosToCents('15,000.00')).toBeNull();
    expect(parsePesosToCents('abc')).toBeNull();
    expect(parsePesosToCents('1,234')).toBeNull();
  });
  it('formatea centavos como pesos', () => {
    expect(formatCents(1_500_000).replace(/\s/g, ' ')).toBe('$ 15.000');
    expect(formatCents(1_500_050n).replace(/\s/g, ' ')).toBe('$ 15.000,5');
  });
});

describe('teléfonos argentinos', () => {
  it('normaliza celulares a E.164 con el 9', () => {
    expect(normalizeMobilePhone('11 2233-4455')).toBe('+5491122334455');
    expect(normalizeMobilePhone('011 15 2233-4455')).toBe('+5491122334455');
    expect(normalizeMobilePhone('+54 9 11 2233-4455')).toBe('+5491122334455');
    expect(normalizeMobilePhone('351 15 555-1234')).toBe('+5493515551234');
  });
  it('interpreta como celular un número de 10 dígitos escrito sin el 9', () => {
    expect(normalizeMobilePhone('3515551234')).toBe('+5493515551234');
    expect(normalizeMobilePhone('+54 11 2233-4455')).toBe('+5491122334455');
  });
  it('rechaza números inválidos o sin característica', () => {
    expect(normalizeMobilePhone('123')).toBeNull();
    expect(normalizeMobilePhone('hola')).toBeNull();
    expect(normalizeMobilePhone('15 2233-4455')).toBeNull();
  });
  it('el contrato de perfil devuelve el teléfono normalizado', () => {
    const parsed = customerProfileBody.parse({
      firstName: ' Martín ',
      lastName: 'Gómez',
      phone: '11 2233-4455',
      acceptTransactional: true,
      acceptMarketing: false,
    });
    expect(parsed.phone).toBe('+5491122334455');
    expect(parsed.firstName).toBe('Martín');
    expect(parsed.preferredChannel).toBe('WHATSAPP');
  });
});

describe('email', () => {
  it('normaliza a minúsculas y sin espacios', () => {
    expect(emailSchema.parse('  Martin@Example.COM ')).toBe('martin@example.com');
  });
});

describe('permisos', () => {
  it('deriva el nivel de acceso de la membresía', () => {
    expect(accessLevelOf('ADMIN', true)).toBe('OWNER');
    expect(accessLevelOf('ADMIN', false)).toBe('BRANCH_ADMIN');
    expect(accessLevelOf('RECEPTION', false)).toBe('RECEPTION');
  });
  it('recepción atiende (agenda, clientes, cobro) pero no ve finanzas ni configuración', () => {
    expect(hasPermission('RECEPTION', 'appointments:manage')).toBe(true);
    expect(hasPermission('RECEPTION', 'customers:create')).toBe(true);
    expect(hasPermission('RECEPTION', 'sales:charge')).toBe(true);
    expect(hasPermission('RECEPTION', 'cash:close')).toBe(false);
    expect(hasPermission('RECEPTION', 'commissions:read')).toBe(false);
    expect(hasPermission('RECEPTION', 'reports:view')).toBe(false);
    expect(hasPermission('RECEPTION', 'dashboard:view')).toBe(false);
  });
  it('el encargado no toca la configuración global ni Mercado Pago', () => {
    expect(hasPermission('BRANCH_ADMIN', 'org:settings')).toBe(false);
    expect(hasPermission('BRANCH_ADMIN', 'mercadopago:connect')).toBe(false);
    expect(hasPermission('BRANCH_ADMIN', 'catalog:manage')).toBe(false);
    expect(hasPermission('BRANCH_ADMIN', 'catalog:branch-prices')).toBe(true);
    expect(hasPermission('BRANCH_ADMIN', 'mercadopago:reconcile')).toBe(true);
  });
  it('el dueño tiene todos los permisos', () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(hasPermission('OWNER', permission)).toBe(true);
    }
  });
});

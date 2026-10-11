/**
 * Datos de ejemplo para desarrollo y staging: 1 organización, 1 sucursal, 1 dueño, 2 barberos,
 * servicios, productos, clientes, categorías de egresos y recompensas.
 * Idempotente: se puede correr varias veces sin duplicar. Se niega a correr en producción.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { createDb } from '../client';
import type { NotificationType, PrismaClient } from '../generated/prisma/client';
// El seed es solo de desarrollo: puede usar las utilidades compartidas.
import { customerSearchText } from '@estoicos/shared';

loadEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const ORG_SLUG = process.env.DEFAULT_ORGANIZATION_SLUG ?? 'estoicos';
const pesos = (n: number) => BigInt(Math.round(n * 100));

const NOTIFICATION_TYPES: NotificationType[] = [
  'LOGIN_CODE',
  'BOOKING_CONFIRMATION',
  'BOOKING_REMINDER',
  'BOOKING_RESCHEDULED',
  'BOOKING_CANCELLATION',
  'DEPOSIT_PAYMENT_LINK',
  'DEPOSIT_REFUNDED',
  'POINTS_CREDITED',
  'REWARD_AVAILABLE',
  'REACTIVATION',
  'REVIEW_REQUEST',
  'STAFF_INVITATION',
  'STAFF_PASSWORD_RESET',
  'STAFF_SECOND_FACTOR',
];

async function hash(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

/** Horario del local (29/09/2026): martes a sábado, de 11 a 20. Domingo y lunes cerrado. */
const DIAS_QUE_ABRE = [2, 3, 4, 5, 6];
const ABRE = 11 * 60;
const CIERRA = 20 * 60;

export async function seed(db: PrismaClient, options: { adminEmail: string; adminPassword: string }) {
  // --- Organización y sucursal ---
  const org = await db.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { name: 'Estoicos', slug: ORG_SLUG },
    update: {},
  });
  await db.organizationSettings.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id },
    update: {},
  });
  // Datos reales del local. El `slug` es el de la URL pública de reservas y no se cambia:
  // /reservar/principal ya está impreso y compartido.
  const datosDelLocal = {
    name: 'Sucursal Principal Freire',
    address: 'Ramón Freire 2411',
    city: 'Belgrano, CABA',
    province: 'Ciudad Autónoma de Buenos Aires',
  };
  const branch = await db.branch.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'principal' } },
    create: { organizationId: org.id, slug: 'principal', ...datosDelLocal },
    update: datosDelLocal,
  });

  // --- Staff: dueño y dos barberos ---
  const owner = await db.user.upsert({
    where: { email: options.adminEmail },
    create: {
      email: options.adminEmail,
      name: 'Dueño Estoicos',
      passwordHash: await hash(options.adminPassword),
      emailVerifiedAt: new Date(),
    },
    update: {},
  });
  await db.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    create: { userId: owner.id, organizationId: org.id, role: 'ADMIN', allBranches: true },
    update: {},
  });

  // Barberos: perfiles SIN acceso al sistema (decisión del 25/09/2026).
  const barberDefs = [
    { display: 'Juan', color: '#8a1f2d', service: 5000, product: 1000 },
    { display: 'Pedro', color: '#8c6a2e', service: 4500, product: 1000 },
  ];
  const barberIds: string[] = [];
  for (const def of barberDefs) {
    const barber =
      (await db.barber.findFirst({ where: { organizationId: org.id, displayName: def.display } })) ??
      (await db.barber.create({
        data: {
          organizationId: org.id,
          displayName: def.display,
          color: def.color,
          serviceCommissionBps: def.service,
          productCommissionBps: def.product,
          branches: { create: [{ branchId: branch.id }] },
        },
      }));
    barberIds.push(barber.id);

    // Horario real del local: martes a sábado de 11 a 20. Domingo y lunes, descanso.
    // (Puede estirarse un poco si cae alguien a última hora; eso se maneja a mano en la agenda.)
    await db.barberSchedule.deleteMany({ where: { barberId: barber.id } });
    await db.barberSchedule.createMany({
      data: DIAS_QUE_ABRE.map((weekday) => ({
        barberId: barber.id,
        branchId: branch.id,
        weekday,
        startMinute: ABRE,
        endMinute: CIERRA,
      })),
    });
  }

  // --- Servicios ---
  const categories: Record<string, string> = {};
  for (const [i, name] of ['Cortes', 'Barba', 'Rituales'].entries()) {
    const cat = await db.serviceCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      create: { organizationId: org.id, name, sortOrder: i },
      update: {},
    });
    categories[name] = cat.id;
  }
  // Catálogo real de la barbería (lista de precios del local, 29/09/2026).
  // Todos los turnos ocupan una hora: es lo que tarda como máximo cualquier servicio, así el
  // que sigue nunca espera. Si un barbero termina antes, el horario libre se ve en la agenda.
  const TURNO = 60;
  const services = [
    {
      name: 'Corte',
      category: 'Cortes',
      duration: TURNO,
      price: 25000,
      description: 'Incluye el perfilado de cejas.',
    },
    { name: 'Barba', category: 'Barba', duration: TURNO, price: 15000 },
    { name: 'Corte y barba', category: 'Cortes', duration: TURNO, price: 28000 },
    {
      name: 'Toalla caliente',
      category: 'Rituales',
      duration: TURNO,
      price: 35000,
      description: 'Corte, arreglo de barba y perfilado, con toalla caliente.',
    },
    // Vale lo mismo que el de adulto; se carga aparte solo para saber cuántos son.
    { name: 'Corte niño', category: 'Cortes', duration: TURNO, price: 25000 },
  ];
  /** El perfilado va incluido en el corte, y el viejo combo lo reemplaza "Corte y barba". */
  const retirados = ['Perfilado de cejas', 'Corte + Barba'];
  for (const [i, s] of services.entries()) {
    const existing = await db.service.findFirst({ where: { organizationId: org.id, name: s.name } });
    const data = {
      categoryId: categories[s.category],
      name: s.name,
      durationMin: s.duration,
      basePriceCents: pesos(s.price),
      description: 'description' in s ? s.description : null,
      sortOrder: i,
      active: true,
      archivedAt: null,
    };
    const service = existing
      ? await db.service.update({ where: { id: existing.id }, data })
      : await db.service.create({ data: { organizationId: org.id, ...data } });
    await db.branchService.upsert({
      where: { branchId_serviceId: { branchId: branch.id, serviceId: service.id } },
      create: { branchId: branch.id, serviceId: service.id },
      update: {},
    });
    for (const barberId of barberIds) {
      await db.barberService.upsert({
        where: { barberId_serviceId: { barberId, serviceId: service.id } },
        create: { barberId, serviceId: service.id },
        update: {},
      });
    }
  }
  await db.service.updateMany({
    where: { organizationId: org.id, name: { in: retirados }, archivedAt: null },
    data: { archivedAt: new Date(), active: false },
  });

  // --- Productos y stock inicial ---
  const productCategory = await db.productCategory.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Cuidado personal' } },
    create: { organizationId: org.id, name: 'Cuidado personal' },
    update: {},
  });
  const products = [
    { sku: 'CERA-MATE', name: 'Cera mate', price: 12000, cost: 6500, stock: 12 },
    { sku: 'POMADA-BRILLO', name: 'Pomada brillo', price: 12500, cost: 6800, stock: 8 },
    { sku: 'SHAMPOO', name: 'Shampoo', price: 9500, cost: 4800, stock: 10 },
    { sku: 'ACEITE-BARBA', name: 'Aceite para barba', price: 11000, cost: 5500, stock: 6 },
  ];
  for (const p of products) {
    const product = await db.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: p.sku } },
      create: {
        organizationId: org.id,
        categoryId: productCategory.id,
        sku: p.sku,
        name: p.name,
        basePriceCents: pesos(p.price),
        costCents: pesos(p.cost),
      },
      update: {},
    });
    const bp = await db.branchProduct.findUnique({
      where: { branchId_productId: { branchId: branch.id, productId: product.id } },
    });
    if (!bp) {
      await db.$transaction([
        db.branchProduct.create({
          data: { branchId: branch.id, productId: product.id, stockOnHand: p.stock, minStock: 3 },
        }),
        db.stockMovement.create({
          data: {
            organizationId: org.id,
            branchId: branch.id,
            productId: product.id,
            type: 'INITIAL',
            quantity: p.stock,
            balanceAfter: p.stock,
            unitCostCents: pesos(p.cost),
            reason: 'Stock inicial (seed)',
            createdById: owner.id,
          },
        }),
      ]);
    }
  }

  // --- Clientes con consentimiento registrado ---
  const customers = [
    ['Martín', 'Gómez', 'martin.gomez@example.com', '+5491122334455', '30111222'],
    ['Lucas', 'Fernández', 'lucas.fernandez@example.com', '+5491133445566', null],
    ['Tomás', 'Rodríguez', 'tomas.rodriguez@example.com', '+5491144556677', '35123456'],
    ['Nicolás', 'López', null, '+5491155667788', null],
    ['Federico', 'Martínez', 'fede.martinez@example.com', '+5493515551234', null],
    ['Santiago', 'García', 'santi.garcia@example.com', '+5491166778899', '40222333'],
  ] as const;
  for (const [firstName, lastName, email, phone, dni] of customers) {
    const exists = await db.customer.findFirst({ where: { organizationId: org.id, phone, firstName } });
    if (exists) continue;
    await db.customer.create({
      data: {
        organizationId: org.id,
        firstName,
        lastName,
        email,
        phone,
        dni,
        searchText: customerSearchText({ firstName, lastName, email, phone, dni }),
        source: 'IN_STORE',
        homeBranchId: branch.id,
        createdById: owner.id,
        consents: {
          create: [
            { channel: 'WHATSAPP', scope: 'TRANSACTIONAL', granted: true },
            { channel: 'EMAIL', scope: 'TRANSACTIONAL', granted: true },
            { channel: 'WHATSAPP', scope: 'MARKETING', granted: firstName !== 'Tomás' },
            { channel: 'EMAIL', scope: 'MARKETING', granted: firstName !== 'Tomás' },
          ],
        },
        consentEvents: {
          create: (['WHATSAPP', 'EMAIL'] as const).flatMap((channel) => [
            {
              channel,
              scope: 'TRANSACTIONAL' as const,
              granted: true,
              source: 'IMPORT' as const,
              policyVersion: '2026-09-v1',
              recordedById: owner.id,
            },
            {
              channel,
              scope: 'MARKETING' as const,
              granted: firstName !== 'Tomás',
              source: 'IMPORT' as const,
              policyVersion: '2026-09-v1',
              recordedById: owner.id,
            },
          ]),
        },
      },
    });
  }

  // Completa el texto de búsqueda de clientes cargados antes de que existiera la columna.
  const withoutSearch = await db.customer.findMany({ where: { organizationId: org.id, searchText: '' } });
  for (const c of withoutSearch) {
    await db.customer.update({ where: { id: c.id }, data: { searchText: customerSearchText(c) } });
  }

  // --- Categorías de egresos ---
  const expenseCategories: [string, string | null][] = [
    ['Insumos', null],
    ['Alquiler', null],
    ['Sueldos', null],
    ['Comisiones', 'COMMISSIONS'],
    ['Servicios (luz, gas, internet)', null],
    ['Impuestos', null],
    ['Otros', null],
  ];
  for (const [i, [name, systemKey]] of expenseCategories.entries()) {
    await db.expenseCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      create: { organizationId: org.id, name, systemKey, sortOrder: i },
      update: {},
    });
  }

  // --- Recompensas (decisión del 28/09/2026: corte gratis cada 8 cortes) ---
  // Con 1 punto cada $1.000 y el corte a $25.000, un corte da 25 puntos: 8 cortes = 200 puntos.
  // La barba ($15.000) sigue el mismo criterio: 8 barbas = 120 puntos.
  const corte = await db.service.findFirstOrThrow({ where: { organizationId: org.id, name: 'Corte' } });
  const barba = await db.service.findFirstOrThrow({ where: { organizationId: org.id, name: 'Barba' } });
  const cera = await db.product.findFirstOrThrow({ where: { organizationId: org.id, sku: 'CERA-MATE' } });
  const rewards = [
    { name: 'Corte gratis', type: 'FREE_SERVICE' as const, pointsCost: 200, serviceId: corte.id, sortOrder: 1 },
    { name: 'Barba gratis', type: 'FREE_SERVICE' as const, pointsCost: 120, serviceId: barba.id, sortOrder: 2 },
    {
      name: '20 % de descuento',
      type: 'PERCENT_DISCOUNT' as const,
      pointsCost: 40,
      discountPercentBps: 2000,
      sortOrder: 3,
    },
    { name: 'Cera mate de regalo', type: 'FREE_PRODUCT' as const, pointsCost: 96, productId: cera.id, sortOrder: 4 },
  ];
  for (const r of rewards) {
    const exists = await db.reward.findFirst({ where: { organizationId: org.id, name: r.name } });
    if (exists) await db.reward.update({ where: { id: exists.id }, data: r });
    else await db.reward.create({ data: { organizationId: org.id, ...r } });
  }

  // --- Configuración de notificaciones (sin plantillas de WhatsApp todavía: sale por email) ---
  for (const type of NOTIFICATION_TYPES) {
    await db.notificationTypeSetting.upsert({
      where: { organizationId_type: { organizationId: org.id, type } },
      create: { organizationId: org.id, type },
      update: {},
    });
  }

  return { organizationId: org.id, branchId: branch.id, ownerId: owner.id, barberIds };
}

async function main() {
  if (process.env.APP_ENV === 'production') {
    throw new Error('El seed no se corre en producción.');
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error('Faltan SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD');

  const db = createDb();
  try {
    const result = await seed(db, { adminEmail: adminEmail.toLowerCase(), adminPassword });
    console.info('Seed listo:', result);
    console.info(`Dueño: ${adminEmail}. Los barberos (Juan y Pedro) son perfiles sin acceso al sistema.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

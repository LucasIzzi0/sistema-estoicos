import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from './generated/prisma/client';

export type Db = PrismaClient;

/** Cliente dentro de una transacción interactiva (`db.$transaction(async (tx) => …)`). */
export type Tx = Prisma.TransactionClient;

/**
 * Crea un cliente de Prisma (Prisma 7 exige un driver adapter).
 * Cada proceso (api, worker, tests) crea el suyo y lo cierra al apagarse.
 *
 * La sesión de Postgres se fuerza a UTC: el adapter envía las fechas como hora UTC sin zona, y
 * si el servidor tuviera otra zona (ej. un Postgres local con la del sistema) las guardaría
 * corridas. Las fechas locales de cada sucursal se calculan en la app con su zona IANA.
 */
export function createDb(databaseUrl: string = requireDatabaseUrl()): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, options: '-c TimeZone=UTC' });
  return new PrismaClient({ adapter });
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta la variable DATABASE_URL');
  return url;
}

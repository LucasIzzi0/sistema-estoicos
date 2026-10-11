import { config as loadEnv } from 'dotenv';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Aplica las migraciones en la base de tests antes de correr la suite. */
export default function setup() {
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('Falta DATABASE_URL_TEST para los tests de integración');
  execSync('pnpm --filter @estoicos/db exec prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}

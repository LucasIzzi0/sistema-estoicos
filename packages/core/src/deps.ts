import type { Db } from '@estoicos/db';
import type { Encryptor, Mailer, MercadoPago, WhatsApp } from '@estoicos/integrations';

export interface CoreConfig {
  /** Clave del HMAC de los códigos de login (AUTH_CODE_SECRET). */
  authCodeSecret: string;
  /** URL pública de la web, para links en emails. */
  appPublicUrl: string;
  emailReplyTo?: string | undefined;
}

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

/** Dependencias que reciben los servicios del core (las arma la API o el worker). */
export interface CoreDeps {
  db: Db;
  mailer: Mailer;
  /** Cifra y descifra los secretos de terceros guardados en la base (tokens de Mercado Pago). */
  encryptor: Encryptor;
  /**
   * Fábrica del cliente de Mercado Pago. Se inyecta en los tests (y mientras no haya
   * credenciales) para usar el simulador; si no está, se usa el cliente HTTP real.
   */
  mercadoPago?: (input: { accessToken: string; liveMode: boolean }) => MercadoPago;
  /** Canal de WhatsApp. Sin él, todo sale por email (es el estado hasta tener número aprobado). */
  whatsapp?: WhatsApp;
  config: CoreConfig;
  log: Logger;
  /** Reloj inyectable para tests. */
  now: () => Date;
  /**
   * Avisa al worker que hay notificaciones nuevas (encola por id). Es opcional: si falla o no
   * está, el despachador periódico del worker las encuentra igual en la bandeja de salida.
   */
  dispatchNotifications?: (ids: string[]) => Promise<void>;
}

/** Datos del pedido HTTP que se guardan en sesiones, códigos y auditoría. */
export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

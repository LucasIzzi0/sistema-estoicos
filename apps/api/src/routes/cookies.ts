import type { FastifyReply } from 'fastify';
import type { ApiConfig } from '../config';

/**
 * Cookie de sesión: HttpOnly, SameSite=Lax y, fuera de desarrollo, Secure con prefijo __Host-
 * (atada al dominio de la web, sin Domain). Solo viaja el token; en la base está su hash.
 */
export function setSessionCookie(
  reply: FastifyReply,
  config: ApiConfig,
  name: string,
  token: string,
  days: number,
) {
  reply.setCookie(name, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: days * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: ApiConfig, name: string) {
  reply.clearCookie(name, { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' });
}

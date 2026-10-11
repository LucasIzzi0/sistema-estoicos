/**
 * Nombres de las cookies de sesión (las setea la API). En staging y producción llevan el
 * prefijo __Host- y son Secure; en desarrollo no, porque se trabaja sobre http://localhost.
 */
const secure = process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';

export const SESSION_COOKIES = secure
  ? { staff: '__Host-est_staff', customer: '__Host-est_client' }
  : { staff: 'est_staff', customer: 'est_client' };

/** Preferencia de UI (no es sesión): sucursal elegida en el selector. */
export const BRANCH_COOKIE = 'est_branch';

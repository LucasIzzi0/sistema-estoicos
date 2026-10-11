/**
 * Emails de acceso (Fase 1) y de turnos (Fase 3, en booking-emails.ts). HTML simple a propósito:
 * texto claro, sin imágenes ni seguimiento (mejor entregabilidad).
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function layout(orgName: string, bodyHtml: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f3f4f5;font-family:Arial,Helvetica,sans-serif;color:#16181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:8px;border:1px solid #d8dde1">
<tr><td style="padding:24px 28px 8px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8a1f2d;font-weight:bold">${escapeHtml(orgName)}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:16px;line-height:1.5">${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#8a1f2d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#5a6168">Si el botón no funciona, copiá este link en el navegador:<br>${escapeHtml(url)}</p>`;
}

export function loginCodeEmail(p: { orgName: string; code: string; minutes: number }): RenderedEmail {
  return {
    subject: `Tu código para ingresar: ${p.code}`,
    text: `Tu código para ingresar a ${p.orgName} es ${p.code}.\n\nVence en ${p.minutes} minutos. Si no lo pediste, ignorá este email.`,
    html: layout(
      p.orgName,
      `<p>Tu código para ingresar es:</p>
<p style="font-size:34px;letter-spacing:.3em;font-weight:bold;margin:16px 0">${escapeHtml(p.code)}</p>
<p>Vence en ${p.minutes} minutos. Si no lo pediste, ignorá este email.</p>`,
    ),
  };
}

export function secondFactorEmail(p: { orgName: string; code: string; minutes: number }): RenderedEmail {
  return {
    subject: `Código de verificación: ${p.code}`,
    text: `Tu código de verificación para el panel de ${p.orgName} es ${p.code}.\n\nVence en ${p.minutes} minutos. Si no fuiste vos, cambiá tu contraseña.`,
    html: layout(
      p.orgName,
      `<p>Tu código de verificación para ingresar al panel es:</p>
<p style="font-size:34px;letter-spacing:.3em;font-weight:bold;margin:16px 0">${escapeHtml(p.code)}</p>
<p>Vence en ${p.minutes} minutos. Si no fuiste vos, cambiá tu contraseña.</p>`,
    ),
  };
}

export function staffInvitationEmail(p: {
  orgName: string;
  name: string;
  invitedBy: string;
  link: string;
  hours: number;
}): RenderedEmail {
  return {
    subject: `${p.invitedBy} te invitó al sistema de ${p.orgName}`,
    text: `Hola ${p.name}:\n\n${p.invitedBy} te invitó al sistema de ${p.orgName}. Definí tu contraseña en este link:\n${p.link}\n\nEl link vence en ${p.hours} horas.`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.name)}:</p>
<p>${escapeHtml(p.invitedBy)} te invitó al sistema de ${escapeHtml(p.orgName)}. Para entrar, definí tu contraseña.</p>
${button(p.link, 'Definir mi contraseña')}
<p style="font-size:13px;color:#5a6168">El link vence en ${p.hours} horas.</p>`,
    ),
  };
}

export function passwordResetEmail(p: {
  orgName: string;
  name: string;
  link: string;
  minutes: number;
}): RenderedEmail {
  return {
    subject: 'Cambiá tu contraseña',
    text: `Hola ${p.name}:\n\nPara elegir una contraseña nueva entrá a este link:\n${p.link}\n\nVence en ${p.minutes} minutos. Si no lo pediste, ignorá este email: tu contraseña sigue igual.`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.name)}:</p>
<p>Recibimos un pedido para cambiar tu contraseña.</p>
${button(p.link, 'Elegir contraseña nueva')}
<p style="font-size:13px;color:#5a6168">Vence en ${p.minutes} minutos. Si no lo pediste, ignorá este email: tu contraseña sigue igual.</p>`,
    ),
  };
}

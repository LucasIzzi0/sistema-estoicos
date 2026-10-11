import { formatCents } from '@estoicos/shared';
import { button, escapeHtml, layout, type RenderedEmail } from './templates';

/**
 * Emails de turnos: confirmación, reprogramación y cancelación. Se arman desde el `payload`
 * guardado en la notificación (una foto del turno al momento del hecho), así un reintento
 * manda exactamente lo mismo.
 */
export interface BookingEmailPayload {
  orgName: string;
  customerFirstName: string;
  branchName: string;
  branchAddress: string | null;
  barberName: string;
  services: string[];
  startsAt: string;
  endsAt: string;
  timezone: string;
  totalCents: number;
  previousStartsAt?: string | null;
  /** Link a "Mis turnos" (cancelar o reprogramar). */
  manageUrl: string;
  /** Link a la página de reservas de la sucursal. */
  bookingUrl: string;
}

function when(iso: string, timezone: string): string {
  const d = new Date(iso);
  const day = d
    .toLocaleDateString('es-AR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', '');
  const time = d.toLocaleTimeString('es-AR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} a las ${time}`;
}

/** Link "Agregar a Google Calendar" (no requiere adjuntos). */
function calendarUrl(p: BookingEmailPayload): string {
  const fmt = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${p.services.join(' + ')} en ${p.orgName}`,
    dates: `${fmt(p.startsAt)}/${fmt(p.endsAt)}`,
    details: `Con ${p.barberName}. Para cancelar o cambiar el horario: ${p.manageUrl}`,
    location: [p.branchName, p.branchAddress].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function summaryRows(p: BookingEmailPayload): { text: string; html: string } {
  const rows: [string, string][] = [
    ['Cuándo', when(p.startsAt, p.timezone)],
    ['Servicio', p.services.join(' + ')],
    ['Barbero', p.barberName],
    ['Dónde', [p.branchName, p.branchAddress].filter(Boolean).join(' · ')],
    ['Precio', formatCents(p.totalCents)],
  ];
  return {
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:15px">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#5a6168;vertical-align:top">${k}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(v)}</td></tr>`,
      )
      .join('')}</table>`,
  };
}

export function bookingConfirmationEmail(p: BookingEmailPayload): RenderedEmail {
  const s = summaryRows(p);
  return {
    subject: `Turno confirmado: ${when(p.startsAt, p.timezone)}`,
    text: `Hola ${p.customerFirstName}:\n\nTu turno en ${p.orgName} quedó reservado.\n\n${s.text}\n\nSi no podés venir, cancelalo o cambiá el horario desde ${p.manageUrl}\n\nAgregalo a tu calendario: ${calendarUrl(p)}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>Tu turno quedó <strong>reservado</strong>.</p>
${s.html}
${button(p.manageUrl, 'Ver o cambiar mi turno')}
<p style="font-size:14px"><a href="${escapeHtml(calendarUrl(p))}" style="color:#8a1f2d">Agregar a Google Calendar</a></p>
<p style="font-size:13px;color:#5a6168">Si no podés venir, avisanos cancelando desde el link: así otro cliente puede usar el horario.</p>`,
    ),
  };
}

export function bookingRescheduledEmail(p: BookingEmailPayload): RenderedEmail {
  const s = summaryRows(p);
  const before = p.previousStartsAt ? `Antes era el ${when(p.previousStartsAt, p.timezone)}.` : '';
  return {
    subject: `Cambió tu turno: ${when(p.startsAt, p.timezone)}`,
    text: `Hola ${p.customerFirstName}:\n\nTu turno en ${p.orgName} cambió de horario. ${before}\n\n${s.text}\n\nVer o cambiar tu turno: ${p.manageUrl}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>Tu turno <strong>cambió de horario</strong>. ${escapeHtml(before)}</p>
${s.html}
${button(p.manageUrl, 'Ver mi turno')}
<p style="font-size:14px"><a href="${escapeHtml(calendarUrl(p))}" style="color:#8a1f2d">Agregar a Google Calendar</a></p>`,
    ),
  };
}

export function bookingCancellationEmail(p: BookingEmailPayload): RenderedEmail {
  const whenText = when(p.startsAt, p.timezone);
  return {
    subject: `Turno cancelado: ${whenText}`,
    text: `Hola ${p.customerFirstName}:\n\nTu turno del ${whenText} con ${p.barberName} en ${p.branchName} quedó cancelado.\n\nCuando quieras, reservá otro en ${p.bookingUrl}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>Tu turno del <strong>${escapeHtml(whenText)}</strong> con ${escapeHtml(p.barberName)} en ${escapeHtml(p.branchName)} quedó <strong>cancelado</strong>.</p>
${button(p.bookingUrl, 'Reservar otro turno')}`,
    ),
  };
}

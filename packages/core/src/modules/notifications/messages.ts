import type { NotificationType } from '@estoicos/db';
import { formatCents } from '@estoicos/shared';
import {
  bookingCancellationEmail,
  bookingConfirmationEmail,
  bookingRescheduledEmail,
  type BookingEmailPayload,
} from './booking-emails';
import { button, escapeHtml, layout, type RenderedEmail } from './templates';

/**
 * Los mensajes se arman desde el `payload` guardado con la notificación (una foto del hecho al
 * momento en que pasó), así un reintento manda exactamente lo mismo y el historial es fiel.
 *
 * Cada tipo tiene su versión por email y sus variables para la plantilla de WhatsApp. Las
 * plantillas de Meta van con variables posicionales: **el orden importa** y está documentado
 * en la pantalla de Notificaciones para copiarlo al crearlas.
 */
export interface ReminderPayload extends BookingEmailPayload {
  /** 1440 = 24 h antes, 120 = 2 h antes. */
  minutesBefore: number;
  confirmUrl: string;
  cancelUrl: string;
  /** Token firmado del turno: lo usan los botones de WhatsApp y los links del email. */
  confirmToken: string;
  cancelToken: string;
}

export interface ReviewPayload {
  orgName: string;
  customerFirstName: string;
  branchName: string;
  barberName: string;
  reviewUrl: string | null;
  unsubscribeUrl: string;
}

export interface ReactivationPayload {
  orgName: string;
  customerFirstName: string;
  branchName: string;
  branchSlug: string;
  weeksAway: number;
  bookingUrl: string;
  unsubscribeUrl: string;
}

export interface PointsPayload {
  orgName: string;
  customerFirstName: string;
  points: number;
  balance: number;
  /** La recompensa más cercana que ya puede canjear (si llegó a alguna). */
  unlockedReward: string | null;
  nextReward: { name: string; missing: number } | null;
  pointsUrl: string;
}

export type NotificationPayload =
  | (BookingEmailPayload & { appPublicUrl?: string })
  | (ReminderPayload & { appPublicUrl?: string })
  | (ReviewPayload & { appPublicUrl?: string })
  | (ReactivationPayload & { appPublicUrl?: string })
  | (PointsPayload & { appPublicUrl?: string });

/** Fecha y hora en palabras: "martes 13 de octubre a las 10:00". */
export function whenText(iso: string, timezone: string): string {
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

function reminderEmail(p: ReminderPayload): RenderedEmail {
  const when = whenText(p.startsAt, p.timezone);
  const soon = p.minutesBefore <= 180;
  const intro = soon ? `Te esperamos hoy ${when.split(' a las ')[1]} hs.` : `Te esperamos ${when}.`;
  return {
    subject: soon ? `Tu turno es hoy a las ${when.split(' a las ')[1]}` : `Recordatorio: tu turno es ${when}`,
    text: `Hola ${p.customerFirstName}:\n\n${intro}\n\n${p.services.join(' + ')} con ${p.barberName} en ${p.branchName}.\n\n¿Venís? Confirmá acá: ${p.confirmUrl}\n¿No podés? Cancelá acá y liberás el horario: ${p.cancelUrl}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>${escapeHtml(intro)}</p>
<p><strong>${escapeHtml(p.services.join(' + '))}</strong> con ${escapeHtml(p.barberName)} en ${escapeHtml(p.branchName)}.</p>
${button(p.confirmUrl, 'Confirmo que voy')}
<p style="font-size:14px">¿No podés venir? <a href="${escapeHtml(p.cancelUrl)}" style="color:#8a1f2d">Cancelá el turno</a> y le dejás el lugar a otra persona.</p>`,
    ),
  };
}

function reviewEmail(p: ReviewPayload): RenderedEmail {
  const cta = p.reviewUrl
    ? button(p.reviewUrl, 'Dejar mi reseña')
    : '<p>Respondenos este mail y contanos cómo te fue.</p>';
  return {
    subject: '¿Cómo quedaste?',
    text: `Hola ${p.customerFirstName}:\n\nGracias por venir a ${p.orgName}. Si te gustó cómo quedaste, ¿nos dejás una reseña? Nos ayuda muchísimo.\n${p.reviewUrl ?? ''}\n\nPara no recibir más estos mensajes: ${p.unsubscribeUrl}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>Gracias por venir. Si te gustó cómo quedaste, ¿nos dejás una reseña? Nos ayuda muchísimo a que más gente nos encuentre.</p>
${cta}
<p style="font-size:12px;color:#8a9099">Si no querés recibir más estos mensajes, <a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#8a9099">cancelá acá</a>.</p>`,
    ),
  };
}

function reactivationEmail(p: ReactivationPayload): RenderedEmail {
  return {
    subject: 'Te estamos esperando',
    text: `Hola ${p.customerFirstName}:\n\nHace ${p.weeksAway} semanas que no te vemos por ${p.branchName}. Cuando quieras, reservá tu turno: ${p.bookingUrl}\n\nPara no recibir más estos mensajes: ${p.unsubscribeUrl}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>Hace ${p.weeksAway} semanas que no te vemos. Cuando quieras, tu lugar está.</p>
${button(p.bookingUrl, 'Reservar mi turno')}
<p style="font-size:12px;color:#8a9099">Si no querés recibir más estos mensajes, <a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#8a9099">cancelá acá</a>.</p>`,
    ),
  };
}

function pointsEmail(p: PointsPayload): RenderedEmail {
  const unlocked = p.unlockedReward
    ? `<p><strong>¡Ya podés canjear: ${escapeHtml(p.unlockedReward)}!</strong> Pedilo la próxima vez que vengas.</p>`
    : p.nextReward
      ? `<p>Te faltan <strong>${p.nextReward.missing} puntos</strong> para ${escapeHtml(p.nextReward.name)}.</p>`
      : '';
  return {
    subject: `Sumaste ${p.points} puntos`,
    text: `Hola ${p.customerFirstName}:\n\nSumaste ${p.points} puntos y ya tenés ${p.balance}.\n${
      p.unlockedReward ? `¡Ya podés canjear: ${p.unlockedReward}!` : p.nextReward ? `Te faltan ${p.nextReward.missing} puntos para ${p.nextReward.name}.` : ''
    }\n\nVer mis puntos: ${p.pointsUrl}`,
    html: layout(
      p.orgName,
      `<p>Hola ${escapeHtml(p.customerFirstName)}:</p>
<p>Sumaste <strong>${p.points} puntos</strong>. Ahora tenés <strong>${p.balance}</strong>.</p>
${unlocked}
${button(p.pointsUrl, 'Ver mis puntos')}`,
    ),
  };
}

/** Versión por email de cada tipo de mensaje (null = ese tipo no se manda por email). */
export function renderNotificationEmail(
  type: NotificationType,
  payload: NotificationPayload,
): RenderedEmail | null {
  switch (type) {
    case 'BOOKING_CONFIRMATION':
      return bookingConfirmationEmail(payload as BookingEmailPayload);
    case 'BOOKING_RESCHEDULED':
      return bookingRescheduledEmail(payload as BookingEmailPayload);
    case 'BOOKING_CANCELLATION':
      return bookingCancellationEmail(payload as BookingEmailPayload);
    case 'BOOKING_REMINDER':
      return reminderEmail(payload as ReminderPayload);
    case 'REVIEW_REQUEST':
      return reviewEmail(payload as ReviewPayload);
    case 'REACTIVATION':
      return reactivationEmail(payload as ReactivationPayload);
    case 'POINTS_CREDITED':
      return pointsEmail(payload as PointsPayload);
    default:
      return null;
  }
}

/**
 * Variables de la plantilla de WhatsApp, en el orden en que hay que declararlas en Meta.
 * `buttons` son los payloads de los botones de respuesta rápida.
 */
export function whatsappParamsFor(
  type: NotificationType,
  payload: NotificationPayload,
): { body: string[]; buttons?: string[] } {
  switch (type) {
    case 'BOOKING_CONFIRMATION':
    case 'BOOKING_RESCHEDULED': {
      const p = payload as BookingEmailPayload;
      return {
        body: [
          p.customerFirstName,
          whenText(p.startsAt, p.timezone),
          p.services.join(' + '),
          p.barberName,
          p.branchName,
        ],
      };
    }
    case 'BOOKING_CANCELLATION': {
      const p = payload as BookingEmailPayload;
      return { body: [p.customerFirstName, whenText(p.startsAt, p.timezone), p.branchName] };
    }
    case 'BOOKING_REMINDER': {
      const p = payload as ReminderPayload;
      return {
        body: [p.customerFirstName, whenText(p.startsAt, p.timezone), p.services.join(' + '), p.barberName],
        // Dos botones: "Confirmo" y "No puedo ir" (decisión del 28/09/2026).
        buttons: [`confirm:${p.confirmToken}`, `cancel:${p.cancelToken}`],
      };
    }
    case 'REVIEW_REQUEST': {
      const p = payload as ReviewPayload;
      return { body: [p.customerFirstName, p.orgName] };
    }
    case 'REACTIVATION': {
      const p = payload as ReactivationPayload;
      return { body: [p.customerFirstName, String(p.weeksAway), p.branchName] };
    }
    case 'POINTS_CREDITED': {
      const p = payload as PointsPayload;
      return { body: [p.customerFirstName, String(p.points), String(p.balance)] };
    }
    default:
      return { body: [] };
  }
}

/** Resumen de dinero para las plantillas que lo muestran. */
export function moneyText(cents: number): string {
  return formatCents(cents);
}

import { randomUUID } from 'node:crypto';
import {
  MercadoPagoError,
  type CreateOrderInput,
  type CreatePreferenceInput,
  type MercadoPago,
  type MpOrderDto,
  type MpPaymentDto,
  type MpPreferenceDto,
  type MpTerminalDto,
  type SearchPaymentsInput,
} from './client';

/**
 * Mercado Pago simulado, con el comportamiento documentado en docs/fase-0/01-arquitectura.md §9:
 * una sola orden en espera por terminal (409 already_queued_order_for_terminal), estados de la
 * orden, expiración, reintegros y búsqueda de pagos.
 *
 * Lo usan los tests y el modo "simulado" de desarrollo, mientras no haya credenciales reales.
 * NO se usa en producción: la configuración exige credenciales de verdad.
 */
export interface FakeOptions {
  now?: () => Date;
  terminals?: { id: string; mode?: 'PDV' | 'STANDALONE'; storeId?: string; posId?: string }[];
}

interface FakeOrder extends MpOrderDto {
  terminalId: string;
  expiresAt: Date;
}

export class FakeMercadoPago implements MercadoPago {
  readonly orders = new Map<string, FakeOrder>();
  readonly payments = new Map<string, MpPaymentDto>();
  readonly preferences = new Map<string, MpPreferenceDto & { externalReference: string }>();
  /** Órdenes creadas con la misma X-Idempotency-Key: MP devuelve la original. */
  private readonly byIdempotency = new Map<string, string>();
  private readonly terminals: MpTerminalDto[];
  private readonly now: () => Date;
  private seq = 0;
  /** Para simular cortes: la próxima llamada falla con este error. */
  failNext: MercadoPagoError | null = null;

  constructor(options: FakeOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.terminals = (options.terminals ?? [{ id: 'NEWLAND_N950__SBX0000001', mode: 'STANDALONE' }]).map(
      (t) => ({
        id: t.id,
        operating_mode: t.mode ?? 'STANDALONE',
        store_id: t.storeId ?? 'STORE01',
        pos_id: t.posId ?? 'POS01',
      }),
    );
  }

  private check() {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}${String(this.seq).padStart(10, '0')}`;
  }

  async getAccount() {
    this.check();
    return { id: '1234567890', nickname: 'ESTOICOSTEST', site_id: 'MLA' };
  }

  async listTerminals(): Promise<MpTerminalDto[]> {
    this.check();
    return this.terminals.map((t) => ({ ...t }));
  }

  async setTerminalMode(terminalId: string, mode: 'PDV' | 'STANDALONE'): Promise<MpTerminalDto> {
    this.check();
    const terminal = this.terminals.find((t) => t.id === terminalId);
    if (!terminal) throw new MercadoPagoError('Terminal inexistente', 404, 'not_found');
    terminal.operating_mode = mode;
    return { ...terminal };
  }

  async createOrder(input: CreateOrderInput): Promise<MpOrderDto> {
    this.check();
    const existing = this.byIdempotency.get(input.idempotencyKey);
    if (existing) return this.toDto(this.orders.get(existing)!);

    const terminal = this.terminals.find((t) => t.id === input.terminalId);
    if (!terminal) throw new MercadoPagoError('Terminal inexistente', 404, 'not_found');
    if (terminal.operating_mode !== 'PDV') {
      throw new MercadoPagoError('La terminal no está en modo PDV', 400, 'invalid_terminal_mode');
    }
    const busy = [...this.orders.values()].some(
      (o) =>
        o.terminalId === input.terminalId && ['created', 'at_terminal', 'action_required'].includes(o.status),
    );
    if (busy) {
      throw new MercadoPagoError(
        'Ya hay una orden en espera para esa terminal',
        409,
        'already_queued_order_for_terminal',
      );
    }

    const id = this.nextId('ORD');
    const order: FakeOrder = {
      id,
      type: 'point',
      status: 'created',
      external_reference: input.externalReference,
      total_amount: input.amount,
      version: 1,
      terminalId: input.terminalId,
      expiresAt: new Date(this.now().getTime() + input.expirationSeconds * 1000),
    };
    this.orders.set(id, order);
    this.byIdempotency.set(input.idempotencyKey, id);
    return this.toDto(order);
  }

  async getOrder(orderId: string): Promise<MpOrderDto> {
    this.check();
    const order = this.orders.get(orderId);
    if (!order) throw new MercadoPagoError('Orden inexistente', 404, 'not_found');
    // Expira sola, como en MP.
    if (['created', 'at_terminal'].includes(order.status) && this.now() >= order.expiresAt) {
      order.status = 'expired';
      order.version = (order.version ?? 1) + 1;
    }
    return this.toDto(order);
  }

  async cancelOrder(orderId: string): Promise<MpOrderDto> {
    this.check();
    const order = this.orders.get(orderId);
    if (!order) throw new MercadoPagoError('Orden inexistente', 404, 'not_found');
    // Regla de MP: con el cliente pagando, solo se cancela desde la terminal.
    if (order.status === 'at_terminal') {
      throw new MercadoPagoError('La orden está en la terminal', 409, 'order_cannot_be_canceled');
    }
    if (order.status !== 'created') {
      throw new MercadoPagoError('La orden ya no se puede cancelar', 409, 'order_cannot_be_canceled');
    }
    order.status = 'canceled';
    order.version = (order.version ?? 1) + 1;
    return this.toDto(order);
  }

  async getPayment(paymentId: string): Promise<MpPaymentDto> {
    this.check();
    const payment = this.payments.get(String(paymentId));
    if (!payment) throw new MercadoPagoError('Pago inexistente', 404, 'not_found');
    return structuredClone(payment);
  }

  async searchPayments(input: SearchPaymentsInput) {
    this.check();
    const all = [...this.payments.values()]
      .filter((p) => {
        const updated = new Date(p.date_last_updated);
        return updated >= input.from && updated <= input.to;
      })
      .sort((a, b) => a.date_last_updated.localeCompare(b.date_last_updated));
    const page = all.slice(input.offset, input.offset + input.limit).map((p) => structuredClone(p));
    return { results: page, total: all.length };
  }

  async refundPayment(paymentId: string, amountCents?: number) {
    this.check();
    const payment = this.payments.get(String(paymentId));
    if (!payment) throw new MercadoPagoError('Pago inexistente', 404, 'not_found');
    if (payment.status !== 'approved') {
      throw new MercadoPagoError('Solo se reintegran pagos aprobados', 400, 'invalid_payment_status');
    }
    const amount = amountCents === undefined ? payment.transaction_amount : amountCents / 100;
    payment.refunds = [...(payment.refunds ?? []), { id: this.nextId('REF'), amount }];
    const refunded = payment.refunds.reduce((a, r) => a + r.amount, 0);
    payment.status = refunded >= payment.transaction_amount ? 'refunded' : 'approved';
    payment.status_detail = refunded >= payment.transaction_amount ? 'refunded' : 'partially_refunded';
    payment.date_last_updated = this.now().toISOString();
    return { id: String(payment.refunds.at(-1)!.id), status: 'approved' };
  }

  async createPreference(input: CreatePreferenceInput): Promise<MpPreferenceDto> {
    this.check();
    const id = this.nextId('PREF');
    const preference = {
      id,
      init_point: `https://fake.mercadopago.com/checkout/${id}`,
      externalReference: input.externalReference,
    };
    this.preferences.set(id, preference);
    return { id, init_point: preference.init_point };
  }

  private toDto(order: FakeOrder): MpOrderDto {
    const { terminalId: _t, expiresAt: _e, ...dto } = order;
    return structuredClone(dto);
  }

  // --- Ayudas para los tests (simulan lo que hace la terminal o el cliente) ---

  /** La terminal muestra el cobro: a partir de acá solo se cancela desde la terminal. */
  atTerminal(orderId: string): void {
    const order = this.orders.get(orderId)!;
    order.status = 'at_terminal';
    order.version = (order.version ?? 1) + 1;
  }

  /** El cliente paga: la orden queda procesada y nace el pago espejo. */
  payOrder(orderId: string, options: { amount?: string; paymentMethod?: string } = {}): MpPaymentDto {
    const order = this.orders.get(orderId)!;
    const amount = Number(options.amount ?? order.total_amount ?? '0');
    const payment = this.pushPayment({
      status: 'approved',
      statusDetail: 'accredited',
      amount,
      externalReference: order.external_reference ?? null,
      paymentMethod: options.paymentMethod ?? 'debit_card',
      pointOfInteraction: 'PAYMENT_TERMINAL',
      terminalId: order.terminalId,
      orderId: order.id,
    });
    order.status = 'processed';
    order.status_detail = 'accredited';
    order.version = (order.version ?? 1) + 1;
    order.transactions = {
      payments: [
        {
          id: this.nextId('PAY'),
          amount: amount.toFixed(2),
          status: 'processed',
          status_detail: 'accredited',
          reference_id: String(payment.id),
        },
      ],
    };
    return payment;
  }

  /** El cobro se rechaza (fondos insuficientes, tarjeta inválida…). */
  rejectOrder(orderId: string, detail = 'insufficient_amount'): void {
    const order = this.orders.get(orderId)!;
    order.status = 'failed';
    order.status_detail = detail;
    order.version = (order.version ?? 1) + 1;
  }

  /** Agrega un pago suelto a la cuenta (transferencia, QR, cobro fuera del sistema). */
  pushPayment(input: {
    status?: string;
    statusDetail?: string;
    amount: number;
    externalReference?: string | null;
    description?: string;
    paymentMethod?: string;
    paymentType?: string;
    pointOfInteraction?: string;
    terminalId?: string;
    orderId?: string;
    payerEmail?: string;
    createdAt?: Date;
  }): MpPaymentDto {
    const id = String(100_000_000 + ++this.seq);
    const at = (input.createdAt ?? this.now()).toISOString();
    const payment: MpPaymentDto = {
      id,
      status: input.status ?? 'approved',
      status_detail: input.statusDetail ?? 'accredited',
      transaction_amount: input.amount,
      currency_id: 'ARS',
      external_reference: input.externalReference ?? null,
      description: input.description ?? null,
      payment_method_id: input.paymentMethod ?? 'account_money',
      payment_type_id: input.paymentType ?? 'account_money',
      operation_type: 'regular_payment',
      date_created: at,
      date_approved: (input.status ?? 'approved') === 'approved' ? at : null,
      date_last_updated: at,
      money_release_date: at,
      transaction_details: { net_received_amount: input.amount * 0.98 },
      fee_details: [{ amount: input.amount * 0.02 }],
      payer: { email: input.payerEmail ?? null },
      point_of_interaction: {
        type: input.pointOfInteraction ?? 'UNSPECIFIED',
        transaction_data: input.terminalId ? { terminal_id: input.terminalId } : null,
      },
      order: input.orderId ? { id: input.orderId, type: 'point' } : null,
      store_id: 'STORE01',
      pos_id: 'POS01',
      refunds: [],
    };
    this.payments.set(id, payment);
    return payment;
  }

  /** Clave de idempotencia nueva, como la que genera la app. */
  static newIdempotencyKey(): string {
    return randomUUID();
  }
}

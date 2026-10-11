/**
 * Cliente de Mercado Pago (API de Orders para Point, Checkout Pro para señas, pagos y
 * reintegros). Es una interfaz: en producción va `HttpMercadoPago`; en los tests y mientras
 * no haya credenciales, `FakeMercadoPago` (simulador con el comportamiento documentado).
 */
export interface MpMoney {
  /** Monto como texto con 2 decimales, tal como lo exige MP ("15000.00"). */
  amount: string;
}

export interface MpTerminalDto {
  id: string;
  operating_mode: 'PDV' | 'STANDALONE' | string;
  store_id?: string | null;
  pos_id?: string | number | null;
  external_pos_id?: string | null;
}

export interface MpOrderDto {
  id: string;
  type: string;
  status: string;
  status_detail?: string | null;
  external_reference?: string | null;
  total_amount?: string;
  /** Versión que sube con cada cambio: forma parte de la clave de idempotencia del webhook. */
  version?: number;
  transactions?: {
    payments?: {
      id: string;
      amount?: string;
      status?: string;
      status_detail?: string | null;
      reference_id?: string | null;
    }[];
  };
}

export interface MpPaymentDto {
  id: number | string;
  status: string;
  status_detail?: string | null;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  description?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  operation_type?: string | null;
  date_created: string;
  date_approved?: string | null;
  date_last_updated: string;
  money_release_date?: string | null;
  transaction_details?: { net_received_amount?: number | null } | null;
  fee_details?: { amount: number }[] | null;
  payer?: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    identification?: { number?: string | null } | null;
  } | null;
  point_of_interaction?: {
    type?: string | null;
    business_info?: { unit?: string | null } | null;
    transaction_data?: { terminal_id?: string | null } | null;
  } | null;
  order?: { id?: string | number | null; type?: string | null } | null;
  store_id?: string | null;
  pos_id?: string | number | null;
  refunds?: { id: number | string; amount: number }[];
}

export interface MpPreferenceDto {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
}

export interface CreateOrderInput {
  terminalId: string;
  amount: string;
  externalReference: string;
  idempotencyKey: string;
  /** Segundos que la orden vive en la terminal. */
  expirationSeconds: number;
  description?: string;
}

export interface CreatePreferenceInput {
  title: string;
  amount: string;
  externalReference: string;
  payerEmail?: string | undefined;
  expiresAt: Date;
  backUrl: string;
  notificationUrl?: string | undefined;
}

export interface SearchPaymentsInput {
  /** Rango por fecha de última actualización (lo que usa el job de sincronización). */
  from: Date;
  to: Date;
  offset: number;
  limit: number;
}

export interface MercadoPago {
  listTerminals(): Promise<MpTerminalDto[]>;
  setTerminalMode(terminalId: string, mode: 'PDV' | 'STANDALONE'): Promise<MpTerminalDto>;
  createOrder(input: CreateOrderInput): Promise<MpOrderDto>;
  getOrder(orderId: string): Promise<MpOrderDto>;
  cancelOrder(orderId: string): Promise<MpOrderDto>;
  getPayment(paymentId: string): Promise<MpPaymentDto>;
  searchPayments(input: SearchPaymentsInput): Promise<{ results: MpPaymentDto[]; total: number }>;
  refundPayment(paymentId: string, amountCents?: number): Promise<{ id: string; status: string }>;
  createPreference(input: CreatePreferenceInput): Promise<MpPreferenceDto>;
  /** Datos de la cuenta: sirve para validar el token al vincular. */
  getAccount(): Promise<{ id: string; nickname?: string | null; site_id?: string | null }>;
}

/** Error de Mercado Pago con el status HTTP y el código, para decidir si se reintenta. */
export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'MercadoPagoError';
  }

  /** La terminal ya tiene un cobro esperando (409 de MP). */
  get terminalBusy(): boolean {
    return this.status === 409 && (this.code ?? '').includes('already_queued');
  }

  /** El token no sirve: la cuenta queda marcada con error. */
  get invalidToken(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const BASE_URL = 'https://api.mercadopago.com';

export class HttpMercadoPago implements MercadoPago {
  constructor(
    private readonly accessToken: string,
    private readonly options: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  private async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; idempotencyKey?: string; query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(`${this.options.baseUrl ?? BASE_URL}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const doFetch = this.options.fetch ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new MercadoPagoError(
        `No se pudo hablar con Mercado Pago: ${error instanceof Error ? error.message : String(error)}`,
        0,
        'NETWORK',
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const code = String(payload.error ?? (payload as { code?: string }).code ?? '');
      const message = String(payload.message ?? `Mercado Pago respondió ${response.status}`);
      throw new MercadoPagoError(
        message,
        response.status,
        code,
        response.status >= 500 || response.status === 429,
      );
    }
    return payload as T;
  }

  listTerminals(): Promise<MpTerminalDto[]> {
    return this.request<{ data?: { terminals?: MpTerminalDto[] } }>('GET', '/terminals/v1/list').then(
      (r) => r.data?.terminals ?? [],
    );
  }

  setTerminalMode(terminalId: string, mode: 'PDV' | 'STANDALONE'): Promise<MpTerminalDto> {
    return this.request<{ data?: { terminals?: MpTerminalDto[] } }>('PATCH', '/terminals/v1/setup', {
      body: { terminals: [{ id: terminalId, operating_mode: mode }] },
    }).then((r) => r.data?.terminals?.[0] ?? { id: terminalId, operating_mode: mode });
  }

  createOrder(input: CreateOrderInput): Promise<MpOrderDto> {
    return this.request<MpOrderDto>('POST', '/v1/orders', {
      idempotencyKey: input.idempotencyKey,
      body: {
        type: 'point',
        external_reference: input.externalReference,
        transactions: { payments: [{ amount: input.amount }] },
        config: {
          point: { terminal_id: input.terminalId, print_on_terminal: 'no_ticket' },
        },
        description: input.description,
        expiration_time: `PT${input.expirationSeconds}S`,
      },
    });
  }

  getOrder(orderId: string): Promise<MpOrderDto> {
    return this.request<MpOrderDto>('GET', `/v1/orders/${orderId}`);
  }

  cancelOrder(orderId: string): Promise<MpOrderDto> {
    return this.request<MpOrderDto>('POST', `/v1/orders/${orderId}/cancel`, {
      idempotencyKey: `cancel-${orderId}`,
    });
  }

  getPayment(paymentId: string): Promise<MpPaymentDto> {
    return this.request<MpPaymentDto>('GET', `/v1/payments/${paymentId}`);
  }

  searchPayments(input: SearchPaymentsInput): Promise<{ results: MpPaymentDto[]; total: number }> {
    return this.request<{ results: MpPaymentDto[]; paging?: { total?: number } }>(
      'GET',
      '/v1/payments/search',
      {
        query: {
          sort: 'date_last_updated',
          criteria: 'asc',
          range: 'date_last_updated',
          begin_date: input.from.toISOString(),
          end_date: input.to.toISOString(),
          offset: String(input.offset),
          limit: String(input.limit),
        },
      },
    ).then((r) => ({ results: r.results ?? [], total: r.paging?.total ?? (r.results ?? []).length }));
  }

  refundPayment(paymentId: string, amountCents?: number): Promise<{ id: string; status: string }> {
    return this.request<{ id: number | string; status: string }>(
      'POST',
      `/v1/payments/${paymentId}/refunds`,
      {
        idempotencyKey: `refund-${paymentId}-${amountCents ?? 'full'}`,
        body: amountCents === undefined ? {} : { amount: amountCents / 100 },
      },
    ).then((r) => ({ id: String(r.id), status: r.status }));
  }

  createPreference(input: CreatePreferenceInput): Promise<MpPreferenceDto> {
    return this.request<MpPreferenceDto>('POST', '/checkout/preferences', {
      body: {
        items: [{ title: input.title, quantity: 1, unit_price: Number(input.amount), currency_id: 'ARS' }],
        external_reference: input.externalReference,
        payer: input.payerEmail ? { email: input.payerEmail } : undefined,
        // Sin "ticket": Rapipago y Pago Fácil acreditan en días y el turno no puede esperar.
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }], installments: 1 },
        // El pago queda aprobado o rechazado al instante, nunca pendiente.
        binary_mode: true,
        expires: true,
        expiration_date_to: input.expiresAt.toISOString(),
        back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
        auto_return: 'approved',
        notification_url: input.notificationUrl,
      },
    });
  }

  getAccount(): Promise<{ id: string; nickname?: string | null; site_id?: string | null }> {
    return this.request<{ id: number | string; nickname?: string; site_id?: string }>(
      'GET',
      '/users/me',
    ).then((r) => ({ id: String(r.id), nickname: r.nickname ?? null, site_id: r.site_id ?? null }));
  }
}

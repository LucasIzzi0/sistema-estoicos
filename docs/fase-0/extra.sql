-- =============================================================================
--  ESTOICOS · SQL complementario al schema de Prisma — FASE 0
--
--  Prisma no puede expresar estas reglas. Se agregan al final de la migración
--  inicial (flujo: `prisma migrate dev --create-only` → pegar este archivo →
--  aplicar). Validado contra PostgreSQL 16 y sin drift con Prisma 7.10.
--
--  1. Anti doble reserva (EXCLUDE USING gist).
--  2. CHECKs de integridad (dinero, signos de ledgers, coherencia de estados).
--  3. Ledgers de solo inserción (trigger que bloquea UPDATE/DELETE).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ANTI DOBLE RESERVA
--    Un barbero no puede tener dos turnos activos que se pisen, en ninguna
--    sucursal. Rango semiabierto [inicio, fin): un turno que termina 10:40 y otro
--    que empieza 10:40 NO chocan. Cancelados, ausentes y completados no ocupan
--    lugar. Es la última línea de defensa: la API además toma un lock por barbero
--    (pg_advisory_xact_lock) para validar horario, bloqueos y cierres en la misma
--    transacción.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap_per_barber
  EXCLUDE USING gist (
    barber_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('PENDING_PAYMENT', 'BOOKED', 'CONFIRMED', 'IN_PROGRESS'));

ALTER TABLE appointments
  ADD CONSTRAINT appointments_time_order CHECK (ends_at > starts_at),
  ADD CONSTRAINT appointments_customer_required CHECK (customer_id IS NOT NULL OR source = 'WALK_IN'),
  ADD CONSTRAINT appointments_hold_when_pending CHECK (status <> 'PENDING_PAYMENT' OR hold_expires_at IS NOT NULL),
  ADD CONSTRAINT appointments_amounts CHECK (
    booked_total_cents >= 0 AND deposit_required_cents >= 0
    AND deposit_required_cents <= booked_total_cents
  ),
  ADD CONSTRAINT appointments_canceled_fields CHECK (
    status <> 'CANCELED' OR (canceled_at IS NOT NULL AND canceled_by IS NOT NULL AND cancel_reason IS NOT NULL)
  );

ALTER TABLE appointment_services
  ADD CONSTRAINT appointment_services_values CHECK (
    duration_min > 0 AND price_cents >= 0 AND deposit_cents >= 0 AND deposit_cents <= price_cents
  );

ALTER TABLE branch_closures
  ADD CONSTRAINT branch_closures_time_order CHECK (ends_at > starts_at);

ALTER TABLE barber_time_offs
  ADD CONSTRAINT barber_time_offs_time_order CHECK (ends_at > starts_at);

ALTER TABLE barber_schedules
  ADD CONSTRAINT barber_schedules_weekday CHECK (weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT barber_schedules_minutes CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute),
  ADD CONSTRAINT barber_schedules_validity CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from);

-- -----------------------------------------------------------------------------
-- 2. CHECKs DE INTEGRIDAD
-- -----------------------------------------------------------------------------

-- Identidad: emails siempre en minúsculas; teléfono E.164; DNI solo dígitos.
ALTER TABLE users
  ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

ALTER TABLE customers
  ADD CONSTRAINT customers_email_lowercase CHECK (email IS NULL OR email = lower(email)),
  ADD CONSTRAINT customers_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT customers_dni_digits CHECK (dni IS NULL OR dni ~ '^[0-9]{6,9}$');

ALTER TABLE sessions
  ADD CONSTRAINT sessions_subject CHECK (
    (kind = 'STAFF' AND user_id IS NOT NULL AND customer_id IS NULL)
    OR (kind = 'CUSTOMER' AND customer_id IS NOT NULL AND user_id IS NULL)
  );

ALTER TABLE auth_codes
  ADD CONSTRAINT auth_codes_attempts CHECK (attempts >= 0 AND attempts <= max_attempts);

-- Configuración: rangos razonables (la API valida con Zod; esto es la red de seguridad).
ALTER TABLE organization_settings
  ADD CONSTRAINT org_settings_booking CHECK (
    booking_slot_step_minutes BETWEEN 5 AND 120
    AND booking_min_notice_minutes >= 0
    AND booking_max_days_ahead BETWEEN 1 AND 365
    AND booking_max_active_per_customer >= 1
  ),
  ADD CONSTRAINT org_settings_deposit CHECK (
    deposit_hold_minutes BETWEEN 5 AND 120
    AND deposit_refund_window_hours >= 0
    AND (no_show_deposit_threshold IS NULL OR no_show_deposit_threshold >= 1)
    AND no_show_deposit_percent_bps BETWEEN 1 AND 10000
  ),
  ADD CONSTRAINT org_settings_loyalty CHECK (
    loyalty_points_per_step >= 1
    AND loyalty_spend_step_cents >= 1
    AND (loyalty_points_expiry_months IS NULL OR loyalty_points_expiry_months >= 1)
  ),
  ADD CONSTRAINT org_settings_point_ttl CHECK (point_order_ttl_minutes BETWEEN 1 AND 180),
  ADD CONSTRAINT org_settings_reminders CHECK (0 < ALL (reminder_offsets_minutes)),
  ADD CONSTRAINT org_settings_quiet_hours CHECK (
    marketing_quiet_start_minute BETWEEN 0 AND 1439 AND marketing_quiet_end_minute BETWEEN 0 AND 1439
  );

-- Catálogo.
ALTER TABLE services
  ADD CONSTRAINT services_values CHECK (
    duration_min BETWEEN 5 AND 600
    AND base_price_cents >= 0
    AND (points_override IS NULL OR points_override >= 0)
    AND (commission_bps_override IS NULL OR commission_bps_override BETWEEN 0 AND 10000)
  ),
  ADD CONSTRAINT services_deposit_config CHECK (
    (deposit_mode = 'NONE' AND deposit_fixed_cents IS NULL AND deposit_percent_bps IS NULL)
    OR (deposit_mode = 'FIXED' AND deposit_fixed_cents > 0 AND deposit_percent_bps IS NULL)
    OR (deposit_mode = 'PERCENT' AND deposit_percent_bps BETWEEN 1 AND 10000 AND deposit_fixed_cents IS NULL)
  );

ALTER TABLE branch_services
  ADD CONSTRAINT branch_services_price CHECK (price_cents_override IS NULL OR price_cents_override >= 0);

ALTER TABLE products
  ADD CONSTRAINT products_values CHECK (
    base_price_cents >= 0
    AND (cost_cents IS NULL OR cost_cents >= 0)
    AND (points_override IS NULL OR points_override >= 0)
    AND (commission_bps_override IS NULL OR commission_bps_override BETWEEN 0 AND 10000)
  );

ALTER TABLE branch_products
  ADD CONSTRAINT branch_products_values CHECK (
    (price_cents_override IS NULL OR price_cents_override >= 0) AND (min_stock IS NULL OR min_stock >= 0)
  );

ALTER TABLE barbers
  ADD CONSTRAINT barbers_commission_bps CHECK (
    service_commission_bps BETWEEN 0 AND 10000
    AND product_commission_bps BETWEEN 0 AND 10000
    AND tip_commission_bps BETWEEN 0 AND 10000
  );

ALTER TABLE barber_services
  ADD CONSTRAINT barber_services_values CHECK (
    (duration_min_override IS NULL OR duration_min_override > 0)
    AND (commission_bps_override IS NULL OR commission_bps_override BETWEEN 0 AND 10000)
  );

-- Stock: el signo depende del tipo; los ajustes y el consumo interno exigen motivo.
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_sign CHECK (
    (type IN ('INITIAL', 'PURCHASE', 'SALE_VOID', 'ADJUSTMENT_IN', 'TRANSFER_IN') AND quantity > 0)
    OR (type IN ('SALE', 'ADJUSTMENT_OUT', 'INTERNAL_USE', 'TRANSFER_OUT') AND quantity < 0)
  ),
  ADD CONSTRAINT stock_movements_reason CHECK (
    type NOT IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'INTERNAL_USE') OR (reason IS NOT NULL AND length(trim(reason)) > 0)
  );

-- Ventas: montos coherentes y campos obligatorios según el tipo de línea.
ALTER TABLE sales
  ADD CONSTRAINT sales_amounts CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND discount_cents <= subtotal_cents
    AND total_cents = subtotal_cents - discount_cents
    AND paid_cents >= 0 AND refunded_cents >= 0 AND refunded_cents <= paid_cents
  ),
  ADD CONSTRAINT sales_status_fields CHECK (
    (status <> 'PAID' OR paid_at IS NOT NULL)
    AND (status <> 'VOIDED' OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND void_reason IS NOT NULL))
  );

ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_amounts CHECK (
    quantity > 0 AND unit_price_cents >= 0 AND discount_cents >= 0
    AND total_cents = quantity * unit_price_cents - discount_cents
    AND total_cents >= 0
  ),
  ADD CONSTRAINT sale_items_type_fields CHECK (
    (type = 'SERVICE' AND service_id IS NOT NULL AND barber_id IS NOT NULL AND product_id IS NULL)
    OR (type = 'PRODUCT' AND product_id IS NOT NULL AND service_id IS NULL)
    OR (type = 'TIP' AND barber_id IS NOT NULL AND service_id IS NULL AND product_id IS NULL)
  );

-- Cobros: cada propósito exige su vínculo.
ALTER TABLE payments
  ADD CONSTRAINT payments_amounts CHECK (
    amount_cents > 0 AND refunded_cents >= 0 AND refunded_cents <= amount_cents
  ),
  ADD CONSTRAINT payments_purpose_links CHECK (
    (purpose <> 'SALE' OR sale_id IS NOT NULL)
    AND (purpose <> 'DEPOSIT' OR appointment_id IS NOT NULL)
    AND (purpose <> 'CUSTOMER_CREDIT' OR customer_id IS NOT NULL)
    AND (purpose <> 'OTHER_INCOME' OR (description IS NOT NULL AND sale_id IS NULL))
    AND (method <> 'CUSTOMER_CREDIT' OR customer_id IS NOT NULL)
  ),
  ADD CONSTRAINT payments_approved_at CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL);

ALTER TABLE refunds
  ADD CONSTRAINT refunds_amount CHECK (amount_cents > 0);

-- Saldo a favor: el signo depende del tipo; los ajustes manuales exigen motivo.
ALTER TABLE customer_credit_entries
  ADD CONSTRAINT credit_entries_sign CHECK (
    amount_cents <> 0
    AND (type NOT IN ('TOPUP', 'REFUND_TO_CREDIT') OR amount_cents > 0)
    AND (type <> 'SPENT' OR amount_cents < 0)
  ),
  ADD CONSTRAINT credit_entries_reason CHECK (type <> 'ADJUSTMENT' OR (reason IS NOT NULL AND length(trim(reason)) > 0));

-- Mercado Pago.
ALTER TABLE mp_orders
  ADD CONSTRAINT mp_orders_amount CHECK (amount_cents > 0),
  ADD CONSTRAINT mp_orders_external_reference CHECK (external_reference ~ '^[A-Za-z0-9_-]{1,64}$');

-- Caja y egresos.
ALTER TABLE cash_sessions
  ADD CONSTRAINT cash_sessions_opening CHECK (opening_cash_cents >= 0),
  ADD CONSTRAINT cash_sessions_closed_fields CHECK (
    status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by_id IS NOT NULL)
  );

ALTER TABLE cash_counts
  ADD CONSTRAINT cash_counts_difference CHECK (
    counted_cents >= 0 AND difference_cents = counted_cents - expected_cents
  );

ALTER TABLE cash_movements
  ADD CONSTRAINT cash_movements_amount CHECK (amount_cents > 0),
  ADD CONSTRAINT cash_movements_method CHECK (method IN ('CASH', 'TRANSFER', 'MP_OTHER', 'OTHER')),
  ADD CONSTRAINT cash_movements_void CHECK (voided_at IS NULL OR (voided_by_id IS NOT NULL AND void_reason IS NOT NULL));

ALTER TABLE expenses
  ADD CONSTRAINT expenses_amount CHECK (amount_cents > 0),
  ADD CONSTRAINT expenses_method CHECK (method IN ('CASH', 'TRANSFER', 'MP_OTHER', 'OTHER')),
  ADD CONSTRAINT expenses_void CHECK (voided_at IS NULL OR (voided_by_id IS NOT NULL AND void_reason IS NOT NULL));

-- Comisiones.
ALTER TABLE commission_entries
  ADD CONSTRAINT commission_entries_values CHECK (
    rate_bps BETWEEN 0 AND 10000
    AND (kind <> 'EARNED' OR amount_cents >= 0)
    AND (kind <> 'REVERSAL' OR (amount_cents <= 0 AND reverses_entry_id IS NOT NULL))
    AND (kind <> 'ADJUSTMENT' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
  );

ALTER TABLE commission_settlements
  ADD CONSTRAINT commission_settlements_period CHECK (period_end >= period_start),
  ADD CONSTRAINT commission_settlements_paid CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND paid_by_id IS NOT NULL));

-- Puntos: el signo depende del tipo; solo las acreditaciones vencen; ajustes con motivo.
ALTER TABLE points_entries
  ADD CONSTRAINT points_entries_sign CHECK (
    points <> 0
    AND (type <> 'EARN' OR points > 0)
    AND (type NOT IN ('REDEEM', 'EXPIRE') OR points < 0)
  ),
  ADD CONSTRAINT points_entries_expiry CHECK (expires_at IS NULL OR points > 0),
  ADD CONSTRAINT points_entries_reason CHECK (type <> 'ADJUST' OR (reason IS NOT NULL AND length(trim(reason)) > 0)),
  ADD CONSTRAINT points_entries_reversal CHECK (type <> 'REVERSAL' OR reverses_entry_id IS NOT NULL);

ALTER TABLE rewards
  ADD CONSTRAINT rewards_values CHECK (
    points_cost > 0
    AND (type <> 'FREE_SERVICE' OR service_id IS NOT NULL)
    AND (type <> 'FREE_PRODUCT' OR product_id IS NOT NULL)
    AND (type <> 'FIXED_DISCOUNT' OR discount_fixed_cents > 0)
    AND (type <> 'PERCENT_DISCOUNT' OR discount_percent_bps BETWEEN 1 AND 10000)
  );

ALTER TABLE reward_redemptions
  ADD CONSTRAINT reward_redemptions_points CHECK (points_spent > 0);

-- -----------------------------------------------------------------------------
-- 3. LEDGERS DE SOLO INSERCIÓN
--    Nadie (ni la app, ni un error, ni alguien con acceso a la base) puede
--    modificar o borrar una fila. Las correcciones se hacen con filas nuevas
--    (reversas o ajustes con motivo y usuario).
--    Nota: TRUNCATE no dispara estos triggers (lo usan los tests); en producción
--    la app usará un rol sin permiso de TRUNCATE (Fase 8).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER points_entries_append_only
  BEFORE UPDATE OR DELETE ON points_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER customer_credit_entries_append_only
  BEFORE UPDATE OR DELETE ON customer_credit_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER commission_entries_append_only
  BEFORE UPDATE OR DELETE ON commission_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER consent_events_append_only
  BEFORE UPDATE OR DELETE ON consent_events
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER appointment_events_append_only
  BEFORE UPDATE OR DELETE ON appointment_events
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

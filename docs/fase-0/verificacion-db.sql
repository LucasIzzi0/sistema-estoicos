-- =============================================================================
--  ESTOICOS · Pruebas de las reglas de la base — FASE 0
--  Se corre con psql sobre una base migrada (schema.prisma + extra.sql).
--  Todo ocurre dentro de una transacción que termina en ROLLBACK.
--  En la Fase 1 esto se convierte en tests de integración automáticos (Vitest).
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;
BEGIN;

CREATE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK  rechaza  | % -> %', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FALLA | %: se esperaba un error y la base lo aceptó', label;
END $$;

CREATE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'OK  acepta   | %', label;
END $$;

-- Datos mínimos
INSERT INTO organizations (id, name, slug, updated_at) VALUES ('a0000000-0000-7000-8000-000000000001','Estoicos','estoicos', now());
INSERT INTO branches (id, organization_id, name, slug, updated_at) VALUES ('a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000001','Centro','centro', now());
INSERT INTO users (id, email, name, updated_at) VALUES ('a0000000-0000-7000-8000-000000000003','dueno@estoicos.test','Dueño', now());
INSERT INTO barbers (id, organization_id, display_name, updated_at) VALUES
  ('a0000000-0000-7000-8000-000000000004','a0000000-0000-7000-8000-000000000001','Juan', now()),
  ('a0000000-0000-7000-8000-000000000005','a0000000-0000-7000-8000-000000000001','Pedro', now());
INSERT INTO customers (id, organization_id, first_name, last_name, source, phone, email, updated_at) VALUES
  ('a0000000-0000-7000-8000-000000000006','a0000000-0000-7000-8000-000000000001','Martín','Gómez','IN_STORE','+5491122334455','martin@example.com', now());
INSERT INTO services (id, organization_id, name, duration_min, base_price_cents, updated_at) VALUES
  ('a0000000-0000-7000-8000-000000000007','a0000000-0000-7000-8000-000000000001','Corte',40,1500000, now());

\echo '--- Anti doble reserva'
SELECT pg_temp.expect_ok('Turno Juan 10:00-10:40', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000004','a0000000-0000-7000-8000-000000000006','BOOKED','STAFF','2026-10-01 10:00-03','2026-10-01 10:40-03',now())$q$);
SELECT pg_temp.expect_error('Turno Juan 10:20-11:00 (se pisa)', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000004','a0000000-0000-7000-8000-000000000006','BOOKED','ONLINE','2026-10-01 10:20-03','2026-10-01 11:00-03',now())$q$);
SELECT pg_temp.expect_error('Turno Juan 10:20-11:00 pendiente de seña (también ocupa)', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, hold_expires_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000004','a0000000-0000-7000-8000-000000000006','PENDING_PAYMENT','ONLINE','2026-10-01 10:20-03','2026-10-01 11:00-03',now() + interval '15 minutes',now())$q$);
SELECT pg_temp.expect_ok('Turno Juan 10:40-11:20 (contiguo, no se pisa)', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000004','a0000000-0000-7000-8000-000000000006','CONFIRMED','STAFF','2026-10-01 10:40-03','2026-10-01 11:20-03',now())$q$);
SELECT pg_temp.expect_ok('Turno Pedro 10:20-11:00 (otro barbero)', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000005','a0000000-0000-7000-8000-000000000006','BOOKED','STAFF','2026-10-01 10:20-03','2026-10-01 11:00-03',now())$q$);
SELECT pg_temp.expect_ok('Turno Juan 10:00-10:40 CANCELADO (no ocupa)', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, canceled_at, canceled_by, cancel_reason, updated_at) VALUES ('a0000000-0000-7000-8000-0000000000c1','a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000004','a0000000-0000-7000-8000-000000000006','CANCELED','STAFF','2026-10-01 10:00-03','2026-10-01 10:40-03',now(),'CUSTOMER','CUSTOMER_REQUEST',now())$q$);
SELECT pg_temp.expect_error('Reactivar el cancelado sobre un turno ocupado', $q$UPDATE appointments SET status='BOOKED' WHERE id='a0000000-0000-7000-8000-0000000000c1'$q$);
SELECT pg_temp.expect_error('Pendiente de seña sin vencimiento del hold', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000005','a0000000-0000-7000-8000-000000000006','PENDING_PAYMENT','ONLINE','2026-10-02 10:00-03','2026-10-02 10:40-03',now())$q$);
SELECT pg_temp.expect_error('Turno online sin cliente', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000005','BOOKED','ONLINE','2026-10-02 11:00-03','2026-10-02 11:40-03',now())$q$);
SELECT pg_temp.expect_ok('Atención sin turno (walk-in) sin cliente registrado', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000005','IN_PROGRESS','WALK_IN','2026-10-02 12:00-03','2026-10-02 12:40-03',now())$q$);
SELECT pg_temp.expect_error('Turno que termina antes de empezar', $q$INSERT INTO appointments (id, organization_id, branch_id, barber_id, customer_id, status, source, starts_at, ends_at, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000005','a0000000-0000-7000-8000-000000000006','BOOKED','STAFF','2026-10-03 11:00-03','2026-10-03 10:00-03',now())$q$);

\echo '--- Caja'
SELECT pg_temp.expect_ok('Abrir caja', $q$INSERT INTO cash_sessions (id, organization_id, branch_id, business_date, opening_cash_cents, opened_by_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','2026-10-01',5000000,'a0000000-0000-7000-8000-000000000003',now())$q$);
SELECT pg_temp.expect_error('Abrir una segunda caja en la misma sucursal', $q$INSERT INTO cash_sessions (id, organization_id, branch_id, business_date, opening_cash_cents, opened_by_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','2026-10-01',0,'a0000000-0000-7000-8000-000000000003',now())$q$);
SELECT pg_temp.expect_error('Cerrar caja sin quién la cerró', $q$INSERT INTO cash_sessions (id, organization_id, branch_id, business_date, status, opening_cash_cents, opened_by_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','2026-09-30','CLOSED',0,'a0000000-0000-7000-8000-000000000003',now())$q$);

\echo '--- Ledger de puntos'
SELECT pg_temp.expect_ok('Acreditar 100 puntos', $q$INSERT INTO points_entries (id, organization_id, customer_id, type, points, idempotency_key) VALUES ('a0000000-0000-7000-8000-0000000000e1','a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000006','EARN',100,'earn:sale-1')$q$);
SELECT pg_temp.expect_error('Acreditar dos veces la misma venta (idempotencia)', $q$INSERT INTO points_entries (id, organization_id, customer_id, type, points, idempotency_key) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000006','EARN',100,'earn:sale-1')$q$);
SELECT pg_temp.expect_error('Editar una fila del ledger', $q$UPDATE points_entries SET points = 1000 WHERE id='a0000000-0000-7000-8000-0000000000e1'$q$);
SELECT pg_temp.expect_error('Borrar una fila del ledger', $q$DELETE FROM points_entries WHERE id='a0000000-0000-7000-8000-0000000000e1'$q$);
SELECT pg_temp.expect_error('Canje con puntos positivos', $q$INSERT INTO points_entries (id, organization_id, customer_id, type, points, idempotency_key) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000006','REDEEM',50,'redeem:x')$q$);
SELECT pg_temp.expect_error('Ajuste manual sin motivo', $q$INSERT INTO points_entries (id, organization_id, customer_id, type, points, idempotency_key) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000006','ADJUST',-20,'adjust:x')$q$);

\echo '--- Ventas y cobros'
INSERT INTO sales (id, organization_id, branch_id, number, subtotal_cents, total_cents, created_by_id, updated_at) VALUES ('a0000000-0000-7000-8000-000000000008','a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002',1,1500000,1500000,'a0000000-0000-7000-8000-000000000003',now());
SELECT pg_temp.expect_ok('Línea de servicio correcta', $q$INSERT INTO sale_items (id, sale_id, type, service_id, barber_id, description, unit_price_cents, total_cents) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000008','SERVICE','a0000000-0000-7000-8000-000000000007','a0000000-0000-7000-8000-000000000004','Corte',1500000,1500000)$q$);
SELECT pg_temp.expect_error('Línea con total mal calculado', $q$INSERT INTO sale_items (id, sale_id, type, service_id, barber_id, description, quantity, unit_price_cents, discount_cents, total_cents) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000008','SERVICE','a0000000-0000-7000-8000-000000000007','a0000000-0000-7000-8000-000000000004','Corte',2,1500000,0,1500000)$q$);
SELECT pg_temp.expect_error('Servicio sin barbero (sin comisión posible)', $q$INSERT INTO sale_items (id, sale_id, type, service_id, description, unit_price_cents, total_cents) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000008','SERVICE','a0000000-0000-7000-8000-000000000007','Corte',1500000,1500000)$q$);
SELECT pg_temp.expect_error('Venta con total distinto a subtotal − descuento', $q$UPDATE sales SET total_cents = 999 WHERE id='a0000000-0000-7000-8000-000000000008'$q$);
SELECT pg_temp.expect_error('Cobro de venta sin venta', $q$INSERT INTO payments (id, organization_id, branch_id, purpose, method, status, amount_cents, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','SALE','CASH','PENDING',1500000,now())$q$);
SELECT pg_temp.expect_error('Cobro aprobado sin fecha de aprobación', $q$INSERT INTO payments (id, organization_id, branch_id, purpose, method, status, amount_cents, sale_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','SALE','CASH','APPROVED',1500000,'a0000000-0000-7000-8000-000000000008',now())$q$);
SELECT pg_temp.expect_ok('Cobro con Point pendiente (vinculado a la venta)', $q$INSERT INTO payments (id, organization_id, branch_id, purpose, method, status, amount_cents, sale_id, approved_at, updated_at) VALUES ('a0000000-0000-7000-8000-00000000000b','a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','SALE','MP_POINT','PENDING',1500000,'a0000000-0000-7000-8000-000000000008',now(),now())$q$);
INSERT INTO payments (id, organization_id, branch_id, purpose, method, status, amount_cents, sale_id, updated_at) VALUES ('a0000000-0000-7000-8000-00000000000c','a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','SALE','MP_POINT','PENDING',1500000,'a0000000-0000-7000-8000-000000000008',now());

\echo '--- Mercado Pago: una orden en espera por terminal'
INSERT INTO mp_accounts (id, organization_id, label, mp_user_id, auth_method, access_token_enc, live_mode, reconcile_from, updated_at) VALUES ('a0000000-0000-7000-8000-000000000009','a0000000-0000-7000-8000-000000000001','Cuenta principal','123456','MANUAL_TOKEN','v1:cifrado',false,now(),now());
INSERT INTO mp_terminals (id, mp_account_id, external_id, updated_at) VALUES ('a0000000-0000-7000-8000-00000000000a','a0000000-0000-7000-8000-000000000009','NEWLAND_N950__SBX0000001',now());
SELECT pg_temp.expect_ok('Primera orden a la terminal', $q$INSERT INTO mp_orders (id, branch_id, mp_account_id, terminal_id, sale_id, payment_id, external_reference, idempotency_key, amount_cents, updated_at) VALUES ('a0000000-0000-7000-8000-0000000000f1','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000009','a0000000-0000-7000-8000-00000000000a','a0000000-0000-7000-8000-000000000008','a0000000-0000-7000-8000-00000000000b','sale_a0000000-0000-7000-8000-000000000008_1',gen_random_uuid()::text,1500000,now())$q$);
SELECT pg_temp.expect_error('Segunda orden en espera a la misma terminal', $q$INSERT INTO mp_orders (id, branch_id, mp_account_id, terminal_id, sale_id, payment_id, external_reference, idempotency_key, amount_cents, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000009','a0000000-0000-7000-8000-00000000000a','a0000000-0000-7000-8000-000000000008','a0000000-0000-7000-8000-00000000000c','sale_a0000000-0000-7000-8000-000000000008_2',gen_random_uuid()::text,1500000,now())$q$);
UPDATE mp_orders SET status = 'REJECTED' WHERE id = 'a0000000-0000-7000-8000-0000000000f1';
SELECT pg_temp.expect_ok('Reintento cuando la anterior terminó', $q$INSERT INTO mp_orders (id, branch_id, mp_account_id, terminal_id, sale_id, payment_id, external_reference, idempotency_key, amount_cents, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-000000000009','a0000000-0000-7000-8000-00000000000a','a0000000-0000-7000-8000-000000000008','a0000000-0000-7000-8000-00000000000c','sale_a0000000-0000-7000-8000-000000000008_2',gen_random_uuid()::text,1500000,now())$q$);
SELECT pg_temp.expect_error('external_reference con caracteres que MP no acepta', $q$UPDATE mp_orders SET external_reference = 'venta #1' WHERE id='a0000000-0000-7000-8000-0000000000f1'$q$);

\echo '--- Datos de clientes, stock, catálogo y auditoría'
SELECT pg_temp.expect_error('Teléfono fuera de formato E.164', $q$UPDATE customers SET phone = '11 2233-4455' WHERE id='a0000000-0000-7000-8000-000000000006'$q$);
SELECT pg_temp.expect_error('Email con mayúsculas', $q$UPDATE customers SET email = 'Martin@Example.com' WHERE id='a0000000-0000-7000-8000-000000000006'$q$);
SELECT pg_temp.expect_error('DNI con letras', $q$UPDATE customers SET dni = '30A45678' WHERE id='a0000000-0000-7000-8000-000000000006'$q$);
INSERT INTO products (id, organization_id, name, base_price_cents, updated_at) VALUES ('a0000000-0000-7000-8000-0000000000d1','a0000000-0000-7000-8000-000000000001','Cera mate',1200000,now());
SELECT pg_temp.expect_error('Venta que SUMA stock', $q$INSERT INTO stock_movements (id, organization_id, branch_id, product_id, type, quantity, balance_after) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-0000000000d1','SALE',3,3)$q$);
SELECT pg_temp.expect_error('Ajuste de stock sin motivo', $q$INSERT INTO stock_movements (id, organization_id, branch_id, product_id, type, quantity, balance_after) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-0000000000d1','ADJUSTMENT_IN',2,2)$q$);
SELECT pg_temp.expect_error('Seña FIJA con porcentaje cargado', $q$UPDATE services SET deposit_mode='FIXED', deposit_fixed_cents=500000, deposit_percent_bps=3000 WHERE id='a0000000-0000-7000-8000-000000000007'$q$);
INSERT INTO audit_logs (id, organization_id, actor_type, actor_user_id, action, entity_type, entity_id, reason) VALUES ('a0000000-0000-7000-8000-0000000000a1','a0000000-0000-7000-8000-000000000001','STAFF','a0000000-0000-7000-8000-000000000003','STOCK_ADJUSTED','Product','x','conteo');
SELECT pg_temp.expect_error('Editar la auditoría', $q$UPDATE audit_logs SET reason = 'otra cosa' WHERE id='a0000000-0000-7000-8000-0000000000a1'$q$);

\echo '--- Egresos y movimientos de caja'
INSERT INTO expense_categories (id, organization_id, name) VALUES ('a0000000-0000-7000-8000-0000000000b1','a0000000-0000-7000-8000-000000000001','Insumos');
SELECT pg_temp.expect_ok('Egreso en efectivo', $q$INSERT INTO expenses (id, organization_id, branch_id, category_id, amount_cents, method, occurred_on, description, created_by_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-0000000000b1',2500000,'CASH','2026-10-01','Navajas','a0000000-0000-7000-8000-000000000003',now())$q$);
SELECT pg_temp.expect_error('Egreso "pagado con Point" (medio inválido para egresos)', $q$INSERT INTO expenses (id, organization_id, branch_id, category_id, amount_cents, method, occurred_on, description, created_by_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-0000000000b1',2500000,'MP_POINT','2026-10-01','Navajas','a0000000-0000-7000-8000-000000000003',now())$q$);
SELECT pg_temp.expect_error('Egreso anulado sin motivo', $q$INSERT INTO expenses (id, organization_id, branch_id, category_id, amount_cents, method, occurred_on, description, created_by_id, voided_at, voided_by_id, updated_at) VALUES (gen_random_uuid(),'a0000000-0000-7000-8000-000000000001','a0000000-0000-7000-8000-000000000002','a0000000-0000-7000-8000-0000000000b1',2500000,'CASH','2026-10-01','Navajas','a0000000-0000-7000-8000-000000000003',now(),'a0000000-0000-7000-8000-000000000003',now())$q$);

ROLLBACK;
\echo '--- Fin: todas las verificaciones pasaron'

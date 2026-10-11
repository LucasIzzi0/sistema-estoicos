-- Migración inicial: schema aprobado en la Fase 0 (Prisma) + reglas de docs/fase-0/extra.sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('ADMIN', 'BARBER');

-- CreateEnum
CREATE TYPE "two_factor_method" AS ENUM ('NONE', 'EMAIL_CODE');

-- CreateEnum
CREATE TYPE "session_kind" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "auth_code_purpose" AS ENUM ('CUSTOMER_LOGIN', 'STAFF_SECOND_FACTOR', 'STAFF_PASSWORD_RESET', 'STAFF_INVITATION');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "customer_source" AS ENUM ('IN_STORE', 'ONLINE_BOOKING', 'IMPORT');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "consent_scope" AS ENUM ('TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "consent_source" AS ENUM ('IN_STORE', 'BOOKING_PAGE', 'CUSTOMER_PORTAL', 'WHATSAPP_REPLY', 'EMAIL_LINK', 'STAFF_UPDATE', 'IMPORT');

-- CreateEnum
CREATE TYPE "time_off_type" AS ENUM ('VACATION', 'BREAK', 'SICK_LEAVE', 'PERSONAL', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "deposit_mode" AS ENUM ('NONE', 'FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "deposit_refund_policy" AS ENUM ('REFUND', 'CUSTOMER_CREDIT');

-- CreateEnum
CREATE TYPE "reward_commission_base" AS ENUM ('LIST_PRICE', 'CHARGED_AMOUNT');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('PENDING_PAYMENT', 'BOOKED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "appointment_source" AS ENUM ('ONLINE', 'STAFF', 'WALK_IN');

-- CreateEnum
CREATE TYPE "confirmation_source" AS ENUM ('DEPOSIT_PAID', 'CUSTOMER_LINK', 'WHATSAPP_REPLY', 'STAFF');

-- CreateEnum
CREATE TYPE "cancel_reason" AS ENUM ('CUSTOMER_REQUEST', 'STAFF_DECISION', 'PAYMENT_TIMEOUT', 'BARBER_UNAVAILABLE', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "deposit_status" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'APPLIED', 'REFUNDED', 'CREDITED', 'RETAINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "appointment_event_type" AS ENUM ('CREATED', 'STATUS_CHANGED', 'RESCHEDULED', 'REASSIGNED', 'UPDATED');

-- CreateEnum
CREATE TYPE "sale_status" AS ENUM ('OPEN', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "sale_item_type" AS ENUM ('SERVICE', 'PRODUCT', 'TIP');

-- CreateEnum
CREATE TYPE "payment_purpose" AS ENUM ('SALE', 'DEPOSIT', 'CUSTOMER_CREDIT', 'OTHER_INCOME');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'TRANSFER', 'MP_POINT', 'MP_CHECKOUT', 'MP_OTHER', 'CUSTOMER_CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "refund_destination" AS ENUM ('ORIGINAL_METHOD', 'CUSTOMER_CREDIT');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('PENDING', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "credit_entry_type" AS ENUM ('TOPUP', 'REFUND_TO_CREDIT', 'SPENT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "mp_auth_method" AS ENUM ('MANUAL_TOKEN', 'OAUTH');

-- CreateEnum
CREATE TYPE "mp_account_status" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "mp_terminal_mode" AS ENUM ('PDV', 'STANDALONE', 'UNDEFINED');

-- CreateEnum
CREATE TYPE "mp_order_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "mp_sync_source" AS ENUM ('WEBHOOK', 'SYNC_JOB', 'ORDER_FETCH');

-- CreateEnum
CREATE TYPE "reconciliation_status" AS ENUM ('AUTO_MATCHED', 'UNASSIGNED', 'MANUALLY_ASSIGNED', 'OTHER_INCOME', 'IGNORED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "webhook_provider" AS ENUM ('MERCADOPAGO', 'WHATSAPP', 'RESEND');

-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "cash_session_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "cash_movement_type" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('INITIAL', 'PURCHASE', 'SALE', 'SALE_VOID', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'INTERNAL_USE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "commission_entry_kind" AS ENUM ('EARNED', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "settlement_period" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('DRAFT', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "points_entry_type" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL');

-- CreateEnum
CREATE TYPE "reward_type" AS ENUM ('FREE_SERVICE', 'FREE_PRODUCT', 'FIXED_DISCOUNT', 'PERCENT_DISCOUNT');

-- CreateEnum
CREATE TYPE "redemption_status" AS ENUM ('APPLIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('LOGIN_CODE', 'BOOKING_CONFIRMATION', 'BOOKING_REMINDER', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLATION', 'DEPOSIT_PAYMENT_LINK', 'DEPOSIT_REFUNDED', 'POINTS_CREDITED', 'REWARD_AVAILABLE', 'REACTIVATION', 'REVIEW_REQUEST', 'STAFF_INVITATION', 'STAFF_PASSWORD_RESET', 'STAFF_SECOND_FACTOR');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELED');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('STAFF_INVITED', 'STAFF_ROLE_CHANGED', 'STAFF_BRANCH_ACCESS_CHANGED', 'STAFF_DEACTIVATED', 'STAFF_PASSWORD_RESET', 'SETTINGS_CHANGED', 'SERVICE_PRICE_CHANGED', 'PRODUCT_PRICE_CHANGED', 'COMMISSION_RATE_CHANGED', 'STOCK_ADJUSTED', 'STOCK_PURCHASE_RECORDED', 'POINTS_ADJUSTED', 'CREDIT_ADJUSTED', 'SALE_DISCOUNT_APPLIED', 'SALE_PRICE_OVERRIDDEN', 'SALE_VOIDED', 'PAYMENT_REFUNDED', 'CASH_SESSION_OPENED', 'CASH_SESSION_CLOSED', 'CASH_MOVEMENT_VOIDED', 'EXPENSE_VOIDED', 'COMMISSION_SETTLEMENT_PAID', 'COMMISSION_SETTLEMENT_VOIDED', 'MP_ACCOUNT_CONNECTED', 'MP_ACCOUNT_DISCONNECTED', 'MP_TERMINAL_ASSIGNED', 'MP_ORDER_CANCELED', 'MP_PAYMENT_RECONCILED', 'APPOINTMENT_NO_SHOW_REVERTED', 'CUSTOMER_MERGED', 'CUSTOMER_ANONYMIZED', 'CUSTOMER_BOOKING_BLOCKED', 'DATA_EXPORTED');

-- CreateEnum
CREATE TYPE "system_alert_kind" AS ENUM ('WORKER_DOWN', 'QUEUE_BACKLOG', 'JOB_STUCK', 'JOB_FAILURES', 'WEBHOOK_SIGNATURE_INVALID', 'WEBHOOK_PROCESSING_FAILED', 'MP_SYNC_FAILING', 'MP_CREDENTIALS_INVALID', 'MP_ORDER_UNRESOLVED', 'LATE_DEPOSIT_PAYMENT', 'NOTIFICATION_FAILURES', 'NEGATIVE_STOCK');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "job_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legal_name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "currency" CHAR(3) NOT NULL DEFAULT 'ARS',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "organization_id" UUID NOT NULL,
    "booking_slot_step_minutes" INTEGER NOT NULL DEFAULT 15,
    "booking_min_notice_minutes" INTEGER NOT NULL DEFAULT 60,
    "booking_max_days_ahead" INTEGER NOT NULL DEFAULT 30,
    "booking_allow_any_barber" BOOLEAN NOT NULL DEFAULT true,
    "booking_max_active_per_customer" INTEGER NOT NULL DEFAULT 2,
    "customer_can_reschedule" BOOLEAN NOT NULL DEFAULT true,
    "customer_reschedule_min_notice_hours" INTEGER NOT NULL DEFAULT 3,
    "deposit_hold_minutes" INTEGER NOT NULL DEFAULT 15,
    "deposit_refund_window_hours" INTEGER NOT NULL DEFAULT 24,
    "deposit_early_cancel_policy" "deposit_refund_policy" NOT NULL DEFAULT 'CUSTOMER_CREDIT',
    "no_show_deposit_threshold" INTEGER,
    "no_show_deposit_percent_bps" INTEGER NOT NULL DEFAULT 5000,
    "loyalty_enabled" BOOLEAN NOT NULL DEFAULT true,
    "loyalty_points_per_step" INTEGER NOT NULL DEFAULT 1,
    "loyalty_spend_step_cents" BIGINT NOT NULL DEFAULT 100000,
    "loyalty_points_expiry_months" INTEGER DEFAULT 12,
    "loyalty_earn_on_products" BOOLEAN NOT NULL DEFAULT true,
    "reward_commission_base" "reward_commission_base" NOT NULL DEFAULT 'LIST_PRICE',
    "default_settlement_period" "settlement_period" NOT NULL DEFAULT 'WEEKLY',
    "require_open_cash_session" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT true,
    "point_order_ttl_minutes" INTEGER NOT NULL DEFAULT 10,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_offsets_minutes" INTEGER[] DEFAULT ARRAY[1440, 120]::INTEGER[],
    "reactivation_after_days" INTEGER NOT NULL DEFAULT 35,
    "reactivation_cooldown_days" INTEGER NOT NULL DEFAULT 30,
    "review_request_delay_minutes" INTEGER NOT NULL DEFAULT 120,
    "review_request_cooldown_days" INTEGER NOT NULL DEFAULT 90,
    "marketing_quiet_start_minute" INTEGER NOT NULL DEFAULT 1260,
    "marketing_quiet_end_minute" INTEGER NOT NULL DEFAULT 540,
    "email_sender_name" TEXT,
    "reply_to_email" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "google_review_url" TEXT,
    "booking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mp_account_id" UUID,
    "mp_store_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_closures" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "two_factor_method" "two_factor_method" NOT NULL DEFAULT 'NONE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "email_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "member_role" NOT NULL,
    "all_branches" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_branches" (
    "membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("membership_id","branch_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" "session_kind" NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "second_factor_verified_at" TIMESTAMPTZ(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_codes" (
    "id" UUID NOT NULL,
    "purpose" "auth_code_purpose" NOT NULL,
    "organization_id" UUID,
    "email" TEXT NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "request_ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "phone" TEXT,
    "whatsapp_user_id" TEXT,
    "whatsapp_unreachable_at" TIMESTAMPTZ(3),
    "email_bounced_at" TIMESTAMPTZ(3),
    "dni" TEXT,
    "birth_date" DATE,
    "preferred_channel" "notification_channel" NOT NULL DEFAULT 'WHATSAPP',
    "source" "customer_source" NOT NULL,
    "home_branch_id" UUID,
    "first_visit_at" TIMESTAMPTZ(3),
    "last_visit_at" TIMESTAMPTZ(3),
    "booking_blocked_at" TIMESTAMPTZ(3),
    "booking_block_note" TEXT,
    "anonymized_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "branch_id" UUID,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "customer_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "scope" "consent_scope" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("customer_id","channel","scope")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "scope" "consent_scope" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" "consent_source" NOT NULL,
    "policy_version" TEXT NOT NULL,
    "recorded_by_id" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID,
    "display_name" TEXT NOT NULL,
    "photo_url" TEXT,
    "color" TEXT,
    "bio" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accepts_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "service_commission_bps" INTEGER NOT NULL DEFAULT 0,
    "product_commission_bps" INTEGER NOT NULL DEFAULT 0,
    "tip_commission_bps" INTEGER NOT NULL DEFAULT 10000,
    "settlement_period" "settlement_period",
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_branches" (
    "barber_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_branches_pkey" PRIMARY KEY ("barber_id","branch_id")
);

-- CreateTable
CREATE TABLE "barber_services" (
    "barber_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "duration_min_override" INTEGER,
    "commission_bps_override" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "barber_services_pkey" PRIMARY KEY ("barber_id","service_id")
);

-- CreateTable
CREATE TABLE "barber_schedules" (
    "id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "valid_from" DATE,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barber_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_time_offs" (
    "id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "time_off_type" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_time_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_min" INTEGER NOT NULL,
    "base_price_cents" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "online_bookable" BOOLEAN NOT NULL DEFAULT true,
    "points_override" INTEGER,
    "commission_bps_override" INTEGER,
    "deposit_mode" "deposit_mode" NOT NULL DEFAULT 'NONE',
    "deposit_fixed_cents" BIGINT,
    "deposit_percent_bps" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_services" (
    "branch_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "price_cents_override" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_services_pkey" PRIMARY KEY ("branch_id","service_id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "base_price_cents" BIGINT NOT NULL,
    "cost_cents" BIGINT,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "points_override" INTEGER,
    "commission_bps_override" INTEGER,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_products" (
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "price_cents_override" BIGINT,
    "stock_on_hand" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_products_pkey" PRIMARY KEY ("branch_id","product_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "unit_cost_cents" BIGINT,
    "reason" TEXT,
    "sale_item_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "appointment_status" NOT NULL,
    "source" "appointment_source" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "any_barber_requested" BOOLEAN NOT NULL DEFAULT false,
    "customer_notes" TEXT,
    "internal_notes" TEXT,
    "booked_total_cents" BIGINT NOT NULL DEFAULT 0,
    "deposit_required_cents" BIGINT NOT NULL DEFAULT 0,
    "deposit_status" "deposit_status" NOT NULL DEFAULT 'NOT_REQUIRED',
    "hold_expires_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_via" "confirmation_source",
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by" "actor_type",
    "cancel_reason" "cancel_reason",
    "cancel_note" TEXT,
    "no_show_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_services" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "price_cents" BIGINT NOT NULL,
    "deposit_cents" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "type" "appointment_event_type" NOT NULL,
    "from_status" "appointment_status",
    "to_status" "appointment_status",
    "previous_starts_at" TIMESTAMPTZ(3),
    "previous_barber_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_customer_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_id" UUID,
    "appointment_id" UUID,
    "status" "sale_status" NOT NULL DEFAULT 'OPEN',
    "subtotal_cents" BIGINT NOT NULL DEFAULT 0,
    "discount_cents" BIGINT NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL DEFAULT 0,
    "paid_cents" BIGINT NOT NULL DEFAULT 0,
    "refunded_cents" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "type" "sale_item_type" NOT NULL,
    "service_id" UUID,
    "product_id" UUID,
    "barber_id" UUID,
    "appointment_service_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" BIGINT NOT NULL,
    "discount_cents" BIGINT NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL,
    "discount_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "purpose" "payment_purpose" NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "refunded_cents" BIGINT NOT NULL DEFAULT 0,
    "sale_id" UUID,
    "appointment_id" UUID,
    "customer_id" UUID,
    "cash_session_id" UUID,
    "mp_payment_id" UUID,
    "reference" TEXT,
    "description" TEXT,
    "received_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "destination" "refund_destination" NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "mp_refund_id" TEXT,
    "cash_session_id" UUID,
    "failure_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "credit_entry_type" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "sale_id" UUID,
    "reason" TEXT,
    "created_by_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "mp_user_id" TEXT NOT NULL,
    "nickname" TEXT,
    "auth_method" "mp_auth_method" NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "public_key" TEXT,
    "webhook_secret_enc" TEXT,
    "live_mode" BOOLEAN NOT NULL,
    "status" "mp_account_status" NOT NULL DEFAULT 'ACTIVE',
    "payments_synced_until" TIMESTAMPTZ(3),
    "reconcile_from" TIMESTAMPTZ(3) NOT NULL,
    "last_error" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "connected_by_id" UUID,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_terminals" (
    "id" UUID NOT NULL,
    "mp_account_id" UUID NOT NULL,
    "branch_id" UUID,
    "external_id" TEXT NOT NULL,
    "label" TEXT,
    "operating_mode" "mp_terminal_mode" NOT NULL DEFAULT 'UNDEFINED',
    "mp_store_id" TEXT,
    "mp_pos_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mp_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_orders" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "mp_account_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "external_id" TEXT,
    "external_reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "paid_amount_cents" BIGINT,
    "status" "mp_order_status" NOT NULL DEFAULT 'PENDING',
    "mp_status" TEXT,
    "mp_status_detail" TEXT,
    "external_payment_id" TEXT,
    "external_payment_ref" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "last_payload" JSONB,
    "cancel_requested_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mp_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "mp_account_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "status_detail" TEXT,
    "amount_cents" BIGINT NOT NULL,
    "net_received_cents" BIGINT,
    "fee_cents" BIGINT,
    "refunded_cents" BIGINT NOT NULL DEFAULT 0,
    "currency_id" TEXT NOT NULL,
    "payment_method_id" TEXT,
    "payment_type_id" TEXT,
    "operation_type" TEXT,
    "external_reference" TEXT,
    "description" TEXT,
    "payer_email" TEXT,
    "payer_name" TEXT,
    "payer_doc_number" TEXT,
    "point_of_interaction_type" TEXT,
    "mp_order_ref" TEXT,
    "mp_terminal_ref" TEXT,
    "mp_store_ref" TEXT,
    "mp_pos_ref" TEXT,
    "branch_id" UUID,
    "date_created" TIMESTAMPTZ(3) NOT NULL,
    "date_approved" TIMESTAMPTZ(3),
    "date_last_updated" TIMESTAMPTZ(3) NOT NULL,
    "money_release_date" TIMESTAMPTZ(3),
    "raw" JSONB NOT NULL,
    "first_seen_via" "mp_sync_source" NOT NULL,
    "reconciliation_status" "reconciliation_status" NOT NULL,
    "reconciled_by_id" UUID,
    "reconciled_at" TIMESTAMPTZ(3),
    "reconciliation_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mp_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_preferences" (
    "id" UUID NOT NULL,
    "mp_account_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "init_point" TEXT NOT NULL,
    "external_reference" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mp_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "webhook_provider" NOT NULL,
    "event_key" TEXT NOT NULL,
    "organization_id" UUID,
    "topic" TEXT,
    "action" TEXT,
    "resource_id" TEXT,
    "account_ref" TEXT,
    "payload" JSONB NOT NULL,
    "status" "webhook_event_status" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "cash_session_status" NOT NULL DEFAULT 'OPEN',
    "opening_cash_cents" BIGINT NOT NULL,
    "opening_note" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "closing_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_counts" (
    "id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "expected_cents" BIGINT NOT NULL,
    "counted_cents" BIGINT NOT NULL,
    "difference_cents" BIGINT NOT NULL,
    "note" TEXT,

    CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "type" "cash_movement_type" NOT NULL,
    "method" "payment_method" NOT NULL DEFAULT 'CASH',
    "amount_cents" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "system_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "category_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "method" "payment_method" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "cash_session_id" UUID,
    "commission_settlement_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "sale_id" UUID,
    "sale_item_id" UUID,
    "kind" "commission_entry_kind" NOT NULL,
    "item_type" "sale_item_type",
    "base_cents" BIGINT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "reverses_entry_id" UUID,
    "reason" TEXT,
    "created_by_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_settlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "barber_id" UUID NOT NULL,
    "period_type" "settlement_period" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_cents" BIGINT NOT NULL,
    "status" "settlement_status" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "paid_by_id" UUID,
    "payment_method" "payment_method",
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "commission_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_settlement_items" (
    "settlement_id" UUID NOT NULL,
    "commission_entry_id" UUID NOT NULL,

    CONSTRAINT "commission_settlement_items_pkey" PRIMARY KEY ("settlement_id","commission_entry_id")
);

-- CreateTable
CREATE TABLE "points_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "points_entry_type" NOT NULL,
    "points" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "sale_id" UUID,
    "reverses_entry_id" UUID,
    "reason" TEXT,
    "created_by_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "reward_type" NOT NULL,
    "points_cost" INTEGER NOT NULL,
    "service_id" UUID,
    "product_id" UUID,
    "discount_fixed_cents" BIGINT,
    "discount_percent_bps" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "sale_item_id" UUID,
    "points_spent" INTEGER NOT NULL,
    "points_entry_id" UUID NOT NULL,
    "status" "redemption_status" NOT NULL DEFAULT 'APPLIED',
    "reversal_entry_id" UUID,
    "redeemed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(3),

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_type_settings" (
    "organization_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_template_name" TEXT,
    "whatsapp_template_language" TEXT NOT NULL DEFAULT 'es_AR',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_type_settings_pkey" PRIMARY KEY ("organization_id","type")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "customer_id" UUID,
    "user_id" UUID,
    "appointment_id" UUID,
    "sale_id" UUID,
    "type" "notification_type" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "template_name" TEXT,
    "payload" JSONB NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "fallback_of_id" UUID,
    "skipped_reason" TEXT,
    "enqueued_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_customer_id" UUID,
    "action" "audit_action" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "kind" "system_alert_kind" NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolved_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" UUID,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "id" TEXT NOT NULL,
    "version" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_beat_at" TIMESTAMPTZ(3) NOT NULL,
    "stopped_at" TIMESTAMPTZ(3),

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job_name" TEXT NOT NULL,
    "scheduler_id" TEXT,
    "status" "job_run_status" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_slug_key" ON "branches"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "branch_closures_branch_id_starts_at_idx" ON "branch_closures"("branch_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_customer_id_idx" ON "sessions"("customer_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_codes_email_purpose_created_at_idx" ON "auth_codes"("email", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "customers_organization_id_phone_idx" ON "customers"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "customers_organization_id_last_name_first_name_idx" ON "customers"("organization_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "customers_organization_id_last_visit_at_idx" ON "customers"("organization_id", "last_visit_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_dni_key" ON "customers"("organization_id", "dni");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_whatsapp_user_id_key" ON "customers"("organization_id", "whatsapp_user_id");

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_created_at_idx" ON "customer_notes"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_events_customer_id_occurred_at_idx" ON "consent_events"("customer_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "barbers_membership_id_key" ON "barbers"("membership_id");

-- CreateIndex
CREATE INDEX "barbers_organization_id_active_idx" ON "barbers"("organization_id", "active");

-- CreateIndex
CREATE INDEX "barber_schedules_barber_id_weekday_idx" ON "barber_schedules"("barber_id", "weekday");

-- CreateIndex
CREATE INDEX "barber_schedules_branch_id_weekday_idx" ON "barber_schedules"("branch_id", "weekday");

-- CreateIndex
CREATE INDEX "barber_time_offs_barber_id_starts_at_idx" ON "barber_time_offs"("barber_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_organization_id_name_key" ON "service_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "services_organization_id_active_idx" ON "services"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_name_key" ON "product_categories"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_product_id_created_at_idx" ON "stock_movements"("branch_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "appointments_branch_id_starts_at_idx" ON "appointments"("branch_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_barber_id_starts_at_idx" ON "appointments"("barber_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_customer_id_starts_at_idx" ON "appointments"("customer_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_status_hold_expires_at_idx" ON "appointments"("status", "hold_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_services_appointment_id_position_key" ON "appointment_services"("appointment_id", "position");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_created_at_idx" ON "appointment_events"("appointment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_appointment_id_key" ON "sales"("appointment_id");

-- CreateIndex
CREATE INDEX "sales_organization_id_branch_id_paid_at_idx" ON "sales"("organization_id", "branch_id", "paid_at");

-- CreateIndex
CREATE INDEX "sales_customer_id_created_at_idx" ON "sales"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_branch_id_number_key" ON "sales"("branch_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_appointment_service_id_key" ON "sale_items"("appointment_service_id");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_barber_id_idx" ON "sale_items"("barber_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mp_payment_id_key" ON "payments"("mp_payment_id");

-- CreateIndex
CREATE INDEX "payments_branch_id_created_at_idx" ON "payments"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_sale_id_idx" ON "payments"("sale_id");

-- CreateIndex
CREATE INDEX "payments_appointment_id_idx" ON "payments"("appointment_id");

-- CreateIndex
CREATE INDEX "payments_cash_session_id_idx" ON "payments"("cash_session_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_mp_refund_id_key" ON "refunds"("mp_refund_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_idempotency_key_key" ON "customer_credit_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "customer_credit_entries_customer_id_created_at_idx" ON "customer_credit_entries"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mp_accounts_mp_user_id_key" ON "mp_accounts"("mp_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_terminals_mp_account_id_external_id_key" ON "mp_terminals"("mp_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_orders_payment_id_key" ON "mp_orders"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_orders_external_id_key" ON "mp_orders"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_orders_external_reference_key" ON "mp_orders"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "mp_orders_idempotency_key_key" ON "mp_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "mp_orders_status_created_at_idx" ON "mp_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "mp_orders_sale_id_idx" ON "mp_orders"("sale_id");

-- CreateIndex
CREATE INDEX "mp_orders_external_payment_ref_idx" ON "mp_orders"("external_payment_ref");

-- CreateIndex
CREATE UNIQUE INDEX "mp_orders_one_pending_per_terminal" ON "mp_orders"("terminal_id") WHERE (status = 'PENDING');

-- CreateIndex
CREATE UNIQUE INDEX "mp_payments_external_id_key" ON "mp_payments"("external_id");

-- CreateIndex
CREATE INDEX "mp_payments_organization_id_reconciliation_status_date_crea_idx" ON "mp_payments"("organization_id", "reconciliation_status", "date_created");

-- CreateIndex
CREATE INDEX "mp_payments_external_reference_idx" ON "mp_payments"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "mp_preferences_payment_id_key" ON "mp_preferences"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "mp_preferences_external_id_key" ON "mp_preferences"("external_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_provider_resource_id_idx" ON "webhook_events"("provider", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_key_key" ON "webhook_events"("provider", "event_key");

-- CreateIndex
CREATE INDEX "cash_sessions_branch_id_business_date_idx" ON "cash_sessions"("branch_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_one_open_per_branch" ON "cash_sessions"("branch_id") WHERE (status = 'OPEN');

-- CreateIndex
CREATE UNIQUE INDEX "cash_counts_cash_session_id_method_key" ON "cash_counts"("cash_session_id", "method");

-- CreateIndex
CREATE INDEX "cash_movements_cash_session_id_idx" ON "cash_movements"("cash_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_name_key" ON "expense_categories"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_system_key_key" ON "expense_categories"("organization_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_commission_settlement_id_key" ON "expenses"("commission_settlement_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_occurred_on_idx" ON "expenses"("organization_id", "occurred_on");

-- CreateIndex
CREATE INDEX "expenses_branch_id_occurred_on_idx" ON "expenses"("branch_id", "occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "commission_entries_idempotency_key_key" ON "commission_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "commission_entries_barber_id_occurred_at_idx" ON "commission_entries"("barber_id", "occurred_at");

-- CreateIndex
CREATE INDEX "commission_entries_organization_id_branch_id_occurred_at_idx" ON "commission_entries"("organization_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "commission_settlements_barber_id_period_start_idx" ON "commission_settlements"("barber_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "commission_settlement_items_commission_entry_id_key" ON "commission_settlement_items"("commission_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "points_entries_idempotency_key_key" ON "points_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "points_entries_customer_id_created_at_idx" ON "points_entries"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "points_entries_organization_id_expires_at_idx" ON "points_entries"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "rewards_organization_id_active_idx" ON "rewards"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_sale_item_id_key" ON "reward_redemptions"("sale_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_points_entry_id_key" ON "reward_redemptions"("points_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_reversal_entry_id_key" ON "reward_redemptions"("reversal_entry_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_customer_id_created_at_idx" ON "reward_redemptions"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_fallback_of_id_key" ON "notifications"("fallback_of_id");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notifications_customer_id_type_created_at_idx" ON "notifications"("customer_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "notifications_provider_message_id_idx" ON "notifications"("provider_message_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "system_alerts_resolved_at_severity_idx" ON "system_alerts"("resolved_at", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "system_alerts_one_open_per_key" ON "system_alerts"("dedupe_key") WHERE (resolved_at IS NULL);

-- CreateIndex
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "api_idempotency_keys_expires_at_idx" ON "api_idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_keys_scope_key_key" ON "api_idempotency_keys"("scope", "key");

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_mp_account_id_fkey" FOREIGN KEY ("mp_account_id") REFERENCES "mp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_home_branch_id_fkey" FOREIGN KEY ("home_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_branches" ADD CONSTRAINT "barber_branches_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_branches" ADD CONSTRAINT "barber_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_schedules" ADD CONSTRAINT "barber_schedules_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_schedules" ADD CONSTRAINT "barber_schedules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_time_offs" ADD CONSTRAINT "barber_time_offs_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_time_offs" ADD CONSTRAINT "barber_time_offs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_time_offs" ADD CONSTRAINT "barber_time_offs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_customer_id_fkey" FOREIGN KEY ("actor_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_appointment_service_id_fkey" FOREIGN KEY ("appointment_service_id") REFERENCES "appointment_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_mp_payment_id_fkey" FOREIGN KEY ("mp_payment_id") REFERENCES "mp_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_accounts" ADD CONSTRAINT "mp_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_accounts" ADD CONSTRAINT "mp_accounts_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_terminals" ADD CONSTRAINT "mp_terminals_mp_account_id_fkey" FOREIGN KEY ("mp_account_id") REFERENCES "mp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_terminals" ADD CONSTRAINT "mp_terminals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_orders" ADD CONSTRAINT "mp_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_orders" ADD CONSTRAINT "mp_orders_mp_account_id_fkey" FOREIGN KEY ("mp_account_id") REFERENCES "mp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_orders" ADD CONSTRAINT "mp_orders_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "mp_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_orders" ADD CONSTRAINT "mp_orders_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_orders" ADD CONSTRAINT "mp_orders_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_orders" ADD CONSTRAINT "mp_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_payments" ADD CONSTRAINT "mp_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_payments" ADD CONSTRAINT "mp_payments_mp_account_id_fkey" FOREIGN KEY ("mp_account_id") REFERENCES "mp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_payments" ADD CONSTRAINT "mp_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_payments" ADD CONSTRAINT "mp_payments_reconciled_by_id_fkey" FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_preferences" ADD CONSTRAINT "mp_preferences_mp_account_id_fkey" FOREIGN KEY ("mp_account_id") REFERENCES "mp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_preferences" ADD CONSTRAINT "mp_preferences_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_preferences" ADD CONSTRAINT "mp_preferences_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_commission_settlement_id_fkey" FOREIGN KEY ("commission_settlement_id") REFERENCES "commission_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "commission_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlement_items" ADD CONSTRAINT "commission_settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "commission_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_settlement_items" ADD CONSTRAINT "commission_settlement_items_commission_entry_id_fkey" FOREIGN KEY ("commission_entry_id") REFERENCES "commission_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "points_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_points_entry_id_fkey" FOREIGN KEY ("points_entry_id") REFERENCES "points_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reversal_entry_id_fkey" FOREIGN KEY ("reversal_entry_id") REFERENCES "points_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_redeemed_by_id_fkey" FOREIGN KEY ("redeemed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_type_settings" ADD CONSTRAINT "notification_type_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_fallback_of_id_fkey" FOREIGN KEY ("fallback_of_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_customer_id_fkey" FOREIGN KEY ("actor_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


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

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "auth"."aal_level" AS ENUM ('aal1', 'aal2', 'aal3');

-- CreateEnum
CREATE TYPE "auth"."code_challenge_method" AS ENUM ('s256', 'plain');

-- CreateEnum
CREATE TYPE "auth"."factor_status" AS ENUM ('unverified', 'verified');

-- CreateEnum
CREATE TYPE "auth"."factor_type" AS ENUM ('totp', 'webauthn', 'phone');

-- CreateEnum
CREATE TYPE "auth"."oauth_authorization_status" AS ENUM ('pending', 'approved', 'denied', 'expired');

-- CreateEnum
CREATE TYPE "auth"."oauth_client_type" AS ENUM ('public', 'confidential');

-- CreateEnum
CREATE TYPE "auth"."oauth_registration_type" AS ENUM ('dynamic', 'manual');

-- CreateEnum
CREATE TYPE "auth"."oauth_response_type" AS ENUM ('code');

-- CreateEnum
CREATE TYPE "auth"."one_time_token_type" AS ENUM ('confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token');

-- CreateEnum
CREATE TYPE "public"."BillingDraftStatus" AS ENUM ('pending', 'confirmed', 'cancelled');

-- CreateTable
CREATE TABLE "auth"."audit_log_entries" (
    "instance_id" UUID,
    "id" UUID NOT NULL,
    "payload" JSON,
    "created_at" TIMESTAMPTZ(6),
    "ip_address" VARCHAR(64) NOT NULL DEFAULT '',

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."custom_oauth_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_type" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "acceptable_client_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pkce_enabled" BOOLEAN NOT NULL DEFAULT true,
    "attribute_mapping" JSONB NOT NULL DEFAULT '{}',
    "authorization_params" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_optional" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT,
    "discovery_url" TEXT,
    "skip_nonce_check" BOOLEAN NOT NULL DEFAULT false,
    "cached_discovery" JSONB,
    "discovery_cached_at" TIMESTAMPTZ(6),
    "authorization_url" TEXT,
    "token_url" TEXT,
    "userinfo_url" TEXT,
    "jwks_uri" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_oauth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."flow_state" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "auth_code" TEXT,
    "code_challenge_method" "auth"."code_challenge_method",
    "code_challenge" TEXT,
    "provider_type" TEXT NOT NULL,
    "provider_access_token" TEXT,
    "provider_refresh_token" TEXT,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "authentication_method" TEXT NOT NULL,
    "auth_code_issued_at" TIMESTAMPTZ(6),
    "invite_token" TEXT,
    "referrer" TEXT,
    "oauth_client_state_id" UUID,
    "linking_target_id" UUID,
    "email_optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "flow_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."identities" (
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "identity_data" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    -- ローカル baseline 注：本番 (Supabase) では DEFAULT lower((identity_data ->> 'email'::text)) だが、
    -- ネイティブ PostgreSQL は DDL の DEFAULT 内で他列参照を許容しないため、ローカルでは default 無しで生成。
    -- 運用上は Supabase 側が auth.identities を管理するため影響無し。
    "email" TEXT,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."instances" (
    "id" UUID NOT NULL,
    "uuid" UUID,
    "raw_base_config" TEXT,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."mfa_amr_claims" (
    "session_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "authentication_method" TEXT NOT NULL,
    "id" UUID NOT NULL,

    CONSTRAINT "amr_id_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."mfa_challenges" (
    "id" UUID NOT NULL,
    "factor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "ip_address" INET NOT NULL,
    "otp_code" TEXT,
    "web_authn_session_data" JSONB,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "friendly_name" TEXT,
    "factor_type" "auth"."factor_type" NOT NULL,
    "status" "auth"."factor_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "secret" TEXT,
    "phone" TEXT,
    "last_challenged_at" TIMESTAMPTZ(6),
    "web_authn_credential" JSONB,
    "web_authn_aaguid" UUID,
    "last_webauthn_challenge_data" JSONB,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."oauth_authorizations" (
    "id" UUID NOT NULL,
    "authorization_id" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "user_id" UUID,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "state" TEXT,
    "resource" TEXT,
    "code_challenge" TEXT,
    "code_challenge_method" "auth"."code_challenge_method",
    "response_type" "auth"."oauth_response_type" NOT NULL DEFAULT 'code',
    "status" "auth"."oauth_authorization_status" NOT NULL DEFAULT 'pending',
    "authorization_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (now() + '00:03:00'::interval),
    "approved_at" TIMESTAMPTZ(6),
    "nonce" TEXT,

    CONSTRAINT "oauth_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."oauth_client_states" (
    "id" UUID NOT NULL,
    "provider_type" TEXT NOT NULL,
    "code_verifier" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oauth_client_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."oauth_clients" (
    "id" UUID NOT NULL,
    "client_secret_hash" TEXT,
    "registration_type" "auth"."oauth_registration_type" NOT NULL,
    "redirect_uris" TEXT NOT NULL,
    "grant_types" TEXT NOT NULL,
    "client_name" TEXT,
    "client_uri" TEXT,
    "logo_uri" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "client_type" "auth"."oauth_client_type" NOT NULL DEFAULT 'confidential',
    "token_endpoint_auth_method" TEXT NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."oauth_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "scopes" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "oauth_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."one_time_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_type" "auth"."one_time_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "relates_to" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."refresh_tokens" (
    "instance_id" UUID,
    "id" BIGSERIAL NOT NULL,
    "token" VARCHAR(255),
    "user_id" VARCHAR(255),
    "revoked" BOOLEAN,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "parent" VARCHAR(255),
    "session_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."saml_providers" (
    "id" UUID NOT NULL,
    "sso_provider_id" UUID NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata_xml" TEXT NOT NULL,
    "metadata_url" TEXT,
    "attribute_mapping" JSONB,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "name_id_format" TEXT,

    CONSTRAINT "saml_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."saml_relay_states" (
    "id" UUID NOT NULL,
    "sso_provider_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "for_email" TEXT,
    "redirect_to" TEXT,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "flow_state_id" UUID,

    CONSTRAINT "saml_relay_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."schema_migrations" (
    "version" VARCHAR(255) NOT NULL,

    CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "auth"."sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "factor_id" UUID,
    "aal" "auth"."aal_level",
    "not_after" TIMESTAMPTZ(6),
    "refreshed_at" TIMESTAMP(6),
    "user_agent" TEXT,
    "ip" INET,
    "tag" TEXT,
    "oauth_client_id" UUID,
    "refresh_token_hmac_key" TEXT,
    "refresh_token_counter" BIGINT,
    "scopes" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."sso_domains" (
    "id" UUID NOT NULL,
    "sso_provider_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "sso_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."sso_providers" (
    "id" UUID NOT NULL,
    "resource_id" TEXT,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "disabled" BOOLEAN,

    CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."users" (
    "instance_id" UUID,
    "id" UUID NOT NULL,
    "aud" VARCHAR(255),
    "role" VARCHAR(255),
    "email" VARCHAR(255),
    "encrypted_password" VARCHAR(255),
    "email_confirmed_at" TIMESTAMPTZ(6),
    "invited_at" TIMESTAMPTZ(6),
    "confirmation_token" VARCHAR(255),
    "confirmation_sent_at" TIMESTAMPTZ(6),
    "recovery_token" VARCHAR(255),
    "recovery_sent_at" TIMESTAMPTZ(6),
    "email_change_token_new" VARCHAR(255),
    "email_change" VARCHAR(255),
    "email_change_sent_at" TIMESTAMPTZ(6),
    "last_sign_in_at" TIMESTAMPTZ(6),
    "raw_app_meta_data" JSONB,
    "raw_user_meta_data" JSONB,
    "is_super_admin" BOOLEAN,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "phone" TEXT,
    "phone_confirmed_at" TIMESTAMPTZ(6),
    "phone_change" TEXT DEFAULT '',
    "phone_change_token" VARCHAR(255) DEFAULT '',
    "phone_change_sent_at" TIMESTAMPTZ(6),
    -- ローカル baseline 注：本番 (Supabase) では DEFAULT LEAST(email_confirmed_at, phone_confirmed_at) だが、
    -- ネイティブ PostgreSQL は DDL の DEFAULT 内で他列参照を許容しないため、ローカルでは default 無しで生成。
    -- 運用上は Supabase 側が auth.users を管理するため影響無し。
    "confirmed_at" TIMESTAMPTZ(6),
    "email_change_token_current" VARCHAR(255) DEFAULT '',
    "email_change_confirm_status" SMALLINT DEFAULT 0,
    "banned_until" TIMESTAMPTZ(6),
    "reauthentication_token" VARCHAR(255) DEFAULT '',
    "reauthentication_sent_at" TIMESTAMPTZ(6),
    "is_sso_user" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."webauthn_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "challenge_type" TEXT NOT NULL,
    "session_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."webauthn_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "attestation_type" TEXT NOT NULL DEFAULT '',
    "aaguid" UUID,
    "sign_count" BIGINT NOT NULL DEFAULT 0,
    "transports" JSONB NOT NULL DEFAULT '[]',
    "backup_eligible" BOOLEAN NOT NULL DEFAULT false,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "friendly_name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AssignmentVehicle" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehicleName" TEXT NOT NULL,

    CONSTRAINT "AssignmentVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AssignmentWorker" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "workerId" TEXT,
    "workerName" TEXT NOT NULL,

    CONSTRAINT "AssignmentWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttendanceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "foremanId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'present',
    "earlyStartMinutes" INTEGER NOT NULL DEFAULT 0,
    "morningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "eveningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyEndTime" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillingDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "status" "public"."BillingDraftStatus" NOT NULL DEFAULT 'pending',
    "invoiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BillingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillingTitle" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,

    CONSTRAINT "BillingTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "color" TEXT,
    "createdBy" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarRemark" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarRemark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CellRemark" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "foremanId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CellRemark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChatMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "lastReadMessageId" TEXT,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChatRoom" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "projectMasterId" TEXT,
    "createdBy" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompanyInfo" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tel" TEXT NOT NULL,
    "fax" TEXT,
    "email" TEXT,
    "representative" TEXT NOT NULL,
    "sealImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "licenseNumber" TEXT,
    "registrationNumber" TEXT,
    "bankAccounts" JSONB,
    "representativeTitle" TEXT,
    "logoImage" TEXT,
    "contactPerson" TEXT,

    CONSTRAINT "CompanyInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConstructionContent" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConstructionSuffix" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionSuffix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConstructionType" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#a8c8e8',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CostMaster" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "unitPrice" DECIMAL(12,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "contactPersons" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "honorific" TEXT NOT NULL DEFAULT '御中',
    "updatedBy" TEXT,
    "postalCode" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyReport" (
    "id" TEXT NOT NULL,
    "foremanId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "morningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "eveningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyStartMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyReportWorkItem" (
    "id" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DailyReportWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Estimate" (
    "id" TEXT NOT NULL,
    "estimateNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "updatedBy" TEXT,
    "location" TEXT,
    "costTotal" INTEGER,
    "constructionPeriod" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EstimateVersion" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "estimateNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "location" TEXT,
    "costTotal" INTEGER,
    "constructionPeriod" TEXT,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "EstimateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryTransaction" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "materialItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Invoice" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paidDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvoiceProjectMaster" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceProjectMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvoiceTitleSuggestion" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceTitleSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvoiceVersion" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "paidDate" TIMESTAMP(3),
    "notes" TEXT,
    "estimateId" TEXT,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "projectMasterIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "InvoiceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoadingCheckItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "date" DATE NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "isChecked" BOOLEAN NOT NULL DEFAULT false,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadingCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Manager" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaterialCategory" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaterialItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "unit" TEXT NOT NULL DEFAULT '本',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "excludeFromStockDecrement" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaterialRequisition" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "foremanId" TEXT NOT NULL,
    "foremanName" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '出庫',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "vehicleInfo" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaterialRequisitionItem" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "vehicleLabel" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequisitionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MemberAdjustment" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "dateKey" TEXT NOT NULL,
    "adjustment" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MemberCountHistory" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "startDate" DATE NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberCountHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text',
    "parentId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MessageMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PartnerWorkVolume" (
    "id" TEXT NOT NULL,
    "partnerCompanyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "customerName" TEXT,
    "projectMasterId" TEXT,
    "projectTitle" TEXT NOT NULL,
    "managerName" TEXT,
    "constructionContent" TEXT,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "sourceAssignmentId" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "rowType" TEXT NOT NULL DEFAULT 'work',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "amountOverridden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartnerWorkVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PartnerWorkVolumeMonth" (
    "id" TEXT NOT NULL,
    "partnerCompanyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerWorkVolumeMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "alias" TEXT,
    "feeBearer" TEXT NOT NULL DEFAULT 'them',
    "bankName" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "accountHolder" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentSchedule" (
    "id" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentType" TEXT NOT NULL DEFAULT 'transfer',
    "payeeId" TEXT,
    "payeeName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "feeFlag" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "bankName" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "accountHolder" TEXT,

    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectAssignment" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "workers" TEXT,
    "vehicles" TEXT,
    "meetingTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "confirmedWorkerIds" TEXT,
    "confirmedVehicleIds" TEXT,
    "isDispatchConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "constructionType" TEXT,
    "estimatedHours" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "dispatchRemark" TEXT,
    "updatedBy" TEXT,
    "workStartedAt" TIMESTAMP(3),
    "workEndedAt" TIMESTAMP(3),
    "workStartedComment" TEXT,
    "workEndedComment" TEXT,
    "laborCostOverride" INTEGER,
    "vehicleCostOverride" INTEGER,
    "subcontractorCostOverride" INTEGER,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMaster" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "constructionType" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'active',
    "location" TEXT,
    "description" TEXT,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "area" DOUBLE PRECISION,
    "areaRemarks" TEXT,
    "city" TEXT,
    "constructionContent" TEXT,
    "contractAmount" INTEGER,
    "customerId" TEXT,
    "customerName" TEXT,
    "estimatedAssemblyWorkers" INTEGER,
    "estimatedDemolitionWorkers" INTEGER,
    "plusCode" TEXT,
    "postalCode" TEXT,
    "prefecture" TEXT,
    "scaffoldingSpec" JSONB,
    "materialCost" DECIMAL(12,2),
    "otherExpenses" DECIMAL(12,2),
    "customerShortName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "constructionSuffixId" TEXT,
    "honorific" TEXT,
    "name" TEXT,
    "updatedBy" TEXT,
    "scheduledStartDate" TIMESTAMP(3),
    "scheduledEndDate" TIMESTAMP(3),
    "managerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "siteShortName" TEXT,
    "loadingCost" DECIMAL(12,2),
    "revenueOverride" INTEGER,
    "roadPermitCompletionDate" TIMESTAMP(3),
    "roadPermitReceiveDate" TIMESTAMP(3),
    "roadPermitExpiryDate" TIMESTAMP(3),

    CONSTRAINT "ProjectMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMasterFile" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL DEFAULT 'other',
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailPath" TEXT,
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "originalSignedUrl" TEXT,
    "originalSignedUrlExpiresAt" TIMESTAMP(3),
    "originalStoragePath" TEXT,
    "sourceType" TEXT,

    CONSTRAINT "ProjectMasterFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMasterSubcontractorCost" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "constructionTypeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "transportCost" DECIMAL(12,2),

    CONSTRAINT "ProjectMasterSubcontractorCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMaterialItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "projectMasterId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "requiredQuantity" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScaffoldingSpecGroup" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScaffoldingSpecGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScaffoldingSpecItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'toggle',
    "options" JSONB,
    "legacyKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasText" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScaffoldingSpecItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScheduleChangeHistory" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeType" TEXT NOT NULL,
    "previousValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,

    CONSTRAINT "ScheduleChangeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SiteSurvey" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "workType" TEXT,
    "managerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduledDate" TIMESTAMP(3),
    "notes" TEXT,
    "handoffNotes" TEXT,
    "arrivalTime" TEXT,
    "vehicleSpec" TEXT,
    "drawingData" JSONB NOT NULL,
    "scaffoldSpec" JSONB,
    "surroundings" JSONB,
    "perimeter" DOUBLE PRECISION,
    "floorArea" DOUBLE PRECISION,
    "scaffoldArea" DOUBLE PRECISION,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SiteSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "totalMembers" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "laborDailyRate" DECIMAL(10,2) NOT NULL DEFAULT 18000,
    "standardWorkMinutes" INTEGER NOT NULL DEFAULT 480,
    "displayedForemanIds" TEXT NOT NULL DEFAULT '[]',
    "subcontractorRevenueRate" INTEGER NOT NULL DEFAULT 60,
    "subcontractorAssemblyRate" INTEGER NOT NULL DEFAULT 60,
    "subcontractorDemolitionRate" INTEGER NOT NULL DEFAULT 40,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UnitPriceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,

    CONSTRAINT "UnitPriceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UnitPriceMaster" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "templates" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT,
    "quantity" DOUBLE PRECISION,

    CONSTRAINT "UnitPriceMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UnitPriceSpecification" (
    "id" TEXT NOT NULL,
    "unitPriceMasterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitPriceSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UnitPriceTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitPriceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "assignedProjects" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT,
    "dailyRate" DECIMAL(10,2),
    "dispatchSortOrder" INTEGER,
    "hideByDefaultInDispatch" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT,
    "isLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "partnerTaxMode" TEXT NOT NULL DEFAULT 'exclusive',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayedForemanIds" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VacationRecord" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "employeeIds" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Vehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dailyRate" DECIMAL(10,2),

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VehicleHandoverNotice" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fromAssignmentId" TEXT NOT NULL,
    "toAssignmentId" TEXT NOT NULL,
    "notifiedUserIds" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "VehicleHandoverNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkReportReply" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkReportReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dailyRate" DECIMAL(65,30),

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."profiles" (
    "id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6),
    "company_name" TEXT,
    "display_name" TEXT,
    "email" TEXT,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_instance_id_idx" ON "auth"."audit_log_entries"("instance_id" ASC);

-- CreateIndex
CREATE INDEX "custom_oauth_providers_created_at_idx" ON "auth"."custom_oauth_providers"("created_at" ASC);

-- CreateIndex
CREATE INDEX "custom_oauth_providers_enabled_idx" ON "auth"."custom_oauth_providers"("enabled" ASC);

-- CreateIndex
CREATE INDEX "custom_oauth_providers_identifier_idx" ON "auth"."custom_oauth_providers"("identifier" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "custom_oauth_providers_identifier_key" ON "auth"."custom_oauth_providers"("identifier" ASC);

-- CreateIndex
CREATE INDEX "custom_oauth_providers_provider_type_idx" ON "auth"."custom_oauth_providers"("provider_type" ASC);

-- CreateIndex
CREATE INDEX "flow_state_created_at_idx" ON "auth"."flow_state"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_auth_code" ON "auth"."flow_state"("auth_code" ASC);

-- CreateIndex
CREATE INDEX "idx_user_id_auth_method" ON "auth"."flow_state"("user_id" ASC, "authentication_method" ASC);

-- CreateIndex
CREATE INDEX "identities_email_idx" ON "auth"."identities"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_id_provider_unique" ON "auth"."identities"("provider_id" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "identities_user_id_idx" ON "auth"."identities"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_amr_claims_session_id_authentication_method_pkey" ON "auth"."mfa_amr_claims"("session_id" ASC, "authentication_method" ASC);

-- CreateIndex
CREATE INDEX "mfa_challenge_created_at_idx" ON "auth"."mfa_challenges"("created_at" DESC);

-- CreateIndex
CREATE INDEX "factor_id_created_at_idx" ON "auth"."mfa_factors"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_last_challenged_at_key" ON "auth"."mfa_factors"("last_challenged_at" ASC);

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_idx" ON "auth"."mfa_factors"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_phone_factor_per_user" ON "auth"."mfa_factors"("user_id" ASC, "phone" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorizations_authorization_code_key" ON "auth"."oauth_authorizations"("authorization_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorizations_authorization_id_key" ON "auth"."oauth_authorizations"("authorization_id" ASC);

-- CreateIndex
CREATE INDEX "idx_oauth_client_states_created_at" ON "auth"."oauth_client_states"("created_at" ASC);

-- CreateIndex
CREATE INDEX "oauth_clients_deleted_at_idx" ON "auth"."oauth_clients"("deleted_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_consents_user_client_unique" ON "auth"."oauth_consents"("user_id" ASC, "client_id" ASC);

-- CreateIndex
CREATE INDEX "oauth_consents_user_order_idx" ON "auth"."oauth_consents"("user_id" ASC, "granted_at" DESC);

-- CreateIndex
-- ローカル baseline 注：本番 (Supabase) は USING HASH ("relates_to" ASC) だが、PostgreSQL の HASH は ASC/DESC を許容しないため ASC を除去。
CREATE INDEX "one_time_tokens_relates_to_hash_idx" ON "auth"."one_time_tokens" USING HASH ("relates_to");

-- CreateIndex
-- ローカル baseline 注：本番 (Supabase) は USING HASH ("token_hash" ASC) だが、PostgreSQL の HASH は ASC/DESC を許容しないため ASC を除去。
CREATE INDEX "one_time_tokens_token_hash_hash_idx" ON "auth"."one_time_tokens" USING HASH ("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_user_id_token_type_key" ON "auth"."one_time_tokens"("user_id" ASC, "token_type" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_instance_id_idx" ON "auth"."refresh_tokens"("instance_id" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_instance_id_user_id_idx" ON "auth"."refresh_tokens"("instance_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_parent_idx" ON "auth"."refresh_tokens"("parent" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_revoked_idx" ON "auth"."refresh_tokens"("session_id" ASC, "revoked" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_unique" ON "auth"."refresh_tokens"("token" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_updated_at_idx" ON "auth"."refresh_tokens"("updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "saml_providers_entity_id_key" ON "auth"."saml_providers"("entity_id" ASC);

-- CreateIndex
CREATE INDEX "saml_providers_sso_provider_id_idx" ON "auth"."saml_providers"("sso_provider_id" ASC);

-- CreateIndex
CREATE INDEX "saml_relay_states_created_at_idx" ON "auth"."saml_relay_states"("created_at" DESC);

-- CreateIndex
CREATE INDEX "saml_relay_states_for_email_idx" ON "auth"."saml_relay_states"("for_email" ASC);

-- CreateIndex
CREATE INDEX "saml_relay_states_sso_provider_id_idx" ON "auth"."saml_relay_states"("sso_provider_id" ASC);

-- CreateIndex
CREATE INDEX "sessions_not_after_idx" ON "auth"."sessions"("not_after" DESC);

-- CreateIndex
CREATE INDEX "sessions_oauth_client_id_idx" ON "auth"."sessions"("oauth_client_id" ASC);

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_id_created_at_idx" ON "auth"."sessions"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "sso_domains_sso_provider_id_idx" ON "auth"."sso_domains"("sso_provider_id" ASC);

-- CreateIndex
CREATE INDEX "sso_providers_resource_id_pattern_idx" ON "auth"."sso_providers"("resource_id" ASC);

-- CreateIndex
CREATE INDEX "users_instance_id_idx" ON "auth"."users"("instance_id" ASC);

-- CreateIndex
CREATE INDEX "users_is_anonymous_idx" ON "auth"."users"("is_anonymous" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "auth"."users"("phone" ASC);

-- CreateIndex
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "auth"."webauthn_challenges"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "webauthn_challenges_user_id_idx" ON "auth"."webauthn_challenges"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "auth"."webauthn_credentials"("credential_id" ASC);

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "auth"."webauthn_credentials"("user_id" ASC);

-- CreateIndex
CREATE INDEX "AssignmentVehicle_assignmentId_idx" ON "public"."AssignmentVehicle"("assignmentId" ASC);

-- CreateIndex
CREATE INDEX "AssignmentVehicle_vehicleName_idx" ON "public"."AssignmentVehicle"("vehicleName" ASC);

-- CreateIndex
CREATE INDEX "AssignmentWorker_assignmentId_idx" ON "public"."AssignmentWorker"("assignmentId" ASC);

-- CreateIndex
CREATE INDEX "AssignmentWorker_workerId_idx" ON "public"."AssignmentWorker"("workerId" ASC);

-- CreateIndex
CREATE INDEX "AssignmentWorker_workerName_idx" ON "public"."AssignmentWorker"("workerName" ASC);

-- CreateIndex
CREATE INDEX "AttendanceRecord_date_idx" ON "public"."AttendanceRecord"("date" ASC);

-- CreateIndex
CREATE INDEX "AttendanceRecord_foremanId_date_idx" ON "public"."AttendanceRecord"("foremanId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "AttendanceRecord_foremanId_idx" ON "public"."AttendanceRecord"("foremanId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_date_key" ON "public"."AttendanceRecord"("userId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "AttendanceRecord_userId_idx" ON "public"."AttendanceRecord"("userId" ASC);

-- CreateIndex
CREATE INDEX "BillingDraft_customerId_status_idx" ON "public"."BillingDraft"("customerId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "BillingDraft_deletedAt_idx" ON "public"."BillingDraft"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "BillingDraft_invoiceId_idx" ON "public"."BillingDraft"("invoiceId" ASC);

-- CreateIndex
CREATE INDEX "BillingDraft_projectId_status_idx" ON "public"."BillingDraft"("projectId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "BillingTitle_name_idx" ON "public"."BillingTitle"("name" ASC);

-- CreateIndex
CREATE INDEX "BillingTitle_sortOrder_idx" ON "public"."BillingTitle"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_category_idx" ON "public"."CalendarEvent"("category" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_createdBy_idx" ON "public"."CalendarEvent"("createdBy" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_projectMasterId_idx" ON "public"."CalendarEvent"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_startAt_idx" ON "public"."CalendarEvent"("startAt" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_visibility_startAt_idx" ON "public"."CalendarEvent"("visibility" ASC, "startAt" ASC);

-- CreateIndex
CREATE INDEX "CalendarRemark_dateKey_idx" ON "public"."CalendarRemark"("dateKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarRemark_dateKey_key" ON "public"."CalendarRemark"("dateKey" ASC);

-- CreateIndex
CREATE INDEX "CellRemark_dateKey_idx" ON "public"."CellRemark"("dateKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CellRemark_foremanId_dateKey_key" ON "public"."CellRemark"("foremanId" ASC, "dateKey" ASC);

-- CreateIndex
CREATE INDEX "CellRemark_foremanId_idx" ON "public"."CellRemark"("foremanId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_roomId_userId_key" ON "public"."ChatMember"("roomId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "ChatMember_userId_lastReadAt_idx" ON "public"."ChatMember"("userId" ASC, "lastReadAt" ASC);

-- CreateIndex
CREATE INDEX "ChatRoom_lastMessageAt_idx" ON "public"."ChatRoom"("lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "ChatRoom_projectMasterId_idx" ON "public"."ChatRoom"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "ChatRoom_type_idx" ON "public"."ChatRoom"("type" ASC);

-- CreateIndex
CREATE INDEX "ConstructionContent_name_idx" ON "public"."ConstructionContent"("name" ASC);

-- CreateIndex
CREATE INDEX "ConstructionContent_sortOrder_idx" ON "public"."ConstructionContent"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "ConstructionSuffix_name_idx" ON "public"."ConstructionSuffix"("name" ASC);

-- CreateIndex
CREATE INDEX "ConstructionSuffix_sortOrder_idx" ON "public"."ConstructionSuffix"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "ConstructionType_name_idx" ON "public"."ConstructionType"("name" ASC);

-- CreateIndex
CREATE INDEX "ConstructionType_sortOrder_idx" ON "public"."ConstructionType"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "CostMaster_name_idx" ON "public"."CostMaster"("name" ASC);

-- CreateIndex
CREATE INDEX "CostMaster_sortOrder_idx" ON "public"."CostMaster"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "public"."Customer"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "public"."Customer"("name" ASC);

-- CreateIndex
CREATE INDEX "Customer_updatedAt_idx" ON "public"."Customer"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "idx_customer_name" ON "public"."Customer"("name" ASC);

-- CreateIndex
CREATE INDEX "DailyReport_date_idx" ON "public"."DailyReport"("date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_foremanId_date_key" ON "public"."DailyReport"("foremanId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "DailyReport_foremanId_idx" ON "public"."DailyReport"("foremanId" ASC);

-- CreateIndex
CREATE INDEX "DailyReportWorkItem_assignmentId_idx" ON "public"."DailyReportWorkItem"("assignmentId" ASC);

-- CreateIndex
CREATE INDEX "DailyReportWorkItem_dailyReportId_idx" ON "public"."DailyReportWorkItem"("dailyReportId" ASC);

-- CreateIndex
CREATE INDEX "Estimate_createdAt_idx" ON "public"."Estimate"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Estimate_customerId_idx" ON "public"."Estimate"("customerId" ASC);

-- CreateIndex
CREATE INDEX "Estimate_estimateNumber_idx" ON "public"."Estimate"("estimateNumber" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_estimateNumber_key" ON "public"."Estimate"("estimateNumber" ASC);

-- CreateIndex
CREATE INDEX "Estimate_projectMasterId_idx" ON "public"."Estimate"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "Estimate_status_idx" ON "public"."Estimate"("status" ASC);

-- CreateIndex
CREATE INDEX "Estimate_updatedAt_idx" ON "public"."Estimate"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "idx_estimate_created" ON "public"."Estimate"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_estimate_status" ON "public"."Estimate"("status" ASC);

-- CreateIndex
CREATE INDEX "EstimateVersion_estimateId_versionNumber_idx" ON "public"."EstimateVersion"("estimateId" ASC, "versionNumber" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "EstimateVersion_estimateId_versionNumber_key" ON "public"."EstimateVersion"("estimateId" ASC, "versionNumber" ASC);

-- CreateIndex
CREATE INDEX "InventoryTransaction_createdAt_idx" ON "public"."InventoryTransaction"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "InventoryTransaction_materialItemId_idx" ON "public"."InventoryTransaction"("materialItemId" ASC);

-- CreateIndex
CREATE INDEX "Invoice_createdAt_idx" ON "public"."Invoice"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "public"."Invoice"("customerId" ASC);

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "public"."Invoice"("dueDate" ASC);

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "public"."Invoice"("invoiceNumber" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "public"."Invoice"("invoiceNumber" ASC);

-- CreateIndex
CREATE INDEX "Invoice_projectMasterId_idx" ON "public"."Invoice"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "public"."Invoice"("status" ASC);

-- CreateIndex
CREATE INDEX "Invoice_updatedAt_idx" ON "public"."Invoice"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "InvoiceProjectMaster_invoiceId_idx" ON "public"."InvoiceProjectMaster"("invoiceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceProjectMaster_invoiceId_projectMasterId_key" ON "public"."InvoiceProjectMaster"("invoiceId" ASC, "projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "InvoiceProjectMaster_projectMasterId_idx" ON "public"."InvoiceProjectMaster"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "InvoiceTitleSuggestion_name_idx" ON "public"."InvoiceTitleSuggestion"("name" ASC);

-- CreateIndex
CREATE INDEX "InvoiceTitleSuggestion_sortOrder_idx" ON "public"."InvoiceTitleSuggestion"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "InvoiceVersion_invoiceId_versionNumber_idx" ON "public"."InvoiceVersion"("invoiceId" ASC, "versionNumber" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceVersion_invoiceId_versionNumber_key" ON "public"."InvoiceVersion"("invoiceId" ASC, "versionNumber" ASC);

-- CreateIndex
CREATE INDEX "LoadingCheckItem_date_vehicleId_idx" ON "public"."LoadingCheckItem"("date" ASC, "vehicleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LoadingCheckItem_date_vehicleId_materialItemId_projectMasterId_" ON "public"."LoadingCheckItem"("date" ASC, "vehicleId" ASC, "materialItemId" ASC, "projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "Manager_name_idx" ON "public"."Manager"("name" ASC);

-- CreateIndex
CREATE INDEX "MaterialCategory_name_idx" ON "public"."MaterialCategory"("name" ASC);

-- CreateIndex
CREATE INDEX "MaterialCategory_sortOrder_idx" ON "public"."MaterialCategory"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "MaterialItem_categoryId_idx" ON "public"."MaterialItem"("categoryId" ASC);

-- CreateIndex
CREATE INDEX "MaterialItem_sortOrder_idx" ON "public"."MaterialItem"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "MaterialRequisition_date_idx" ON "public"."MaterialRequisition"("date" ASC);

-- CreateIndex
CREATE INDEX "MaterialRequisition_foremanId_idx" ON "public"."MaterialRequisition"("foremanId" ASC);

-- CreateIndex
CREATE INDEX "MaterialRequisition_projectMasterId_idx" ON "public"."MaterialRequisition"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "MaterialRequisition_status_idx" ON "public"."MaterialRequisition"("status" ASC);

-- CreateIndex
CREATE INDEX "MaterialRequisitionItem_materialItemId_idx" ON "public"."MaterialRequisitionItem"("materialItemId" ASC);

-- CreateIndex
CREATE INDEX "MaterialRequisitionItem_requisitionId_idx" ON "public"."MaterialRequisitionItem"("requisitionId" ASC);

-- CreateIndex
CREATE INDEX "MemberAdjustment_dateKey_idx" ON "public"."MemberAdjustment"("dateKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MemberAdjustment_dateKey_key" ON "public"."MemberAdjustment"("dateKey" ASC);

-- CreateIndex
CREATE INDEX "MemberCountHistory_startDate_idx" ON "public"."MemberCountHistory"("startDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MemberCountHistory_startDate_key" ON "public"."MemberCountHistory"("startDate" ASC);

-- CreateIndex
CREATE INDEX "Message_roomId_createdAt_idx" ON "public"."Message"("roomId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "public"."Message"("senderId" ASC);

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "public"."MessageAttachment"("messageId" ASC);

-- CreateIndex
CREATE INDEX "MessageMention_messageId_idx" ON "public"."MessageMention"("messageId" ASC);

-- CreateIndex
CREATE INDEX "MessageMention_targetType_targetId_idx" ON "public"."MessageMention"("targetType" ASC, "targetId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MessageRead_messageId_userId_key" ON "public"."MessageRead"("messageId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "MessageRead_userId_idx" ON "public"."MessageRead"("userId" ASC);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "public"."Notification"("userId" ASC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "public"."Notification"("userId" ASC, "readAt" ASC);

-- CreateIndex
CREATE INDEX "PartnerWorkVolume_date_idx" ON "public"."PartnerWorkVolume"("date" ASC);

-- CreateIndex
CREATE INDEX "PartnerWorkVolume_partnerCompanyId_date_deletedAt_idx" ON "public"."PartnerWorkVolume"("partnerCompanyId" ASC, "date" ASC, "deletedAt" ASC);

-- CreateIndex
CREATE INDEX "PartnerWorkVolume_partnerCompanyId_date_idx" ON "public"."PartnerWorkVolume"("partnerCompanyId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "PartnerWorkVolume_partnerCompanyId_status_idx" ON "public"."PartnerWorkVolume"("partnerCompanyId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWorkVolume_sourceAssignmentId_rowType_key" ON "public"."PartnerWorkVolume"("sourceAssignmentId" ASC, "rowType" ASC);

-- CreateIndex
CREATE INDEX "PartnerWorkVolumeMonth_partnerCompanyId_idx" ON "public"."PartnerWorkVolumeMonth"("partnerCompanyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWorkVolumeMonth_partnerCompanyId_year_month_key" ON "public"."PartnerWorkVolumeMonth"("partnerCompanyId" ASC, "year" ASC, "month" ASC);

-- CreateIndex
CREATE INDEX "Payee_isActive_idx" ON "public"."Payee"("isActive" ASC);

-- CreateIndex
CREATE INDEX "Payee_name_idx" ON "public"."Payee"("name" ASC);

-- CreateIndex
CREATE INDEX "PaymentSchedule_isPaid_idx" ON "public"."PaymentSchedule"("isPaid" ASC);

-- CreateIndex
CREATE INDEX "PaymentSchedule_payeeId_idx" ON "public"."PaymentSchedule"("payeeId" ASC);

-- CreateIndex
CREATE INDEX "PaymentSchedule_paymentDate_idx" ON "public"."PaymentSchedule"("paymentDate" ASC);

-- CreateIndex
CREATE INDEX "PaymentSchedule_paymentDate_paymentType_idx" ON "public"."PaymentSchedule"("paymentDate" ASC, "paymentType" ASC);

-- CreateIndex
CREATE INDEX "PaymentSchedule_paymentType_idx" ON "public"."PaymentSchedule"("paymentType" ASC);

-- CreateIndex
CREATE INDEX "ProjectAssignment_assignedEmployeeId_idx" ON "public"."ProjectAssignment"("assignedEmployeeId" ASC);

-- CreateIndex
CREATE INDEX "ProjectAssignment_constructionType_idx" ON "public"."ProjectAssignment"("constructionType" ASC);

-- CreateIndex
CREATE INDEX "ProjectAssignment_date_idx" ON "public"."ProjectAssignment"("date" ASC);

-- CreateIndex
CREATE INDEX "ProjectAssignment_isDispatchConfirmed_idx" ON "public"."ProjectAssignment"("isDispatchConfirmed" ASC);

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectMasterId_idx" ON "public"."ProjectAssignment"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_date" ON "public"."ProjectAssignment"("date" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_employee_date" ON "public"."ProjectAssignment"("assignedEmployeeId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "idx_assignment_project_master" ON "public"."ProjectAssignment"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "ProjectMaster_createdAt_idx" ON "public"."ProjectMaster"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ProjectMaster_customerId_idx" ON "public"."ProjectMaster"("customerId" ASC);

-- CreateIndex
CREATE INDEX "ProjectMaster_customerName_idx" ON "public"."ProjectMaster"("customerName" ASC);

-- CreateIndex
CREATE INDEX "ProjectMaster_status_idx" ON "public"."ProjectMaster"("status" ASC);

-- CreateIndex
CREATE INDEX "ProjectMaster_title_idx" ON "public"."ProjectMaster"("title" ASC);

-- CreateIndex
CREATE INDEX "idx_project_master_customer" ON "public"."ProjectMaster"("customerId" ASC);

-- CreateIndex
CREATE INDEX "idx_project_master_title" ON "public"."ProjectMaster"("title" ASC);

-- CreateIndex
CREATE INDEX "ProjectMasterFile_projectMasterId_idx" ON "public"."ProjectMasterFile"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "ProjectMasterSubcontractorCost_constructionTypeId_idx" ON "public"."ProjectMasterSubcontractorCost"("constructionTypeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMasterSubcontractorCost_projectMasterId_constructionType" ON "public"."ProjectMasterSubcontractorCost"("projectMasterId" ASC, "constructionTypeId" ASC);

-- CreateIndex
CREATE INDEX "ProjectMasterSubcontractorCost_projectMasterId_idx" ON "public"."ProjectMasterSubcontractorCost"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "ProjectMaterialItem_projectMasterId_idx" ON "public"."ProjectMaterialItem"("projectMasterId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMaterialItem_projectMasterId_materialItemId_key" ON "public"."ProjectMaterialItem"("projectMasterId" ASC, "materialItemId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "public"."PushSubscription"("endpoint" ASC);

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "public"."PushSubscription"("userId" ASC);

-- CreateIndex
CREATE INDEX "ScaffoldingSpecGroup_sortOrder_idx" ON "public"."ScaffoldingSpecGroup"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "ScaffoldingSpecItem_groupId_idx" ON "public"."ScaffoldingSpecItem"("groupId" ASC);

-- CreateIndex
CREATE INDEX "ScaffoldingSpecItem_sortOrder_idx" ON "public"."ScaffoldingSpecItem"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_assignmentId_idx" ON "public"."ScheduleChangeHistory"("assignmentId" ASC);

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_changedAt_idx" ON "public"."ScheduleChangeHistory"("changedAt" ASC);

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_changedById_idx" ON "public"."ScheduleChangeHistory"("changedById" ASC);

-- CreateIndex
CREATE INDEX "SiteSurvey_createdAt_idx" ON "public"."SiteSurvey"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "SiteSurvey_projectMasterId_idx" ON "public"."SiteSurvey"("projectMasterId" ASC);

-- CreateIndex
CREATE INDEX "UnitPriceCategory_sortOrder_idx" ON "public"."UnitPriceCategory"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "UnitPriceMaster_categoryId_idx" ON "public"."UnitPriceMaster"("categoryId" ASC);

-- CreateIndex
CREATE INDEX "UnitPriceMaster_description_idx" ON "public"."UnitPriceMaster"("description" ASC);

-- CreateIndex
CREATE INDEX "UnitPriceSpecification_sortOrder_idx" ON "public"."UnitPriceSpecification"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "UnitPriceSpecification_unitPriceMasterId_idx" ON "public"."UnitPriceSpecification"("unitPriceMasterId" ASC);

-- CreateIndex
CREATE INDEX "UnitPriceTemplate_sortOrder_idx" ON "public"."UnitPriceTemplate"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "public"."User"("companyId" ASC);

-- CreateIndex
CREATE INDEX "User_email_idx" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role" ASC);

-- CreateIndex
CREATE INDEX "User_teamId_idx" ON "public"."User"("teamId" ASC);

-- CreateIndex
CREATE INDEX "User_username_idx" ON "public"."User"("username" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username" ASC);

-- CreateIndex
CREATE INDEX "UserNotificationPreference_userId_idx" ON "public"."UserNotificationPreference"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_userId_type_key" ON "public"."UserNotificationPreference"("userId" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "UserSettings_userId_idx" ON "public"."UserSettings"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "public"."UserSettings"("userId" ASC);

-- CreateIndex
CREATE INDEX "VacationRecord_dateKey_idx" ON "public"."VacationRecord"("dateKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VacationRecord_dateKey_key" ON "public"."VacationRecord"("dateKey" ASC);

-- CreateIndex
CREATE INDEX "Vehicle_name_idx" ON "public"."Vehicle"("name" ASC);

-- CreateIndex
CREATE INDEX "VehicleHandoverNotice_fromAssignmentId_idx" ON "public"."VehicleHandoverNotice"("fromAssignmentId" ASC);

-- CreateIndex
CREATE INDEX "VehicleHandoverNotice_toAssignmentId_idx" ON "public"."VehicleHandoverNotice"("toAssignmentId" ASC);

-- CreateIndex
CREATE INDEX "VehicleHandoverNotice_vehicleId_canceledAt_idx" ON "public"."VehicleHandoverNotice"("vehicleId" ASC, "canceledAt" ASC);

-- CreateIndex
CREATE INDEX "WorkReportReply_assignmentId_reportType_idx" ON "public"."WorkReportReply"("assignmentId" ASC, "reportType" ASC);

-- CreateIndex
CREATE INDEX "WorkReportReply_authorId_idx" ON "public"."WorkReportReply"("authorId" ASC);

-- CreateIndex
CREATE INDEX "Worker_name_idx" ON "public"."Worker"("name" ASC);

-- AddForeignKey
ALTER TABLE "auth"."identities" ADD CONSTRAINT "identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."mfa_amr_claims" ADD CONSTRAINT "mfa_amr_claims_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."mfa_challenges" ADD CONSTRAINT "mfa_challenges_auth_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "auth"."mfa_factors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."oauth_consents" ADD CONSTRAINT "oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."saml_providers" ADD CONSTRAINT "saml_providers_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."saml_relay_states" ADD CONSTRAINT "saml_relay_states_flow_state_id_fkey" FOREIGN KEY ("flow_state_id") REFERENCES "auth"."flow_state"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."saml_relay_states" ADD CONSTRAINT "saml_relay_states_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."sso_domains" ADD CONSTRAINT "sso_domains_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth"."webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."AssignmentVehicle" ADD CONSTRAINT "AssignmentVehicle_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssignmentWorker" ADD CONSTRAINT "AssignmentWorker_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."ProjectMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChatMember" ADD CONSTRAINT "ChatMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyReportWorkItem" ADD CONSTRAINT "DailyReportWorkItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyReportWorkItem" ADD CONSTRAINT "DailyReportWorkItem_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "public"."DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "public"."MaterialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaterialItem" ADD CONSTRAINT "MaterialItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."MaterialCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaterialRequisitionItem" ADD CONSTRAINT "MaterialRequisitionItem_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "public"."MaterialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaterialRequisitionItem" ADD CONSTRAINT "MaterialRequisitionItem_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "public"."MaterialRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "public"."Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMasterFile" ADD CONSTRAINT "ProjectMasterFile_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMasterSubcontractorCost" ADD CONSTRAINT "ProjectMasterSubcontractorCost_constructionTypeId_fkey" FOREIGN KEY ("constructionTypeId") REFERENCES "public"."ConstructionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMasterSubcontractorCost" ADD CONSTRAINT "ProjectMasterSubcontractorCost_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMaterialItem" ADD CONSTRAINT "ProjectMaterialItem_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "public"."MaterialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMaterialItem" ADD CONSTRAINT "ProjectMaterialItem_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScaffoldingSpecItem" ADD CONSTRAINT "ScaffoldingSpecItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."ScaffoldingSpecGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScheduleChangeHistory" ADD CONSTRAINT "ScheduleChangeHistory_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SiteSurvey" ADD CONSTRAINT "SiteSurvey_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UnitPriceMaster" ADD CONSTRAINT "UnitPriceMaster_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."UnitPriceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UnitPriceSpecification" ADD CONSTRAINT "UnitPriceSpecification_unitPriceMasterId_fkey" FOREIGN KEY ("unitPriceMasterId") REFERENCES "public"."UnitPriceMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkReportReply" ADD CONSTRAINT "WorkReportReply_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- ============================================================================
-- Prisma 拾い損ね分の追補（pg_dump --schema-only から手動 merge）
-- 1) 部分ユニーク制約: InventoryTransaction_idempotencyKey_key
--    Prisma の @@unique は WHERE 句付き unique index を表現できないため
-- 2) 改ざん防止関数 + トリガ: protect_confirmed_billing_draft
--    Prisma の introspection は関数/トリガを拾わない
-- ============================================================================

-- 部分ユニーク (InventoryTransaction.idempotencyKey)
CREATE UNIQUE INDEX "InventoryTransaction_idempotencyKey_key"
  ON public."InventoryTransaction" USING btree ("idempotencyKey")
  WHERE ("idempotencyKey" IS NOT NULL);

-- 改ざん防止関数
CREATE FUNCTION public.protect_confirmed_billing_draft() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN
    IF NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
       OR NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
      RAISE EXCEPTION 'Cannot modify amount/projectId/customerId of confirmed BillingDraft (id: %)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 改ざん防止トリガ
CREATE TRIGGER trg_protect_confirmed_billing_draft
  BEFORE UPDATE ON public."BillingDraft"
  FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_billing_draft();
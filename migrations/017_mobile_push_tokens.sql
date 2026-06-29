-- Migration: 017_mobile_push_tokens
-- Device push tokens for native iOS/Android price-alert notifications.

CREATE TABLE IF NOT EXISTS "MobilePushToken" (
    id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"      text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    platform      text NOT NULL CHECK (platform IN ('ios', 'android')),
    token         text NOT NULL,
    "deviceId"    text,
    "appVersion"  text,
    "createdAt"   timestamptz NOT NULL DEFAULT now(),
    "lastSeenAt"  timestamptz NOT NULL DEFAULT now(),
    "disabledAt"  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_push_platform_token
    ON "MobilePushToken" (platform, token);

CREATE INDEX IF NOT EXISTS idx_mobile_push_user_active
    ON "MobilePushToken" ("userId")
    WHERE "disabledAt" IS NULL;

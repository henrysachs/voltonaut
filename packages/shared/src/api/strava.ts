import { z } from "zod";

const EmptyStatus = (
  status:
    | "disabled"
    | "registration_required"
    | "disconnected"
    | "confirmation_expired"
    | "credentials_unavailable"
    | "refreshing"
    | "credentials_uncertain"
    | "reauthorization_required"
    | "revocation_pending",
) => z.object({ status: z.literal(status) }).strict();

export const StravaStatusSchema = z.union([
  EmptyStatus("disabled"),
  EmptyStatus("registration_required"),
  EmptyStatus("disconnected"),
  EmptyStatus("confirmation_expired"),
  EmptyStatus("credentials_unavailable"),
  EmptyStatus("refreshing"),
  EmptyStatus("credentials_uncertain"),
  EmptyStatus("reauthorization_required"),
  EmptyStatus("revocation_pending"),
  z.object({ status: z.literal("pending"), confirmBy: z.string().datetime() }).strict(),
  z
    .object({
      status: z.literal("connected"),
      athleteId: z.string().regex(/^[1-9]\d*$/u),
      scope: z.literal("activity:write"),
      accessExpiresAt: z.string().datetime(),
    })
    .strict(),
]);

export const StravaChannelSchema = z.string().uuid();

export const StravaStartRequestSchema = z
  .object({ action: z.literal("connect"), channel: StravaChannelSchema })
  .strict();

export const StravaStartResponseSchema = z.object({ authorizationUrl: z.string().url() }).strict();

export const StravaConfirmRequestSchema = z
  .object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict();

export const StravaDisconnectRequestSchema = z.object({ action: z.literal("disconnect") }).strict();

export type StravaStatus = z.infer<typeof StravaStatusSchema>;

export type StravaStartRequest = z.infer<typeof StravaStartRequestSchema>;

export type StravaStartResponse = z.infer<typeof StravaStartResponseSchema>;

export type StravaConfirmRequest = z.infer<typeof StravaConfirmRequestSchema>;

export type StravaDisconnectRequest = z.infer<typeof StravaDisconnectRequestSchema>;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const StravaRemoteIdSchema = z.string().regex(/^[1-9]\d{0,19}$/u);
export const STRAVA_NOTICE_REVISION = "virtual-ride-1";

export const StravaConsentSchema = z
  .object({
    rideId: z.string().uuid(),
    payloadHash: HashSchema,
    exportHash: HashSchema,
    exportVersion: z.literal("tcx-1"),
    connectionGeneration: z.string().min(1).max(64),
    athleteId: StravaRemoteIdSchema,
    sourcePolicy: z.literal("declared_ble_v1"),
    noticeRevision: z.literal(STRAVA_NOTICE_REVISION),
  })
  .strict();

export const StravaReceiptSchema = z
  .object({
    uploadId: StravaRemoteIdSchema,
    externalId: z.string().regex(/^voltonaut-[a-f0-9-]{36}\.tcx$/u),
  })
  .strict();

const TimeSchema = z.number().int().nonnegative().safe();

export const StravaProgressSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), notBeforeMs: TimeSchema }).strict(),
  z
    .object({ kind: z.literal("preparing"), owner: z.string().uuid(), leaseUntilMs: TimeSchema })
    .strict(),
  z
    .object({
      kind: z.literal("submitting"),
      attemptId: z.string().uuid(),
      startedAtMs: TimeSchema,
      leaseUntilMs: TimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("submission_unknown"),
      attemptId: z.string().uuid(),
      reason: z.enum(["response_lost", "crash", "protocol"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("processing"),
      receipt: StravaReceiptSchema,
      nextPollAtMs: TimeSchema,
      issue: z.enum(["none", "authorization", "rate_limit", "network", "protocol"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delivered"),
      receipt: StravaReceiptSchema,
      activityId: StravaRemoteIdSchema,
      confirmedAtMs: TimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("submission_rejected"),
      reason: z.enum(["authorization", "rate_limit", "file", "provider"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("processing_rejected"),
      receipt: StravaReceiptSchema,
      reason: z.literal("provider_error"),
    })
    .strict(),
]);

export const StravaAuthoritySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("consented"),
      consent: StravaConsentSchema,
      consentedAtMs: TimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("stopped"),
      consent: StravaConsentSchema,
      stoppedAtMs: TimeSchema,
      reason: z.enum(["disconnect", "credentials", "policy"]),
    })
    .strict(),
]);

export const StravaDeliverySchema = z
  .object({
    deliveryId: z.string().uuid(),
    rideId: z.string().uuid(),
    authority: StravaAuthoritySchema,
    progress: StravaProgressSchema,
  })
  .strict();

export const StravaRideViewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("blocked"),
      reason: z.enum([
        "source_policy_disabled",
        "not_replayed",
        "window_source",
        "connection_disabled",
        "registration_required",
        "connection_missing",
        "confirmation_required",
        "credentials_unavailable",
        "credentials_uncertain",
        "reauthorization_required",
        "revocation_pending",
        "consent_stale",
        "refreshing",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("offer"),
      consent: StravaConsentSchema,
      assurance: z.literal("client_declared"),
    })
    .strict(),
  z.object({ kind: z.literal("delivery"), delivery: StravaDeliverySchema }).strict(),
]);

export const StravaUploadRequestSchema = z
  .object({ action: z.literal("upload"), consent: StravaConsentSchema })
  .strict();

export const StravaBridgeMessageSchema = z.discriminatedUnion("type", [
  z.object({ v: z.literal(1), type: z.literal("ready"), channel: StravaChannelSchema }).strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal("finish"),
      channel: StravaChannelSchema,
      result: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("code"), code: StravaConfirmRequestSchema.shape.code }).strict(),
        z.object({ kind: z.literal("denied") }).strict(),
      ]),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal("authorize"),
      channel: StravaChannelSchema,
      authorizationUrl: z.string().url().max(4096),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal("ack"),
      channel: StravaChannelSchema,
      outcome: z.literal("confirmed"),
    })
    .strict(),
]);

export type StravaConsent = z.infer<typeof StravaConsentSchema>;

export type StravaReceipt = z.infer<typeof StravaReceiptSchema>;

export type StravaProgress = z.infer<typeof StravaProgressSchema>;

export type StravaAuthority = z.infer<typeof StravaAuthoritySchema>;

export type StravaDelivery = z.infer<typeof StravaDeliverySchema>;

export type StravaRideView = z.infer<typeof StravaRideViewSchema>;

export type StravaUploadRequest = z.infer<typeof StravaUploadRequestSchema>;

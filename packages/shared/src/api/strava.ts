import { z } from "zod";

const EmptyStatus = (
  status:
    | "disabled"
    | "disconnected"
    | "confirmation_expired"
    | "credentials_unavailable"
    | "revocation_pending",
) => z.object({ status: z.literal(status) }).strict();

export const StravaStatusSchema = z.union([
  EmptyStatus("disabled"),
  EmptyStatus("disconnected"),
  EmptyStatus("confirmation_expired"),
  EmptyStatus("credentials_unavailable"),
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

export const StravaStartRequestSchema = z.object({ action: z.literal("connect") }).strict();
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

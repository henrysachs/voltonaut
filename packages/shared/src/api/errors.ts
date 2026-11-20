import { z } from "zod";

/** Error codes used across every /v1 endpoint (08-backend.md error envelope). */
export const ErrorCodeSchema = z.enum([
  "unauthorized",
  "invalid_login_token",
  "rate_limited",
  "validation_failed",
  "not_found",
  "ride_id_conflict",
  "payload_too_large",
  "unsupported_media_type",
  "internal_error",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Every non-2xx response uses this envelope: `{ error: { code, message } }`. */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export function errorEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

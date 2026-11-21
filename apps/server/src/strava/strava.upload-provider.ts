import { z } from "zod";
import { StravaRemoteIdSchema } from "@voltonaut/shared";
import type { StravaReceipt } from "@voltonaut/shared";
import type { StravaTokens } from "./strava.crypto.js";

export type RefreshResult =
  | {
      readonly kind: "refreshed";
      readonly tokens: Readonly<StravaTokens>;
      readonly accessExpiresAt: number;
    }
  | { readonly kind: "refused" }
  | { readonly kind: "unknown" };

export type ProviderUploadState =
  | { readonly kind: "processing" }
  | { readonly kind: "delivered"; readonly activityId: string }
  | { readonly kind: "error" };

export type SubmitResult =
  | { readonly kind: "known"; readonly receipt: StravaReceipt; readonly state: ProviderUploadState }
  | {
      readonly kind: "refused";
      readonly reason: "authorization" | "rate_limit" | "file" | "provider";
    }
  | { readonly kind: "unknown"; readonly reason: "response_lost" | "protocol" };

export type PollResult =
  | { readonly kind: "observed"; readonly state: ProviderUploadState }
  | {
      readonly kind: "deferred";
      readonly reason: "authorization" | "rate_limit" | "network" | "protocol";
    };

const ReceiptResponseSchema = z.object({ id_str: StravaRemoteIdSchema });

const ProcessingResponseSchema = z.object({
  error: z.string().max(4096).nullable(),
  activity_id: z.number().int().positive().safe().nullable(),
});

export function uploadReceipt(body: string, externalId: string): StravaReceipt | undefined {
  try {
    const parsed = ReceiptResponseSchema.safeParse(JSON.parse(body));

    return parsed.success ? { uploadId: parsed.data.id_str, externalId } : undefined;
  } catch {
    return undefined;
  }
}

export function uploadState(body: string): ProviderUploadState | undefined {
  try {
    const raw: unknown = JSON.parse(body);
    const error = z.object({ error: z.string().min(1).max(4096) }).safeParse(raw);

    if (error.success) return { kind: "error" };
    const parsed = ProcessingResponseSchema.safeParse(raw);

    if (!parsed.success) return undefined;

    return parsed.data.activity_id === null
      ? { kind: "processing" }
      : { kind: "delivered", activityId: String(parsed.data.activity_id) };
  } catch {
    return undefined;
  }
}

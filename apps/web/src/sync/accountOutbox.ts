import {
  HealthResponseSchema,
  MeResponseSchema,
  ProfileInputSchema,
  PresentProfileSchema,
  RideReceiptSchema,
  RideUploadSchema,
  type ProfileInput,
  type RideUpload,
} from "@voltonaut/shared";

import type { AccountLease, SyncFailure } from "./privateAuthTransport.js";

const text = HealthResponseSchema.shape.version;
const integer = HealthResponseSchema.shape.uptimeS.int().max(Number.MAX_SAFE_INTEGER);
const envelope = HealthResponseSchema.pick({});

function literal<T extends string>(value: T) {
  return text.refine((input) => input === value).transform(() => value);
}

const attempt = envelope.extend({ attempts: integer.max(5), retryAtMs: integer }).strict();
const queued = attempt.extend({ kind: literal("queued") });
const sending = attempt.extend({ kind: literal("sending") });

const blocked = attempt.extend({
  kind: literal("blocked"),
  cause: text
    .refine((value) =>
      ["reauth", "forbidden", "missing", "conflict", "contract", "retry"].includes(value),
    )
    .transform(parseCause),
});

const rideStored = attempt.extend({ kind: literal("stored"), receipt: RideReceiptSchema });
const profileStored = attempt.extend({ kind: literal("stored"), receipt: PresentProfileSchema });

function parseCause(value: string): Exclude<SyncFailure, "superseded"> {
  switch (value) {
    case "reauth":
    case "forbidden":
    case "missing":
    case "conflict":
    case "contract":
    case "retry":
      return value;
    default:
      throw new Error("Unbekannter Warteschlangenstatus.");
  }
}

const ownership = envelope.extend({
  apiOrigin: text
    .url()
    .max(512)
    .refine((value) => new URL(value).origin === value),
  userId: MeResponseSchema.shape.user.shape.id,
  createdAtMs: integer,
  revision: text.uuid(),
});

export const OutboxRowSchema = ownership
  .extend({
    kind: literal("ride"),
    payload: RideUploadSchema,
    state: queued.or(sending).or(blocked).or(rideStored),
  })
  .strict()
  .or(
    ownership
      .extend({
        kind: literal("profile"),
        payload: ProfileInputSchema,
        state: queued.or(sending).or(blocked).or(profileStored),
      })
      .strict(),
  )
  .refine(
    (row) =>
      row.kind !== "ride" ||
      row.state.kind !== "stored" ||
      row.payload.rideId === row.state.receipt.rideId,
  );

export type OutboxRow = ReturnType<typeof OutboxRowSchema.parse>;

export type OutboxState = OutboxRow["state"];

export type OutboxRead =
  | { readonly kind: "ready"; readonly rows: readonly OutboxRow[] }
  | { readonly kind: "failed" };

export type OutboxOwner = Pick<AccountLease, "apiOrigin" | "userId">;

export interface AccountOutbox {
  readonly list: (owner: OutboxOwner) => Promise<readonly OutboxRow[]>;
  readonly claim: (row: OutboxRow) => Promise<void>;
  readonly update: (row: OutboxRow) => Promise<void>;
}

export function outboxKey(row: OutboxRow): readonly string[] {
  return [row.apiOrigin, row.kind, row.kind === "ride" ? row.payload.rideId : row.userId];
}

export function newOutboxRow(
  owner: OutboxOwner,
  payload: RideUpload | ProfileInput,
  nowMs: number,
): OutboxRow {
  const base = {
    apiOrigin: owner.apiOrigin,
    userId: owner.userId,
    createdAtMs: nowMs,
    revision: crypto.randomUUID(),
    state: { kind: "queued", attempts: 0, retryAtMs: 0 },
  };

  return OutboxRowSchema.parse(
    "rideId" in payload
      ? { ...base, kind: "ride", payload }
      : { ...base, kind: "profile", payload },
  );
}

export function retryState(
  attempts: number,
  cause: Exclude<SyncFailure, "superseded">,
  nowMs: number,
): Exclude<OutboxState, { readonly kind: "stored" }> {
  const retryAtMs = nowMs + Math.min(60_000, 1000 * 2 ** attempts);

  return cause === "retry" && attempts < 5
    ? { kind: "queued", attempts, retryAtMs }
    : { kind: "blocked", cause, attempts, retryAtMs };
}

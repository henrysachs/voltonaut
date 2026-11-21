import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach } from "vitest";
import { StravaConsentSchema } from "@voltonaut/shared";
import type { StravaConsent } from "@voltonaut/shared";
import { createDatabase } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { parseServerConfig } from "../config.js";
import { stravaTables } from "../schema.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import { StravaCredentialStore } from "./strava.credential-store.js";

const cleanup = new Set<() => void>();

afterEach(() => {
  for (const close of cleanup) close();
  cleanup.clear();
});

export const consent = StravaConsentSchema.parse({
  rideId: "00000000-0000-4000-8000-000000000001",
  payloadHash: "a".repeat(64),
  exportHash: "b".repeat(64),
  exportVersion: "tcx-1",
  connectionGeneration: "generation-a",
  athleteId: "42",
  sourcePolicy: "declared_ble_v1",
  noticeRevision: "virtual-ride-1",
});

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test claim");

  return value;
}

export function gate() {
  const events = new EventTarget();

  const wait = new Promise<void>((resolve) => {
    events.addEventListener(
      "release",
      () => {
        resolve();
      },
      { once: true },
    );
  });

  return {
    wait,
    release: () => {
      events.dispatchEvent(new Event("release"));
    },
  };
}

export function accepted(
  stores: {
    readonly jobs: Readonly<StravaDeliveryStore>;
    readonly credentials: Readonly<StravaCredentialStore>;
  },
  userId: string,
  agreement: StravaConsent,
  nowMs: number,
) {
  stores.jobs.enqueue(userId, agreement, nowMs);
  const preparing = required(stores.jobs.prepare(nowMs));
  const work = required(stores.credentials.claimWork(userId, "submit", nowMs));
  const attempt = required(stores.jobs.dispatch(preparing, work, agreement, nowMs));
  stores.jobs.submitted(
    attempt,
    {
      kind: "known",
      receipt: {
        uploadId: "12345678901234567890",
        externalId: `voltonaut-${agreement.rideId}.tcx`,
      },
      state: { kind: "processing" },
    },
    nowMs,
  );
  stores.credentials.releaseWork(work);

  return required(stores.jobs.own(userId, agreement.rideId));
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Each test owner uses an actual mutable SQLite connection.
function owner(db: ServerDatabase) {
  return {
    db,
    jobs: new StravaDeliveryStore(db, stravaTables),
    credentials: new StravaCredentialStore(db, stravaTables),
  };
}

export function fixture() {
  const directory = mkdtempSync(
    join(required(process.env["TMPDIR"]), "opencode", "strava-delivery-"),
  );

  const config = parseServerConfig(
    { AUTH_MODE: "disabled", DATABASE_PATH: join(directory, "db.sqlite") },
    "test",
  );

  const first = createDatabase(config);
  const clients = [first];
  cleanup.add(() => {
    for (const db of clients) db.$client.close();
    rmSync(directory, { recursive: true });
  });
  // Isolated scope: historical 0000..0003 plus 0005 directly; parent supplies real 0004 and journal.
  first.$client.exec(
    readFileSync(new URL("../../drizzle/0005_strava_delivery.sql", import.meta.url), "utf8"),
  );
  first.$client.exec("INSERT INTO users VALUES ('owner', 'owner@example.test', 0, NULL)");
  first.$client.exec(
    "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation) VALUES ('owner','42','connected','encrypted',999999,'activity:write','generation-a')",
  );

  const reopen = () => {
    const db = createDatabase(config);
    clients.push(db);

    return owner(db);
  };

  return { a: owner(first), b: reopen(), reopen };
}

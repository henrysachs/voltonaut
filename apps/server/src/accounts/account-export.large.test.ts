import request from "supertest";
import { expect, it } from "vitest";

import { AccountExportSchema, type AccountExport } from "@voltonaut/shared";
import { bearer, bodyOf } from "../testing/test-app.spec.js";
import { accountDataFixture, NOW_MS, ride } from "./account-data.fixture.js";

const RIDES = 50;

/**
 * Explicit budget for a 14.5 MB export: under the full gate with coverage it takes about 5 s on
 * 4 cores, right at vitest's 5 s default. The data set stays at the size AK5 must prove.
 */
const LARGE_EXPORT_TIMEOUT_MS = 30_000;
const SAMPLES_PER_RIDE = 3600;

/** The fixture already stores small rides under low ids. */
const FIRST_ID = 100;

/** A one-hour ride with a sample per second, the size that broke the 8 s client budget (#141). */
function hourRide(index: number) {
  const base = ride(index);

  return {
    ...base,
    samples: Array.from({ length: SAMPLES_PER_RIDE }, (_, second) => ({
      elapsedMs: second * 1000,
      distanceM: second * 8,
      powerW: 200,
      cadenceRpm: 85,
      gap: false,
    })),
  };
}

/** Sample counts of the exported rides among `wanted`, in export order. */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- The export is a readonly Zod output with brands the rule cannot resolve. */
function sampleCounts(
  exported: Readonly<AccountExport>,
  wanted: ReadonlySet<string>,
): readonly number[] {
  return exported.rides.flatMap(({ recording }) =>
    wanted.has(recording.rideId) && recording.schemaVersion === 1 ? [recording.samples.length] : [],
  );
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

it(
  "exports fifty one-hour rides completely and schema-valid (#157)",
  async () => {
    const f = await accountDataFixture();

    const ids = Array.from({ length: RIDES }, (_, offset) => FIRST_ID + offset);

    for (const index of ids) f.rides.store(f.owner.user.id, hourRide(index), NOW_MS);

    const response = await request(f.server)
      .get("/v1/me/export")
      .set(bearer(f.owner.sessionToken))
      .expect(200);

    const exported = AccountExportSchema.parse(bodyOf(response));

    const wanted = new Set(ids.map((index) => ride(index).rideId));

    const hours = sampleCounts(exported, wanted);

    expect(hours).toEqual(Array.from({ length: RIDES }, () => SAMPLES_PER_RIDE));
    expect(response.text.length).toBeGreaterThan(10_000_000);
  },
  LARGE_EXPORT_TIMEOUT_MS,
);

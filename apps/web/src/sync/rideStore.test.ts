import { describe, expect, it } from "vitest";
import {
  archivedRideTrack,
  serializeRideTcx,
  type ArchivedRide,
  type CapturedRide,
} from "@voltonaut/shared";

import { createRideStore } from "./rideStore.js";
import { localRide } from "./testdata/localRide.js";

const capture = {
  kind: "local_only",
  reason: "journal_age",
  track: {
    rideId: "550e8400-e29b-41d4-a716-446655440001",
    startedAt: localRide.startedAt,
    metadata: localRide.metadata,
    samples: localRide.samples,
  },
} satisfies CapturedRide;

describe("local ride store", () => {
  it("saves and reloads a validated completed ride through injected storage", async () => {
    const rows: ArchivedRide[] = [{ kind: "legacy", recording: localRide }];

    const store = createRideStore({
      list: () => Promise.resolve(rows),
      insert: (ride) => {
        rows.push(ride);

        return Promise.resolve();
      },
    });

    await store.save(capture);
    expect(await store.list()).toEqual([{ kind: "legacy", recording: localRide }, capture]);
    expect(serializeRideTcx(archivedRideTrack({ kind: "legacy", recording: localRide }))).toBe(
      serializeRideTcx(localRide),
    );
    await expect(
      store.save({ ...capture, track: { ...capture.track, samples: [] } }),
    ).rejects.toThrow("Aufnahme ungültig");
    expect(rows).toHaveLength(2);
  });

  it("surfaces storage failure without claiming successful persistence", async () => {
    const store = createRideStore({
      list: () => Promise.resolve([]),
      insert: () => Promise.reject(new Error("Speicher voll")),
    });

    await expect(
      store.save({
        kind: "local_only",
        reason: "journal_age",
        track: {
          rideId: localRide.rideId,
          startedAt: localRide.startedAt,
          metadata: localRide.metadata,
          samples: localRide.samples,
        },
      }),
    ).rejects.toThrow("Speicher voll");
  });
});

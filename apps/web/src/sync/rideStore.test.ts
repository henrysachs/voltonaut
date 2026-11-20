import { describe, expect, it } from "vitest";
import type { CompletedLocalRide } from "@voltonaut/shared";

import { createRideStore } from "./rideStore.js";
import { localRide } from "./testdata/localRide.js";

describe("local ride store", () => {
  it("saves and reloads a validated completed ride through injected storage", async () => {
    const rows: CompletedLocalRide[] = [];

    const store = createRideStore({
      list: () => Promise.resolve(rows),
      insert: (ride) => {
        rows.push(ride);

        return Promise.resolve();
      },
    });

    await store.save(localRide);
    expect(await store.list()).toEqual([localRide]);
    await expect(store.save({ ...localRide, samples: [] })).rejects.toThrow("Aufnahme ungültig");
    expect(rows).toHaveLength(1);
  });

  it("surfaces storage failure without claiming successful persistence", async () => {
    const store = createRideStore({
      list: () => Promise.resolve([]),
      insert: () => Promise.reject(new Error("Speicher voll")),
    });

    await expect(store.save(localRide)).rejects.toThrow("Speicher voll");
  });
});

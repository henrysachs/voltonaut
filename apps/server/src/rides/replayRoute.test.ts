import { TEST_ROUTES, WORLDS } from "@voltonaut/engine";
import type { RecordingV2, RideReference } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { replayRoute } from "./replayRoute.js";
import { normalReplay } from "../testing/replay.spec.js";

const { physicsRevision, profile, source, clockScale, workerTimeOriginMs, initializedWorkerMs } =
  normalReplay().initialization;

/** Shipped route and world ids plus inherited object names and unknown ids. */
const PROBED_IDS = [
  ...new Set([
    ...Object.keys(TEST_ROUTES),
    ...WORLDS.map((world) => world.id),
    "constructor",
    "__proto__",
    "toString",
    "missing-route",
    "",
  ]),
];

const PROBED_REVISIONS = ["1", "2", ""];

function initialization(reference: RideReference): RecordingV2["initialization"] {
  return {
    physicsRevision,
    ...reference,
    profile,
    source,
    clockScale,
    workerTimeOriginMs,
    initializedWorkerMs,
  };
}

/** Every reference the server resolves, as "form id@revision → route id replayRevision". */
function replayableReferences(): readonly string[] {
  const resolved: string[] = [];

  for (const id of PROBED_IDS) {
    for (const revision of PROBED_REVISIONS) {
      const route = replayRoute(initialization({ routeId: id, routeRevision: revision }));

      if (route !== undefined) {
        resolved.push(
          `route ${id}@${revision} → ${route.route.id} ${String(route.replayRevision)}`,
        );
      }

      for (const pathId of PROBED_IDS) {
        const world = replayRoute(initialization({ worldId: id, worldRevision: revision, pathId }));

        if (world !== undefined) {
          resolved.push(
            `world ${id}@${revision}/${pathId} → ${world.route.id} ${String(world.replayRevision)}`,
          );
        }
      }
    }
  }

  return resolved.toSorted();
}

it("replays exactly the shipped references and nothing else (ADR-016, ADR-033 §7–8)", () => {
  expect(replayableReferences()).toEqual(
    [
      "route alpine-pass@1 → alpine-pass undefined",
      "route coast-loop@1 → coast-loop undefined",
      "route flat-loop@1 → flat-loop undefined",
      "route kom-climb@1 → kom-climb undefined",
      "route night-city@1 → night-city undefined",
      "route test-loop@1 → test-loop undefined",
      "world alpine-pass@1/alpine-pass → alpine-pass world-path-1",
      "world coast-loop@1/coast-loop → coast-loop world-path-1",
      "world flat-loop@1/flat-loop → flat-loop world-path-1",
      "world kom-climb@1/kom-climb → kom-climb world-path-1",
      "world night-city@1/night-city → night-city world-path-1",
      "world test-loop@1/test-loop → test-loop world-path-1",
      "world voltonaut@1/voltonaut-coast → voltonaut-coast world-path-1",
      "world voltonaut@1/voltonaut-forest → voltonaut-forest world-path-1",
      "world voltonaut@1/voltonaut-night-city → voltonaut-night-city world-path-1",
      "world felsental@1/felsental → felsental world-path-1",
      "world voltonaut@1/voltonaut-tour → voltonaut-tour world-path-1",
    ].toSorted(),
  );
});

it("resolves stored single routes to the shipped route data", () => {
  for (const routeId of ["flat-loop", "test-loop", "kom-climb", "coast-loop"]) {
    expect(replayRoute(initialization({ routeId, routeRevision: "1" }))?.route).toBe(
      TEST_ROUTES[routeId],
    );
  }
});

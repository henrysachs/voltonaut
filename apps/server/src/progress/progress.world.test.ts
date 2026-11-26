import request from "supertest";
import { afterEach, expect, it } from "vitest";

import { AccountExportSchema, type RideReference } from "@voltonaut/shared";

import { bearer } from "../testing/test-app.spec.js";
import {
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  expectApiError,
  fixture,
  grantConsent,
  JOURNAL_ID,
  NOW_MS,
  OTHER_JOURNAL_ID,
  STORED_ROUTE,
  WORLD_PATH,
  type Fixture,
} from "./progress.fixtures.spec.js";

afterEach(closeProgressApps);

const REFERENCE_COLUMNS =
  "SELECT journal_id, route_id, route_revision, world_id, world_revision, path_id FROM ride_progress_journals ORDER BY journal_id";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fixture is a readonly test-handle alias.
function acceptTwo(f: Fixture, journalId: string, reference: RideReference): void {
  accept(f, f.owner, batch([checkpoint({ journalId, reference })]));
  accept(
    f,
    f.owner,
    batch([
      checkpoint({ journalId, reference, sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 }),
    ]),
  );
}

it("stores world path journals and continues stored single-route journals", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);

  acceptTwo(f, JOURNAL_ID, WORLD_PATH);
  acceptTwo(f, OTHER_JOURNAL_ID, STORED_ROUTE);

  expect(f.db.$client.prepare(REFERENCE_COLUMNS).all()).toEqual([
    {
      journal_id: JOURNAL_ID,
      route_id: null,
      route_revision: null,
      world_id: "test-loop",
      world_revision: "1",
      path_id: "test-loop",
    },
    {
      journal_id: OTHER_JOURNAL_ID,
      route_id: "test-loop",
      route_revision: "1",
      world_id: null,
      world_revision: null,
      path_id: null,
    },
  ]);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(4);
});

it.each<readonly [RideReference, RideReference]>([
  [WORLD_PATH, STORED_ROUTE],
  [STORED_ROUTE, WORLD_PATH],
  [WORLD_PATH, { ...WORLD_PATH, worldRevision: "2" }],
  [WORLD_PATH, { ...WORLD_PATH, pathId: "flat-loop" }],
])("refuses to continue a %o journal as %o", async (stored, next) => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  accept(f, f.owner, batch([checkpoint({ reference: stored })]));

  expectApiError(
    () =>
      accept(
        f,
        f.owner,
        batch([
          checkpoint({ reference: next, sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 }),
        ]),
      ),
    409,
    "ledger_conflict",
  );
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

it("exports each journal with the reference it was stored with", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  acceptTwo(f, JOURNAL_ID, WORLD_PATH);
  acceptTwo(f, OTHER_JOURNAL_ID, STORED_ROUTE);

  const response = await request(f.server)
    .get("/v1/me/export")
    .set(bearer(f.owner.sessionToken))
    .expect(200);

  const exported = AccountExportSchema.parse(JSON.parse(response.text)).progression.progress;

  expect(exported.journals).toEqual([
    expect.objectContaining({ journalId: JOURNAL_ID, ...WORLD_PATH }),
    expect.objectContaining({ journalId: OTHER_JOURNAL_ID, ...STORED_ROUTE }),
  ]);
  expect(exported.journals[0]).not.toHaveProperty("routeId");
  expect(exported.journals[1]).not.toHaveProperty("worldId");
  expect(exported.ranges).toEqual([
    expect.objectContaining({ journalId: JOURNAL_ID, startTick: 0 }),
    expect.objectContaining({ journalId: JOURNAL_ID, startTick: 1 }),
    expect.objectContaining({ journalId: OTHER_JOURNAL_ID, startTick: 0 }),
    expect.objectContaining({ journalId: OTHER_JOURNAL_ID, startTick: 1 }),
  ]);
});

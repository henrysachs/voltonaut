import request from "supertest";
import { afterEach, expect, it } from "vitest";

import { AccountExportSchema } from "@voltonaut/shared";
import { bearer, bodyOf } from "../testing/test-app.spec.js";
import {
  JOURNAL_ID,
  OTHER_JOURNAL_ID,
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  contiguousPair,
  fixture,
  grantConsent,
  metadata,
  type Fixture,
} from "./progress.fixtures.spec.js";

const ORIGIN = "http://localhost:5173";
const PROGRESS_TABLES = ["progress_consents", "ride_progress_journals", "ride_progress_ranges"];

afterEach(closeProgressApps);

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Fixture is a readonly test-handle alias that the rule cannot resolve. */
function ownedRows(f: Fixture, userId: string): readonly number[] {
  return PROGRESS_TABLES.map(
    (table) => f.db.$client.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(userId).length,
  );
}

async function seededFixture(): Promise<Fixture> {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  grantConsent(f.db, f.other);
  accept(f, f.owner, batch(contiguousPair()));
  accept(f, f.other, batch([checkpoint({ journalId: OTHER_JOURNAL_ID })]));

  return f;
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

it("exports only the owner's progress consent, journals and ranges without session hashes", async () => {
  const f = await seededFixture();

  const response = await request(f.server)
    .get("/v1/me/export")
    .set(bearer(f.owner.sessionToken))
    .expect(200);

  const { progress } = AccountExportSchema.parse(bodyOf(response)).progression;

  expect(progress.consent).toEqual({
    status: "present",
    version: 1,
    enabled: true,
    sessionGeneration: 1,
    updatedAt: "2026-11-25T12:00:00.000Z",
  });
  expect(progress.journals).toEqual([
    expect.objectContaining({
      journalId: JOURNAL_ID,
      physics: metadata.physics,
      lastEndTick: 2,
      lastSequence: 1,
      lastRewardDay: "2026-11-25",
    }),
  ]);
  expect(progress.ranges).toHaveLength(1);
  expect(progress.ranges[0]).toMatchObject({ journalId: JOURNAL_ID, startTick: 0, endTick: 2 });
  expect(progress.ranges[0]?.payload.checkpoints).toHaveLength(2);
  expect(progress.ranges[0]?.receipt.journalId).toBe(JOURNAL_ID);
  expect(response.text).not.toContain(OTHER_JOURNAL_ID);
  expect(response.text).not.toContain(f.owner.sessionToken);
  expect(response.text).not.toMatch(/session_?hash/iu);
});

it("deletes the owner's progress with the account and blocks late progress writes", async () => {
  const f = await seededFixture();

  expect(ownedRows(f, f.owner.user.id)).toEqual([1, 1, 1]);

  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.owner.user.email })
    .expect(204);

  expect(ownedRows(f, f.owner.user.id)).toEqual([0, 0, 0]);
  expect(ownedRows(f, f.other.user.id)).toEqual([1, 1, 1]);
  expect(() => {
    grantConsent(f.db, f.owner);
  }).toThrow("account is deleted");
  expect(() =>
    f.db.$client
      .prepare("UPDATE ride_progress_journals SET user_id = ? WHERE user_id = ?")
      .run(f.owner.user.id, f.other.user.id),
  ).toThrow("account is deleted");
  expect(() =>
    f.db.$client
      .prepare("UPDATE ride_progress_ranges SET user_id = ? WHERE user_id = ?")
      .run(f.owner.user.id, f.other.user.id),
  ).toThrow("account is deleted");
});

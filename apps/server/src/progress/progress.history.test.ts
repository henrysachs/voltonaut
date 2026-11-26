import request from "supertest";
import { afterEach, expect, it } from "vitest";

import { ProgressHistoryResponseSchema } from "@voltonaut/shared";

import {
  JOURNAL_ID,
  NOW_MS,
  OTHER_JOURNAL_ID,
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  fixture,
  grantConsent,
  type Fixture,
} from "./progress.fixtures.spec.js";
import { bearer, bodyOf } from "../testing/test-app.spec.js";

afterEach(closeProgressApps);

/* oxlint-disable typescript/prefer-readonly-parameter-types -- The fixture is a readonly alias that the rule cannot resolve. */
async function history(f: Fixture, sessionToken: string, before?: string) {
  const query = before === undefined ? "" : `?before=${encodeURIComponent(before)}`;

  const response = await request(f.server)
    .get(`/v1/me/progress-history${query}`)
    .set(bearer(sessionToken))
    .expect(200);

  expect(response.headers["cache-control"]).toBe("no-store");

  return ProgressHistoryResponseSchema.parse(bodyOf(response));
}

const CLIMB = { distanceM: 2, elevationGainM: 0.4 };

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function journalId(index: number): string {
  return `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

it("sums the confirmed ranges of an own journal and hides other accounts", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  grantConsent(f.db, f.other);

  const first = checkpoint({ factCount: 2, factOptions: CLIMB });

  const second = checkpoint({
    sequence: 1,
    startTick: first.endTick,
    startedAtMs: first.endedAtMs,
    factCount: 3,
    factOptions: CLIMB,
  });

  const receipts = [accept(f, f.owner, batch([first])), accept(f, f.owner, batch([second]))];

  accept(f, f.other, batch([checkpoint({ journalId: OTHER_JOURNAL_ID })]));

  const page = await history(f, f.owner.sessionToken);

  expect(page).toEqual({
    journals: [
      {
        journalId: JOURNAL_ID,
        routeId: first.routeId,
        startedAt: new Date(NOW_MS).toISOString(),
        lastConfirmedAt: new Date(second.endedAtMs).toISOString(),
        confirmedTicks: 5,
        rangeCount: 2,
        rewardDays: ["2026-11-25"],
        awardedVolts: sumOf(receipts.map(({ awardedVolts }) => awardedVolts)),
        withheldVolts: 0,
        candidateVolts: 3,
      },
    ],
    nextCursor: null,
  });
  expect((await history(f, f.other.sessionToken)).journals.map(({ journalId: id }) => id)).toEqual([
    OTHER_JOURNAL_ID,
  ]);
});

it("pages newest first with a stable cursor", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);

  for (const index of Array.from({ length: 22 }, (_, offset) => offset + 1))
    accept(f, f.owner, batch([checkpoint({ journalId: journalId(index) })]));

  const firstPage = await history(f, f.owner.sessionToken);

  expect(firstPage.journals).toHaveLength(20);
  expect(firstPage.journals[0]?.journalId).toBe(journalId(22));
  expect(firstPage.nextCursor).toBe(`${NOW_MS}_${journalId(3)}`);

  const secondPage = await history(f, f.owner.sessionToken, String(firstPage.nextCursor));

  expect(secondPage.journals.map(({ journalId: id }) => id)).toEqual([journalId(2), journalId(1)]);
  expect(secondPage.nextCursor).toBeNull();
});

it("requires a session and rejects a malformed cursor or extra query", async () => {
  const f = await fixture();

  await request(f.server).get("/v1/me/progress-history").expect(401);

  const rejected = await Promise.all(
    ["?before=1_x", "?limit=5"].map((query) =>
      request(f.server).get(`/v1/me/progress-history${query}`).set(bearer(f.owner.sessionToken)),
    ),
  );

  expect(rejected.map(({ status }) => status)).toEqual([422, 422]);

  expect((await history(f, f.owner.sessionToken)).journals).toEqual([]);
});

it("gives a journal without a stored range no page slot", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);

  for (const index of Array.from({ length: 21 }, (_, offset) => offset + 1))
    accept(f, f.owner, batch([checkpoint({ journalId: journalId(index) })]));

  f.db.$client.prepare("DELETE FROM ride_progress_ranges WHERE journal_id = ?").run(journalId(21));

  const page = await history(f, f.owner.sessionToken);

  expect(page.journals.map(({ journalId: id }) => id)).toEqual(
    Array.from({ length: 20 }, (_, offset) => journalId(20 - offset)),
  );
  expect(page.nextCursor).toBeNull();
});
/* oxlint-enable typescript/prefer-readonly-parameter-types */

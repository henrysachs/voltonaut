import { afterEach, expect, it } from "vitest";

import {
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  fact,
  fixture,
  grantConsent,
  type Fixture,
} from "./progress.fixtures.spec.js";

afterEach(closeProgressApps);

function largeRangeBatch() {
  const startAtMs = Date.parse("2026-11-24T23:59:00.000Z");

  return batch(
    Array.from({ length: 10 }, (_, index) =>
      checkpoint({
        sequence: index,
        startTick: index * 120,
        startedAtMs: startAtMs + index * 6000,
        facts: Array.from({ length: 120 }, () =>
          fact({ powerW: 0, cadenceRpm: 0, distanceM: 0, elevationGainM: 2, energyKj: 0 }),
        ),
      }),
    ),
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fixture is a readonly test-handle alias.
function acceptCapped(f: Fixture) {
  return accept(
    f,
    f.owner,
    batch([
      checkpoint({
        sequence: 10,
        startTick: 1200,
        startedAtMs: Date.parse("2026-11-25T00:00:00.000Z"),
        facts: [fact({ powerW: 0, cadenceRpm: 0, distanceM: 0, elevationGainM: 100 })],
      }),
    ]),
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fixture is a readonly test-handle alias.
function acceptNextDay(f: Fixture) {
  return accept(
    f,
    f.owner,
    batch([
      checkpoint({
        sequence: 11,
        startTick: 1201,
        startedAtMs: Date.parse("2026-11-26T00:00:00.000Z"),
        facts: [fact({ powerW: 0, cadenceRpm: 0, distanceM: 0, elevationGainM: 100 })],
      }),
    ]),
    Date.parse("2026-11-26T12:00:00.000Z"),
  );
}

it("books a midnight-crossing range to its UTC end day and applies the daily cap", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const first = accept(f, f.owner, largeRangeBatch());
  expect(first).toMatchObject({
    startTick: 0,
    endTick: 1200,
    rewardDay: "2026-11-25",
    candidateVolts: 3600,
    awardedVolts: 3000,
    withheldVolts: 600,
  });

  const capped = acceptCapped(f);
  expect(capped).toMatchObject({
    rewardDay: "2026-11-25",
    candidateVolts: 150,
    awardedVolts: 0,
    withheldVolts: 150,
  });

  const nextDay = acceptNextDay(f);
  expect(nextDay).toMatchObject({
    rewardDay: "2026-11-26",
    candidateVolts: 150,
    awardedVolts: 150,
    withheldVolts: 0,
  });

  expect(
    f.db.$client
      .prepare("SELECT reward_day, start_tick, delta_volts FROM volts_ledger ORDER BY start_tick")
      .all(),
  ).toEqual([
    { reward_day: "2026-11-25", start_tick: 0, delta_volts: 3000 },
    { reward_day: "2026-11-25", start_tick: 1200, delta_volts: 0 },
    { reward_day: "2026-11-26", start_tick: 1201, delta_volts: 150 },
  ]);
  expect(
    f.db.$client.prepare("SELECT last_end_tick, last_sequence FROM ride_progress_journals").get(),
  ).toEqual({ last_end_tick: 1202, last_sequence: 11 });
});

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Panel views and Volts receipts are readonly aliases with Zod brands; the rule cannot resolve them. */
import { expect, it } from "vitest";
import {
  JournalIdSchema,
  VoltsRideRangeReceiptSchema,
  type RideProgressCheckpoint,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import type { ProgressPanelCounts, ProgressPanelView } from "../ui/progressPanel.js";
import { ProgressLive, type ProgressLiveSource } from "./progressLive.js";
import { checkpoint, journalId } from "./progressOutboxTestdata.js";

const OTHER_JOURNAL = JournalIdSchema.parse("650e8400-e29b-41d4-a716-446655440000");

const IDLE: ProgressPanelCounts = {
  rows: 0,
  queued: 0,
  sending: 0,
  blocked: 0,
  stored: 0,
  open: 0,
  remaining: 100,
};

type AccountView = Extract<ProgressPanelView, { readonly kind: "account" }>;

function account(counts: Partial<ProgressPanelCounts> = {}): AccountView {
  return {
    kind: "account",
    consent: { kind: "ready", enabled: true, version: 1, rewardsAvailable: true },
    outbox: { kind: "ready", counts: { ...IDLE, ...counts } },
    busy: false,
    message: "",
  };
}

/** Stands in for `ProgressSync`: the test sets its view, journal binding and receipts. */
class FakeSync implements ProgressLiveSource {
  current: ProgressPanelView = account();
  bound: ReturnType<ProgressLiveSource["journal"]> = { journalId, kind: "writing" };
  readonly #views = new Set<(view: ProgressPanelView) => void>();
  readonly #receipts = new Set<(receipt: VoltsRideRangeReceipt) => void>();

  readonly view = (): ProgressPanelView => this.current;

  readonly journal = (): ReturnType<ProgressLiveSource["journal"]> => this.bound;

  readonly subscribe = (listener: (view: ProgressPanelView) => void): (() => void) => {
    this.#views.add(listener);

    return () => {
      this.#views.delete(listener);
    };
  };

  readonly subscribeReceipts = (
    listener: (receipt: VoltsRideRangeReceipt) => void,
  ): (() => void) => {
    this.#receipts.add(listener);

    return () => {
      this.#receipts.delete(listener);
    };
  };

  show(view: ProgressPanelView): void {
    this.current = view;

    for (const listener of this.#views) listener(view);
  }

  confirm(receipt: VoltsRideRangeReceipt): void {
    for (const listener of this.#receipts) listener(receipt);
  }
}

function climb(options: Readonly<{ startTick: number; id?: string; source?: "ble" | "sim" }>) {
  const base = checkpoint({ ...options, sequence: options.startTick });

  return {
    ...base,
    facts: [
      {
        powerW: 200,
        cadenceRpm: 90,
        timeS: 0.05,
        distanceM: 1,
        energyKj: 0.6,
        elevationGainM: 0.4,
      },
    ],
  } satisfies RideProgressCheckpoint;
}

function receiptFor(
  options: Readonly<{ entry: string; startTick: number; awarded: number; withheld?: number }>,
  id = journalId,
): VoltsRideRangeReceipt {
  const withheld = options.withheld ?? 0;

  return VoltsRideRangeReceiptSchema.parse({
    entryId: `123e4567-e89b-42d3-a456-42661417400${options.entry}`,
    journalId: id,
    startTick: options.startTick,
    endTick: options.startTick + 1,
    rewardDay: "2026-11-26",
    cumulativeWorkVolts: 1,
    cumulativeClimbVolts: 1,
    candidateVolts: options.awarded + withheld,
    awardedVolts: options.awarded,
    withheldVolts: withheld,
  });
}

function liveWith(sync: FakeSync, online = true) {
  const live = new ProgressLive(sync, () => online);
  const views: ReturnType<ProgressLive["view"]>[] = [];

  live.subscribe((view) => {
    views.push(view);
  });

  return { live, views };
}

it("grows the preview with every checkpoint and confirms only by receipts", () => {
  const sync = new FakeSync();
  const { live } = liveWith(sync);

  expect(live.view()).toMatchObject({ previewVolts: null, confirmedVolts: null });

  live.accept(climb({ startTick: 0 }));
  live.accept(climb({ startTick: 1 }));

  // 2 × 0.6 kJ → 1 work Volt; 2 × 0.4 m × 1.5 → 1 climb Volt.
  expect(live.view()).toEqual({
    previewVolts: 2,
    confirmedVolts: null,
    withheldVolts: 0,
    status: "pending",
  });

  sync.confirm(receiptFor({ entry: "1", startTick: 0, awarded: 1 }));
  sync.confirm(receiptFor({ entry: "1", startTick: 0, awarded: 1 }));
  sync.confirm(receiptFor({ entry: "2", startTick: 1, awarded: 1, withheld: 1 }));

  expect(live.view()).toEqual({
    previewVolts: 2,
    confirmedVolts: 2,
    withheldVolts: 1,
    status: "confirmed",
  });
});

it("ignores receipts of another journal and resets on a new journal", () => {
  const sync = new FakeSync();
  const { live } = liveWith(sync);

  live.accept(climb({ startTick: 0 }));
  sync.confirm(receiptFor({ entry: "1", startTick: 0, awarded: 5 }, OTHER_JOURNAL));

  expect(live.view().confirmedVolts).toBeNull();

  sync.confirm(receiptFor({ entry: "2", startTick: 0, awarded: 1 }));
  sync.bound = { journalId: OTHER_JOURNAL, kind: "writing" };
  live.accept(climb({ startTick: 0, id: OTHER_JOURNAL }));

  expect(live.view()).toMatchObject({ previewVolts: 0, confirmedVolts: null });
});

it.each([
  ["syncing", { sending: 1 }, true],
  ["pending", { queued: 1 }, true],
  ["offline", { queued: 1 }, false],
  ["failed", { blocked: 1 }, true],
] as const)("reports %s from the delivery state", (status, counts, online) => {
  const sync = new FakeSync();
  const { live } = liveWith(sync, online);

  live.accept(climb({ startTick: 0 }));
  sync.show(account(counts));

  expect(live.view().status).toBe(status);
});

it("reports a full or unavailable outbox as failed", () => {
  const sync = new FakeSync();
  const { live } = liveWith(sync);

  live.accept(climb({ startTick: 0 }));
  sync.show({ ...account(), outbox: { kind: "capacity", counts: IDLE } });

  expect(live.view().status).toBe("failed");

  sync.show({ ...account(), outbox: { kind: "failed" } });

  expect(live.view().status).toBe("failed");
});

it("hides confirmed Volts as soon as the journal is no longer written for the account", () => {
  const sync = new FakeSync();
  const { live, views } = liveWith(sync);

  live.accept(climb({ startTick: 0 }));
  sync.confirm(receiptFor({ entry: "1", startTick: 0, awarded: 3 }));

  expect(views.at(-1)?.confirmedVolts).toBe(3);

  sync.bound = { journalId, kind: "ignored" };
  sync.show({ kind: "guest", message: "Gast" });

  expect(views.at(-1)).toMatchObject({ confirmedVolts: null, status: "guest" });

  sync.show(account());

  expect(views.at(-1)).toMatchObject({ confirmedVolts: null, status: "off" });
});

it("keeps sim and guest rides as a preview without server booking", () => {
  const simSync = new FakeSync();
  const sim = liveWith(simSync).live;

  sim.accept(climb({ startTick: 0, source: "sim" }));

  expect(sim.view()).toMatchObject({ previewVolts: 0, status: "sim", confirmedVolts: null });

  const guest = new ProgressLive(undefined);

  guest.accept(climb({ startTick: 0 }));
  guest.accept();
  guest.refresh();

  expect(guest.view()).toMatchObject({ status: "guest", confirmedVolts: null });
});

it("waits while consent for the journal is still loading", () => {
  const sync = new FakeSync();
  const { live } = liveWith(sync);

  sync.bound = { journalId, kind: "pending" };
  live.accept(climb({ startTick: 0 }));

  expect(live.view().status).toBe("pending");

  sync.bound = undefined;
  live.refresh();

  expect(live.view().status).toBe("off");
});
/* oxlint-enable typescript/prefer-readonly-parameter-types */

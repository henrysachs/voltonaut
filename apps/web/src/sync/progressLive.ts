/* oxlint-disable typescript/prefer-readonly-parameter-types -- Panel views and Volts receipts are readonly aliases with Zod brands; the rule cannot resolve them. */
import { calculateBaseRewards } from "@voltonaut/rules";
import {
  RewardFactsSchema,
  type RideProgressCheckpoint,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import type { ProgressPanelView } from "../ui/progressPanel.js";

export type ProgressLiveStatus =
  | "sim"
  | "guest"
  | "off"
  | "pending"
  | "syncing"
  | "offline"
  | "failed"
  | "confirmed";

export interface ProgressLiveView {
  /** Volts of the running journal from native facts; the daily limit is only known to the server. */
  readonly previewVolts: number | null;
  /** Sum of server receipts for the running journal; `null` without any receipt. */
  readonly confirmedVolts: number | null;
  readonly withheldVolts: number;
  readonly status: ProgressLiveStatus;
}

/** The parts of `ProgressSync` the live display reads. */
export interface ProgressLiveSource {
  readonly view: () => ProgressPanelView;
  readonly subscribe: (listener: (view: ProgressPanelView) => void) => () => void;
  readonly subscribeReceipts: (listener: (receipt: VoltsRideRangeReceipt) => void) => () => void;
  readonly journal: () =>
    | Readonly<{ journalId: string; kind: "ignored" | "pending" | "writing" }>
    | undefined;
}

interface RunningJournal {
  readonly journalId: string;
  readonly source: RideProgressCheckpoint["source"];
  energyKj: number;
  elevationGainM: number;
  previewVolts: number;
  readonly receipts: Map<string, Readonly<{ awardedVolts: number; withheldVolts: number }>>;
}

function previewOf(journal: Readonly<RunningJournal>): number {
  const facts = RewardFactsSchema.safeParse({
    activeDistanceM: 0,
    activeElevationGainM: 0,
    activeTimeS: 0,
    elevationGainM: journal.elevationGainM,
    energyKj: journal.energyKj,
  });

  // Beyond the accepted aggregate limits the server rejects the facts; keep the last preview.
  return facts.success ? calculateBaseRewards(facts.data).volts.total : journal.previewVolts;
}

function deliveryStatus(view: ProgressPanelView, online: boolean): ProgressLiveStatus {
  if (view.kind !== "account" || view.outbox.kind === "loading") return "pending";

  if (view.outbox.kind !== "ready") return "failed";
  const { blocked, sending, queued } = view.outbox.counts;

  if (blocked > 0) return "failed";

  if (sending > 0) return "syncing";

  if (queued > 0) return online ? "pending" : "offline";

  return "confirmed";
}

/**
 * Live Volts of the running ride (spec E6-11 AK3): a preview from native facts and the
 * server-confirmed part from stored receipts. Owns no balance; nothing here is authoritative.
 */
export class ProgressLive {
  readonly #listeners = new Set<(view: ProgressLiveView) => void>();
  readonly #source: ProgressLiveSource | undefined;
  readonly #online: () => boolean;
  #journal: RunningJournal | undefined;

  constructor(source: ProgressLiveSource | undefined, online: () => boolean = () => true) {
    this.#source = source;
    this.#online = online;
    source?.subscribe(() => {
      this.publish();
    });
    source?.subscribeReceipts((receipt) => {
      this.confirm(receipt);
    });
  }

  readonly accept = (checkpoint?: RideProgressCheckpoint): void => {
    if (checkpoint === undefined) return;

    const journalId = checkpoint.journalId.toLowerCase();

    if (this.#journal?.journalId !== journalId) {
      this.#journal = {
        journalId,
        source: checkpoint.source,
        energyKj: 0,
        elevationGainM: 0,
        previewVolts: 0,
        receipts: new Map(),
      };
    }

    const journal = this.#journal;

    for (const fact of checkpoint.facts) {
      journal.energyKj += fact.energyKj;
      journal.elevationGainM += fact.elevationGainM;
    }

    journal.previewVolts = previewOf(journal);
    this.publish();
  };

  /** Recomputes the status, e.g. when the browser goes on- or offline. */
  readonly refresh = (): void => {
    this.publish();
  };

  view(): ProgressLiveView {
    const journal = this.#journal;
    const status = this.status();

    const confirmed =
      status === "sim" || status === "guest" || status === "off"
        ? []
        : [...(journal?.receipts.values() ?? [])];

    return {
      previewVolts: journal === undefined ? null : journal.previewVolts,
      confirmedVolts:
        confirmed.length === 0
          ? null
          : confirmed.reduce((total, { awardedVolts }) => total + awardedVolts, 0),
      withheldVolts: confirmed.reduce((total, { withheldVolts }) => total + withheldVolts, 0),
      status,
    };
  }

  subscribe(listener: (view: ProgressLiveView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.view());

    return () => {
      this.#listeners.delete(listener);
    };
  }

  private confirm(receipt: Readonly<VoltsRideRangeReceipt>): void {
    if (this.#journal?.journalId !== receipt.journalId) return;
    this.#journal.receipts.set(receipt.entryId, {
      awardedVolts: receipt.awardedVolts,
      withheldVolts: receipt.withheldVolts,
    });
    this.publish();
  }

  private status(): ProgressLiveStatus {
    const journal = this.#journal;

    if (journal?.source === "sim") return "sim";
    const source = this.#source;

    if (source === undefined || source.view().kind === "guest") return "guest";
    const bound = source.journal();

    if (journal === undefined || bound?.journalId !== journal.journalId) return "off";

    if (bound.kind === "ignored") return "off";

    if (bound.kind === "pending") return "pending";

    const delivery = deliveryStatus(source.view(), this.#online());

    // Nothing waits, but nothing is confirmed yet either: the first range is still being written.
    return delivery === "confirmed" && journal.receipts.size === 0 ? "pending" : delivery;
  }

  private publish(): void {
    const view = this.view();

    for (const listener of this.#listeners) listener(view);
  }
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

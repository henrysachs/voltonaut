/* oxlint-disable eslint/max-lines -- Progress consent, early buffering, journal lifecycle and ordered delivery form one state machine in the mandated integration module. */
/* oxlint-disable eslint/no-await-in-loop -- Outbox transitions and receipts must commit in journal order; parallel writes would race the same rows. */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- External contracts are readonly aliases; the owned journal binding intentionally advances its high-water time. */
import {
  JournalIdSchema,
  ProgressCheckpointBatchSchema,
  RideProgressCheckpointSchema,
  type ProgressCheckpointBatch,
  type JournalId,
  type ProgressConsentState,
  type RideProgressCheckpoint,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import type { ApplicationSession, SessionView } from "./applicationSession.js";
import {
  PrivateRequestError,
  type AccountLease,
  type SyncFailure,
} from "./privateAuthTransport.js";
import {
  SERVER_PROGRESS_MAX_FACTS,
  SERVER_PROGRESS_MAX_TIME_S,
  groupProgressBatches,
  progressBatchEndTick,
  progressBatchStartTick,
} from "./progressBatch.js";
import { openProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import {
  ProgressOutboxError,
  progressReceiptCoversRow,
  type ProgressOutbox,
  type ProgressOutboxRow,
  type ProgressPendingPageCursor,
  type ProgressWriteFence,
} from "./progressOutbox.js";
import type { ProgressPanelView } from "../ui/progressPanel.js";

const DELIVERY_TARGET_MS = 60_000;
const DELIVERY_PAGE_SIZE = 10;
const TIME_EPSILON_S = 1e-9;

type ConsentPanel = Extract<ProgressPanelView, { readonly kind: "account" }>["consent"];

type OutboxPanel = Extract<ProgressPanelView, { readonly kind: "account" }>["outbox"];

type DeliveryOutcome = "delivered" | "empty" | "deferred" | "failed" | "partial";

type JournalDelivery = Readonly<{ journalId: string; outcome: DeliveryOutcome }>;

interface ProgressBuffer {
  readonly journalId: JournalId;
  readonly checkpoints: RideProgressCheckpoint[];
  factCount: number;
  timeS: number;
}

type JournalState =
  | { readonly kind: "ignored"; readonly journalId: JournalId }
  | { readonly kind: "pending"; readonly journalId: JournalId }
  | {
      readonly kind: "writing";
      readonly journalId: JournalId;
      readonly lease: AccountLease;
      readonly consentVersion: number;
      readonly sessionGeneration: number;
      readonly controller: AbortController;
      lastEndedAtMs: number | undefined;
      lastPaused: boolean;
      deliverRequested: boolean;
    };

export interface ProgressSyncOptions {
  readonly session: Readonly<Pick<ApplicationSession, "authorize" | "subscribe">>;
  readonly outbox?: () => Promise<ProgressOutbox>;
  readonly nowMs?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, Math.max(0, delayMs));

  return () => {
    clearTimeout(timer);
  };
}

function utcDay(endedAtMs: number): string {
  return new Date(endedAtMs).toISOString().slice(0, 10);
}

function failureText(error: Error): string {
  if (error instanceof PrivateRequestError) {
    switch (error.cause) {
      case "reauth":
        return "Anmeldung abgelaufen. Nach erneuter Anmeldung erneut versuchen.";
      case "forbidden":
        return "Server verweigert automatischen Progress. Daten bleiben lokal erhalten.";
      case "missing":
        return "Server findet die Progress-Bindung nicht. Daten bleiben lokal erhalten.";
      case "conflict":
        return "Server bindet diese Daten an eine andere Sitzung oder Zustimmung. Keine Umordnung.";
      case "contract":
        return "Serverantwort oder Progress-Vertrag ungültig. Das betroffene Journal wird nicht weiter gespeichert; die nächste Fahrt startet ein neues Journal.";
      case "retry":
        return "Server nicht erreichbar. Daten bleiben erhalten; der nächste Versuch folgt dem Backoff.";
      case "superseded":
        return "Sitzung gewechselt. Ungültige Aktion nicht ausgeführt.";
    }
  }

  if (error instanceof ProgressOutboxError)
    return "Lokale Progress-Warteschlange nicht bestätigt. Bestehende Daten bleiben unverändert.";

  return "Progress-Aktion nicht bestätigt. Bestehende Daten bleiben unverändert.";
}

function deliveryCause(error: Error): Exclude<SyncFailure, "superseded"> | undefined {
  if (error instanceof PrivateRequestError)
    return error.cause === "superseded" ? undefined : error.cause;

  return "retry";
}

function journalGroups(rows: readonly ProgressOutboxRow[]): readonly ProgressOutboxRow[][] {
  const groups: ProgressOutboxRow[][] = [];
  let current: ProgressOutboxRow[] | undefined;
  let journalId: string | undefined;

  for (const row of rows) {
    if (row.journalId !== journalId) {
      current = [];
      groups.push(current);
      journalId = row.journalId;
    }

    current?.push(row);
  }

  return groups;
}

function deliveryPageCursor(
  rows: readonly ProgressOutboxRow[],
  lastGroup: JournalDelivery | undefined,
): ProgressPendingPageCursor | undefined {
  const last = rows.at(-1);

  if (last === undefined) return undefined;

  const skipJournal =
    lastGroup?.journalId === last.journalId &&
    (lastGroup.outcome === "empty" || lastGroup.outcome === "deferred");

  return {
    journalId: last.journalId,
    startTick: skipJournal ? Number.MAX_SAFE_INTEGER : last.startTick,
  };
}

export class ProgressSync {
  readonly #options: ProgressSyncOptions;
  readonly #listeners = new Set<(view: ProgressPanelView) => void>();
  #sessionView: SessionView = { kind: "guest", message: "Gast" };
  #lease: AccountLease | undefined;
  #consent: ProgressConsentState | undefined;
  #consentFailure: string | undefined;
  #consentBusy = false;
  #deliveryBusy = false;
  #delivering = false;
  #pendingMode: "manual" | "resume" | undefined;
  #outbox: OutboxPanel = { kind: "loading" };
  #message = "";
  #journal: JournalState | undefined;
  #buffer: ProgressBuffer | undefined;
  #replayDepth = 0;
  #epoch = 0;
  #resource: Promise<ProgressOutbox> | undefined;
  #operations: Promise<void> = Promise.resolve();
  #timerCancel: (() => void) | undefined;
  #timerAt: number | undefined;
  #targetAt: number | undefined;

  constructor(options: ProgressSyncOptions) {
    this.#options = options;
    options.session.subscribe((view) => {
      const previous = this.#sessionView;
      const restoring = previous.kind === "busy" && previous.operation === "restoring";

      const preserveBuffer =
        (view.kind === "authenticated" && restoring) ||
        (view.kind === "busy" && view.operation === "restoring" && restoring);

      this.#sessionView = view;
      this.bind(
        view.kind === "authenticated" ? options.session.authorize() : undefined,
        preserveBuffer,
      );
    });
  }

  private parseCheckpoint(
    checkpoint: RideProgressCheckpoint | undefined,
  ): RideProgressCheckpoint | undefined {
    if (checkpoint === undefined || checkpoint.source !== "ble") return undefined;
    const parsed = RideProgressCheckpointSchema.safeParse(checkpoint);

    if (!parsed.success) {
      this.#message = "Ungültiger Progress-Checkpoint verworfen.";
      this.publish();

      return undefined;
    }

    return parsed.data;
  }

  readonly accept = (checkpoint?: RideProgressCheckpoint): void => {
    const parsed = this.parseCheckpoint(checkpoint);

    if (parsed === undefined) return;
    this.startJournal(parsed);
    const journal = this.#journal;
    const replaying = this.#replayDepth > 0;

    if (journal?.kind !== "writing" || !this.journalCurrent(journal)) return;
    void this.enqueue(async () => {
      if (!this.journalCurrent(journal)) return;

      try {
        const database = await this.database();

        if (!this.journalCurrent(journal)) return;
        const previousEnd = journal.lastEndedAtMs;
        const result = await database.append(this.writeFence(journal), parsed);

        if (!this.journalCurrent(journal) || result.kind !== "stored") return;
        journal.lastEndedAtMs = parsed.endedAtMs;
        const pausedTransition = parsed.quality.paused && !journal.lastPaused;
        journal.lastPaused = parsed.quality.paused;

        const crossedUtcDay =
          previousEnd !== undefined && utcDay(previousEnd) !== utcDay(parsed.endedAtMs);

        if (pausedTransition || crossedUtcDay) {
          if (replaying) journal.deliverRequested = true;
          else {
            this.#targetAt = undefined;
            this.cancelTimer();
            void this.startDelivery(journal.lease, "resume");
          }
        } else this.scheduleTarget();
      } catch {
        if (this.journalCurrent(journal)) {
          this.#message = failureText(
            new ProgressOutboxError("storage", "Progress storage failed"),
          );
          await this.refreshOutbox(journal.lease);
        }
      }
    });
  };

  readonly flush = (): Promise<void> => this.retry("manual");

  view(): ProgressPanelView {
    if (this.#lease === undefined)
      return { kind: "guest", message: "Gast. Automatischer Progress benötigt ein Konto." };

    const consent: ConsentPanel =
      this.#consent === undefined
        ? this.#consentFailure === undefined
          ? { kind: "loading" }
          : { kind: "failed", message: this.#consentFailure }
        : {
            kind: "ready",
            enabled: this.#consent.enabled,
            version: this.#consent.version,
            rewardsAvailable: this.#consent.rewardsAvailable,
          };

    return {
      kind: "account",
      consent,
      outbox: this.#outbox,
      busy: this.#consentBusy || this.#deliveryBusy,
      message: this.#message,
    };
  }

  subscribe(listener: (view: ProgressPanelView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.view());

    return () => {
      this.#listeners.delete(listener);
    };
  }

  async setConsent(enabled: boolean): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined || this.#consentBusy) return;
    const epoch = this.#epoch;
    this.#epoch += 1;
    this.#consentBusy = true;
    this.#message = enabled
      ? "Aktivierung wird bestätigt …"
      : "Lokaler Stopp aktiv; Widerruf wird bestätigt …";

    if (!enabled) this.stopLocally(lease);

    this.publish();

    try {
      const consent = await lease.progress.update(enabled);

      if (epoch + 1 !== this.#epoch || !this.current(lease)) return;
      this.#consent = consent;
      this.#consentFailure = undefined;
      this.resumePendingBuffer();
      this.#message = enabled
        ? "Aktiviert. Gilt ab der nächsten Fahrt beziehungsweise einem neuen Journal bei Tick 0."
        : "Widerrufen. Neue Speicherung und Uploads sind gestoppt; bestätigte Bereiche bleiben.";
      await this.refreshOutbox(lease);

      if (enabled) await this.startDelivery(lease, "resume");
    } catch {
      if (epoch + 1 !== this.#epoch || !this.current(lease)) return;
      this.clearPendingBuffer();
      this.#message = enabled
        ? "Aktivierung nicht bestätigt. Automatischer Progress bleibt inaktiv."
        : "Widerruf nicht serverbestätigt. Lokal bleiben Speicherung und Uploads gestoppt; erneut widerrufen.";
    } finally {
      if (epoch + 1 === this.#epoch && this.current(lease)) {
        this.#consentBusy = false;
        this.publish();
      }
    }
  }

  private stopLocally(lease: AccountLease): void {
    if (this.#consent !== undefined) this.#consent = { ...this.#consent, enabled: false };
    this.clearPendingBuffer();

    if (this.#journal?.kind === "writing") this.#journal.controller.abort();
    this.cancelTimer();
    this.#targetAt = undefined;
    void this.blockPending(lease).catch(() => {
      if (this.current(lease)) this.#message = "Lokale Blockaden nicht vollständig bestätigt.";
    });
  }

  async retry(mode: "manual" | "resume" = "manual"): Promise<void> {
    const lease = this.#lease;

    if (lease === undefined) return;

    if (this.#consent === undefined) {
      await this.loadConsent(lease, this.#epoch);

      return;
    }

    if (!this.#consent.enabled) {
      await this.refreshOutbox(lease);

      return;
    }

    await this.startDelivery(lease, mode);
  }

  private bind(lease: AccountLease | undefined, preserveBuffer = false): void {
    this.#epoch += 1;
    this.#lease = lease;
    this.#consent = undefined;
    this.#consentFailure = undefined;
    this.#consentBusy = false;
    this.#deliveryBusy = false;
    this.#delivering = false;
    this.#pendingMode = undefined;
    this.#outbox = { kind: "loading" };
    this.#message = "";

    if (!preserveBuffer) this.clearPendingBuffer();

    if (this.#journal?.kind === "writing") this.#journal.controller.abort();

    if (!preserveBuffer || this.#journal?.kind !== "pending") this.#journal = undefined;
    this.cancelTimer();
    this.#targetAt = undefined;
    this.publish();

    if (lease !== undefined) void this.loadConsent(lease, this.#epoch);
  }

  private async loadConsent(lease: AccountLease, epoch: number): Promise<void> {
    try {
      const consent = await lease.progress.status();

      if (epoch !== this.#epoch || !this.current(lease)) return;
      this.#consent = consent;
      this.#consentFailure = undefined;
      this.resumePendingBuffer();
      this.publish();
      await this.refreshOutbox(lease);

      if (consent.enabled) await this.startDelivery(lease, "resume");
    } catch {
      if (epoch !== this.#epoch || !this.current(lease)) return;
      this.clearPendingBuffer();
      this.#consentFailure = "Progress-Zustimmung nicht erreichbar. Keine automatische Erfassung.";
      this.publish();
    }
  }

  private startJournal(checkpoint: RideProgressCheckpoint): void {
    const journalId = JournalIdSchema.parse(checkpoint.journalId);

    if (this.#journal?.journalId === journalId) {
      if (this.#journal.kind === "pending") this.bufferCheckpoint(checkpoint);

      return;
    }

    if (this.#journal?.kind === "writing") this.#journal.controller.abort();
    const lease = this.#lease;
    const consent = this.#consent;
    const first = checkpoint.startTick === 0 && checkpoint.sequence === 0;

    const loading =
      this.#sessionView.kind === "busy" ||
      (lease !== undefined &&
        this.current(lease) &&
        consent === undefined &&
        this.#consentFailure === undefined);

    if (loading && first) {
      this.startBuffer(journalId, checkpoint);

      return;
    }

    const writable =
      lease !== undefined &&
      this.current(lease) &&
      consent?.enabled === true &&
      consent.rewardsAvailable &&
      consent.version > 0 &&
      first;

    if (writable) this.#message = "";
    this.#journal = writable
      ? {
          kind: "writing",
          journalId,
          lease,
          consentVersion: consent.version,
          sessionGeneration: lease.generation,
          controller: new AbortController(),
          lastEndedAtMs: undefined,
          lastPaused: false,
          deliverRequested: false,
        }
      : { kind: "ignored", journalId };
  }

  private startBuffer(journalId: JournalId, checkpoint: RideProgressCheckpoint): void {
    if (this.#buffer !== undefined) {
      this.clearPendingBuffer();
      this.#message = "Journalwechsel im frühen Puffer. Diese Fahrt wird nicht gespeichert.";
      this.#journal = { kind: "ignored", journalId };

      return;
    }

    this.#buffer = {
      journalId,
      checkpoints: [checkpoint],
      factCount: checkpoint.facts.length,
      timeS: checkpoint.facts.reduce((total, fact) => total + fact.timeS, 0),
    };
    this.#journal = { kind: "pending", journalId };
  }

  private bufferCheckpoint(checkpoint: RideProgressCheckpoint): void {
    const buffer = this.#buffer;
    const previous = buffer?.checkpoints.at(-1);

    if (buffer === undefined || previous === undefined) return;

    const contiguous = ProgressCheckpointBatchSchema.safeParse({
      consentVersion: 1,
      sessionGeneration: 1,
      checkpoints: [previous, checkpoint],
    }).success;

    const factCount = buffer.factCount + checkpoint.facts.length;
    const timeS = buffer.timeS + checkpoint.facts.reduce((total, fact) => total + fact.timeS, 0);

    if (
      !contiguous ||
      factCount > SERVER_PROGRESS_MAX_FACTS ||
      timeS > SERVER_PROGRESS_MAX_TIME_S + TIME_EPSILON_S
    ) {
      this.clearPendingBuffer();
      this.#message = "Früher Progress-Puffer voll oder nicht zusammenhängend. Fahrt verworfen.";
      this.publish();

      return;
    }

    buffer.checkpoints.push(checkpoint);
    buffer.factCount = factCount;
    buffer.timeS = timeS;
  }

  private clearPendingBuffer(): void {
    this.#buffer = undefined;

    if (this.#journal?.kind === "pending")
      this.#journal = { kind: "ignored", journalId: this.#journal.journalId };
  }

  private resumePendingBuffer(): void {
    const buffer = this.#buffer;
    const journal = this.#journal;
    this.#buffer = undefined;

    if (
      buffer === undefined ||
      journal?.kind !== "pending" ||
      journal.journalId !== buffer.journalId
    )
      return;
    this.#journal = undefined;
    this.#replayDepth += 1;

    for (const checkpoint of buffer.checkpoints) this.accept(checkpoint);
    this.#replayDepth -= 1;
    void this.enqueue(() => {
      const current = this.#journal;

      if (current?.kind === "writing" && current.deliverRequested) {
        current.deliverRequested = false;
        this.#targetAt = undefined;
        this.cancelTimer();
        void this.startDelivery(current.lease, "resume");
      }

      return Promise.resolve();
    });
  }

  private stopJournal(journalId: string): void {
    if (this.#buffer?.journalId === journalId) this.clearPendingBuffer();
    const journal = this.#journal;

    if (journal?.kind !== "writing" || journal.journalId !== journalId) return;
    journal.controller.abort();
    this.#journal = { kind: "ignored", journalId: JournalIdSchema.parse(journalId) };
    this.cancelTimer();
    this.#targetAt = undefined;
    this.#message = failureText(new PrivateRequestError("contract"));
    this.publish();
  }

  private async rejectContract(
    database: ProgressOutbox,
    lease: AccountLease,
    journalId: string,
  ): Promise<void> {
    this.stopJournal(journalId);
    const rows = await database.listJournalPending(lease, JournalIdSchema.parse(journalId));
    await this.failGroup(database, lease, rows, "contract");
  }

  private journalCurrent(journal: Extract<JournalState, { readonly kind: "writing" }>): boolean {
    return (
      this.#journal === journal &&
      this.current(journal.lease) &&
      !journal.controller.signal.aborted &&
      this.#consent !== undefined &&
      this.#consent.enabled &&
      this.#consent.rewardsAvailable &&
      this.#consent.version === journal.consentVersion
    );
  }

  private writeFence(
    journal: Extract<JournalState, { readonly kind: "writing" }>,
  ): ProgressWriteFence {
    return {
      apiOrigin: journal.lease.apiOrigin,
      userId: journal.lease.userId,
      journalId: journal.journalId,
      consentVersion: journal.consentVersion,
      sessionGeneration: journal.sessionGeneration,
      signal: AbortSignal.any([journal.lease.signal, journal.controller.signal]),
      current: () => this.journalCurrent(journal),
    };
  }

  private rowFence(lease: AccountLease, row: ProgressOutboxRow): ProgressWriteFence {
    return {
      apiOrigin: lease.apiOrigin,
      userId: lease.userId,
      journalId: row.journalId,
      consentVersion: row.consentVersion,
      sessionGeneration: row.sessionGeneration,
      signal: lease.signal,
      current: () => this.current(lease),
    };
  }

  private current(lease: AccountLease): boolean {
    return this.#lease === lease && lease.current();
  }

  private canUpload(lease: AccountLease): boolean {
    return (
      this.current(lease) &&
      this.#consent !== undefined &&
      this.#consent.enabled &&
      this.#consent.rewardsAvailable
    );
  }

  private database(): Promise<ProgressOutbox> {
    this.#resource ??= Promise.resolve()
      .then(() => this.#options.outbox?.() ?? openProgressOutboxDatabase())
      .catch(() => {
        this.#resource = undefined;
        throw new ProgressOutboxError("storage", "Progress outbox unavailable");
      });

    return this.#resource;
  }

  private async refreshOutbox(lease: AccountLease): Promise<void> {
    if (!this.current(lease)) return;

    try {
      const view = await (await this.database()).view(lease);

      if (!this.current(lease)) return;
      this.#outbox =
        view.kind === "blocked"
          ? { kind: "capacity", counts: view.counts }
          : { kind: "ready", counts: view.counts };
    } catch {
      if (this.current(lease)) this.#outbox = { kind: "failed" };
    }

    this.publish();
  }

  private async startDelivery(lease: AccountLease, mode: "manual" | "resume"): Promise<void> {
    if (!this.canUpload(lease)) return;

    if (this.#delivering) {
      if (mode === "manual" || this.#pendingMode === undefined) this.#pendingMode = mode;

      return;
    }

    const epoch = this.#epoch;
    this.#delivering = true;
    this.#deliveryBusy = true;
    this.publish();

    try {
      await this.enqueue(() => this.deliver(lease, mode));
    } catch {
      if (epoch === this.#epoch && this.current(lease)) {
        this.#message = "Progress-Lieferung nicht bestätigt. Daten bleiben erhalten.";
        await this.refreshOutbox(lease);
      }
    } finally {
      if (epoch === this.#epoch && this.current(lease)) {
        this.#delivering = false;
        this.#deliveryBusy = false;
        this.publish();
        const pending = this.#pendingMode;
        this.#pendingMode = undefined;

        if (pending !== undefined) void this.startDelivery(lease, pending);
      }
    }
  }

  private async deliver(lease: AccountLease, mode: "manual" | "resume"): Promise<void> {
    if (!this.canUpload(lease)) return;
    const database = await this.database();
    const journal = this.#journal;

    if (journal?.kind === "writing" && this.journalCurrent(journal) && journal.lease === lease)
      await database.prepareDelivery(this.writeFence(journal));

    let after: ProgressPendingPageCursor | undefined;

    while (this.canUpload(lease)) {
      const rows = (await database.listPendingPage(lease, DELIVERY_PAGE_SIZE, after)).toSorted(
        (left, right) =>
          left.journalId.localeCompare(right.journalId) ||
          progressBatchStartTick(left.payload) - progressBatchStartTick(right.payload),
      );

      let lastGroup: JournalDelivery | undefined;

      for (const group of journalGroups(rows)) {
        if (!this.canUpload(lease)) return;
        const journalId = group[0]?.journalId;
        const outcome = await this.deliverJournal(database, lease, group, mode);

        if (journalId !== undefined) lastGroup = { journalId, outcome };

        if (outcome === "failed" || outcome === "partial") {
          if (outcome === "partial") this.#pendingMode = "resume";
          await this.schedulePending(lease);

          return;
        }
      }

      if (rows.length < DELIVERY_PAGE_SIZE) break;
      const next = deliveryPageCursor(rows, lastGroup);

      if (next === undefined) break;
      after = next;
    }

    if (!this.current(lease)) return;
    this.#targetAt = undefined;
    await this.schedulePending(lease);
    await this.refreshOutbox(lease);
  }

  private async deliverJournal(
    database: ProgressOutbox,
    lease: AccountLease,
    rows: readonly ProgressOutboxRow[],
    mode: "manual" | "resume",
  ): Promise<DeliveryOutcome> {
    const eligible = await this.eligibleRows(database, lease, rows, mode);

    if (eligible.length === 0) return "empty";
    let batches: readonly ProgressCheckpointBatch[];

    try {
      batches = groupProgressBatches(eligible.map((row) => row.payload));
    } catch {
      const journalId = rows[0]?.journalId;

      if (journalId === undefined) return "failed";
      await this.rejectContract(database, lease, journalId);

      return "failed";
    }

    for (const batch of batches) {
      if (!this.canUpload(lease)) return "empty";
      const startTick = progressBatchStartTick(batch);
      const endTick = progressBatchEndTick(batch);

      const covered = eligible.filter(
        (row) =>
          progressBatchStartTick(row.payload) >= startTick &&
          progressBatchEndTick(row.payload) <= endTick,
      );

      const journalId = batch.checkpoints[0]?.journalId;

      if (covered.length === 0 || journalId === undefined) {
        if (journalId !== undefined) await this.rejectContract(database, lease, journalId);

        return "failed";
      }

      const outcome = await this.submitGroup(database, lease, batch, covered, mode);

      if (outcome === "failed") return "failed";

      if (outcome === "partial") return "partial";
    }

    return eligible.length < rows.length ? "deferred" : "delivered";
  }

  private async eligibleRows(
    database: ProgressOutbox,
    lease: AccountLease,
    rows: readonly ProgressOutboxRow[],
    mode: "manual" | "resume",
  ): Promise<readonly ProgressOutboxRow[]> {
    const first = rows[0];
    const eligible: ProgressOutboxRow[] = [];

    if (first === undefined) return eligible;

    for (const candidate of rows) {
      if (candidate.consentVersion !== first.consentVersion) break;
      let row = candidate;

      if (row.phase === "open") {
        const sealed = await database.seal(this.rowFence(lease, row));

        if (sealed === undefined) break;
        row = sealed;
      }

      if (row.state.kind === "queued") {
        if (row.state.retryAtMs > this.nowMs() && mode === "resume") break;
        eligible.push(row);
      } else if (row.state.kind === "sending") eligible.push(row);
      else if (
        row.state.kind === "blocked" &&
        mode === "manual" &&
        (row.state.cause === "retry" || row.state.cause === "reauth")
      )
        eligible.push(row);
      else break;
    }

    return eligible;
  }

  private async submitGroup(
    database: ProgressOutbox,
    lease: AccountLease,
    batch: ProgressCheckpointBatch,
    rows: readonly ProgressOutboxRow[],
    mode: "manual" | "resume",
  ): Promise<"delivered" | "failed" | "partial"> {
    const sending: ProgressOutboxRow[] = [];

    for (const row of rows) {
      if (!this.canUpload(lease)) return "failed";

      const marked = await database.markSending({
        row,
        fence: this.rowFence(lease, row),
        nowMs: this.nowMs(),
        manual: mode === "manual",
      });

      if (marked.state.kind !== "sending") return "failed";
      sending.push(marked);
    }

    if (!this.canUpload(lease)) return "failed";

    try {
      const receipt = await lease.progress.submit(batch);

      return await this.applyReceipt(database, lease, batch, sending, receipt);
    } catch (error) {
      const cause = deliveryCause(
        error instanceof Error ? error : new Error("Progress delivery failed"),
      );

      if (cause === undefined) return "failed";
      const journalId = batch.checkpoints[0]?.journalId;

      if (cause === "contract" && journalId !== undefined)
        await this.rejectContract(database, lease, journalId);
      else await this.failGroup(database, lease, sending, cause);

      return "failed";
    }
  }

  private async applyReceipt(
    database: ProgressOutbox,
    lease: AccountLease,
    batch: ProgressCheckpointBatch,
    sending: readonly ProgressOutboxRow[],
    receipt: Readonly<VoltsRideRangeReceipt>,
  ): Promise<"delivered" | "failed" | "partial"> {
    const firstUncovered = sending.findIndex((row) => !progressReceiptCoversRow(receipt, row));
    const journalId = batch.checkpoints[0]?.journalId;

    if (journalId === undefined) return "failed";

    if (firstUncovered === 0) {
      await this.rejectContract(database, lease, journalId);

      return "failed";
    }

    const journalRows = await database.listJournalPending(lease, receipt.journalId);

    for (const row of journalRows) {
      if (row.state.kind === "stored" || !progressReceiptCoversRow(receipt, row)) continue;
      let currentRow = row;

      if (currentRow.phase === "open") {
        const sealed = await database.seal(this.rowFence(lease, currentRow));

        if (sealed === undefined) continue;
        currentRow = sealed;
      }

      if (!this.current(lease)) return "failed";
      await database.markStored({
        row: currentRow,
        fence: this.rowFence(lease, currentRow),
        receipt,
      });
    }

    const uncovered = sending.filter((row) => !progressReceiptCoversRow(receipt, row));

    for (const row of uncovered) {
      if (!this.current(lease)) return "failed";
      await database.requeue(row, this.rowFence(lease, row), this.nowMs());
    }

    return uncovered.length === 0 ? "delivered" : "partial";
  }

  private async failGroup(
    database: ProgressOutbox,
    lease: AccountLease,
    rows: readonly ProgressOutboxRow[],
    cause: Exclude<SyncFailure, "superseded">,
  ): Promise<void> {
    if (!this.current(lease)) return;

    for (const candidate of rows) {
      try {
        let row = candidate;

        if (row.state.kind === "queued" && row.state.attempts === 0)
          row = await database.markSending({
            row,
            fence: this.rowFence(lease, row),
            nowMs: this.nowMs(),
            manual: true,
          });

        await database.markBlocked({
          row,
          fence: this.rowFence(lease, row),
          cause,
          attempts: row.state.attempts,
          nowMs: this.nowMs(),
        });
      } catch {
        continue;
      }
    }

    this.#message = failureText(new PrivateRequestError(cause));
    await this.refreshOutbox(lease);
  }

  private async blockPending(lease: AccountLease): Promise<void> {
    if (!this.current(lease)) return;
    const database = await this.database();
    const rows = await database.listPending(lease);

    for (const candidate of rows) {
      if (!this.current(lease)) return;
      let row = candidate;

      try {
        if (row.phase === "open") {
          const sealed = await database.seal(this.rowFence(lease, row));

          if (sealed === undefined) continue;
          row = sealed;
        }

        if (row.state.kind === "queued" && row.state.attempts === 0)
          row = await database.markSending({
            row,
            fence: this.rowFence(lease, row),
            nowMs: this.nowMs(),
            manual: true,
          });

        if (row.state.kind !== "blocked" || row.state.cause !== "consent")
          await database.markBlocked({
            row,
            fence: this.rowFence(lease, row),
            cause: "consent",
            attempts: row.state.attempts,
            nowMs: this.nowMs(),
          });
      } catch {
        continue;
      }
    }

    await this.refreshOutbox(lease);
  }

  private async schedulePending(lease: AccountLease): Promise<void> {
    if (!this.current(lease)) return;

    try {
      const next = await (await this.database()).nextRetryAt(lease);
      const nowMs = this.nowMs();

      if (next === undefined || next <= nowMs) this.cancelTimer();
      else this.scheduleAt(next);
    } catch {
      this.#outbox = { kind: "failed" };
      this.publish();
    }
  }

  private scheduleTarget(): void {
    const nowMs = this.nowMs();
    this.#targetAt ??= nowMs + DELIVERY_TARGET_MS;
    this.scheduleAt(this.#targetAt);
  }

  private scheduleAt(atMs: number): void {
    if (this.#timerAt !== undefined && this.#timerAt <= atMs && this.#timerAt > this.nowMs())
      return;
    this.cancelTimer();
    this.#timerAt = atMs;
    this.#timerCancel = (this.#options.schedule ?? defaultSchedule)(() => {
      this.#timerCancel = undefined;
      this.#timerAt = undefined;
      void this.retry("resume");
    }, atMs - this.nowMs());
  }

  private cancelTimer(): void {
    this.#timerCancel?.();
    this.#timerCancel = undefined;
    this.#timerAt = undefined;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.#operations.then(operation);
    this.#operations = result.catch(() => {});

    return result;
  }

  private nowMs(): number {
    return (this.#options.nowMs ?? Date.now)();
  }

  private publish(): void {
    const view = this.view();

    for (const listener of this.#listeners) listener(view);
  }
}

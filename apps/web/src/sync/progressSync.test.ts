/* oxlint-disable eslint/max-lines -- The focused integration suite keeps consent, delivery and transport boundaries together. */
/* oxlint-disable eslint/max-classes-per-file -- The suite keeps one stateful session harness and one in-memory outbox fake. */
/* oxlint-disable eslint/require-await -- The in-memory outbox mirrors the asynchronous ProgressOutbox contract without timers or I/O. */
/* oxlint-disable typescript/require-await -- The in-memory outbox mirrors the asynchronous ProgressOutbox contract without timers or I/O. */
/* oxlint-disable eslint/max-dependencies -- This integration intentionally spans session, transport, outbox and UI-facing sync contracts. */
/* oxlint-disable eslint/no-await-in-loop -- Retry attempts are intentionally sequential so each outbox backoff state is observable. */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- The session/outbox fixtures own mutable state and mirror the production interfaces. */
/* oxlint-disable vitest/no-conditional-in-test -- The HTTP fixture routes methods and revocation assertions inspect discriminated outbox state. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";

import {
  JournalIdSchema,
  ProgressConsentStateSchema,
  RideProgressCheckpointSchema,
  VoltsRideRangeReceiptSchema,
  type ProgressCheckpointBatch,
  type ProgressConsentState,
  type RideProgressCheckpoint,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import { AccountScopeSource } from "./accountScope.js";
import { PrivateRequestError, type SyncFailure } from "./apiRoute.js";
import type { ProgressPort } from "./progressPort.js";
import { privateAuthTransport } from "./privateAuthTransport.js";
import {
  appendProgressBatch,
  groupProgressBatches,
  progressBatchStartTick,
} from "./progressBatch.js";
import {
  PROGRESS_OUTBOX_MAX_ROWS,
  newProgressOutboxRow,
  progressReceiptCoversRow,
  type ProgressAccountOwner,
  type ProgressAppendResult,
  type ProgressBlockCause,
  type ProgressMarkBlocked,
  type ProgressMarkSending,
  type ProgressMarkStored,
  type ProgressOutbox,
  type ProgressOutboxRow,
  type ProgressOutboxState,
  type ProgressOutboxView,
  type ProgressPendingPageCursor,
  type ProgressWriteFence,
} from "./progressOutbox.js";
import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import { ProgressSync, type ProgressLease, type ProgressSyncOptions } from "./progressSync.js";
import { deferred } from "./testdata/deferred.js";
import { MemoryOutboxDatabase, batch, checkpoint, owner, userA } from "./progressOutboxTestdata.js";

const ORIGIN = "http://localhost:3000";
const OTHER_JOURNAL = "550e8400-e29b-41d4-a716-446655440001";
const THIRD_JOURNAL = "550e8400-e29b-41d4-a716-446655440002";
const DEFAULT_STATE: ProgressOutboxState = { kind: "queued", attempts: 0, retryAtMs: 0 };

function rangeReceipt(value: ProgressCheckpointBatch): VoltsRideRangeReceipt {
  const first = value.checkpoints[0];
  const last = value.checkpoints.at(-1);

  if (first === undefined || last === undefined) throw new Error("Receipt needs checkpoints");

  return VoltsRideRangeReceiptSchema.parse({
    entryId: crypto.randomUUID(),
    journalId: first.journalId,
    startTick: first.startTick,
    endTick: last.endTick,
    rewardDay: "2026-11-25",
    cumulativeWorkVolts: 1,
    cumulativeClimbVolts: 0,
    candidateVolts: 1,
    awardedVolts: 1,
    withheldVolts: 0,
  });
}

function rowKey(row: ProgressOutboxRow): string {
  return JSON.stringify([
    row.apiOrigin,
    row.userId,
    row.journalId,
    progressBatchStartTick(row.payload),
  ]);
}

function failureState(
  attempts: number,
  cause: ProgressBlockCause,
  nowMs: number,
): ProgressOutboxState {
  const retryAtMs = nowMs + Math.min(60_000, 1000 * 2 ** (attempts - 1));

  return cause === "retry" && attempts < 5
    ? { kind: "queued", attempts, retryAtMs }
    : { kind: "blocked", cause, attempts, retryAtMs };
}

class MemoryOutbox implements ProgressOutbox {
  readonly #rows = new Map<string, ProgressOutboxRow>();
  requeues = 0;
  viewCalls = 0;
  pendingPageLimits: number[] = [];
  nextRetryAtCalls = 0;
  prepareDeliveryCalls = 0;
  flushCalls = 0;

  raw(): readonly ProgressOutboxRow[] {
    return [...this.#rows.values()];
  }

  seed(row: ProgressOutboxRow): void {
    this.#rows.set(rowKey(row), row);
  }

  private check(fence: ProgressWriteFence): void {
    if (fence.signal.aborted || !fence.current()) throw new Error("stale progress fence");
  }

  private checkRow(fence: ProgressWriteFence, row: ProgressOutboxRow): void {
    this.check(fence);

    if (
      row.apiOrigin !== fence.apiOrigin ||
      row.userId !== fence.userId ||
      row.journalId !== fence.journalId ||
      row.consentVersion !== fence.consentVersion ||
      row.sessionGeneration !== fence.sessionGeneration
    )
      throw new Error("progress row owner changed");
  }

  private replace(
    row: ProgressOutboxRow,
    state: ProgressOutboxState,
    phase: ProgressOutboxRow["phase"] = row.phase,
  ): ProgressOutboxRow {
    const next = newProgressOutboxRow({
      owner: row,
      consentVersion: row.consentVersion,
      sessionGeneration: row.sessionGeneration,
      batch: row.payload,
      phase,
      state,
    });

    this.#rows.set(rowKey(next), next);

    return next;
  }

  private journal(fence: ProgressWriteFence): readonly ProgressOutboxRow[] {
    return this.raw()
      .filter(
        (row) =>
          row.apiOrigin === fence.apiOrigin &&
          row.userId === fence.userId &&
          row.journalId === fence.journalId,
      )
      .toSorted(
        (left, right) =>
          progressBatchStartTick(left.payload) - progressBatchStartTick(right.payload),
      );
  }

  // oxlint-disable-next-line eslint/max-lines-per-function -- The fake reproduces the outbox's atomic append and local batching transition in one readable method.
  async append(
    fence: ProgressWriteFence,
    entry: RideProgressCheckpoint,
  ): Promise<ProgressAppendResult> {
    this.check(fence);

    if (entry.source === "sim") return { kind: "ignored", reason: "sim" };

    if (fence.consentVersion <= 0) return { kind: "ignored", reason: "consent" };
    const journal = this.journal(fence);

    const duplicate = journal.find((row) =>
      row.payload.checkpoints.some((item) => item.sequence === entry.sequence),
    );

    if (duplicate !== undefined) {
      const seen = duplicate.payload.checkpoints.find((item) => item.sequence === entry.sequence);

      if (JSON.stringify(seen) !== JSON.stringify(entry)) throw new Error("sequence changed");

      return { kind: "stored", rows: [duplicate] };
    }

    const open = journal.find((row) => row.phase === "open");

    const update = appendProgressBatch({
      open: open?.state.kind === "blocked" ? undefined : open?.payload,
      checkpoint: entry,
      consentVersion: fence.consentVersion,
      sessionGeneration: fence.sessionGeneration,
    });

    const sealed =
      open !== undefined && open.state.kind === "blocked"
        ? [open.payload, ...update.sealed]
        : update.sealed;

    if (open !== undefined) this.#rows.delete(rowKey(open));
    const changed: ProgressOutboxRow[] = [];

    for (const value of sealed) {
      const previous =
        open !== undefined && progressBatchStartTick(open.payload) === progressBatchStartTick(value)
          ? open
          : undefined;

      const row = newProgressOutboxRow({
        owner: fence,
        consentVersion: fence.consentVersion,
        sessionGeneration: fence.sessionGeneration,
        batch: value,
        phase: "sealed",
        state: previous?.state ?? { kind: "queued", attempts: 0, retryAtMs: 0 },
      });

      this.seed(row);
      changed.push(row);
    }

    if (update.open !== undefined) {
      const row = newProgressOutboxRow({
        owner: fence,
        consentVersion: fence.consentVersion,
        sessionGeneration: fence.sessionGeneration,
        batch: update.open,
        phase: "open",
      });

      this.seed(row);
      changed.push(row);
    }

    return { kind: "stored", rows: changed };
  }

  async seal(fence: ProgressWriteFence): Promise<ProgressOutboxRow | undefined> {
    this.check(fence);
    const open = this.journal(fence).find((row) => row.phase === "open");

    return open === undefined ? undefined : this.replace(open, open.state, "sealed");
  }

  async prepareDelivery(fence: ProgressWriteFence): Promise<void> {
    this.prepareDeliveryCalls += 1;
    await this.seal(fence);

    for (const row of this.raw()) {
      if (
        row.apiOrigin === fence.apiOrigin &&
        row.userId === fence.userId.toLowerCase() &&
        row.state.kind === "stored"
      )
        this.#rows.delete(rowKey(row));
    }
  }

  async flush(
    fence: ProgressWriteFence,
    nowMs: number,
  ): Promise<readonly ProgressCheckpointBatch[]> {
    this.flushCalls += 1;
    await this.prepareDelivery(fence);

    const eligible: ProgressOutboxRow[] = [];

    for (const row of this.journal(fence)) {
      this.checkRow(fence, row);

      if (
        row.state.kind === "blocked" ||
        (row.state.kind === "queued" && row.state.retryAtMs > nowMs)
      )
        break;

      if (row.state.kind !== "stored") eligible.push(row);
    }

    return groupProgressBatches(eligible.map((row) => row.payload));
  }

  listPending(account: ProgressAccountOwner): Promise<readonly ProgressOutboxRow[]> {
    return Promise.resolve(
      this.raw().filter(
        (row) =>
          row.apiOrigin === account.apiOrigin &&
          row.userId === account.userId.toLowerCase() &&
          row.state.kind !== "stored",
      ),
    );
  }

  async listPendingPage(
    account: ProgressAccountOwner,
    limit: number,
    after?: ProgressPendingPageCursor,
  ): Promise<readonly ProgressOutboxRow[]> {
    this.pendingPageLimits.push(limit);
    const rows = await this.listPending(account);

    return rows
      .toSorted(
        (left, right) =>
          left.journalId.localeCompare(right.journalId) ||
          progressBatchStartTick(left.payload) - progressBatchStartTick(right.payload),
      )
      .filter((row) => {
        if (after === undefined) return true;
        const journalOrder = row.journalId.localeCompare(after.journalId);

        return (
          journalOrder > 0 ||
          (journalOrder === 0 && progressBatchStartTick(row.payload) > after.startTick)
        );
      })
      .slice(0, limit);
  }

  async listJournalPending(
    account: ProgressAccountOwner,
    journalId: ProgressOutboxRow["journalId"],
  ): Promise<readonly ProgressOutboxRow[]> {
    const rows = await this.listPending(account);

    return rows
      .filter((row) => row.journalId === journalId)
      .toSorted(
        (left, right) =>
          progressBatchStartTick(left.payload) - progressBatchStartTick(right.payload),
      );
  }

  async nextRetryAt(account: ProgressAccountOwner, afterMs: number): Promise<number | undefined> {
    this.nextRetryAtCalls += 1;
    const rows = await this.listPending(account);
    let next: number | undefined;

    for (const row of rows) {
      if (row.state.kind !== "queued" || row.state.retryAtMs <= afterMs) continue;

      if (next === undefined || row.state.retryAtMs < next) next = row.state.retryAtMs;
    }

    return next;
  }

  async purgeOwner(account: ProgressAccountOwner): Promise<void> {
    for (const [key, row] of this.#rows) {
      if (row.apiOrigin === account.apiOrigin && row.userId === account.userId)
        this.#rows.delete(key);
    }
  }

  async markSending(input: ProgressMarkSending): Promise<ProgressOutboxRow> {
    this.checkRow(input.fence, input.row);
    const existing = this.#rows.get(rowKey(input.row));

    if (existing === undefined || existing.phase !== "sealed")
      throw new Error("missing sealed row");

    if (existing.state.kind === "sending" || existing.state.kind === "stored") return existing;

    if (existing.state.kind === "queued") {
      if (existing.state.retryAtMs > input.nowMs && !input.manual) return existing;

      return this.replace(existing, {
        kind: "sending",
        attempts: existing.state.attempts + 1,
        retryAtMs: 0,
      });
    }

    if (!input.manual || (existing.state.cause !== "retry" && existing.state.cause !== "reauth"))
      throw new Error("blocked row needs manual retry");

    return this.replace(existing, { kind: "sending", attempts: 1, retryAtMs: 0 });
  }

  async markStored(input: ProgressMarkStored): Promise<ProgressOutboxRow> {
    this.checkRow(input.fence, input.row);

    if (input.row.phase !== "sealed") throw new Error("missing sealed row");

    if (!progressReceiptCoversRow(input.receipt, input.row))
      throw new Error("receipt does not cover row");

    const stored = this.replace(input.row, {
      kind: "stored",
      attempts: Math.max(1, input.row.state.attempts),
      retryAtMs: 0,
      receipt: input.receipt,
    });

    this.#rows.delete(rowKey(stored));

    return stored;
  }

  async markBlocked(input: ProgressMarkBlocked): Promise<ProgressOutboxRow> {
    this.checkRow(input.fence, input.row);
    const existing = this.#rows.get(rowKey(input.row));

    if (
      existing === undefined ||
      existing.state.kind === "stored" ||
      existing.state.attempts !== input.attempts ||
      input.attempts < 1
    )
      throw new Error("attempt state changed");

    return this.replace(existing, failureState(input.attempts, input.cause, input.nowMs));
  }

  async requeue(
    row: ProgressOutboxRow,
    fence: ProgressWriteFence,
    nowMs: number,
  ): Promise<ProgressOutboxRow> {
    this.checkRow(fence, row);
    const existing = this.#rows.get(rowKey(row));

    if (existing === undefined || existing.state.kind === "stored") throw new Error("missing row");
    this.requeues += 1;

    return this.replace(existing, {
      kind: "queued",
      attempts: existing.state.attempts,
      retryAtMs: nowMs,
    });
  }

  state(account: ProgressAccountOwner): Promise<ProgressOutboxView> {
    const rows = this.raw().filter(
      (row) => row.apiOrigin === account.apiOrigin && row.userId === account.userId.toLowerCase(),
    );

    const counts = {
      rows: rows.length,
      queued: rows.filter((row) => row.state.kind === "queued").length,
      sending: rows.filter((row) => row.state.kind === "sending").length,
      blocked: rows.filter((row) => row.state.kind === "blocked").length,
      stored: rows.filter((row) => row.state.kind === "stored").length,
      open: rows.filter((row) => row.phase === "open").length,
      remaining: Math.max(0, PROGRESS_OUTBOX_MAX_ROWS - rows.length),
    };

    return Promise.resolve(
      rows.length >= PROGRESS_OUTBOX_MAX_ROWS
        ? { kind: "blocked", cause: "capacity", counts }
        : { kind: "ready", counts },
    );
  }

  view(account: ProgressAccountOwner): Promise<ProgressOutboxView> {
    this.viewCalls += 1;

    return this.state(account);
  }
}

function seedRow(
  memory: Readonly<{ seed: (row: ProgressOutboxRow) => void }>,
  checkpoints: readonly RideProgressCheckpoint[],
  state: ProgressOutboxState = DEFAULT_STATE,
  sessionGeneration = 1,
): ProgressOutboxRow {
  const first = checkpoints[0];

  if (first === undefined) throw new Error("Progress row needs a checkpoint");

  const value = newProgressOutboxRow({
    owner: { ...owner, journalId: JournalIdSchema.parse(first.journalId) },
    consentVersion: 1,
    sessionGeneration,
    batch: batch(checkpoints, 1, sessionGeneration),
    phase: checkpoints.at(-1)?.quality.paused === true ? "sealed" : "open",
    state,
  });

  memory.seed(value);

  return value;
}

function checkpointWithFacts(sequence: number, startTick: number): RideProgressCheckpoint {
  const base = checkpoint({ sequence, startTick });
  const fact = base.facts[0];

  if (fact === undefined) throw new Error("Checkpoint fixture needs a fact");

  return RideProgressCheckpointSchema.parse({
    ...base,
    endTick: startTick + 120,
    facts: Array.from({ length: 120 }, () => ({ ...fact })),
  });
}

class Harness {
  readonly scope = new AccountScopeSource<ProgressLease>();
  readonly memory: MemoryOutbox;
  readonly outbox: ProgressOutbox;
  readonly submitted: ProgressCheckpointBatch[] = [];
  readonly updates: boolean[] = [];
  readonly scheduled: number[] = [];
  active: ProgressLease | undefined;
  controller: AbortController | undefined;
  generation = 0;
  nowMs = 1000;
  consent: ProgressConsentState = ProgressConsentStateSchema.parse({
    version: 0,
    enabled: false,
    rewardsAvailable: true,
    sessionGeneration: 1,
  });
  statusPending?: Promise<ProgressConsentState>;
  updatePending?: Promise<ProgressConsentState>;
  submitFailure?: PrivateRequestError;
  submitOverride?: (value: ProgressCheckpointBatch) => Promise<VoltsRideRangeReceipt>;
  readonly token = "same-private-token";
  readonly sync: ProgressSync;

  constructor(
    memory = new MemoryOutbox(),
    options: Pick<ProgressSyncOptions, "outbox" | "schedule"> = {},
  ) {
    this.memory = memory;
    this.outbox = memory;
    this.scope.signOut({ kind: "guest", message: "Gast" });
    this.sync = new ProgressSync({
      scope: this.scope,
      outbox: () => Promise.resolve(this.outbox),
      nowMs: () => this.nowMs,
      schedule: (_callback, delayMs) => {
        this.scheduled.push(delayMs);

        return () => {};
      },
      ...options,
    });
  }

  beginRestore(): void {
    this.scope.signOut({ kind: "busy", operation: "restoring" });
  }

  login(): ProgressLease {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    const controller = this.controller;
    const generation = this.generation;
    let lease: ProgressLease;

    const base = privateAuthTransport(ORIGIN).authorize({
      token: this.token,
      userId: userA,
      generation,
      signal: controller.signal,
      current: () => this.active === lease,
    });

    lease = { ...base, progress: this.progressLease(() => this.active === lease, generation) };
    this.active = lease;

    this.scope.signIn(lease, {
      persistent: true,
      user: { id: userA, email: "rider@example.com", createdAt: "2026-11-20T00:00:00.000Z" },
    });

    return lease;
  }

  private progressLease(current: () => boolean, generation: number): ProgressPort {
    return {
      status: () => {
        const pending = this.statusPending;
        delete this.statusPending;

        return pending ?? Promise.resolve({ ...this.consent });
      },
      update: async (enabled) => {
        if (!current()) throw new PrivateRequestError("superseded");
        this.updates.push(enabled);
        const pending = this.updatePending;
        delete this.updatePending;

        if (pending !== undefined) await pending;

        if (!current()) throw new PrivateRequestError("superseded");

        const version =
          this.consent.enabled === enabled ? this.consent.version : this.consent.version + 1;

        this.consent = {
          version,
          enabled,
          rewardsAvailable: this.consent.rewardsAvailable,
          sessionGeneration: generation,
        };

        return { ...this.consent };
      },
      submit: async (value) => {
        if (!current()) throw new PrivateRequestError("superseded");
        this.submitted.push(value);

        if (this.submitFailure !== undefined) throw this.submitFailure;

        const result =
          this.submitOverride === undefined
            ? rangeReceipt(value)
            : await this.submitOverride(value);

        if (!current()) throw new PrivateRequestError("superseded");

        return result;
      },
    };
  }

  logout(): void {
    this.active = undefined;
    this.controller?.abort();

    this.scope.signOut({ kind: "guest", message: "Gast" });
  }
}

function settle(depth = 200): Promise<void> {
  return depth === 0 ? Promise.resolve() : Promise.resolve().then(() => settle(depth - 1));
}

function accountMessage(view: ReturnType<ProgressSync["view"]>): string {
  if (view.kind !== "account") throw new Error("Expected an account progress view");

  return view.message;
}

it("ignores guest, sim and undefined checkpoints and activates at the next tick-zero journal", async () => {
  const f = new Harness();
  f.sync.accept();
  f.sync.accept(checkpoint({ source: "sim" }));
  f.sync.accept(checkpoint());
  f.login();
  await settle();
  f.sync.accept(checkpoint());
  await settle();
  expect(f.memory.raw()).toEqual([]);
  await f.sync.setConsent(true);
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1 }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  f.sync.accept(checkpoint({ id: OTHER_JOURNAL, paused: true }));
  await settle();
  expect(f.submitted.map((value) => value.checkpoints[0]?.journalId)).toEqual([OTHER_JOURNAL]);
  expect(f.memory.raw()).toEqual([]);
});

it("requires tick zero when consent was already active", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.sync.accept(checkpoint({ startTick: 5 }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  f.sync.accept(checkpoint({ id: OTHER_JOURNAL, paused: true }));
  await settle();
  expect(f.submitted).toHaveLength(1);
  expect(f.memory.raw()).toEqual([]);
});

it("requires sequence zero for a new tick-zero journal", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.sync.accept(checkpoint({ sequence: 1 }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  f.sync.accept(checkpoint({ id: OTHER_JOURNAL, paused: true }));
  await settle();
  expect(f.submitted).toHaveLength(1);
});

it("does not persist or upload when consent is enabled but rewards policy is off", async () => {
  const memory = new MemoryOutbox();
  const pending = seedRow(memory, [checkpoint({ paused: true })]);
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: false, sessionGeneration: 1 };
  f.login();
  await settle();
  expect(f.sync.view()).toMatchObject({
    kind: "account",
    consent: { kind: "ready", enabled: true, rewardsAvailable: false },
  });
  expect(memory.raw()).toEqual([pending]);
  expect(f.submitted).toEqual([]);
  f.sync.accept(checkpoint({ id: OTHER_JOURNAL, paused: true }));
  await settle();
  expect(memory.raw()).toEqual([pending]);
  await f.sync.flush();
  expect(memory.raw()).toEqual([pending]);
  expect(f.submitted).toEqual([]);
});

it("replays every contiguous checkpoint buffered while consent status was loading", async () => {
  const status = deferred<ProgressConsentState>();
  const f = new Harness();
  f.statusPending = status.promise;
  f.submitFailure = new PrivateRequestError("retry");
  f.login();

  for (let sequence = 0; sequence < 6; sequence += 1)
    f.sync.accept(checkpoint({ sequence, startTick: sequence }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  status.resolve({ version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 });
  await settle();
  expect(f.memory.raw()).toHaveLength(1);
  expect(f.memory.raw()[0]?.payload.checkpoints.map((entry) => entry.sequence)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
  expect(f.memory.raw()[0]?.sessionGeneration).toBe(1);
});

it("buffers contiguous checkpoints while the session is restoring", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitFailure = new PrivateRequestError("retry");
  f.beginRestore();

  for (let sequence = 0; sequence < 6; sequence += 1)
    f.sync.accept(checkpoint({ sequence, startTick: sequence }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  f.login();
  await settle();
  expect(f.memory.raw()[0]?.payload.checkpoints.map((entry) => entry.sequence)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
});

it("clears the early buffer when 1200 facts or 60 seconds would be exceeded", async () => {
  const status = deferred<ProgressConsentState>();
  const f = new Harness();
  f.statusPending = status.promise;
  f.login();

  for (let sequence = 0; sequence < 10; sequence += 1)
    f.sync.accept(checkpointWithFacts(sequence, sequence * 120));
  f.sync.accept(checkpointWithFacts(10, 1200));
  status.resolve({ version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 });
  await settle();
  expect(f.memory.raw()).toEqual([]);
  expect(f.submitted).toEqual([]);
  expect(accountMessage(f.sync.view())).toContain("Puffer voll");
});

it("discards a queued tick-zero checkpoint when consent resolves disabled", async () => {
  const status = deferred<ProgressConsentState>();
  const f = new Harness();
  f.statusPending = status.promise;
  f.login();
  f.sync.accept(checkpoint());
  status.resolve({ version: 0, enabled: false, rewardsAvailable: true, sessionGeneration: 1 });
  await settle();
  expect(f.memory.raw()).toEqual([]);
  await f.sync.setConsent(true);
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1 }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
});

it("discards a queued tick-zero checkpoint when consent status fails", async () => {
  let failStatus: ((error: Error) => void) | undefined;

  const status = new Promise<ProgressConsentState>((_resolve, reject) => {
    failStatus = (error: Error) => {
      reject(error);
    };
  });

  const f = new Harness();
  f.statusPending = status;
  f.login();
  f.sync.accept(checkpoint());
  failStatus?.(new Error("offline"));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  expect(f.sync.view()).toMatchObject({
    kind: "account",
    consent: { kind: "failed" },
  });
});

it("creates no row or request for sim with active consent", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.sync.accept();
  f.sync.accept(checkpoint({ source: "sim", paused: true }));
  await settle();
  expect(f.memory.raw()).toEqual([]);
  expect(f.submitted).toEqual([]);
});

it("persists each open checkpoint and seals it on manual flush", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  expect(f.sync.view()).toMatchObject({
    kind: "account",
    consent: { kind: "ready", enabled: true },
  });
  f.sync.accept(checkpoint());
  await settle();
  expect(f.memory.raw()[0]?.phase).toBe("open");
  expect(f.submitted).toEqual([]);
  await f.sync.flush();
  expect(f.submitted).toHaveLength(1);
  expect(f.memory.raw()).toEqual([]);
  expect(f.memory.prepareDeliveryCalls).toBe(1);
  expect(f.memory.flushCalls).toBe(0);
});

it("refreshes outbox status on delivery but not after every checkpoint append", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  const viewCalls = f.memory.viewCalls;
  f.sync.accept(checkpoint());
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1 }));
  await settle();
  expect(f.memory.viewCalls).toBe(viewCalls);
  expect(f.memory.raw()[0]?.payload.checkpoints.map((entry) => entry.sequence)).toEqual([0, 1]);
  await f.sync.flush();
  expect(f.memory.viewCalls).toBeGreaterThan(viewCalls);
  expect(f.submitted).toHaveLength(1);
});

it("delivers on the pause transition and merges later paused checkpoints locally", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.sync.accept(checkpoint());
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1, paused: true }));
  await settle();
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([2]);
  f.sync.accept(checkpoint({ sequence: 2, startTick: 2, paused: true }));
  f.sync.accept(checkpoint({ sequence: 3, startTick: 3, paused: true }));
  await settle();
  expect(f.submitted).toHaveLength(1);
  expect(f.memory.raw()).toHaveLength(1);
  expect(f.memory.raw()[0]?.payload.checkpoints.map((entry) => entry.sequence)).toEqual([2, 3]);
  await f.sync.flush();
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([2, 2]);
});

it("resumes the same token after reload using the stored row generation", async () => {
  const memory = new MemoryOutbox();
  const first = new Harness(memory);
  first.login();
  await settle();
  await first.sync.setConsent(true);
  first.submitFailure = new PrivateRequestError("retry");
  first.sync.accept(checkpoint({ paused: true }));
  await settle();
  expect(memory.raw()[0]?.sessionGeneration).toBe(1);
  first.logout();
  const reloaded = new Harness(memory);
  reloaded.generation = first.generation;
  reloaded.consent = { ...first.consent };
  reloaded.nowMs = 5000;
  expect(reloaded.login().generation).toBe(2);
  await settle();
  expect(reloaded.submitted[0]?.sessionGeneration).toBe(1);
  expect(memory.raw()).toEqual([]);
});

it("revocation blocks open and pending rows without deleting confirmed data", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  const confirmedCheckpoint = checkpoint({ id: OTHER_JOURNAL, paused: true });

  const confirmed = seedRow(f.memory, [confirmedCheckpoint], {
    kind: "stored",
    attempts: 1,
    retryAtMs: 0,
    receipt: rangeReceipt(batch([confirmedCheckpoint])),
  });

  seedRow(f.memory, [checkpoint({ id: THIRD_JOURNAL, paused: true })]);
  f.submitFailure = new PrivateRequestError("retry");
  f.login();
  await settle();
  f.sync.accept(checkpoint());
  await settle();
  const revocation = f.sync.setConsent(false);
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1 }));
  await revocation;
  await settle();
  const pending = f.memory.raw().filter((row) => row.state.kind !== "stored");
  expect(pending).toHaveLength(2);
  expect(
    pending.every((row) => row.state.kind === "blocked" && row.state.cause === "consent"),
  ).toBe(true);
  expect(pending.every((row) => row.phase === "sealed")).toBe(true);
  expect(f.memory.raw()).toContainEqual(confirmed);
  const submitted = f.submitted.length;
  await f.sync.retry();
  expect(f.submitted).toHaveLength(submitted);
});

it("stops active journal persistence and uploads when rewards policy turns off without deleting rows", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.sync.accept(checkpoint());
  await settle();
  const stored = f.memory.raw();
  expect(stored).toHaveLength(1);
  f.consent = { ...f.consent, rewardsAvailable: false };
  await f.sync.setConsent(true);
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1, paused: true }));
  await settle();
  expect(f.memory.raw()).toEqual(stored);
  await f.sync.flush();
  expect(f.memory.raw()).toEqual(stored);
  expect(f.submitted).toEqual([]);
});

it("marks in-flight work blocked immediately when consent is revoked", async () => {
  const memory = new MemoryOutbox();
  seedRow(memory, [checkpoint({ paused: true })]);
  const reply = deferred<VoltsRideRangeReceipt>();
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitOverride = () => reply.promise;
  f.login();
  await settle();
  expect(memory.raw()[0]?.state.kind).toBe("sending");
  const revocation = f.sync.setConsent(false);
  await settle();
  expect(memory.raw()[0]?.state).toMatchObject({ kind: "blocked", cause: "consent" });
  await revocation;
});

it("pages eleven pending rows in groups of at most ten local batches", async () => {
  const memory = new MemoryOutbox();
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  memory.pendingPageLimits.length = 0;
  memory.nextRetryAtCalls = 0;

  for (let index = 0; index < 11; index += 1)
    seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })]);
  await f.sync.flush();
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([10, 1]);
  expect(memory.pendingPageLimits).toEqual([10, 10]);
  expect(memory.nextRetryAtCalls).toBe(1);
  expect(memory.raw()).toEqual([]);
});

const pagingModes: readonly ("manual" | "resume")[] = ["manual", "resume"];

it.each(pagingModes)(
  "skips a blocked journal page before delivering the next in %s mode",
  async (mode) => {
    const memory = new MemoryOutbox();
    const f = new Harness(memory);

    const blocked: ProgressOutboxState = {
      kind: "blocked",
      cause: "contract",
      attempts: 1,
      retryAtMs: 0,
    };

    f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
    f.login();
    await settle();

    for (let index = 0; index < 10; index += 1)
      seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })], blocked);
    seedRow(memory, [checkpoint({ id: OTHER_JOURNAL, paused: true })]);
    await f.sync.retry(mode);
    expect(f.submitted.map((value) => value.checkpoints[0]?.journalId)).toEqual([OTHER_JOURNAL]);
    expect(memory.raw()).toHaveLength(10);
    expect(
      memory.raw().every((row) => row.state.kind === "blocked" && row.state.cause === "contract"),
    ).toBe(true);
  },
);

it("keeps fresh rows behind a full backoff page until retry", async () => {
  const memory = new MemoryOutbox();
  const f = new Harness(memory);
  const backoff: ProgressOutboxState = { kind: "queued", attempts: 1, retryAtMs: 2000 };
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.scheduled.length = 0;
  memory.nextRetryAtCalls = 0;

  for (let index = 0; index < 10; index += 1)
    seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })], backoff);

  for (let index = 10; index < 12; index += 1)
    seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })]);
  await f.sync.retry("resume");
  expect(f.submitted).toEqual([]);
  expect(memory.raw()).toHaveLength(12);
  expect(f.scheduled).toEqual([1000]);
  expect(memory.nextRetryAtCalls).toBe(1);
  f.nowMs = 2000;
  await f.sync.retry("resume");
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([10, 2]);
  expect(f.submitted.flatMap((value) => value.checkpoints.map((entry) => entry.sequence))).toEqual(
    Array.from({ length: 12 }, (_, index) => index),
  );
  expect(memory.raw()).toEqual([]);
});

it("defers fresh rows behind an eligible prefix with a backoff tail", async () => {
  const memory = new MemoryOutbox();
  const f = new Harness(memory);
  const backoff: ProgressOutboxState = { kind: "queued", attempts: 1, retryAtMs: 2000 };
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.scheduled.length = 0;
  seedRow(memory, [checkpoint({ paused: true })]);
  seedRow(memory, [checkpoint({ sequence: 1, startTick: 1, paused: true })], backoff);

  for (let index = 2; index < 12; index += 1)
    seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })]);
  await f.sync.retry("resume");
  expect(f.submitted.flatMap((value) => value.checkpoints.map((entry) => entry.sequence))).toEqual([
    0,
  ]);
  expect(memory.raw()).toHaveLength(11);
  expect(f.scheduled).toEqual([1000]);
  f.nowMs = 2000;
  await f.sync.retry("resume");
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([1, 10, 1]);
  expect(f.submitted.flatMap((value) => value.checkpoints.map((entry) => entry.sequence))).toEqual(
    Array.from({ length: 12 }, (_, index) => index),
  );
  expect(memory.raw()).toEqual([]);
});

it("schedules an indexed backoff head behind fresh tail rows", async () => {
  const database = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(database);
  const f = new Harness(new MemoryOutbox(), { outbox: () => Promise.resolve(outbox) });
  const backoff: ProgressOutboxState = { kind: "queued", attempts: 1, retryAtMs: 5000 };
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.scheduled.length = 0;
  seedRow(database, [checkpoint({ paused: true })], backoff);

  for (let index = 1; index < 4; index += 1)
    seedRow(database, [checkpoint({ sequence: index, startTick: index, paused: true })]);
  await f.sync.retry("resume");
  expect(f.submitted).toEqual([]);
  expect(f.scheduled).toEqual([4000]);
  f.nowMs = 5000;
  await f.sync.retry("resume");
  expect(f.submitted.flatMap((value) => value.checkpoints.map((entry) => entry.sequence))).toEqual([
    0, 1, 2, 3,
  ]);
});

it("schedules a later journal retry after a full blocked page", async () => {
  const memory = new MemoryOutbox();
  const f = new Harness(memory);

  const blocked: ProgressOutboxState = {
    kind: "blocked",
    cause: "contract",
    attempts: 1,
    retryAtMs: 0,
  };

  const backoff: ProgressOutboxState = { kind: "queued", attempts: 1, retryAtMs: 3000 };
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  f.scheduled.length = 0;

  for (let index = 0; index < 10; index += 1)
    seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })], blocked);
  seedRow(memory, [checkpoint({ id: OTHER_JOURNAL, paused: true })], backoff);
  await f.sync.retry("resume");
  expect(f.submitted).toEqual([]);
  expect(memory.raw()).toHaveLength(11);
  expect(f.scheduled).toEqual([2000]);
  f.nowMs = 3000;
  await f.sync.retry("resume");
  expect(f.submitted.map((value) => value.checkpoints[0]?.journalId)).toEqual([OTHER_JOURNAL]);
  expect(memory.raw()).toHaveLength(10);
});

it("uses the account lease generation as journal session generation", async () => {
  const f = new Harness();
  f.generation = 6;
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  expect(f.login().generation).toBe(7);
  await settle();
  f.sync.accept(checkpoint({ paused: true }));
  await settle();
  expect(f.submitted[0]?.sessionGeneration).toBe(7);
});

it("delivers contiguous rows across browser generation changes", async () => {
  const memory = new MemoryOutbox();
  seedRow(memory, [checkpoint({ paused: true })], DEFAULT_STATE, 1);
  seedRow(memory, [checkpoint({ sequence: 1, startTick: 1, paused: true })], DEFAULT_STATE, 2);
  const f = new Harness(memory);
  f.generation = 2;
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.login();
  await settle();
  expect(f.submitted).toHaveLength(1);
  expect(f.submitted[0]?.checkpoints).toHaveLength(2);
  expect(f.submitted[0]?.sessionGeneration).toBe(1);
  expect(memory.raw()).toEqual([]);
});

it("stops persisting the current journal after a contract rejection", async () => {
  const f = new Harness();
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitFailure = new PrivateRequestError("contract");
  f.login();
  await settle();
  f.sync.accept(checkpoint({ paused: true }));
  await settle();
  expect(f.memory.raw()[0]?.state).toMatchObject({ kind: "blocked", cause: "contract" });
  f.sync.accept(checkpoint({ sequence: 1, startTick: 1 }));
  await settle();
  expect(f.memory.raw()).toHaveLength(1);
  expect(f.submitted).toHaveLength(1);
  expect(accountMessage(f.sync.view())).toContain("nächste Fahrt");
  delete f.submitFailure;
  f.sync.accept(checkpoint({ id: OTHER_JOURNAL, paused: true }));
  await settle();
  expect(f.submitted).toHaveLength(2);
});

it("stores a covered receipt prefix and retries only the uncovered rows", async () => {
  const memory = new MemoryOutbox();

  for (let index = 0; index < 3; index += 1)
    seedRow(memory, [checkpoint({ sequence: index, startTick: index, paused: true })]);
  let calls = 0;
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitOverride = (value) => {
    calls += 1;
    const checkpoints = calls === 1 ? value.checkpoints.slice(0, 1) : value.checkpoints;

    return Promise.resolve(rangeReceipt(batch(checkpoints)));
  };

  f.login();
  await settle();
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([3, 2]);
  expect(memory.requeues).toBe(2);
  expect(memory.raw()).toEqual([]);
});

it("seals a covered open row appended while the receipt is in flight", async () => {
  const memory = new MemoryOutbox();
  const first = checkpoint({ paused: true });
  const next = checkpoint({ sequence: 1, startTick: 1 });
  seedRow(memory, [first]);
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitOverride = () => {
    seedRow(memory, [next]);

    return Promise.resolve(rangeReceipt(batch([first, next])));
  };

  f.login();
  await settle();
  expect(f.submitted).toHaveLength(1);
  expect(memory.raw()).toEqual([]);
});

it("clears every covered journal row omitted from a shorter retry", async () => {
  const memory = new MemoryOutbox();

  const checkpoints = Array.from({ length: 3 }, (_, index) =>
    checkpoint({ sequence: index, startTick: index, paused: true }),
  );

  for (const value of checkpoints) seedRow(memory, [value]);
  let calls = 0;
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitOverride = () => {
    calls += 1;

    return calls === 1
      ? Promise.reject(new PrivateRequestError("retry"))
      : Promise.resolve(rangeReceipt(batch(checkpoints)));
  };

  f.login();
  await settle();
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([3]);
  seedRow(memory, [checkpoint({ sequence: 2, startTick: 2, paused: true })], {
    kind: "queued",
    attempts: 1,
    retryAtMs: 3000,
  });
  f.nowMs = 2000;
  await f.sync.retry("resume");
  expect(f.submitted.map((value) => value.checkpoints.length)).toEqual([3, 2]);
  expect(memory.raw()).toEqual([]);
});

it("keeps rows blocked when a receipt belongs to another journal", async () => {
  const memory = new MemoryOutbox();
  seedRow(memory, [checkpoint({ paused: true })]);
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitOverride = () =>
    Promise.resolve(rangeReceipt(batch([checkpoint({ id: OTHER_JOURNAL, paused: true })])));
  f.login();
  await settle();
  expect(memory.raw()[0]?.state).toMatchObject({ kind: "blocked", cause: "contract" });
});

it("honors five automatic attempts and resets only on manual retry", async () => {
  const memory = new MemoryOutbox();
  seedRow(memory, [checkpoint({ paused: true })]);
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitFailure = new PrivateRequestError("retry");
  f.login();
  await settle();
  expect(memory.raw()[0]?.state).toEqual({ kind: "queued", attempts: 1, retryAtMs: 2000 });

  for (const nowMs of [2000, 4000, 8000, 16_000]) {
    f.nowMs = nowMs;
    await f.sync.retry("resume");
  }

  expect(f.submitted).toHaveLength(5);
  expect(memory.raw()[0]?.state).toMatchObject({ kind: "blocked", cause: "retry", attempts: 5 });
  expect(f.scheduled).toEqual([1000, 2000, 4000, 8000]);
  f.nowMs = 26_000;
  await f.sync.retry("resume");
  expect(f.submitted).toHaveLength(5);
  delete f.submitFailure;
  await f.sync.retry();
  expect(f.submitted).toHaveLength(6);
  expect(memory.raw()).toEqual([]);
});

const blockingCases: readonly { readonly cause: Exclude<SyncFailure, "superseded" | "retry"> }[] = [
  { cause: "reauth" },
  { cause: "forbidden" },
  { cause: "missing" },
  { cause: "conflict" },
  { cause: "contract" },
];

it.each(blockingCases)("blocks $cause without automatic retry", async ({ cause }) => {
  const memory = new MemoryOutbox();
  seedRow(memory, [checkpoint({ paused: true })]);
  const f = new Harness(memory);
  f.consent = { version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 };
  f.submitFailure = new PrivateRequestError(cause);
  f.login();
  await settle();
  expect(memory.raw()[0]?.state).toMatchObject({ kind: "blocked", cause });
  await f.sync.retry("resume");
  expect(f.submitted).toHaveLength(1);
});

it("ignores a stale consent status completion", async () => {
  const status = deferred<ProgressConsentState>();
  const f = new Harness();
  f.statusPending = status.promise;
  f.login();
  f.sync.accept(checkpoint());
  f.logout();
  status.resolve({ version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 });
  await settle();
  expect(f.sync.view().kind).toBe("guest");
  expect(f.memory.raw()).toEqual([]);
});

it("ignores a stale consent update completion", async () => {
  const update = deferred<ProgressConsentState>();
  const f = new Harness();
  f.login();
  await settle();
  f.updatePending = update.promise;
  const pending = f.sync.setConsent(true);
  f.logout();
  update.resolve({ version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 1 });
  await pending;
  expect(f.sync.view().kind).toBe("guest");
  expect(f.memory.raw()).toEqual([]);
});

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string;
  readonly body: string;
}

function progressResponse(
  request: Readonly<Pick<IncomingMessage, "method" | "url">>,
  response: Readonly<Pick<ServerResponse, "setHeader" | "end">>,
  malformed: boolean,
): void {
  response.setHeader("Content-Type", "application/json");

  if (request.url === "/v1/me/progress-consent" && request.method === "GET")
    response.end(
      JSON.stringify(
        malformed
          ? {
              version: 0,
              enabled: false,
              rewardsAvailable: true,
              sessionGeneration: 1,
              sessionToken: "leak",
            }
          : { version: 0, enabled: false, rewardsAvailable: true, sessionGeneration: 1 },
      ),
    );
  else if (request.url === "/v1/me/progress-consent")
    response.end(
      JSON.stringify({ version: 1, enabled: true, rewardsAvailable: true, sessionGeneration: 2 }),
    );
  else response.end(JSON.stringify({ range: rangeReceipt(batch([checkpoint({ paused: true })])) }));
}

async function progressServer(): Promise<{
  readonly origin: string;
  readonly requests: RecordedRequest[];
  readonly setMalformed: (value: boolean) => void;
  readonly close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  let malformed = false;

  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        body,
      });
      progressResponse(request, response, malformed);
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address instanceof Object ? address.port : undefined;

  if (port === undefined) throw new Error("Missing test port");

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    setMalformed: (value: boolean) => {
      malformed = value;
    },
    close: () => {
      server.closeAllConnections();

      return new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

it("uses strict tokenless GET, PUT and POST progress routes with generation checks", async () => {
  const server = await progressServer();

  try {
    let current = true;

    const lease = privateAuthTransport(server.origin).authorize({
      token: "private-token",
      userId: userA,
      generation: 2,
      signal: new AbortController().signal,
      current: () => current,
    });

    expect(await lease.progress.status()).toEqual({
      version: 0,
      enabled: false,
      rewardsAvailable: true,
      sessionGeneration: 1,
    });
    expect(await lease.progress.update(true)).toEqual({
      version: 1,
      enabled: true,
      rewardsAvailable: true,
      sessionGeneration: 2,
    });
    await lease.progress.submit(batch([checkpoint({ paused: true })]));
    expect(server.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /v1/me/progress-consent",
      "PUT /v1/me/progress-consent",
      "POST /v1/progress/checkpoints",
    ]);
    expect(
      server.requests.every((request) => request.authorization === "Bearer private-token"),
    ).toBe(true);
    expect(JSON.parse(server.requests[1]?.body ?? "{}")).toEqual({
      enabled: true,
      sessionGeneration: 2,
    });
    expect(JSON.stringify(lease)).not.toContain("private-token");
    expect(JSON.stringify(lease)).not.toContain("sessionToken");
  } finally {
    await server.close();
  }
});

it("rejects malformed or invalid progress contracts before accepting a receipt", async () => {
  const server = await progressServer();

  try {
    server.setMalformed(true);
    let current = true;

    const lease = privateAuthTransport(server.origin).authorize({
      token: "private-token",
      userId: userA,
      generation: 2,
      signal: new AbortController().signal,
      current: () => current,
    });

    await expect(lease.progress.status()).rejects.toMatchObject({ cause: "contract" });
    const count = server.requests.length;

    const invalid: ProgressCheckpointBatch = {
      consentVersion: 1,
      sessionGeneration: 2,
      checkpoints: Array.from({ length: 1201 }, (_, index) =>
        checkpoint({ sequence: index, startTick: index, paused: index === 1200 }),
      ),
    };

    await expect(lease.progress.submit(invalid)).rejects.toBeInstanceOf(Error);
    current = false;
    await expect(lease.progress.status()).rejects.toMatchObject({ cause: "superseded" });
    expect(server.requests).toHaveLength(count);
  } finally {
    await server.close();
  }
});

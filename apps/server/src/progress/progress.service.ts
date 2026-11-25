import { Inject, Injectable } from "@nestjs/common";
import { hasRewardFactsRegressed } from "@voltonaut/rules";
import {
  RewardFactsSchema,
  VoltsRideRangeCommandSchema,
  type ProgressCheckpointBatch,
  type RewardFacts,
  type VoltsRideRangeCommand,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import { AuthService } from "../auth/auth.service.js";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.module.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { EconomyService } from "../economy/economy.service.js";
import { PROGRESS_TABLES } from "./progress.schema.js";
import type {
  ProgressTables,
  RideProgressJournalRow,
  RideProgressRangeRow,
} from "./progress.schema.js";
import { ProgressRangeStore } from "./progress.range-store.js";
import {
  ZERO_PROGRESS_FACTS,
  progressError,
  progressPayloadHash,
  validateProgressBatch,
  type ValidatedProgressBatch,
  type ValidatedProgressMetadata,
  type ValidatedProgressRange,
} from "./progress.validation.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Validated progress contracts and Zod brands are readonly; the rule cannot resolve these aliases. */
type ProgressEconomyService = Readonly<Pick<EconomyService, "transaction">>;

type ProgressAuthService = Readonly<Pick<AuthService, "isSessionActive">>;

type SessionPrincipal = NonNullable<ReturnType<AuthService["validateSession"]>>;

type LedgerTransaction = Parameters<Parameters<ProgressEconomyService["transaction"]>[0]>[0];

function addFacts(previous: RewardFacts, delta: RewardFacts): RewardFacts {
  const current = {
    activeDistanceM: previous.activeDistanceM + delta.activeDistanceM,
    activeElevationGainM: previous.activeElevationGainM + delta.activeElevationGainM,
    activeTimeS: previous.activeTimeS + delta.activeTimeS,
    elevationGainM: previous.elevationGainM + delta.elevationGainM,
    energyKj: previous.energyKj + delta.energyKj,
  };

  const parsed = RewardFactsSchema.safeParse(current);

  if (!parsed.success) {
    throw progressError(409, "ledger_conflict", "cumulative progress facts exceed accepted limits");
  }

  return parsed.data;
}

function hasCheckpointPrefix(
  prefix: Readonly<ProgressCheckpointBatch>,
  candidate: Readonly<ProgressCheckpointBatch>,
): boolean {
  if (prefix.checkpoints.length > candidate.checkpoints.length) return false;

  const candidatePrefix = candidate.checkpoints.slice(0, prefix.checkpoints.length);

  return JSON.stringify(candidatePrefix) === JSON.stringify(prefix.checkpoints);
}

function rangeCommand(
  range: ValidatedProgressRange,
  cumulativeFacts: RewardFacts,
): VoltsRideRangeCommand {
  return VoltsRideRangeCommandSchema.parse({
    journalId: range.metadata.journalId,
    startTick: range.startTick,
    endTick: range.endTick,
    rewardDay: range.rewardDay,
    cumulativeFacts,
  });
}

@Injectable()
export class ProgressService {
  private readonly store: ProgressRangeStore;

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(PROGRESS_TABLES) tables: ProgressTables,
    @Inject(EconomyService) private readonly economy: ProgressEconomyService,
    @Inject(AuthService) private readonly auth: ProgressAuthService,
    @Inject(SERVER_CONFIG) private readonly config: Readonly<
      Pick<ServerConfig, "rideSourcePolicy">
    >,
  ) {
    this.store = new ProgressRangeStore(db, tables);
  }

  public accept(
    session: Readonly<SessionPrincipal>,
    batch: Readonly<ProgressCheckpointBatch>,
    nowMs: number,
  ): VoltsRideRangeReceipt {
    const validated = validateProgressBatch(batch, nowMs);

    if (this.config.rideSourcePolicy !== "declared_ble_v1") {
      throw progressError(
        403,
        "progress_source_disabled",
        "automatic progress rewards are disabled",
      );
    }

    const payloadHash = progressPayloadHash(validated.payload);

    return this.economy.transaction((tx) =>
      this.acceptWithin(session, validated, payloadHash, nowMs, tx),
    );
  }

  private acceptWithin(
    session: Readonly<SessionPrincipal>,
    batch: ValidatedProgressBatch,
    payloadHash: string,
    nowMs: number,
    tx: Readonly<LedgerTransaction>,
  ): VoltsRideRangeReceipt {
    if (!this.auth.isSessionActive(session.sessionTokenHash, nowMs)) {
      throw progressError(401, "unauthorized", "invalid session token");
    }

    this.requireConsent(session, batch);

    const journal = this.loadJournal(session, batch);
    const existing = this.store.range(batch.range);

    if (existing !== undefined) {
      return this.retryRange(session, journal, existing, batch, payloadHash);
    }

    return this.createRange(session, journal, batch, payloadHash, nowMs, tx);
  }

  private loadJournal(
    session: Readonly<SessionPrincipal>,
    batch: ValidatedProgressBatch,
  ): RideProgressJournalRow | undefined {
    const journal = this.store.journal(batch.range.metadata.journalId);

    if (journal === undefined) return undefined;

    if (journal.userId !== session.userId) {
      throw progressError(404, "not_found", "progress journal not found");
    }

    if (
      journal.sessionHash !== session.sessionTokenHash ||
      journal.consentVersion !== batch.payload.consentVersion
    ) {
      throw progressError(409, "progress_consent_conflict", "progress journal binding changed");
    }

    if (!this.metadataMatches(journal, batch.range.metadata)) {
      throw progressError(409, "ledger_conflict", "progress journal metadata changed");
    }

    return journal;
  }

  private retryRange(
    session: Readonly<SessionPrincipal>,
    journal: Readonly<RideProgressJournalRow> | undefined,
    existing: Readonly<RideProgressRangeRow>,
    batch: ValidatedProgressBatch,
    payloadHash: string,
  ): VoltsRideRangeReceipt {
    if (existing.userId !== session.userId) {
      throw progressError(404, "not_found", "progress range not found");
    }

    if (journal === undefined) {
      throw progressError(500, "internal_error", "progress journal missing for accepted range");
    }

    if (existing.payloadHash !== payloadHash) {
      const stored = this.store.payload(existing);

      if (
        !hasCheckpointPrefix(stored, batch.payload) &&
        !hasCheckpointPrefix(batch.payload, stored)
      ) {
        throw progressError(409, "ledger_conflict", "progress range payload changed");
      }
    }

    return this.store.receipt(existing);
  }

  private createRange(
    session: Readonly<SessionPrincipal>,
    journal: Readonly<RideProgressJournalRow> | undefined,
    batch: ValidatedProgressBatch,
    payloadHash: string,
    nowMs: number,
    tx: Readonly<LedgerTransaction>,
  ): VoltsRideRangeReceipt {
    this.requireContinuity(journal, batch.range);

    if (
      tx.rideRangeReceipt(session.userId, batch.range.metadata.journalId, batch.range.startTick) !==
      undefined
    ) {
      throw progressError(
        500,
        "internal_error",
        "progress range missing for accepted ledger entry",
      );
    }

    const previousFacts = journal === undefined ? ZERO_PROGRESS_FACTS : this.store.facts(journal);
    const cumulativeFacts = addFacts(previousFacts, batch.range.deltaFacts);

    if (hasRewardFactsRegressed(previousFacts, cumulativeFacts)) {
      throw progressError(409, "ledger_conflict", "cumulative progress facts regressed");
    }

    const receipt = tx.creditRideRange(session.userId, rangeCommand(batch.range, cumulativeFacts));

    this.store.commit(session, batch, cumulativeFacts, receipt, payloadHash, nowMs);

    return receipt;
  }

  private requireContinuity(
    journal: Readonly<RideProgressJournalRow> | undefined,
    range: ValidatedProgressRange,
  ): void {
    if (journal === undefined) {
      if (range.startTick !== 0 || range.startSequence !== 0) {
        throw progressError(409, "ledger_conflict", "first progress range must start at tick zero");
      }

      return;
    }

    if (range.startTick !== journal.lastEndTick) {
      throw progressError(409, "ledger_conflict", "progress range is not contiguous");
    }

    if (range.startSequence !== journal.lastSequence + 1) {
      throw progressError(409, "ledger_conflict", "progress sequence is not contiguous");
    }

    if (range.startedAtMs < journal.lastEndedAtMs) {
      throw progressError(409, "ledger_conflict", "progress range time moved backwards");
    }

    if (range.rewardDay < journal.lastRewardDay) {
      throw progressError(409, "ledger_conflict", "progress reward day moved backwards");
    }
  }

  private requireConsent(session: Readonly<SessionPrincipal>, batch: ValidatedProgressBatch): void {
    const consent = this.store.consent(session.userId);

    if (consent === undefined || !consent.enabled) {
      throw progressError(403, "progress_consent_required", "active progress consent is required");
    }

    if (
      consent.version !== batch.payload.consentVersion ||
      consent.sessionHash !== session.sessionTokenHash
    ) {
      throw progressError(409, "progress_consent_conflict", "progress consent no longer matches");
    }
  }

  private metadataMatches(
    journal: Readonly<RideProgressJournalRow>,
    metadata: ValidatedProgressMetadata,
  ): boolean {
    return (
      journal.source === metadata.source &&
      journal.clockScale === metadata.clockScale &&
      journal.physicsRevision === metadata.physicsRevision &&
      journal.routeId === metadata.routeId &&
      journal.routeRevision === metadata.routeRevision &&
      journal.physicsJson === JSON.stringify(metadata.physics)
    );
  }
}

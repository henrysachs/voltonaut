import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import {
  ProgressConsentStateSchema,
  ProgressConsentUpdateSchema,
  type ProgressConsentState,
  type ProgressConsentUpdate,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthServicePort } from "../auth/auth.service.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import { SERVER_CONFIG, type ServerConfig } from "../config.module.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { PROGRESS_TABLES } from "./progress.schema.js";
import type { ProgressConsentRow, ProgressTables } from "./progress.schema.js";

type ProgressAuthService = Readonly<Pick<AuthServicePort, "isSessionActive">>;

@Injectable()
export class ProgressConsentService {
  private readonly consents: ProgressTables["progressConsents"];

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(PROGRESS_TABLES) tables: ProgressTables,
    @Inject(CLOCK) private readonly clock: Readonly<Clock>,
    @Inject(SERVER_CONFIG) private readonly config: Readonly<
      Pick<ServerConfig, "rideSourcePolicy">
    >,
    @Inject(AuthService) private readonly auth: ProgressAuthService,
  ) {
    this.consents = tables.progressConsents;
  }

  public state(
    userId: string,
    sessionGeneration: number,
    sessionHash: string,
  ): ProgressConsentState {
    const row = this.findConsent(userId);

    if (row === undefined) return this.consentState(0, false, sessionGeneration);

    const bound = row.sessionHash === sessionHash;

    return this.consentState(
      row.version,
      bound && row.enabled,
      bound ? row.sessionGeneration : sessionGeneration,
    );
  }

  public update(
    userId: string,
    sessionHash: string,
    sessionGeneration: number,
    enabled: boolean,
    nowMs = this.clock.nowMs(),
  ): ProgressConsentState {
    const update = ProgressConsentUpdateSchema.parse({ enabled, sessionGeneration });

    return this.db.transaction(() => this.updateWithin(userId, sessionHash, update, nowMs), {
      behavior: "immediate",
    });
  }

  private updateWithin(
    userId: string,
    sessionHash: string,
    update: Readonly<ProgressConsentUpdate>,
    nowMs: number,
  ): ProgressConsentState {
    if (!this.auth.isSessionActive(sessionHash, nowMs)) {
      throw new ApiError(401, "unauthorized", "invalid session token");
    }

    if (update.enabled && !this.rewardsAvailable) {
      throw new ApiError(
        403,
        "progress_source_disabled",
        "automatic progress rewards are disabled",
      );
    }

    const row = this.findConsent(userId);

    if (row !== undefined && row.enabled === update.enabled && row.sessionHash === sessionHash) {
      return this.retainConsent(row, update, nowMs);
    }

    const version = this.nextVersion(row);

    const values: ProgressConsentRow = {
      userId,
      version,
      enabled: update.enabled,
      sessionHash,
      sessionGeneration: update.sessionGeneration,
      updatedAt: nowMs,
    };

    if (row === undefined) {
      this.db.insert(this.consents).values(values).run();
    } else {
      this.db.update(this.consents).set(values).where(eq(this.consents.userId, userId)).run();
    }

    return this.consentState(version, update.enabled, update.sessionGeneration);
  }

  private retainConsent(
    row: Readonly<ProgressConsentRow>,
    update: Readonly<ProgressConsentUpdate>,
    nowMs: number,
  ): ProgressConsentState {
    if (row.sessionGeneration !== update.sessionGeneration) {
      this.db
        .update(this.consents)
        .set({ sessionGeneration: update.sessionGeneration, updatedAt: nowMs })
        .where(eq(this.consents.userId, row.userId))
        .run();
    }

    return this.consentState(row.version, row.enabled, update.sessionGeneration);
  }

  private consentState(
    version: number,
    enabled: boolean,
    sessionGeneration: number,
  ): ProgressConsentState {
    return ProgressConsentStateSchema.parse({
      version,
      enabled,
      sessionGeneration,
      rewardsAvailable: this.rewardsAvailable,
    });
  }

  private get rewardsAvailable(): boolean {
    return this.config.rideSourcePolicy === "declared_ble_v1";
  }

  private findConsent(userId: string): ProgressConsentRow | undefined {
    return this.db.select().from(this.consents).where(eq(this.consents.userId, userId)).get();
  }

  private nextVersion(row: Readonly<ProgressConsentRow> | undefined): number {
    if (row?.version === Number.MAX_SAFE_INTEGER) {
      throw new ApiError(500, "internal_error", "consent version exhausted");
    }

    return (row?.version ?? 0) + 1;
  }
}

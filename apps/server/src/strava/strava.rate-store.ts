import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";

const PairSchema = z
  .string()
  .regex(/^\d+,\d+$/u)
  .transform((value) => value.split(",").map(Number))
  .pipe(z.tuple([z.number().int().nonnegative().safe(), z.number().int().nonnegative().safe()]));

const shortReset = (nowMs: number) => (Math.floor(nowMs / 900000) + 1) * 900000;
const dayReset = (nowMs: number) => (Math.floor(nowMs / 86400000) + 1) * 86400000;

type Budget = Readonly<StravaTables["rateBudget"]["$inferSelect"]>;

interface RateHeaders {
  readonly get: (name: string) => string | null;
}

function retryAfterAt(value: string | null, nowMs: number): number | undefined {
  const seconds = z
    .string()
    .regex(/^\d{1,9}$/u)
    .transform(Number)
    .safeParse(value);

  if (seconds.success) return nowMs + seconds.data * 1000;
  const dateMs = Date.parse(value ?? "");

  return Number.isSafeInteger(dateMs) && dateMs > nowMs ? dateMs : undefined;
}

function currentBudget(row: Budget, nowMs: number): Budget {
  return {
    ...row,
    shortReset: shortReset(nowMs),
    dayReset: dayReset(nowMs),
    shortUsage: row.shortReset <= nowMs ? 0 : row.shortUsage,
    readShortUsage: row.shortReset <= nowMs ? 0 : row.readShortUsage,
    dayUsage: row.dayReset <= nowMs ? 0 : row.dayUsage,
    readDayUsage: row.dayReset <= nowMs ? 0 : row.readDayUsage,
    shortPending: row.shortReset <= nowMs ? 0 : row.shortPending,
    readShortPending: row.shortReset <= nowMs ? 0 : row.readShortPending,
    dayPending: row.dayReset <= nowMs ? 0 : row.dayPending,
    readDayPending: row.dayReset <= nowMs ? 0 : row.readDayPending,
  };
}

function completeReservation(row: Budget, requestedAtMs: number, read: boolean): Budget {
  return {
    ...row,
    shortPending: Math.max(
      0,
      row.shortPending - Number(row.shortReset === shortReset(requestedAtMs)),
    ),
    dayPending: Math.max(0, row.dayPending - Number(row.dayReset === dayReset(requestedAtMs))),
    readShortPending: Math.max(
      0,
      row.readShortPending - Number(read && row.shortReset === shortReset(requestedAtMs)),
    ),
    readDayPending: Math.max(
      0,
      row.readDayPending - Number(read && row.dayReset === dayReset(requestedAtMs)),
    ),
  };
}

function waitUntil(row: Budget, read: boolean): number {
  let untilMs = row.blockedUntil;

  if (row.shortUsage >= row.shortLimit || (read && row.readShortUsage >= row.readShortLimit))
    untilMs = Math.max(untilMs, row.shortReset);

  if (row.dayUsage >= row.dayLimit || (read && row.readDayUsage >= row.readDayLimit))
    untilMs = Math.max(untilMs, row.dayReset);

  return untilMs;
}

function observedBudget(row: Budget, headers: RateHeaders, requestedAtMs: number): Budget {
  const limits = PairSchema.safeParse(headers.get("x-ratelimit-limit"));
  const usage = PairSchema.safeParse(headers.get("x-ratelimit-usage"));
  const readLimits = PairSchema.safeParse(headers.get("x-readratelimit-limit"));
  const readUsage = PairSchema.safeParse(headers.get("x-readratelimit-usage"));

  return {
    ...row,
    shortLimit: limits.success ? limits.data[0] : row.shortLimit,
    dayLimit: limits.success ? limits.data[1] : row.dayLimit,
    readShortLimit: readLimits.success ? readLimits.data[0] : row.readShortLimit,
    readDayLimit: readLimits.success ? readLimits.data[1] : row.readDayLimit,
    shortUsage:
      usage.success && row.shortReset === shortReset(requestedAtMs)
        ? Math.max(row.shortUsage, usage.data[0] + row.shortPending)
        : row.shortUsage,
    dayUsage:
      usage.success && row.dayReset === dayReset(requestedAtMs)
        ? Math.max(row.dayUsage, usage.data[1] + row.dayPending)
        : row.dayUsage,
    readShortUsage:
      readUsage.success && row.shortReset === shortReset(requestedAtMs)
        ? Math.max(row.readShortUsage, readUsage.data[0] + row.readShortPending)
        : row.readShortUsage,
    readDayUsage:
      readUsage.success && row.dayReset === dayReset(requestedAtMs)
        ? Math.max(row.readDayUsage, readUsage.data[1] + row.readDayPending)
        : row.readDayUsage,
  };
}

@Injectable()
export class StravaRateStore {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public reserve(
    read: boolean,
    nowMs: number,
  ): { readonly kind: "reserved" } | { readonly kind: "wait"; readonly untilMs: number } {
    return this.db.transaction(
      () => {
        const table = this.tables.rateBudget;
        this.db
          .insert(table)
          .values({ id: 1, shortReset: shortReset(nowMs), dayReset: dayReset(nowMs) })
          .onConflictDoNothing()
          .run();
        const row = this.db.select().from(table).where(eq(table.id, 1)).get();

        if (row === undefined) throw new Error("missing Strava rate budget");
        const current = currentBudget(row, nowMs);
        const untilMs = waitUntil(current, read);
        const reserved = untilMs <= nowMs;
        this.db
          .update(table)
          .set({
            ...current,
            shortUsage: current.shortUsage + Number(reserved),
            dayUsage: current.dayUsage + Number(reserved),
            readShortUsage: current.readShortUsage + Number(reserved && read),
            readDayUsage: current.readDayUsage + Number(reserved && read),
            shortPending: current.shortPending + Number(reserved),
            dayPending: current.dayPending + Number(reserved),
            readShortPending: current.readShortPending + Number(reserved && read),
            readDayPending: current.readDayPending + Number(reserved && read),
          })
          .where(eq(table.id, 1))
          .run();

        return reserved ? { kind: "reserved" } : { kind: "wait", untilMs };
      },
      { behavior: "immediate" },
    );
  }

  public observe(
    headers: RateHeaders,
    status: number,
    requestedAtMs: number,
    nowMs: number,
    read: boolean,
  ): void {
    this.db.transaction(
      () => {
        const table = this.tables.rateBudget;
        const row = this.db.select().from(table).where(eq(table.id, 1)).get();

        if (row === undefined) return;

        const observed = observedBudget(
          completeReservation(currentBudget(row, nowMs), requestedAtMs, read),
          headers,
          requestedAtMs,
        );

        const retryAtMs = retryAfterAt(headers.get("retry-after"), nowMs);

        this.db
          .update(table)
          .set({
            ...observed,
            blockedUntil:
              status === 429
                ? Math.max(observed.blockedUntil, retryAtMs ?? shortReset(nowMs))
                : observed.blockedUntil,
          })
          .where(eq(table.id, 1))
          .run();
      },
      { behavior: "immediate" },
    );
  }
}

import { expect, it } from "vitest";
import { StravaRateStore } from "./strava.rate-store.js";
import { stravaTables } from "../schema.js";
import { fixture } from "./strava.delivery-fixture.spec.js";

const headers = (usage: string) =>
  new Headers({
    "X-RateLimit-Limit": "100,1000",
    "X-RateLimit-Usage": usage,
    "X-ReadRateLimit-Limit": "100,1000",
    "X-ReadRateLimit-Usage": usage,
  });

it("keeps app-wide reservations and late header consumption monotone across owners", () => {
  const { a, b } = fixture();
  const first = new StravaRateStore(a.db, stravaTables);
  const second = new StravaRateStore(b.db, stravaTables);
  expect(first.reserve("poll", 1000)).toEqual({ kind: "reserved" });
  expect(second.reserve("poll", 1000).kind).toBe("wait");
  first.observe(headers("1,1"), 200, 1000, 1000, "poll");
  expect(first.reserve("poll", 1001)).toEqual({ kind: "reserved" });
  expect(second.reserve("poll", 1002)).toEqual({ kind: "reserved" });
  first.observe(headers("50,50"), 200, 1001, 1003, "poll");
  second.observe(headers("2,2"), 200, 1002, 1004, "poll");
  expect(a.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortUsage: 51,
    dayUsage: 51,
    readShortUsage: 51,
    readDayUsage: 51,
    shortPending: 0,
  });
});

it("does not resurrect old reset windows and respects daily exhaustion without Retry-After", () => {
  const { a } = fixture();
  const rate = new StravaRateStore(a.db, stravaTables);
  rate.reserve("upload", 1000);
  rate.observe(headers("100,1000"), 429, 1000, 1000, "upload");
  expect(rate.reserve("upload", 1001)).toEqual({ kind: "wait", untilMs: 86400000 });
  expect(rate.reserve("upload", 86400001)).toEqual({ kind: "reserved" });
  rate.observe(headers("99,999"), 200, 1000, 86400002, "upload");
  expect(a.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortUsage: 1,
    dayUsage: 1,
    shortReset: 87300000,
    dayReset: 172800000,
  });
});

it("honors a valid HTTP-date Retry-After beyond the quarter-hour reset", () => {
  const { a } = fixture();
  const rate = new StravaRateStore(a.db, stravaTables);
  const response = headers("1,1");
  response.set("Retry-After", new Date(3600000).toUTCString());
  rate.reserve("upload", 1000);
  rate.observe(response, 429, 1000, 1000, "upload");
  expect(rate.reserve("upload", 1001)).toEqual({ kind: "wait", untilMs: 3600000 });
});

it.each([
  { all: "10,100", read: "8,100", untilMs: 900000 },
  { all: "8,100", read: "10,100", untilMs: 900000 },
  { all: "100,10", read: "100,8", untilMs: 86400000 },
  { all: "100,8", read: "100,10", untilMs: 86400000 },
])(
  "preserves trusted capacity across owners at $all all / $read read limits",
  ({
    all,
    read,
    untilMs,
  }: {
    readonly all: string;
    readonly read: string;
    readonly untilMs: number;
  }) => {
    const { a, b, reopen } = fixture();
    const first = new StravaRateStore(a.db, stravaTables);
    const second = new StravaRateStore(b.db, stravaTables);
    first.reserve("poll", 1000);

    const response = new Headers({
      "X-RateLimit-Limit": all,
      "X-RateLimit-Usage": "1,1",
      "X-ReadRateLimit-Limit": read,
      "X-ReadRateLimit-Usage": "1,1",
    });

    first.observe(response, 200, 1000, 1000, "poll");

    for (let index = 0; index < 3; index += 1) {
      expect(second.reserve("authorization_hint", 1000)).toEqual({ kind: "reserved" });
      second.observe(new Headers(), 200, 1000, 1000, "authorization_hint");
    }

    const restarted = new StravaRateStore(reopen().db, stravaTables);
    expect(restarted.reserve("authorization_hint", 1000)).toEqual({ kind: "wait", untilMs });
    expect(first.reserve("authorization_hint", 1000)).toEqual({ kind: "wait", untilMs });

    for (let index = 0; index < 4; index += 1) {
      expect(restarted.reserve("poll", 1000)).toEqual({ kind: "reserved" });
      restarted.observe(new Headers(), 200, 1000, 1000, "poll");
    }

    expect(first.reserve("poll", 1000)).toEqual({ kind: "wait", untilMs });
    expect(a.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
      shortLimit: Number(all.split(",")[0]),
      dayLimit: Number(all.split(",")[1]),
      readShortLimit: Number(read.split(",")[0]),
      readDayLimit: Number(read.split(",")[1]),
    });
  },
);

it.each([
  { providerLimit: 0, trusted: "wait" },
  { providerLimit: 1, trusted: "wait" },
  { providerLimit: 3, trusted: "reserved" },
])(
  "rounds the hint allowance down for provider limit $providerLimit",
  ({ providerLimit, trusted }: { readonly providerLimit: number; readonly trusted: string }) => {
    const { a } = fixture();
    const rates = new StravaRateStore(a.db, stravaTables);
    expect(rates.reserve("upload", 1000)).toEqual({ kind: "reserved" });
    rates.observe(
      new Headers({
        "X-RateLimit-Limit": `${providerLimit},100`,
        "X-RateLimit-Usage": "1,1",
        "X-ReadRateLimit-Limit": `${providerLimit},100`,
        "X-ReadRateLimit-Usage": "1,1",
      }),
      200,
      1000,
      1000,
      "upload",
    );
    expect(rates.reserve("authorization_hint", 1000)).toEqual({ kind: "wait", untilMs: 900000 });
    expect(rates.reserve("poll", 1000).kind).toBe(trusted);
  },
);

it("keeps unknown pending hints charged across owners and a reset permits only the new half", () => {
  const { a, b, reopen } = fixture();
  const rates = new StravaRateStore(a.db, stravaTables);
  rates.reserve("poll", 1000);
  rates.observe(headers("1,1"), 200, 1000, 1000, "poll");
  expect(rates.reserve("authorization_hint", 1000)).toEqual({ kind: "reserved" });
  const second = new StravaRateStore(b.db, stravaTables);
  expect(second.reserve("authorization_hint", 1000)).toEqual({ kind: "reserved" });
  rates.observe(headers("49,499"), 200, 1000, 1000, "authorization_hint");
  const restarted = new StravaRateStore(reopen().db, stravaTables);
  expect(restarted.reserve("authorization_hint", 1000)).toEqual({
    kind: "wait",
    untilMs: 86400000,
  });
  expect(restarted.reserve("poll", 1000)).toEqual({ kind: "reserved" });
  expect(restarted.reserve("authorization_hint", 900000)).toEqual({
    kind: "wait",
    untilMs: 86400000,
  });
  expect(restarted.reserve("authorization_hint", 86400000)).toEqual({ kind: "reserved" });
});

it("applies observed lower limits and Retry-After to hints and trusted work without raising quotas", () => {
  const { a } = fixture();
  const rates = new StravaRateStore(a.db, stravaTables);
  rates.reserve("poll", 1000);
  rates.observe(headers("1,1"), 200, 1000, 1000, "poll");
  rates.reserve("authorization_hint", 1000);
  const response = headers("2,2");
  response.set("X-ReadRateLimit-Limit", "4,1000");
  response.set("Retry-After", "3600");
  rates.observe(response, 429, 1000, 1000, "authorization_hint");
  expect(rates.reserve("authorization_hint", 1001)).toEqual({ kind: "wait", untilMs: 3601000 });
  expect(rates.reserve("poll", 1001)).toEqual({ kind: "wait", untilMs: 3601000 });
  expect(rates.reserve("upload", 1001)).toEqual({ kind: "wait", untilMs: 3601000 });
  expect(rates.reserve("poll", 3601000)).toEqual({ kind: "reserved" });
  expect(a.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortLimit: 100,
    dayLimit: 1000,
    readShortLimit: 4,
    readDayLimit: 1000,
  });
});

const learnedLimits = new Headers({
  "X-RateLimit-Limit": "100,1000",
  "X-RateLimit-Usage": "0,0",
  "X-ReadRateLimit-Limit": "100,1000",
  "X-ReadRateLimit-Usage": "0,0",
});

it("releases an unsent reservation only inside the window it was taken in", () => {
  const { a, reopen } = fixture();
  const rates = new StravaRateStore(a.db, stravaTables);
  rates.reserve("poll", 0);
  rates.observe(learnedLimits, 200, 0, 0, "poll");
  expect(rates.reserve("poll", 1000)).toEqual({ kind: "reserved" });
  expect(rates.reserve("poll", 900001)).toEqual({ kind: "reserved" });
  rates.release("poll", 1000, 900002);
  expect(reopen().db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortUsage: 1,
    shortPending: 1,
    readShortUsage: 1,
    readShortPending: 1,
    dayUsage: 2,
    dayPending: 1,
  });
});

it("keeps a new day's usage when a reservation from the previous day is released", () => {
  const { a, reopen } = fixture();
  const rates = new StravaRateStore(a.db, stravaTables);
  rates.reserve("poll", 0);
  rates.observe(learnedLimits, 200, 0, 0, "poll");
  expect(rates.reserve("poll", 86399000)).toEqual({ kind: "reserved" });
  expect(rates.reserve("poll", 86400001)).toEqual({ kind: "reserved" });
  rates.release("poll", 86399000, 86400002);
  expect(reopen().db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    dayReset: 172800000,
    dayUsage: 1,
    dayPending: 1,
    readDayUsage: 1,
    readDayPending: 1,
  });
});

it("keeps a peer's observed request counted when another owner releases its unsent reservation", () => {
  const { a, b, reopen } = fixture();
  const first = new StravaRateStore(a.db, stravaTables);
  const second = new StravaRateStore(b.db, stravaTables);
  first.reserve("upload", 1000);
  first.observe(headers("1,1"), 201, 1000, 1000, "upload");
  expect(first.reserve("upload", 1001)).toEqual({ kind: "reserved" });
  expect(second.reserve("upload", 1001)).toEqual({ kind: "reserved" });
  second.observe(headers("2,2"), 201, 1001, 1002, "upload");
  first.release("upload", 1001, 1003);
  expect(reopen().db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortUsage: 2,
    dayUsage: 2,
    shortPending: 0,
    dayPending: 0,
  });
});

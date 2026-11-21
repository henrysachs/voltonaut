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
  expect(first.reserve(true, 1000)).toEqual({ kind: "reserved" });
  expect(second.reserve(true, 1000).kind).toBe("wait");
  first.observe(headers("1,1"), 200, 1000, 1000, true);
  expect(first.reserve(true, 1001)).toEqual({ kind: "reserved" });
  expect(second.reserve(true, 1002)).toEqual({ kind: "reserved" });
  first.observe(headers("50,50"), 200, 1001, 1003, true);
  second.observe(headers("2,2"), 200, 1002, 1004, true);
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
  rate.reserve(false, 1000);
  rate.observe(headers("100,1000"), 429, 1000, 1000, false);
  expect(rate.reserve(false, 1001)).toEqual({ kind: "wait", untilMs: 86400000 });
  expect(rate.reserve(false, 86400001)).toEqual({ kind: "reserved" });
  rate.observe(headers("99,999"), 200, 1000, 86400002, false);
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
  rate.reserve(false, 1000);
  rate.observe(response, 429, 1000, 1000, false);
  expect(rate.reserve(false, 1001)).toEqual({ kind: "wait", untilMs: 3600000 });
});

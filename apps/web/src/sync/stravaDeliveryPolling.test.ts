import { afterEach, expect, it, vi } from "vitest";
import type { StravaProgress, StravaRideView } from "@voltonaut/shared";
import {
  StravaDeliveryFixture,
  deliveryFor,
  offerFor,
  rideA,
  rideB,
  type DeliveryControls,
} from "./stravaDeliveryFixture.spec.js";

afterEach(() => {
  vi.useRealTimers();
});

const pendingProgress: StravaProgress[] = [
  { kind: "queued", notBeforeMs: 0 },
  { kind: "preparing", owner: rideB, leaseUntilMs: 100 },
  { kind: "submitting", attemptId: rideB, startedAtMs: 10, leaseUntilMs: 100 },
  {
    kind: "processing",
    receipt: { uploadId: "12", externalId: `voltonaut-${rideA}.tcx` },
    nextPollAtMs: 100,
    issue: "none",
  },
];

it.each(pendingProgress)(
  "polls consented $kind delivery with GET, then stops at confirmed delivery",
  async (progress) => {
    vi.useFakeTimers();
    const f = new StravaDeliveryFixture();
    await f.session.exchange("a");
    f.ride = () => Promise.resolve({ kind: "delivery", delivery: deliveryFor(progress) });
    await f.sync.select(rideA);
    expect(f.requests.filter((request) => request.method === "GET")).toHaveLength(1);

    const delivered = deliveryFor({
      kind: "delivered",
      receipt: { uploadId: "12", externalId: `voltonaut-${rideA}.tcx` },
      activityId: "34",
      confirmedAtMs: 200,
    });

    f.ride = () => Promise.resolve({ kind: "delivery", delivery: delivered });
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.sync.view()).toMatchObject({ ride: { view: { value: { delivery: delivered } } } });
    await vi.advanceTimersByTimeAsync(9000);
    expect(f.requests.filter((request) => request.method === "GET")).toHaveLength(2);
    expect(f.consents).toEqual([]);
  },
);

const unpolledStates: { readonly name: string; readonly create: () => StravaRideView }[] = [
  { name: "offer", create: () => offerFor() },
  { name: "blocked", create: () => ({ kind: "blocked", reason: "connection_missing" }) },
  {
    name: "stopped",
    create: () => ({
      kind: "delivery",
      delivery: deliveryFor({ kind: "queued", notBeforeMs: 0 }, true),
    }),
  },
  {
    name: "unknown",
    create: () => ({
      kind: "delivery",
      delivery: deliveryFor({ kind: "submission_unknown", attemptId: rideB, reason: "crash" }),
    }),
  },
  {
    name: "rejected",
    create: () => ({
      kind: "delivery",
      delivery: deliveryFor({ kind: "submission_rejected", reason: "file" }),
    }),
  },
];

it.each(unpolledStates)(
  "does not poll $name state or manufacture an upload",
  async ({ create }) => {
    vi.useFakeTimers();
    const f = new StravaDeliveryFixture();
    await f.session.exchange("a");
    f.ride = () => Promise.resolve(create());
    await f.sync.select(rideA);
    await vi.advanceTimersByTimeAsync(12000);
    expect(f.requests.filter((request) => request.method === "GET")).toHaveLength(1);
    expect(f.consents).toEqual([]);
  },
);

const cancellations = [
  {
    name: "selection",
    cancel: async (f: DeliveryControls) => {
      await f.sync.select(rideB);
    },
  },
  {
    name: "logout",
    cancel: async (f: DeliveryControls) => {
      await f.session.logout();
    },
  },
  {
    name: "dispose",
    cancel: (f: DeliveryControls) => {
      f.sync.dispose();

      return Promise.resolve();
    },
  },
];

it.each(cancellations)(
  "cancels a pending poll on $name",
  async ({ cancel }: Readonly<(typeof cancellations)[number]>) => {
    vi.useFakeTimers();
    const f = new StravaDeliveryFixture();
    await f.session.exchange("a");
    f.ride = () =>
      Promise.resolve({
        kind: "delivery",
        delivery: deliveryFor({ kind: "queued", notBeforeMs: 0 }),
      });
    await f.sync.select(rideA);
    f.ride = (rideId) => Promise.resolve(offerFor(rideId));
    await cancel(f);
    const before = [...f.requests];
    await vi.advanceTimersByTimeAsync(12000);
    expect(f.requests).toEqual(before);
  },
);

it("unsubscribes from the account scope on disposal", async () => {
  const f = new StravaDeliveryFixture();
  f.sync.dispose();
  await f.session.exchange("a");
  expect(f.requests).toEqual([]);
  expect(f.sync.view()).toEqual({ kind: "guest" });
});

import { afterEach, expect, it, vi } from "vitest";
import type { StravaDelivery, StravaRideView, StravaStatus } from "@voltonaut/shared";
import {
  StravaDeliveryFixture,
  consentFor,
  deliveryFor,
  offerFor,
  rideA,
  rideB,
  pendingResponse,
} from "./stravaDeliveryFixture.spec.js";

afterEach(() => {
  vi.useRealTimers();
});

it("stores an explicit offered consent once, disables competing commands, then reloads its delivery", async () => {
  const f = new StravaDeliveryFixture();
  const pending = pendingResponse<StravaDelivery>();
  const queued = deliveryFor({ kind: "queued", notBeforeMs: 0 });
  await f.session.exchange("a");
  await f.sync.select(rideA);
  f.upload = () => pending.promise;
  const upload = f.sync.upload(consentFor());
  expect(f.sync.view()).toMatchObject({ busy: true });
  await f.sync.upload(consentFor());
  await f.sync.disconnect();
  f.sync.connect();
  expect(f.consents).toEqual([consentFor()]);
  expect(f.opens).toEqual([]);
  expect(f.requests.filter((request) => request.method === "disconnect")).toEqual([]);
  f.ride = () => Promise.resolve({ kind: "delivery", delivery: queued });
  pending.resolve(queued);
  await upload;
  expect(f.sync.view()).toMatchObject({
    busy: false,
    ride: { rideId: rideA, view: { kind: "ready", value: { kind: "delivery", delivery: queued } } },
  });
  expect(f.requests.filter((request) => request.method === "POST")).toHaveLength(1);
});

it("recovers a lost upload reply only by GET and does not silently grant consent again", async () => {
  const f = new StravaDeliveryFixture();
  await f.session.exchange("a");
  await f.sync.select(rideA);
  f.upload = () => Promise.reject(new Error("reply lost"));

  const uncertain = deliveryFor({
    kind: "submission_unknown",
    attemptId: rideB,
    reason: "response_lost",
  });

  f.ride = () => Promise.resolve({ kind: "delivery", delivery: uncertain });
  await f.sync.upload(consentFor());
  await f.sync.refresh();
  await f.sync.upload(consentFor());
  expect(f.consents).toEqual([consentFor()]);
  expect(f.requests.filter((request) => request.method === "GET")).toHaveLength(3);
  expect(f.sync.view()).toMatchObject({
    busy: false,
    ride: { view: { value: { delivery: uncertain } } },
  });
  expect(JSON.stringify(f.sync.view())).toContain("Kein automatischer neuer POST");
});

it("requires the current fully loaded offer, not an old ride or changed connection consent", async () => {
  const f = new StravaDeliveryFixture();
  await f.session.exchange("a");
  await f.sync.upload(consentFor());
  const pending = pendingResponse<StravaRideView>();
  f.ride = () => pending.promise;
  const select = f.sync.select(rideA);
  await f.sync.upload(consentFor());
  pending.resolve(offerFor());
  await select;
  await f.sync.upload({ ...consentFor(), connectionGeneration: "obsolete" });
  f.ride = (rideId) => Promise.resolve(offerFor(rideId));
  await f.sync.select(rideB);
  await f.sync.upload(consentFor());
  expect(f.consents).toEqual([]);
  expect(f.sync.view()).toMatchObject({ ride: { rideId: rideB, view: { kind: "ready" } } });
});

const selectionOutcomes = [
  {
    outcome: "resolves",
    finish: (
      pending: Readonly<Pick<ReturnType<typeof pendingResponse<StravaRideView>>, "resolve">>,
    ) => {
      pending.resolve(offerFor());
    },
  },
  {
    outcome: "rejects",
    finish: (
      pending: Readonly<Pick<ReturnType<typeof pendingResponse<StravaRideView>>, "reject">>,
    ) => {
      pending.reject(new Error("late A failure"));
    },
  },
];

it.each(selectionOutcomes)(
  "keeps ride B selected when A's older request later $outcome",
  async ({ finish }: Readonly<(typeof selectionOutcomes)[number]>) => {
    const f = new StravaDeliveryFixture();
    const pending = pendingResponse<StravaRideView>();
    await f.session.exchange("a");
    f.ride = () => pending.promise;
    const first = f.sync.select(rideA);
    f.ride = (rideId) => Promise.resolve(offerFor(rideId));
    await f.sync.select(rideB);
    finish(pending);
    await first;
    expect(f.sync.view()).toMatchObject({
      ride: { rideId: rideB, view: { kind: "ready", value: offerFor(rideB) } },
      message: "",
    });
  },
);

it("shows a failed selection and lets the user retry its status without uploading", async () => {
  const f = new StravaDeliveryFixture();
  await f.session.exchange("a");
  f.ride = () => Promise.reject(new Error("offline"));
  await f.sync.select(rideA);
  expect(f.sync.view()).toMatchObject({ ride: { view: { kind: "failed" } } });
  await f.sync.upload(consentFor());
  f.ride = (rideId) => Promise.resolve(offerFor(rideId));
  await f.sync.refresh();
  expect(f.sync.view()).toMatchObject({ ride: { view: { kind: "ready", value: offerFor() } } });
  expect(f.consents).toEqual([]);
});

it("does not leak a late selected ride or upload completion into a new account", async () => {
  const f = new StravaDeliveryFixture();
  const pending = pendingResponse<StravaDelivery>();
  await f.session.exchange("a");
  await f.sync.select(rideA);
  f.upload = () => pending.promise;
  const upload = f.sync.upload(consentFor());
  await f.session.exchange("b");
  pending.resolve(deliveryFor({ kind: "queued", notBeforeMs: 0 }));
  await upload;
  expect(f.sync.view()).toMatchObject({
    userId: "b",
    busy: false,
    ride: { kind: "none" },
    message: "",
  });
  expect(f.requests.filter((request) => request.method === "GET")).toEqual([
    { userId: "a", method: "GET", rideId: rideA },
  ]);
});

it("ignores an old ride response after logout even if transport ignores cancellation", async () => {
  const f = new StravaDeliveryFixture();
  const pending = pendingResponse<StravaRideView>();
  await f.session.exchange("a");
  f.ride = () => pending.promise;
  const select = f.sync.select(rideA);
  await f.session.logout();
  pending.resolve(offerFor());
  await select;
  expect(f.sync.view()).toEqual({ kind: "guest" });
});

it("refreshes the selected ride even when connection status fails, without starting login", async () => {
  const f = new StravaDeliveryFixture();
  await f.session.exchange("a");
  await f.sync.select(rideA);
  f.status = () => Promise.reject(new Error("offline"));
  await f.sync.refresh();
  expect(f.sync.view()).toMatchObject({
    connection: { kind: "failed" },
    ride: { view: { value: offerFor() } },
  });
  expect(JSON.stringify(f.sync.view())).toContain("Kein automatischer Login");
  expect(f.opens).toEqual([]);
});

const disconnectOutcomes = [
  {
    outcome: "success",
    message: "nicht zurückgeholt",
    finish: (
      pending: Readonly<Pick<ReturnType<typeof pendingResponse<StravaStatus>>, "resolve">>,
    ) => {
      pending.resolve({ status: "disconnected" });
    },
  },
  {
    outcome: "failure",
    message: "nicht bestätigt",
    finish: (
      pending: Readonly<Pick<ReturnType<typeof pendingResponse<StravaStatus>>, "reject">>,
    ) => {
      pending.reject(new Error("reply lost"));
    },
  },
];

it.each(disconnectOutcomes)(
  "deduplicates disconnect and refreshes authoritative status after $outcome",
  async ({ finish, message }: Readonly<(typeof disconnectOutcomes)[number]>) => {
    const f = new StravaDeliveryFixture();
    const pending = pendingResponse<StravaStatus>();
    await f.session.exchange("a");
    await f.sync.select(rideA);
    f.disconnect = () => pending.promise;
    const disconnect = f.sync.disconnect();
    await f.sync.disconnect();
    expect(f.sync.view()).toMatchObject({ busy: true });
    f.status = () => Promise.resolve({ status: "revocation_pending" });
    finish(pending);
    await disconnect;
    expect(f.requests.filter((request) => request.method === "disconnect")).toHaveLength(1);
    expect(f.sync.view()).toMatchObject({
      busy: false,
      connection: { value: { status: "revocation_pending" } },
      ride: { view: { kind: "ready" } },
    });
    expect(JSON.stringify(f.sync.view())).toContain(message);
  },
);

it.each(disconnectOutcomes)(
  "ignores stale disconnect $outcome after changing accounts",
  async ({ finish }: Readonly<(typeof disconnectOutcomes)[number]>) => {
    const f = new StravaDeliveryFixture();
    const pending = pendingResponse<StravaStatus>();
    await f.session.exchange("a");
    f.disconnect = () => pending.promise;
    const disconnect = f.sync.disconnect();
    await f.session.exchange("b");
    finish(pending);
    await disconnect;
    expect(f.sync.view()).toMatchObject({
      userId: "b",
      busy: false,
      message: "",
      connection: { value: { status: "disconnected" } },
    });
    expect(f.requests.filter((request) => request.method === "status")).toHaveLength(2);
  },
);

it("keeps guest commands inert and stops notifying an unsubscribed observer", async () => {
  const f = new StravaDeliveryFixture();
  const views: string[] = [];

  const unsubscribe = f.sync.subscribe((view) => {
    views.push(view.kind);
  });

  await f.sync.select(rideA);
  await f.sync.upload(consentFor());
  await f.sync.refresh();
  await f.sync.disconnect();
  f.sync.connect();
  expect(f.requests).toEqual([]);
  expect(f.opens).toEqual([]);
  expect(views).toEqual(["guest"]);
  unsubscribe();
  await f.session.exchange("a");
  expect(views).toEqual(["guest"]);
});

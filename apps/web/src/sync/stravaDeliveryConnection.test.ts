import { afterEach, expect, it, vi } from "vitest";
import type { StravaStatus } from "@voltonaut/shared";
import {
  StravaDeliveryFixture,
  deliveryChannel,
  pendingResponse,
  type DeliveryControls,
} from "./stravaDeliveryFixture.spec.js";

afterEach(() => {
  vi.useRealTimers();
});

async function start(f: DeliveryControls): Promise<void> {
  await f.session.exchange("a");
  f.sync.connect();
  f.message({ v: 1, type: "ready", channel: deliveryChannel });
  await Promise.resolve();
}

it("keeps a denied authorization disconnected without confirming or uploading", async () => {
  const f = new StravaDeliveryFixture();
  f.confirm = () => Promise.reject(new Error("denial must not confirm"));
  await start(f);
  f.message({ v: 1, type: "finish", channel: deliveryChannel, result: { kind: "denied" } });
  expect(f.sync.view()).toMatchObject({
    busy: false,
  });
  expect(JSON.stringify(f.sync.view())).toContain("abgelehnt");
  expect(f.closed).toBe(1);
  expect(f.sent).toHaveLength(1);
  expect(f.consents).toEqual([]);
});

const failedConfirmations: {
  readonly name: string;
  readonly confirm: () => Promise<StravaStatus>;
}[] = [
  { name: "rejected", confirm: () => Promise.reject(new Error("reply lost")) },
  {
    name: "not connected",
    confirm: () => Promise.resolve({ status: "pending", confirmBy: "2027-01-01T00:00:00.000Z" }),
  },
];

it.each(failedConfirmations)(
  "reconciles a $name confirmation only by checking status",
  async ({ confirm }) => {
    const f = new StravaDeliveryFixture();
    await start(f);
    f.confirm = confirm;
    f.message({
      v: 1,
      type: "finish",
      channel: deliveryChannel,
      result: { kind: "code", code: "c".repeat(43) },
    });
    await vi.waitFor(() => {
      expect(f.sync.view()).toMatchObject({
        busy: false,
      });
      expect(JSON.stringify(f.sync.view())).toContain("Bestätigungsantwort fehlt");
      expect(f.requests.filter((request) => request.method === "status")).toHaveLength(2);
    });
    expect(f.opens).toHaveLength(1);
    expect(f.sent).toHaveLength(1);
  },
);

it("closes a failed start without navigating to an unconfirmed authorization URL", async () => {
  const f = new StravaDeliveryFixture();
  f.start = () => Promise.reject(new Error("cookie missing"));
  await f.session.exchange("a");
  f.sync.connect();
  f.message({ v: 1, type: "ready", channel: deliveryChannel });
  await vi.waitFor(() => {
    expect(f.sync.view()).toMatchObject({
      busy: false,
    });
    expect(JSON.stringify(f.sync.view())).toContain("Start fehlgeschlagen");
  });
  expect(f.sent).toEqual([]);
  expect(f.closed).toBe(1);
});

it("does not acknowledge or refresh a confirmation returned after account change", async () => {
  const f = new StravaDeliveryFixture();
  const pending = pendingResponse<StravaStatus>();
  f.confirm = () => pending.promise;
  await start(f);
  f.message({
    v: 1,
    type: "finish",
    channel: deliveryChannel,
    result: { kind: "code", code: "c".repeat(43) },
  });
  await f.session.exchange("b");
  pending.resolve({
    status: "connected",
    athleteId: "42",
    scope: "activity:write",
    accessExpiresAt: "2027-01-01T00:00:00.000Z",
  });
  await Promise.resolve();
  expect(f.sent).toHaveLength(1);
  expect(f.sync.view()).toMatchObject({ userId: "b", busy: false, message: "" });
  expect(f.requests.filter((request) => request.method === "status")).toHaveLength(2);
});

it("closes an unfinished authorization at its lifetime deadline", async () => {
  vi.useFakeTimers();
  const f = new StravaDeliveryFixture();
  await start(f);
  await vi.advanceTimersByTimeAsync(300000);
  expect(f.sync.view()).toMatchObject({
    busy: false,
  });
  expect(JSON.stringify(f.sync.view())).toContain("abgelaufen");
  expect(f.closed).toBe(1);
});

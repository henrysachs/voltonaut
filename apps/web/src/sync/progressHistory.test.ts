import { expect, it, vi } from "vitest";
import {
  ProgressHistoryResponseSchema,
  VoltsBalanceResponseSchema,
  type ProgressHistoryResponse,
} from "@voltonaut/shared";

import { PrivateRequestError } from "./apiRoute.js";
import { ProgressHistory, rereadOnReceipts, type ProgressHistoryLease } from "./progressHistory.js";
import { deferred } from "./testdata/deferred.js";
import { ScopeDriver, testBinding } from "./testdata/scopeDriver.js";

const JOURNAL = {
  journalId: "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  routeId: "test-loop",
  startedAt: "2026-11-26T08:00:00.000Z",
  lastConfirmedAt: "2026-11-26T08:30:00.000Z",
  confirmedTicks: 1800,
  rangeCount: 3,
  rewardDays: ["2026-11-26"],
  awardedVolts: 120,
  withheldVolts: 5,
  candidateVolts: 125,
};

function page(awardedVolts: number, nextCursor: string | null = null): ProgressHistoryResponse {
  return ProgressHistoryResponseSchema.parse({
    journals: [{ ...JOURNAL, awardedVolts, candidateVolts: awardedVolts + 5 }],
    nextCursor,
  });
}

class HistoryServer {
  balance = 900;
  next: () => Promise<ProgressHistoryResponse> = () => Promise.resolve(page(120));
  reads = 0;

  lease(userId: string, generation: number): ProgressHistoryLease {
    return {
      ...testBinding(userId, generation),
      progress: {
        history: () => {
          this.reads += 1;

          return this.next();
        },
      },
      shop: {
        balance: () =>
          Promise.resolve(VoltsBalanceResponseSchema.parse({ voltsBalance: this.balance })),
      },
    };
  }
}

function historyFor(server: Readonly<Pick<HistoryServer, "lease">>) {
  const scope = new ScopeDriver<ProgressHistoryLease>((userId, generation) =>
    server.lease(userId, generation),
  );

  return { scope, history: new ProgressHistory(scope.scope) };
}

it("loads the confirmed journals and balance of an account and none for guests", async () => {
  const server = new HistoryServer();
  const { scope, history } = historyFor(server);

  await history.refresh();

  expect(history.view()).toEqual({ kind: "guest" });
  expect(server.reads).toBe(0);

  scope.signIn("rider");
  await vi.waitFor(() => {
    expect(history.view().kind).toBe("ready");
  });

  expect(history.view()).toMatchObject({ voltsBalance: 900, truncated: false });
  expect(history.view()).toHaveProperty(["journals", 0, "awardedVolts"], 120);
});

it("rereads on refresh and marks a page with more journals", async () => {
  const server = new HistoryServer();
  const { scope, history } = historyFor(server);

  scope.signIn("rider");
  await vi.waitFor(() => {
    expect(history.view().kind).toBe("ready");
  });
  server.balance = 1000;
  server.next = () =>
    Promise.resolve(page(220, "1764144000000_6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f"));
  await history.refresh();

  expect(history.view()).toMatchObject({ voltsBalance: 1000, truncated: true });
});

it("shows no numbers when the server does not answer", async () => {
  const server = new HistoryServer();
  const { scope, history } = historyFor(server);

  server.next = () => Promise.reject(new PrivateRequestError("retry"));
  scope.signIn("rider");
  await vi.waitFor(() => {
    expect(history.view().kind).toBe("failed");
  });

  expect(JSON.stringify(history.view())).not.toMatch(/\d/u);
});

it("drops the answer of a signed-out or replaced account", async () => {
  const server = new HistoryServer();
  const { scope, history } = historyFor(server);
  const pending = deferred<ProgressHistoryResponse>();

  server.next = () => pending.promise;
  scope.signIn("rider");
  scope.signOut();
  pending.resolve(page(120));
  await pending.promise;
  await Promise.resolve();

  expect(history.view()).toEqual({ kind: "guest" });
});

it("rereads once per delivered batch of receipts", () => {
  const listeners: (() => void)[] = [];
  const scheduled: (() => void)[] = [];
  let refreshes = 0;

  const stop = rereadOnReceipts(
    {
      subscribeReceipts: (listener) => {
        listeners.push(listener);

        return () => {
          listeners.length = 0;
        };
      },
    },
    {
      refresh: () => {
        refreshes += 1;

        return Promise.resolve();
      },
    },
    (callback) => {
      scheduled.push(callback);
    },
  );

  for (const listener of [...listeners, ...listeners, ...listeners]) listener();

  expect(scheduled).toHaveLength(1);

  for (const callback of scheduled.splice(0)) callback();

  for (const listener of listeners) listener();

  expect(refreshes).toBe(1);
  expect(scheduled).toHaveLength(1);

  stop();

  expect(listeners).toEqual([]);
});

import { expect, it } from "vitest";

import { accountRoutes } from "./accountPorts.js";
import { PrivateRequestError, retryAfterSeconds, sendRoute, type ApiResponse } from "./apiRoute.js";

function answer(status: number, retryAfter: string | null): ApiResponse {
  return {
    status,
    json: () => Promise.resolve({}),
    headers: { get: (name: string) => (name === "Retry-After" ? retryAfter : null) },
  };
}

function exportWith(response: ApiResponse) {
  return sendRoute(
    {
      apiOrigin: "http://127.0.0.1:3000",
      http: () => Promise.resolve(response),
      bearer: "token",
      declareJson: "always",
      current: () => true,
      signal: new AbortController().signal,
    },
    accountRoutes.exportAccount,
    null,
  );
}

it("carries the server's wait on a rate-limited request", async () => {
  await expect(exportWith(answer(429, "42"))).rejects.toMatchObject({
    cause: "retry",
    retryAfterS: 42,
  });
  await expect(exportWith(answer(429, null))).rejects.toMatchObject({
    cause: "retry",
    retryAfterS: undefined,
  });
});

it("keeps other failures free of a wait, even with a Retry-After header", async () => {
  const failure = exportWith(answer(503, "42"));

  await expect(failure).rejects.toBeInstanceOf(PrivateRequestError);
  await expect(failure).rejects.toMatchObject({ cause: "retry", retryAfterS: undefined });
});

it.each([
  ["7", 7],
  [" 60 ", 60],
  ["999999", 3600],
  ["Wed, 21 Oct 2026 07:28:00 GMT", undefined],
  ["-1", undefined],
  ["1.5", undefined],
  [null, undefined],
] as const)("reads Retry-After %j as %s seconds", (header, seconds) => {
  expect(retryAfterSeconds(header)).toBe(seconds);
});

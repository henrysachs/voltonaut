import { expect, it } from "vitest";

import { ACCOUNT_EXPORT_TIMEOUT_MS, accountRoutes } from "./accountPorts.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, requestTimeoutMs } from "./apiRoute.js";
import { sessionRoutes } from "./authTransport.js";
import { identityRoutes } from "./identityPort.js";
import { progressRoutes } from "./progressPort.js";
import { shopRoutes } from "./shopPort.js";
import { stravaRoutes } from "./stravaPort.js";

const everyRoute = [
  ...Object.entries(accountRoutes),
  ...Object.entries(sessionRoutes),
  ...Object.entries(identityRoutes),
  ...Object.entries(progressRoutes),
  ...Object.entries(shopRoutes),
  ...Object.entries(stravaRoutes),
];

/** Routes whose request budget differs from the default, with that budget. */
function longRoutes(): readonly (readonly [string, number])[] {
  const long: (readonly [string, number])[] = [];

  for (const [name, route] of everyRoute) {
    const budget = requestTimeoutMs(route);

    if (budget !== DEFAULT_REQUEST_TIMEOUT_MS) long.push([name, budget]);
  }

  return long;
}

it("gives only the account export the long download budget (issue #141)", () => {
  expect(requestTimeoutMs({})).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  expect(longRoutes()).toEqual([["exportAccount", ACCOUNT_EXPORT_TIMEOUT_MS]]);
  expect(ACCOUNT_EXPORT_TIMEOUT_MS).toBeGreaterThanOrEqual(15 * DEFAULT_REQUEST_TIMEOUT_MS);
});

import { expect, expectTypeOf, it } from "vitest";

import {
  ProgressConsentStateSchema,
  ProgressConsentUpdateSchema,
  ProgressSessionGenerationSchema,
  type ProgressConsentState,
  type ProgressConsentUpdate,
} from "./progress.js";

it("validates and freezes readonly consent state and updates", () => {
  const state = ProgressConsentStateSchema.parse({
    version: 0,
    enabled: false,
    rewardsAvailable: true,
    sessionGeneration: 1,
  });

  const update = ProgressConsentUpdateSchema.parse({ enabled: true, sessionGeneration: 1 });

  expect(state).toEqual({
    version: 0,
    enabled: false,
    rewardsAvailable: true,
    sessionGeneration: 1,
  });
  expect(update).toEqual({ enabled: true, sessionGeneration: 1 });
  expect(Object.isFrozen(state)).toBe(true);
  expect(Object.isFrozen(update)).toBe(true);
  expectTypeOf<ProgressConsentState>().toEqualTypeOf<{
    readonly version: number;
    readonly enabled: boolean;
    readonly rewardsAvailable: boolean;
    readonly sessionGeneration: number;
  }>();
  expectTypeOf<ProgressConsentUpdate>().toEqualTypeOf<{
    readonly enabled: boolean;
    readonly sessionGeneration: number;
  }>();
});

it("requires positive safe session generations", () => {
  for (const sessionGeneration of [1, Number.MAX_SAFE_INTEGER]) {
    expect(ProgressSessionGenerationSchema.parse(sessionGeneration)).toBe(sessionGeneration);
    expect(
      ProgressConsentStateSchema.safeParse({
        version: 0,
        enabled: false,
        rewardsAvailable: true,
        sessionGeneration,
      }).success,
    ).toBe(true);
    expect(
      ProgressConsentUpdateSchema.safeParse({ enabled: false, sessionGeneration }).success,
    ).toBe(true);
  }

  for (const sessionGeneration of [
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(ProgressSessionGenerationSchema.safeParse(sessionGeneration).success).toBe(false);
    expect(
      ProgressConsentStateSchema.safeParse({
        version: 0,
        enabled: false,
        rewardsAvailable: true,
        sessionGeneration,
      }).success,
    ).toBe(false);
    expect(
      ProgressConsentUpdateSchema.safeParse({ enabled: false, sessionGeneration }).success,
    ).toBe(false);
  }
});

it("requires nonnegative safe integer consent versions", () => {
  for (const version of [
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(
      ProgressConsentStateSchema.safeParse({
        version,
        enabled: false,
        rewardsAvailable: true,
        sessionGeneration: 1,
      }).success,
    ).toBe(false);
  }
});

it("strictly requires boolean rewards availability and rejects unknown consent fields", () => {
  expect(
    ProgressConsentStateSchema.safeParse({
      version: 0,
      enabled: false,
      rewardsAvailable: true,
      sessionGeneration: 1,
      role: "admin",
    }).success,
  ).toBe(false);
  expect(
    ProgressConsentStateSchema.safeParse({
      version: 0,
      enabled: false,
      sessionGeneration: 1,
    }).success,
  ).toBe(false);
  expect(
    ProgressConsentStateSchema.safeParse({
      version: 0,
      enabled: false,
      rewardsAvailable: "yes",
      sessionGeneration: 1,
    }).success,
  ).toBe(false);
  expect(
    ProgressConsentUpdateSchema.safeParse({
      enabled: true,
      rewardsAvailable: true,
      sessionGeneration: 1,
    }).success,
  ).toBe(false);
  expect(
    ProgressConsentUpdateSchema.safeParse({ enabled: true, sessionGeneration: 1, version: 0 })
      .success,
  ).toBe(false);
  expect(ProgressConsentUpdateSchema.safeParse({ enabled: true }).success).toBe(false);
  expect(
    ProgressConsentStateSchema.safeParse({
      version: 0,
      enabled: "yes",
      rewardsAvailable: true,
      sessionGeneration: 1,
    }).success,
  ).toBe(false);
});

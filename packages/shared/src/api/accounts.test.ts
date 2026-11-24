import { expect, it } from "vitest";
import { AccountDeletionRequestSchema, AccountExportSchema } from "./accounts.js";

it("normalizes only the deletion confirmation and rejects extra ownership fields", () => {
  expect(AccountDeletionRequestSchema.parse({ confirmation: " Rider@Example.com " })).toEqual({
    confirmation: "rider@example.com",
  });
  expect(
    AccountDeletionRequestSchema.safeParse({
      confirmation: "rider@example.com",
      userId: "00000000-0000-4000-8000-000000000001",
    }).success,
  ).toBe(false);
  expect(AccountDeletionRequestSchema.safeParse({ confirmation: "not-an-email" }).success).toBe(
    false,
  );
});

it("exports the honest current server state without sessions or credentials", () => {
  const value = AccountExportSchema.parse({
    schemaVersion: 1,
    exportedAt: "2026-11-24T12:00:00.000Z",
    account: {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "rider@example.com",
        createdAt: "2026-11-20T00:00:00.000Z",
      },
      membership: { tier: "normal", vip: false },
      authorization: { role: "user" },
    },
    profile: { status: "missing" },
    rides: [],
    inventory: { status: "not_stored" },
    progression: { status: "not_stored" },
    strava: { status: { status: "disabled" }, deliveries: [] },
  });

  expect(value.inventory).toEqual({ status: "not_stored" });
  expect(value.progression).toEqual({ status: "not_stored" });
  expect(
    AccountExportSchema.safeParse({
      ...value,
      sessionToken: "not-allowed",
      strava: { ...value.strava, accessToken: "not-allowed" },
    }).success,
  ).toBe(false);
});

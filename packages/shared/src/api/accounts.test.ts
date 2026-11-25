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

const exportInput = {
  schemaVersion: 4,
  exportedAt: "2026-11-24T12:00:00.000Z",
  account: {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "rider@example.com",
      createdAt: "2026-11-20T00:00:00.000Z",
    },
    membership: { tier: "normal", vip: false },
    authorization: { role: "user" },
    identities: [{ issuer: "https://identity.example", subject: "owner-subject" }],
  },
  profile: { status: "missing" },
  rides: [],
  inventory: {
    items: [],
    loadout: {
      loadout: {
        rider: {
          skinTone: "#c98d68",
          jerseyId: "jersey.classic",
          jerseyColors: ["#ec6b48", "#f5ebca"],
          helmetId: "helmet.standard",
          helmetColor: "#f5ebca",
          shoesId: "shoes.white",
          glassesId: "glasses.none",
        },
        bike: { frameId: "frame.race", frameColor: "#f0a83b", wheelsId: "wheels.alloy" },
      },
      updatedAt: null,
    },
  },
  progression: {
    volts: {
      balance: 12,
      journal: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          reason: "ride_reward",
          deltaVolts: 20,
          refId: "20000000-0000-4000-8000-000000000001",
          idempotencyKey: "ride:20000000-0000-4000-8000-000000000001:0",
          payloadHash: "a".repeat(64),
          rewardDay: "2026-11-24",
          startTick: 0,
          endTick: 1,
          candidateVolts: 20,
          cumulativeWorkVolts: 20,
          cumulativeClimbVolts: 0,
          cumulativeFacts: {
            activeDistanceM: 0,
            activeElevationGainM: 0,
            activeTimeS: 0,
            elevationGainM: 0,
            energyKj: 20,
          },
          createdAt: "2026-11-24T12:00:00.000Z",
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          reason: "purchase",
          deltaVolts: -8,
          refId: "item-one",
          idempotencyKey: "purchase:item-one",
          payloadHash: "b".repeat(64),
          createdAt: "2026-11-24T12:00:01.000Z",
        },
      ],
    },
    progress: { consent: { status: "missing" }, journals: [], ranges: [] },
  },
  strava: { status: { status: "disabled" }, deliveries: [] },
};

it("exports the honest current server state without sessions or credentials", () => {
  const value = AccountExportSchema.parse(exportInput);

  expect(value.inventory.items).toEqual([]);
  expect(value.inventory.loadout.updatedAt).toBeNull();
  expect(value.progression.volts.balance).toBe(12);
  expect(value.progression.volts.journal).toHaveLength(2);
  expect(value.account.identities).toEqual([
    { issuer: "https://identity.example", subject: "owner-subject" },
  ]);
  expect(
    AccountExportSchema.safeParse({
      ...value,
      sessionToken: "not-allowed",
      strava: { ...value.strava, accessToken: "not-allowed" },
    }).success,
  ).toBe(false);
});

it("exports progress consent without its session binding", () => {
  const consent = {
    status: "present",
    version: 2,
    enabled: true,
    sessionGeneration: 1,
    updatedAt: "2026-11-24T12:00:00.000Z",
  };

  const withConsent = (value: Readonly<Record<string, string | number | boolean>>) => ({
    ...exportInput,
    progression: {
      ...exportInput.progression,
      progress: { consent: value, journals: [], ranges: [] },
    },
  });

  expect(AccountExportSchema.parse(withConsent(consent)).progression.progress.consent).toEqual(
    consent,
  );
  expect(
    AccountExportSchema.safeParse(withConsent({ ...consent, sessionHash: "a".repeat(64) })).success,
  ).toBe(false);
  expect(
    AccountExportSchema.safeParse({
      ...exportInput,
      progression: { volts: exportInput.progression.volts },
    }).success,
  ).toBe(false);
});

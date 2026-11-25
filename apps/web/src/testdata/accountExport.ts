import { AccountExportSchema } from "@voltonaut/shared";

const A = "00000000-0000-4000-8000-000000000001";

export const accountExport = AccountExportSchema.parse({
  schemaVersion: 1,
  exportedAt: "2026-11-20T00:00:00.000Z",
  account: {
    user: { id: A, email: `${A}@example.com`, createdAt: "2026-11-20T00:00:00.000Z" },
    membership: { tier: "normal", vip: false },
    authorization: { role: "user" },
    identities: [],
  },
  profile: { status: "missing" },
  rides: [],
  inventory: { status: "not_stored" },
  progression: { volts: { balance: 0, journal: [] } },
  strava: { status: { status: "disabled" }, deliveries: [] },
});

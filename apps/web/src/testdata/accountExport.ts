import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { AccountExportSchema } from "@voltonaut/shared";

const A = "00000000-0000-4000-8000-000000000001";

export const accountExport = AccountExportSchema.parse({
  schemaVersion: 4,
  exportedAt: "2026-11-20T00:00:00.000Z",
  account: {
    user: { id: A, email: `${A}@example.com`, createdAt: "2026-11-20T00:00:00.000Z" },
    membership: { tier: "normal", vip: false },
    authorization: { role: "user" },
    identities: [],
  },
  profile: { status: "missing" },
  rides: [],
  inventory: { items: [], loadout: { loadout: DEFAULT_AVATAR_CONFIG, updatedAt: null } },
  progression: {
    volts: { balance: 0, journal: [] },
    progress: { consent: { status: "missing" }, journals: [], ranges: [] },
  },
  strava: { status: { status: "disabled" }, deliveries: [] },
});

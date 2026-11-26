import { accountExportThrottlerModule } from "./accounts/account-export.rate-limit.js";
import { AccountsModule } from "./accounts/accounts.module.js";
import { EconomyModule } from "./economy/economy.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { ProgressModule } from "./progress/progress.module.js";
import { RidesModule } from "./rides/rides.module.js";
import {
  accountsTables,
  economyTables,
  inventoryTables,
  progressTables,
  ridesTables,
  stravaTables,
} from "./schema.js";
import { StravaModule } from "./strava/strava.module.js";

const ridesModule = RidesModule.register(ridesTables);
const stravaModule = StravaModule.register(stravaTables, ridesModule);
const economyModule = EconomyModule.register(economyTables);
const inventoryModule = InventoryModule.register(inventoryTables, economyModule);
const progressModule = ProgressModule.register(progressTables, economyModule);

export const applicationModules = [
  AccountsModule.register(accountsTables, {
    rides: ridesModule,
    strava: stravaModule,
    economy: economyModule,
    inventory: inventoryModule,
    progress: progressModule,
    exportThrottler: accountExportThrottlerModule(),
  }),
  economyModule,
  inventoryModule,
  progressModule,
  ridesModule,
  stravaModule,
];

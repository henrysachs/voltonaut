import { AccountsModule } from "./accounts/accounts.module.js";
import { EconomyModule } from "./economy/economy.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { RidesModule } from "./rides/rides.module.js";
import {
  accountsTables,
  economyTables,
  inventoryTables,
  ridesTables,
  stravaTables,
} from "./schema.js";
import { StravaModule } from "./strava/strava.module.js";

const ridesModule = RidesModule.register(ridesTables);
const economyModule = EconomyModule.register(economyTables);

export const applicationModules = [
  AccountsModule.register(accountsTables),
  economyModule,
  InventoryModule.register(inventoryTables, economyModule),
  ridesModule,
  StravaModule.register(stravaTables, ridesModule),
];

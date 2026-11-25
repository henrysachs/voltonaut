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
const stravaModule = StravaModule.register(stravaTables, ridesModule);
const economyModule = EconomyModule.register(economyTables);
const inventoryModule = InventoryModule.register(inventoryTables, economyModule);

export const applicationModules = [
  AccountsModule.register(
    accountsTables,
    ridesModule,
    stravaModule,
    economyModule,
    inventoryModule,
  ),
  economyModule,
  inventoryModule,
  ridesModule,
  stravaModule,
];

import { AccountsModule } from "./accounts/accounts.module.js";
import { EconomyModule } from "./economy/economy.module.js";
import { RidesModule } from "./rides/rides.module.js";
import { accountsTables, economyTables, ridesTables, stravaTables } from "./schema.js";
import { StravaModule } from "./strava/strava.module.js";

const ridesModule = RidesModule.register(ridesTables);
const stravaModule = StravaModule.register(stravaTables, ridesModule);
const economyModule = EconomyModule.register(economyTables);

export const applicationModules = [
  AccountsModule.register(accountsTables, ridesModule, stravaModule, economyModule),
  economyModule,
  ridesModule,
  stravaModule,
];

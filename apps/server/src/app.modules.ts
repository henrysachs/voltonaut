import { AccountsModule } from "./accounts/accounts.module.js";
import { EconomyModule } from "./economy/economy.module.js";
import { ProgressModule } from "./progress/progress.module.js";
import { RidesModule } from "./rides/rides.module.js";
import {
  accountsTables,
  economyTables,
  progressTables,
  ridesTables,
  stravaTables,
} from "./schema.js";
import { StravaModule } from "./strava/strava.module.js";

const ridesModule = RidesModule.register(ridesTables);
const stravaModule = StravaModule.register(stravaTables, ridesModule);
const economyModule = EconomyModule.register(economyTables);
const progressModule = ProgressModule.register(progressTables, economyModule);

export const applicationModules = [
  AccountsModule.register(accountsTables, ridesModule, stravaModule, economyModule, progressModule),
  economyModule,
  progressModule,
  ridesModule,
  stravaModule,
];

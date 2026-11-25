export * from "./auth/auth.schema.js";

import { users } from "./auth/auth.schema.js";
import { createAccountsTables } from "./accounts/accounts.schema.js";
import { createEconomyTables } from "./economy/economy.schema.js";
import { createInventoryTables } from "./inventory/inventory.schema.js";
import { createRidesTables } from "./rides/rides.schema.js";
import { createStravaTables } from "./strava/strava.schema.js";

export const accountsTables = createAccountsTables(users.id);
export const economyTables = createEconomyTables(users.id);
export const inventoryTables = createInventoryTables(users.id);
export const ridesTables = createRidesTables(users.id);
export const profiles = accountsTables.profiles;
export const accountStatus = accountsTables.accountStatus;
export const rides = ridesTables.rides;
export const voltsLedger = economyTables.voltsLedger;
export const inventory = inventoryTables.inventory;
export const stravaTables = createStravaTables(users.id);
export const stravaTransactions = stravaTables.transactions;
export const stravaConnections = stravaTables.connections;
export const stravaDeliveries = stravaTables.deliveries;
export const stravaRateBudget = stravaTables.rateBudget;

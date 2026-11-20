export * from "./auth/auth.schema.js";

import { users } from "./auth/auth.schema.js";
import { createAccountsTables } from "./accounts/accounts.schema.js";
import { createRidesTables } from "./rides/rides.schema.js";
import { createStravaTables } from "./strava/strava.schema.js";

export const accountsTables = createAccountsTables(users.id);
export const ridesTables = createRidesTables(users.id);
export const profiles = accountsTables.profiles;
export const rides = ridesTables.rides;
export const stravaTables = createStravaTables(users.id);
export const stravaTransactions = stravaTables.transactions;
export const stravaConnections = stravaTables.connections;

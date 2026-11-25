import { PrivateRequestError } from "../apiRoute.js";
import type { IdentityPort } from "../identityPort.js";

/**
 * The connected logins `AccountSync` lists next to the account mirror. Account-mirror tests do not
 * exercise them, so they answer like an unreachable server and the section shows its failure state.
 */
const offline = (): Promise<never> => Promise.reject(new PrivateRequestError("retry"));

export const offlineIdentities: IdentityPort = {
  list: offline,
  startLink: offline,
  completeLink: offline,
};

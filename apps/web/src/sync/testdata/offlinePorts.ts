import type { MembershipPort } from "../accountPorts.js";
import { PrivateRequestError } from "../apiRoute.js";
import type { IdentityPort } from "../identityPort.js";
import type { ShopPort } from "../shopPort.js";

/**
 * Sections `AccountSync` binds next to the account mirror. Account-mirror tests do not exercise
 * them, so they answer like an unreachable server and each section shows its own failure state.
 */
const offline = (): Promise<never> => Promise.reject(new PrivateRequestError("retry"));

export const offlineIdentities: IdentityPort = {
  list: offline,
  startLink: offline,
  completeLink: offline,
};

export const offlineMembership: MembershipPort = { status: offline, users: offline, save: offline };

export const offlineShop: ShopPort = {
  balance: offline,
  inventory: offline,
  purchase: offline,
  loadout: offline,
  saveLoadout: offline,
};

import type { ProgressLease, StravaLease } from "../privateAuthTransport.js";
import type { IdentityLease } from "../identityLease.js";
import type { ShopLease } from "../shopLease.js";

const unexpected = (): Promise<never> =>
  Promise.reject(new Error("Strava was not requested by this account test"));

export const unusedStravaLease: StravaLease = {
  status: unexpected,
  start: unexpected,
  confirm: unexpected,
  disconnect: unexpected,
  ride: unexpected,
  upload: unexpected,
};

export const unexpectedMembership = {
  accountStatus: () => Promise.reject(new Error("unexpected account status")),
  adminUsers: () => Promise.reject(new Error("unexpected admin directory")),
  saveMembership: () => Promise.reject(new Error("unexpected membership write")),
};

export const unusedIdentityLease: IdentityLease = {
  list: () => Promise.reject(new Error("identities were not requested by this account test")),
  startLink: () => Promise.reject(new Error("unexpected identity link")),
  completeLink: () => Promise.reject(new Error("unexpected identity link completion")),
};

export const unusedProgressLease: ProgressLease = {
  status: () => Promise.reject(new Error("progress was not requested by this account test")),
  update: () => Promise.reject(new Error("unexpected progress consent update")),
  submit: () => Promise.reject(new Error("unexpected progress submission")),
};

export const unusedShopLease: ShopLease = {
  balance: () => Promise.reject(new Error("Volts were not requested by this account test")),
  inventory: () => Promise.reject(new Error("inventory was not requested by this account test")),
  purchase: () => Promise.reject(new Error("unexpected purchase")),
};

export const unexpectedAccountData = {
  exportAccount: () => Promise.reject(new Error("unexpected account export")),
  deleteAccount: () => Promise.reject(new Error("unexpected account deletion")),
};

/** Account-lease members an account test does not exercise. */
export const unexpectedAccountParts = {
  ...unexpectedMembership,
  ...unexpectedAccountData,
  identities: unusedIdentityLease,
  progress: unusedProgressLease,
  shop: unusedShopLease,
};

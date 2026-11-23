import type { StravaLease } from "../privateAuthTransport.js";

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

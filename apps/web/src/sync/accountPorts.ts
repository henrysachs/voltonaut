import {
  AccountDeletionRequestSchema,
  AccountDeletionResponseSchema,
  AccountExportSchema,
  AccountStatusSchema,
  AccountUserIdSchema,
  AdminUsersSchema,
  MembershipSchema,
  ProfileInputSchema,
  ProfileStateSchema,
  RideDetailSchema,
  RideIdSchema,
  RideListSchema,
  RideReceiptSchema,
  RideUploadSchema,
  type AccountDeletionResponse,
  type AccountExport,
  type AccountStatus,
  type AdminUsers,
  type Membership,
  type ProfileInput,
  type ProfileState,
  type RideDetail,
  type RideList,
  type RideReceipt,
  type RideUpload,
} from "@voltonaut/shared";
import { PrivateRequestError, privateRoute, type PrivateSend } from "./apiRoute.js";

/** The account's server profile (spec E5-07). */
export interface ProfilePort {
  readonly load: () => Promise<ProfileState>;
  readonly save: (profile: ProfileInput) => Promise<ProfileState>;
}

/** The account's canonical V2 rides (spec E10-04). */
export interface RidePort {
  readonly history: (cursor: string | null) => Promise<RideList>;
  readonly detail: (rideId: string) => Promise<RideDetail>;
  readonly upload: (ride: RideUpload) => Promise<RideReceipt>;
}

/** Export and deletion of all own data (spec E5-11). */
export interface AccountDataPort {
  readonly exportAccount: () => Promise<AccountExport>;
  /** Resolves once the server deleted the account; reports the Strava revocation (issue #140). */
  readonly deleteAccount: (confirmation: string) => Promise<AccountDeletionResponse>;
}

/** Own membership and, for admins, the directory and its writes (spec E5-10, no retry). */
export interface MembershipPort {
  readonly status: () => Promise<AccountStatus>;
  readonly users: (cursor: string | null) => Promise<AdminUsers>;
  readonly save: (userId: string, membership: Readonly<Membership>) => Promise<AccountStatus>;
}

/** The export downloads every own ride at once; the server limits it to one per minute. */
export const ACCOUNT_EXPORT_TIMEOUT_MS = 120_000;

export const accountRoutes = {
  profile: privateRoute({
    method: "GET",
    path: () => "/v1/me/profile",
    response: ProfileStateSchema,
    credentials: "omit",
  }),
  saveProfile: privateRoute({
    method: "PUT",
    path: () => "/v1/me/profile",
    body: (profile: ProfileInput) => JSON.stringify(ProfileInputSchema.parse(profile)),
    response: ProfileStateSchema,
    credentials: "omit",
  }),
  history: privateRoute({
    method: "GET",
    path: (cursor: string | null) =>
      cursor === null ? "/v2/rides" : `/v2/rides?cursor=${RideIdSchema.parse(cursor)}`,
    response: RideListSchema,
    credentials: "omit",
  }),
  detail: privateRoute({
    method: "GET",
    path: (rideId: string) => `/v2/rides/${RideIdSchema.parse(rideId)}`,
    response: RideDetailSchema,
    credentials: "omit",
  }),
  upload: privateRoute({
    method: "POST",
    path: () => "/v2/rides",
    body: (ride: RideUpload) => JSON.stringify(ride),
    response: RideReceiptSchema,
    credentials: "omit",
  }),
  exportAccount: privateRoute({
    method: "GET",
    path: () => "/v1/me/export",
    response: AccountExportSchema,
    credentials: "omit",
    // Issue #141: 50 one-hour rides are about 15 MB; on a slow link the body alone exceeds 8 s.
    timeoutMs: ACCOUNT_EXPORT_TIMEOUT_MS,
  }),
  deleteAccount: privateRoute({
    method: "DELETE",
    path: () => "/v1/me",
    body: (confirmation: string) =>
      JSON.stringify(AccountDeletionRequestSchema.parse({ confirmation })),
    response: AccountDeletionResponseSchema,
    credentials: "omit",
  }),
  accountStatus: privateRoute({
    method: "GET",
    path: () => "/v1/me/account-status",
    response: AccountStatusSchema,
    credentials: "omit",
  }),
  adminUsers: privateRoute({
    method: "GET",
    path: (cursor: string | null) =>
      cursor === null
        ? "/v1/admin/users"
        : `/v1/admin/users?cursor=${encodeURIComponent(AccountUserIdSchema.parse(cursor))}`,
    response: AdminUsersSchema,
    credentials: "omit",
  }),
  saveMembership: privateRoute({
    method: "PATCH",
    path: ({ userId }: Readonly<{ userId: string; membership: Readonly<Membership> }>) =>
      `/v1/admin/users/${encodeURIComponent(AccountUserIdSchema.parse(userId))}/membership`,
    body: ({ membership }) => JSON.stringify(MembershipSchema.parse(membership)),
    response: AccountStatusSchema,
    credentials: "omit",
  }),
};

export function profilePort(send: PrivateSend): ProfilePort {
  return {
    load: () => send(accountRoutes.profile, null),
    save: (profile) => send(accountRoutes.saveProfile, profile),
  };
}

export function ridePort(send: PrivateSend): RidePort {
  return {
    history: (cursor) => send(accountRoutes.history, cursor),
    detail: (rideId) => send(accountRoutes.detail, rideId),
    async upload(ride) {
      const payload = RideUploadSchema.parse(ride);
      const receipt = await send(accountRoutes.upload, payload);

      if (receipt.rideId !== payload.rideId) throw new PrivateRequestError("contract");

      return receipt;
    },
  };
}

export function accountDataPort(send: PrivateSend): AccountDataPort {
  return {
    exportAccount: () => send(accountRoutes.exportAccount, null),
    deleteAccount: (confirmation) => send(accountRoutes.deleteAccount, confirmation),
  };
}

export function membershipPort(send: PrivateSend): MembershipPort {
  return {
    status: () => send(accountRoutes.accountStatus, null),
    users: (cursor) => send(accountRoutes.adminUsers, cursor),
    save: (userId, membership) => send(accountRoutes.saveMembership, { userId, membership }),
  };
}

import {
  AccountDeletionRequestSchema,
  AccountDeletionResponseSchema,
  AccountExportSchema,
  ProfileInputSchema,
  ProfileStateSchema,
  ProgressCheckpointBatchSchema,
  ProgressConsentStateSchema,
  ProgressConsentUpdateSchema,
  ProgressRangeResponseSchema,
  RideDetailSchema,
  RideIdSchema,
  RideListSchema,
  RideReceiptSchema,
  RideUploadSchema,
  StravaStatusSchema,
  StravaStartRequestSchema,
  StravaStartResponseSchema,
  StravaConfirmRequestSchema,
  StravaDisconnectRequestSchema,
  StravaRideViewSchema,
  StravaUploadRequestSchema,
  StravaDeliverySchema,
  AccountStatusSchema,
  AccountUserIdSchema,
  AdminUsersSchema,
  MembershipSchema,
  type AccountStatus,
  type AccountExport,
  type AdminUsers,
  type Membership,
  type ProfileInput,
  type ProfileState,
  type ProgressCheckpointBatch,
  type ProgressConsentState,
  type RideDetail,
  type RideList,
  type RideReceipt,
  type RideUpload,
  type StravaStatus,
  type StravaStartResponse,
  type StravaRideView,
  type StravaConsent,
  type StravaDelivery,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";
import type { ProfileWriteLease } from "./profile-store.js";
import {
  PrivateRequestError,
  authorizedRequest,
  type LeaseAuthorization,
} from "./privateAuthRequest.js";
import { identityLease, type IdentityLease } from "./identityLease.js";

export { PrivateRequestError } from "./privateAuthRequest.js";

export type { SyncFailure } from "./privateAuthRequest.js";

export interface AccountLease extends ProfileWriteLease {
  readonly apiOrigin: string;
  readonly userId: string;
  readonly generation: number;
  readonly current: () => boolean;
  readonly profile: () => Promise<ProfileState>;
  readonly saveProfile: (profile: ProfileInput) => Promise<ProfileState>;
  readonly history: (cursor: string | null) => Promise<RideList>;
  readonly detail: (rideId: string) => Promise<RideDetail>;
  readonly upload: (ride: RideUpload) => Promise<RideReceipt>;
  readonly exportAccount: () => Promise<AccountExport>;
  readonly deleteAccount: (confirmation: string) => Promise<void>;
  readonly strava: StravaLease;
  readonly progress: ProgressLease;
  readonly identities: IdentityLease;
  readonly accountStatus: () => Promise<AccountStatus>;
  readonly adminUsers: (cursor: string | null) => Promise<AdminUsers>;
  readonly saveMembership: (
    userId: string,
    membership: Readonly<Membership>,
  ) => Promise<AccountStatus>;
}

export interface ProgressLease {
  readonly status: () => Promise<ProgressConsentState>;
  readonly update: (enabled: boolean) => Promise<ProgressConsentState>;
  readonly submit: (batch: ProgressCheckpointBatch) => Promise<VoltsRideRangeReceipt>;
}

export interface StravaLease {
  readonly status: () => Promise<StravaStatus>;
  readonly start: (channel: string) => Promise<StravaStartResponse>;
  readonly confirm: (code: string) => Promise<StravaStatus>;
  readonly disconnect: () => Promise<StravaStatus>;
  readonly ride: (rideId: string) => Promise<StravaRideView>;
  readonly upload: (consent: StravaConsent) => Promise<StravaDelivery>;
}

export interface PrivateAuthTransport {
  readonly authorize: (authorization: LeaseAuthorization) => AccountLease;
}

function progressLease(
  request: ReturnType<typeof authorizedRequest>,
  generation: number,
): ProgressLease {
  return {
    status: () => request("/v1/me/progress-consent", ProgressConsentStateSchema),
    update: (enabled) =>
      request(
        "/v1/me/progress-consent",
        ProgressConsentStateSchema,
        JSON.stringify(
          ProgressConsentUpdateSchema.parse({ enabled, sessionGeneration: generation }),
        ),
      ),
    async submit(batch) {
      const payload = ProgressCheckpointBatchSchema.parse(batch);

      const response = await request(
        "/v1/progress/checkpoints",
        ProgressRangeResponseSchema,
        JSON.stringify(payload),
      );

      if (
        !payload.checkpoints.every(
          (checkpoint) => response.range.journalId === checkpoint.journalId,
        )
      )
        throw new PrivateRequestError("contract");

      return response.range;
    },
  };
}

function stravaLease(request: ReturnType<typeof authorizedRequest>): StravaLease {
  return {
    status: () => request("/v1/strava/connection", StravaStatusSchema, undefined, "include"),
    start: (channel) =>
      request(
        "/v1/strava/connect-start",
        StravaStartResponseSchema,
        JSON.stringify(StravaStartRequestSchema.parse({ action: "connect", channel })),
        "include",
      ),
    confirm: (code) =>
      request(
        "/v1/strava/confirm",
        StravaStatusSchema,
        JSON.stringify(StravaConfirmRequestSchema.parse({ code })),
        "include",
      ),
    disconnect: () =>
      request(
        "/v1/strava/disconnect",
        StravaStatusSchema,
        JSON.stringify(StravaDisconnectRequestSchema.parse({ action: "disconnect" })),
        "include",
      ),
    ride: (rideId) =>
      request(
        `/v1/strava/rides/${RideIdSchema.parse(rideId)}`,
        StravaRideViewSchema,
        undefined,
        "include",
      ),
    upload: (consent) =>
      request(
        `/v1/strava/rides/${RideIdSchema.parse(consent.rideId)}`,
        StravaDeliverySchema,
        JSON.stringify(StravaUploadRequestSchema.parse({ action: "upload", consent })),
        "include",
      ),
  };
}

export function privateAuthTransport(apiOrigin: string): PrivateAuthTransport {
  return {
    authorize(authorization) {
      const request = authorizedRequest(apiOrigin, authorization);

      return {
        apiOrigin,
        userId: authorization.userId,
        generation: authorization.generation,
        signal: authorization.signal,
        current: authorization.current,
        strava: stravaLease(request),
        progress: progressLease(request, authorization.generation),
        identities: identityLease(request),
        ...membershipLease(request),
        profile: () => request("/v1/me/profile", ProfileStateSchema),
        saveProfile: (profile) =>
          request(
            "/v1/me/profile",
            ProfileStateSchema,
            JSON.stringify(ProfileInputSchema.parse(profile)),
          ),
        history: (cursor) =>
          request(
            cursor === null ? "/v2/rides" : `/v2/rides?cursor=${RideIdSchema.parse(cursor)}`,
            RideListSchema,
          ),
        detail: (rideId) => request(`/v2/rides/${RideIdSchema.parse(rideId)}`, RideDetailSchema),
        exportAccount: () => request("/v1/me/export", AccountExportSchema),
        deleteAccount: async (confirmation) => {
          await request(
            "/v1/me",
            AccountDeletionResponseSchema,
            JSON.stringify(AccountDeletionRequestSchema.parse({ confirmation })),
            "omit",
            "DELETE",
          );
        },
        async upload(ride) {
          const payload = RideUploadSchema.parse(ride);
          const receipt = await request("/v2/rides", RideReceiptSchema, JSON.stringify(payload));

          if (receipt.rideId !== payload.rideId) throw new PrivateRequestError("contract");

          return receipt;
        },
      };
    },
  };
}

function membershipLease(
  request: ReturnType<typeof authorizedRequest>,
): Pick<AccountLease, "accountStatus" | "adminUsers" | "saveMembership"> {
  return {
    accountStatus: () => request("/v1/me/account-status", AccountStatusSchema),
    adminUsers: (cursor) =>
      request(
        cursor === null
          ? "/v1/admin/users"
          : `/v1/admin/users?cursor=${encodeURIComponent(AccountUserIdSchema.parse(cursor))}`,
        AdminUsersSchema,
      ),
    saveMembership: (userId, membership) =>
      request(
        `/v1/admin/users/${encodeURIComponent(AccountUserIdSchema.parse(userId))}/membership`,
        AccountStatusSchema,
        JSON.stringify(MembershipSchema.parse(membership)),
      ),
  };
}

import {
  accountDataPort,
  membershipPort,
  profilePort,
  ridePort,
  type AccountDataPort,
  type MembershipPort,
  type ProfilePort,
  type RidePort,
} from "./accountPorts.js";
import {
  browserFetch,
  sendRoute,
  type ApiFetch,
  type LeaseBinding,
  type PrivateSend,
  type RouteTarget,
} from "./apiRoute.js";
import { identityPort, type IdentityPort } from "./identityPort.js";
import { progressPort, type ProgressPort } from "./progressPort.js";
import { shopPort, type ShopPort } from "./shopPort.js";
import { stravaPort, type StravaPort } from "./stravaPort.js";

export interface LeaseAuthorization {
  readonly token: string;
  readonly userId: string;
  readonly generation: number;
  readonly signal: Readonly<AbortSignal>;
  readonly current: () => boolean;
}

/** The private API, one narrow port per capability; every port shares the lease's gate. */
export interface AccountPorts {
  readonly profile: ProfilePort;
  readonly rides: RidePort;
  readonly data: AccountDataPort;
  readonly membership: MembershipPort;
  readonly strava: StravaPort;
  readonly progress: ProgressPort;
  readonly identities: IdentityPort;
  readonly shop: ShopPort;
}

/** A lease that carries only the named ports; consumers ask for exactly what they call. */
export type LeaseWith<K extends keyof AccountPorts> = LeaseBinding &
  Readonly<Pick<AccountPorts, K>>;

export type AccountLease = LeaseWith<keyof AccountPorts>;

/** Turns a confirmed session into a token-free lease; fixtures may issue narrower leases. */
export interface LeaseIssuer<Lease extends LeaseBinding> {
  readonly authorize: (authorization: LeaseAuthorization) => Lease;
}

export type PrivateAuthTransport = LeaseIssuer<AccountLease>;

export function privateAuthTransport(
  apiOrigin: string,
  http: ApiFetch = browserFetch,
): PrivateAuthTransport {
  return {
    authorize(authorization) {
      const target: RouteTarget = {
        apiOrigin,
        http,
        bearer: authorization.token,
        declareJson: "always",
        current: authorization.current,
        signal: authorization.signal,
      };

      const send: PrivateSend = (route, input) => sendRoute(target, route, input);

      return {
        apiOrigin,
        userId: authorization.userId,
        generation: authorization.generation,
        signal: authorization.signal,
        current: authorization.current,
        profile: profilePort(send),
        rides: ridePort(send),
        data: accountDataPort(send),
        membership: membershipPort(send),
        strava: stravaPort(send),
        progress: progressPort(send, authorization.generation),
        identities: identityPort(send),
        shop: shopPort(send),
      };
    },
  };
}

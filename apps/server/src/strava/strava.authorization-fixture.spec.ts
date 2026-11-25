import { StravaAuthorization } from "./strava.authorization.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { stravaTables } from "../schema.js";
import type { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaDeliveryStore } from "./strava.delivery-store.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { StravaProvider } from "./strava.provider.js";
import type { Clock } from "../config.module.js";
import type { AuthorizationProof } from "./strava.authorization-provider.js";

export class PolicyProvider extends StravaProvider {
  public athleteCalls = 0;
  readonly #accessTokens = new Set<string>();
  #headers: Readonly<Headers> | undefined;

  public constructor(
    provider: Readonly<StravaProvider>,
    tokens: { readonly accessToken: string },
    private readonly athlete: { readonly athleteId: number },
  ) {
    super(provider.enabledConfig());
    this.#accessTokens.add(tokens.accessToken);
  }

  public override async refresh(
    ...input: Readonly<Parameters<StravaProvider["refresh"]>>
  ): Promise<Awaited<ReturnType<StravaProvider["refresh"]>>> {
    const result = await super.refresh(...input);

    if (result.kind === "refreshed") this.#accessTokens.add(result.tokens.accessToken);

    return result;
  }

  public override verifyAuthorization(
    input: Parameters<StravaProvider["verifyAuthorization"]>[0],
  ): Promise<AuthorizationProof> {
    this.athleteCalls += 1;

    // Learn actual loopback headers once; only the long policy attack reuses them in process.
    if (this.#headers === undefined)
      return super.verifyAuthorization({
        ...input,
        onHeaders: (headers, status) => {
          if (status === 200) this.#headers = headers;
          input.onHeaders(headers, status);
        },
      });

    input.signal.throwIfAborted();
    const authorized = this.#accessTokens.has(input.accessToken);
    input.onHeaders(this.#headers, authorized ? 200 : 401);

    return Promise.resolve(
      authorized && input.athleteId === String(this.athlete.athleteId)
        ? { kind: "valid" }
        : { kind: "deferred", unauthorized: !authorized },
    );
  }
}

export function authorizationFixture(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Each test owner uses an actual mutable SQLite connection.
  owner: {
    readonly db: ServerDatabase;
    readonly credentials: Readonly<StravaCredentialStore>;
    readonly jobs: Readonly<StravaDeliveryStore>;
  },
  provider: Readonly<StravaProvider>,
  clock: Clock,
) {
  const rates = new StravaRateStore(owner.db, stravaTables);
  const hints = new StravaAuthorizationStore(owner.db, stravaTables);
  const authorization = new StravaAuthorization(owner.credentials, owner.jobs, provider, clock);

  return { rates, hints, authorization };
}

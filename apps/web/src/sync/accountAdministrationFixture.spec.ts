import type { AccountStatus, AdminUsers, Membership } from "@voltonaut/shared";
import { ApplicationSession } from "./applicationSession.js";
import { AccountSync } from "./accountSync.js";
import { privateAuthTransport, type PrivateAuthTransport } from "./privateAuthTransport.js";
import type { AdministrationView } from "./accountAdministration.js";

export class AdministrationFixture {
  role: "user" | "admin" = "admin";
  membership: Membership = { tier: "normal", vip: false };
  statusPending: Promise<AccountStatus> | undefined;
  usersPending: Promise<AdminUsers> | undefined;
  writePending: Promise<AccountStatus> | undefined;
  loseReply = false;
  nextCursor: string | null = null;
  readonly writes: string[] = [];
  readonly reads: string[] = [];
  readonly signals: Readonly<AbortSignal>[] = [];
  readonly views: AdministrationView[] = [];
  profileApplies = 0;
  readonly session = new ApplicationSession({
    transport: {
      mode: () =>
        Promise.resolve({ mode: "oidc", providers: [{ id: "test", displayName: "Test" }] }),
      me: () => Promise.reject(new Error("unexpected restore")),
      exchange: (id) =>
        Promise.resolve({
          user: { id, email: `${id}@example.com`, createdAt: "2026-11-20T00:00:00.000Z" },
          sessionToken: `token-${id}`,
        }),
      logout: () => Promise.resolve(),
    },
    persistence: { load: () => {}, save: () => false, clear: () => true },
    navigate: () => {
      throw new Error("unexpected navigation");
    },
    privateTransport: this.transport(),
  });
  readonly sync = new AccountSync({
    session: this.session,
    archive: () => Promise.resolve([]),
    outbox: () =>
      Promise.resolve({
        list: () => Promise.resolve([]),
        claim: () => Promise.reject(new Error("no admin outbox")),
        update: () => Promise.reject(new Error("no admin outbox")),
        purgeOwner: () => Promise.reject(new Error("no admin outbox")),
      }),
    progressOutbox: () =>
      Promise.resolve({ purgeOwner: () => Promise.reject(new Error("no admin progress outbox")) }),
    deletions: {
      load: () => [],
      remember: () => true,
      forget: () => true,
    },
    profile: {
      saved: () => Promise.reject(new Error("unexpected local profile read")),
      apply: () => {
        this.profileApplies += 1;

        return Promise.resolve();
      },
    },
    nowMs: () => 0,
  });

  constructor() {
    this.sync.administration.subscribe((view) => {
      this.views.push(view);
    });
  }

  status(): AccountStatus {
    return { membership: { ...this.membership }, authorization: { role: this.role } };
  }

  directory(): AdminUsers {
    return {
      users: [
        {
          id: "target",
          email: "target@example.com",
          displayName: null,
          membership: { ...this.membership },
        },
      ],
      nextCursor: this.nextCursor,
    };
  }

  private transport(): PrivateAuthTransport {
    return {
      authorize: (authorization) => {
        this.signals.push(authorization.signal);

        return {
          ...privateAuthTransport("http://localhost:3000").authorize(authorization),
          profile: () => Promise.resolve({ status: "missing" }),
          history: () => Promise.resolve({ rides: [], nextCursor: null }),
          accountStatus: () => {
            this.reads.push(authorization.userId);
            const pending = this.statusPending;
            this.statusPending = undefined;

            return pending ?? Promise.resolve(this.status());
          },
          adminUsers: () => this.usersPending ?? Promise.resolve(this.directory()),
          saveMembership: (id, membership) => {
            this.writes.push(`${authorization.userId}:${id}`);
            this.membership = { ...membership };

            return this.loseReply
              ? Promise.reject(new Error("lost reply"))
              : (this.writePending ?? Promise.resolve(this.status()));
          },
        };
      },
    };
  }
}

import type { User } from "@voltonaut/shared";
import type { LeaseBinding } from "../apiRoute.js";
import { AccountScopeSource, type SignedOutSession } from "../accountScope.js";

export const API_ORIGIN = "http://localhost:3000";

const GUEST: SignedOutSession = { kind: "guest", message: "Gast" };

export function testUser(userId: string): User {
  return { id: userId, email: `${userId}@example.com`, createdAt: "2026-11-20T00:00:00.000Z" };
}

/** Lease members every fake lease shares; staleness comes from the scope, not from the fake. */
export function testBinding(userId: string, generation: number): LeaseBinding {
  return {
    apiOrigin: API_ORIGIN,
    userId,
    generation,
    signal: new AbortController().signal,
    current: () => true,
  };
}

/**
 * In-memory account scope for feature tests: signs accounts in and out like the application
 * session does, without tokens, transports or session fakes.
 */
export class ScopeDriver<L extends LeaseBinding> {
  readonly scope = new AccountScopeSource<L>();
  readonly #issue: (userId: string, generation: number) => L;
  #generation = 0;
  #bound: L | undefined;

  constructor(issue: (userId: string, generation: number) => L) {
    this.#issue = issue;
    this.scope.subscribe((binding) => {
      this.#bound = binding.kind === "signedIn" ? binding.lease : undefined;
    });
  }

  /** The lease of the current binding, as every feature store sees it. */
  bound(): L | undefined {
    return this.#bound;
  }

  /** Signs `userId` in with a fresh generation and returns the bound lease. */
  signIn(userId: string, persistent = true): L {
    this.#generation += 1;
    this.scope.signIn(this.#issue(userId, this.#generation), {
      user: testUser(userId),
      persistent,
    });
    const lease = this.#bound;

    if (lease === undefined) throw new Error("scope did not bind the signed-in account");

    return lease;
  }

  signOut(session?: SignedOutSession): void {
    this.scope.signOut(session ?? GUEST);
  }

  /** A completed login handoff: the session is busy first, then bound to a new generation. */
  exchange(userId: string): Promise<void> {
    this.signOut({ kind: "busy", operation: "exchanging" });
    this.signIn(userId);

    return Promise.resolve();
  }

  logout(): Promise<void> {
    this.signOut();

    return Promise.resolve();
  }
}

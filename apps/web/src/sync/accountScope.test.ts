import { expect, it } from "vitest";

import type { LeaseBinding } from "./apiRoute.js";
import { ApplicationSession } from "./applicationSession.js";
import { AccountLane } from "./accountLane.js";
import {
  AccountScopeSource,
  sessionAccountScope,
  type AccountBinding,
  type AccountScope,
} from "./accountScope.js";
import { AccountState } from "./accountState.js";
import { ScopeDriver, testBinding, testUser } from "./testdata/scopeDriver.js";

type Seen = { readonly kind: "guest" } | { readonly kind: "account"; readonly userId: string };

function feature(scope: AccountScope<LeaseBinding>) {
  const state = new AccountState<Seen, LeaseBinding>(
    { kind: "guest" },
    {
      enter: (binding) =>
        binding.kind === "signedIn"
          ? { kind: "account", userId: binding.lease.userId }
          : { kind: "guest" },
    },
  );

  state.follow(scope);

  return state;
}

function driver(): ScopeDriver<LeaseBinding> {
  return new ScopeDriver<LeaseBinding>(testBinding);
}

function owner(view: Seen): string {
  return view.kind === "account" ? view.userId : "-";
}

function bindingLabel(binding: AccountBinding<LeaseBinding>): string {
  return binding.kind === "signedIn" ? binding.lease.userId : binding.session.kind;
}

function boundLease(binding: AccountBinding<LeaseBinding>): LeaseBinding | undefined {
  return binding.kind === "signedIn" ? binding.lease : undefined;
}

it("supersedes the old binding for every feature when another account signs in", () => {
  const scope = driver();
  const a = scope.signIn("a");
  scope.signIn("b");

  expect(a.current()).toBe(false);
  expect(a.signal.aborted).toBe(true);
  expect(scope.bound()?.userId).toBe("b");
  expect(scope.bound()?.current()).toBe(true);
});

it("ends the binding on logout, even when the issued lease itself stays valid", () => {
  const scope = driver();
  const a = scope.signIn("a");
  scope.signOut();

  expect(a.current()).toBe(false);
  expect(a.signal.aborted).toBe(true);
  expect(scope.bound()).toBeUndefined();
});

it("ignores a repeated sign-in of the same account generation", () => {
  const source = new AccountScopeSource<LeaseBinding>();
  const seen: string[] = [];
  source.subscribe((binding) => {
    seen.push(binding.kind);
  });
  const lease = testBinding("a", 1);
  const account = { user: testUser("a"), persistent: true };

  source.signIn(lease, account);
  source.signIn(lease, account);

  expect(seen).toEqual(["signedOut", "signedIn"]);
});

it("lets listeners see every feature on the same account after a change", () => {
  const scope = driver();
  const first = feature(scope.scope);
  const second = feature(scope.scope);
  const pairs: string[] = [];

  const record = () => {
    pairs.push(`${owner(first.view())}/${owner(second.view())}`);
  };

  first.subscribe(record);
  second.subscribe(record);
  pairs.length = 0;
  scope.signIn("a");
  scope.signIn("b");
  scope.signOut();

  expect(pairs).toEqual(["a/a", "a/a", "b/b", "b/b", "-/-", "-/-"]);
});

it("drops results and rendered actions of an ended binding", () => {
  const scope = driver();
  const state = feature(scope.scope);
  const a = scope.signIn("a");
  const calls: string[] = [];

  const action = state.guard(() => {
    calls.push("a");
  });

  scope.signIn("b");
  state.update(a, () => ({ kind: "account", userId: "late a" }));
  action();

  expect(state.view()).toEqual({ kind: "account", userId: "b" });
  expect(calls).toEqual([]);
});

it("keeps only the newest turn of a lane current, and no turn after its binding ended", () => {
  const scope = driver();
  const lane = new AccountLane();
  const a = scope.signIn("a");
  const older = lane.begin(a);
  const joined = lane.join(a);
  const newer = lane.begin(a);

  expect([older.current(), joined.current(), newer.current()]).toEqual([false, false, true]);
  scope.signOut();
  expect(newer.current()).toBe(false);
});

it("follows the application session through login, account deletion and a new login", async () => {
  let user = testUser("a");

  const session = new ApplicationSession<LeaseBinding>({
    transport: {
      mode: () => Promise.reject(new Error("unexpected provider lookup")),
      me: () => Promise.reject(new Error("unexpected restore")),
      exchange: () => Promise.resolve({ user, sessionToken: "s".repeat(43) }),
      logout: () => Promise.resolve(),
    },
    persistence: { load: () => {}, save: () => true, clear: () => true },
    navigate: () => {
      throw new Error("unexpected navigation");
    },
    privateTransport: {
      authorize: ({ userId, generation, signal, current }) => ({
        apiOrigin: "http://localhost:3000",
        userId,
        generation,
        signal,
        current,
      }),
    },
  });

  const scope = sessionAccountScope(session);
  const kinds: string[] = [];
  let bound: LeaseBinding | undefined;

  scope.subscribe((binding) => {
    kinds.push(bindingLabel(binding));
    bound = boundLease(binding);
  });

  await session.exchange("code-a");
  const a = bound;
  session.endAfterAccountDeletion();

  expect(a?.current()).toBe(false);
  expect(bound).toBeUndefined();

  user = testUser("b");
  await session.exchange("code-b");

  expect(kinds).toEqual(["guest", "busy", "a", "guest", "busy", "b"]);
  expect(bound?.userId).toBe("b");
});

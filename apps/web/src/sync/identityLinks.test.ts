import { expect, it } from "vitest";
import type { LinkedIdentitiesResponse, OidcLinkStartResponse, User } from "@voltonaut/shared";
import type { SessionView } from "./applicationSession.js";
import {
  IdentityLinks,
  TAB_ONLY_TEXT,
  type IdentityLinksLease,
  type IdentityLinksView,
} from "./identityLinks.js";
import { PrivateRequestError } from "./apiRoute.js";

const user: User = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const PROVIDERS = [
  { id: "cloudflare", displayName: "Cloudflare Access" },
  { id: "authentik", displayName: "authentik" },
];

const CLOUDFLARE_ONLY: LinkedIdentitiesResponse = {
  identities: [{ providerId: "cloudflare", displayName: "Cloudflare Access" }],
};

const BOTH: LinkedIdentitiesResponse = {
  identities: [
    ...CLOUDFLARE_ONLY.identities,
    { providerId: "authentik", displayName: "authentik" },
  ],
};

class Harness {
  readonly calls: string[] = [];
  readonly redirects: string[] = [];
  listener: ((view: SessionView) => void) | undefined;
  signedIn = false;
  completion: Promise<LinkedIdentitiesResponse> = Promise.resolve(BOTH);
  listed: LinkedIdentitiesResponse = CLOUDFLARE_ONLY;
  readonly views: IdentityLinksView[] = [];

  readonly lease: IdentityLinksLease = {
    generation: 1,
    current: () => this.signedIn,
    identities: {
      list: () => {
        this.calls.push("list");

        return Promise.resolve(this.listed);
      },
      startLink: (providerId): Promise<OidcLinkStartResponse> => {
        this.calls.push(`start:${providerId}`);

        return Promise.resolve({ location: "https://idp.example/authorize?state=s" });
      },
      completeLink: (code) => {
        this.calls.push(`complete:${code}`);

        return this.completion;
      },
    },
  };

  readonly links = new IdentityLinks({
    session: {
      authorize: () => (this.signedIn ? this.lease : undefined),
      subscribe: (listener) => {
        this.listener = listener;
        listener({ kind: "guest", message: "Gast." });

        return () => {
          this.listener = undefined;
        };
      },
    },
    providers: () => Promise.resolve(PROVIDERS),
    redirect: (location) => {
      this.redirects.push(location);
    },
  });

  constructor() {
    this.links.subscribe((view) => {
      this.views.push(view);
    });
  }

  async signIn(persistent = true): Promise<void> {
    this.signedIn = true;
    this.listener?.({ kind: "authenticated", user, persistent });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  last(): IdentityLinksView | undefined {
    return this.views.at(-1);
  }
}

it("shows connected logins and offers only providers that are not connected yet", async () => {
  const harness = new Harness();

  expect(harness.last()).toEqual({ kind: "hidden", message: "" });
  await harness.signIn();
  expect(harness.last()).toEqual({
    kind: "ready",
    linked: CLOUDFLARE_ONLY.identities,
    available: [PROVIDERS[1]],
    message: "",
    busy: false,
    linkable: true,
  });
  expect(harness.calls).toEqual(["list"]);
});

it("starts a link for the signed-in account and continues at the provider", async () => {
  const harness = new Harness();
  await harness.signIn();
  await harness.links.connect("authentik");

  expect(harness.calls).toEqual(["list", "start:authentik"]);
  expect(harness.redirects).toEqual(["https://idp.example/authorize?state=s"]);
});

it("completes a returned link code once with the confirmed session", async () => {
  const harness = new Harness();
  harness.links.completePending("c".repeat(43));
  harness.listed = BOTH;
  await harness.signIn();
  harness.links.settle();

  expect(harness.calls).toEqual([`complete:${"c".repeat(43)}`, "list"]);
  expect(harness.last()).toMatchObject({ kind: "ready", linked: BOTH.identities, available: [] });
  expect(harness.last()?.message).toMatch(/verbunden/u);
});

it("reports a login that belongs to another account and still lists the own logins", async () => {
  const harness = new Harness();
  harness.completion = Promise.reject(new PrivateRequestError("conflict"));
  harness.links.completePending("c".repeat(43));
  await harness.signIn();

  expect(harness.last()).toMatchObject({ kind: "ready", linked: CLOUDFLARE_ONLY.identities });
  expect(harness.last()?.message).toMatch(/anderen Voltonaut-Konto/u);
});

it("drops a link code when no session could be confirmed", () => {
  const harness = new Harness();
  harness.links.completePending("c".repeat(43));
  harness.links.settle();

  expect(harness.calls).toEqual([]);
  expect(harness.last()?.kind).toBe("hidden");
  expect(harness.last()?.message).toMatch(/nicht abgeschlossen/u);
});

it("does not leave the tab to link while the session cannot be stored", async () => {
  const harness = new Harness();
  await harness.signIn(false);

  expect(harness.last()).toMatchObject({ kind: "ready", linkable: false, message: TAB_ONLY_TEXT });
  await harness.links.connect("authentik");
  expect(harness.calls).toEqual(["list"]);
  expect(harness.redirects).toEqual([]);
  expect(harness.last()?.message).toBe(TAB_ONLY_TEXT);
});

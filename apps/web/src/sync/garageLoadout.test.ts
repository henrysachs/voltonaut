import { expect, it, vi } from "vitest";

import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { LoadoutResponseSchema, type AvatarConfig, type LoadoutResponse } from "@voltonaut/shared";

import { PrivateRequestError } from "./apiRoute.js";
import {
  GarageLoadout,
  wornLoadout,
  type GarageLoadoutView,
  type LoadoutLease,
} from "./garageLoadout.js";

const STRIPE: AvatarConfig = {
  ...DEFAULT_AVATAR_CONFIG,
  rider: { ...DEFAULT_AVATAR_CONFIG.rider, jerseyId: "jersey.stripe" },
};

class LoadoutServer {
  stored: AvatarConfig = DEFAULT_AVATAR_CONFIG;
  readonly saves: AvatarConfig[] = [];
  failure: Error | undefined;
  readFailure: Error | undefined;
  active = true;

  lease(): LoadoutLease {
    return {
      signal: new AbortController().signal,
      apiOrigin: "http://localhost:3000",
      userId: "rider",
      generation: 1,
      current: () => this.active,
      shop: {
        loadout: () => this.read(),
        saveLoadout: (loadout) => this.write(loadout),
      },
    };
  }

  private read(): Promise<LoadoutResponse> {
    if (this.readFailure !== undefined) return Promise.reject(this.readFailure);

    return Promise.resolve(LoadoutResponseSchema.parse({ loadout: this.stored, updatedAt: null }));
  }

  private write(loadout: Readonly<AvatarConfig>): Promise<LoadoutResponse> {
    this.saves.push(loadout);

    if (this.failure !== undefined) return Promise.reject(this.failure);
    this.stored = loadout;

    return this.read();
  }
}

async function readyLoadout(stored: AvatarConfig = DEFAULT_AVATAR_CONFIG) {
  const server = new LoadoutServer();

  server.stored = stored;

  const loadout = new GarageLoadout();

  loadout.bind(server.lease());
  await vi.waitFor(() => {
    expect(loadout.view().kind).toBe("ready");
  });

  return { server, loadout };
}

it("wears the default as guest and the server loadout when signed in", async () => {
  const guest = new GarageLoadout();

  expect(wornLoadout(guest.view())).toEqual(DEFAULT_AVATAR_CONFIG);
  await guest.save(STRIPE);

  const { server, loadout } = await readyLoadout(STRIPE);

  expect(wornLoadout(loadout.view())).toEqual(STRIPE);
  expect(server.saves).toEqual([]);
});

it("saves once, blocks a second save while open and shows the server result", async () => {
  const { server, loadout } = await readyLoadout();
  const views: GarageLoadoutView[] = [];

  loadout.subscribe((view) => {
    views.push(view);
  });

  const first = loadout.save(STRIPE);

  await loadout.save(DEFAULT_AVATAR_CONFIG);
  await first;

  expect(server.saves).toEqual([STRIPE]);
  expect(views).toContainEqual(expect.objectContaining({ saving: true }));
  expect(loadout.view()).toMatchObject({ kind: "ready", loadout: STRIPE, saving: false });
});

it("rereads the server after a rejected save and keeps the old loadout otherwise", async () => {
  const { server, loadout } = await readyLoadout();

  server.failure = new PrivateRequestError("conflict");
  await loadout.save(STRIPE);

  expect(loadout.view()).toMatchObject({ loadout: DEFAULT_AVATAR_CONFIG });
  expect(JSON.stringify(loadout.view())).toContain("Ausrüsten abgelehnt");

  server.failure = new PrivateRequestError("retry");
  await loadout.save(STRIPE);

  expect(loadout.view()).toMatchObject({ loadout: DEFAULT_AVATAR_CONFIG, saving: false });
  expect(JSON.stringify(loadout.view())).toContain("nicht bestätigt");
});

it("falls back to the default after a failed load and rereads on retry", async () => {
  const server = new LoadoutServer();
  const loadout = new GarageLoadout();

  server.readFailure = new PrivateRequestError("retry");
  server.stored = STRIPE;
  loadout.bind(server.lease());
  await vi.waitFor(() => {
    expect(loadout.view().kind).toBe("failed");
  });

  expect(wornLoadout(loadout.view())).toEqual(DEFAULT_AVATAR_CONFIG);

  server.readFailure = undefined;
  await loadout.retry();

  expect(wornLoadout(loadout.view())).toEqual(STRIPE);
});

it("ignores results for a replaced account", async () => {
  const { server, loadout } = await readyLoadout();
  const pending = loadout.save(STRIPE);

  server.active = false;
  loadout.bind();
  await pending;

  expect(loadout.view()).toEqual({ kind: "guest" });
});

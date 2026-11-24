import { describe, expect, it } from "vitest";

import { hardReload } from "./hardReload.js";

function setup(names: readonly string[]) {
  const log: string[] = [];

  const registration = {
    unregister: async () => {
      await Promise.resolve();
      log.push("unregister");

      return true;
    },
  };

  const ports = {
    registrations: () => Promise.resolve([registration]),
    cacheNames: () => Promise.resolve(names),
    deleteCache: async (name: string) => {
      await Promise.resolve();
      log.push(`delete:${name}`);

      return true;
    },
    refetchShell: async () => {
      await Promise.resolve();
      log.push("refetch");
    },
    reload: () => {
      log.push("reload");
    },
  };

  return { log, ports };
}

describe("hardReload", () => {
  it("resets only the own worker and shell caches, then reloads last", async () => {
    const { log, ports } = setup(["voltonaut-shell-a", "other-app", "voltonaut-shell-b"]);

    await hardReload(ports);

    expect(log).toEqual([
      "unregister",
      "delete:voltonaut-shell-a",
      "delete:voltonaut-shell-b",
      "refetch",
      "reload",
    ]);
  });

  it("does not reload when a reset step fails", async () => {
    const { log, ports } = setup([]);

    await expect(
      hardReload({
        ...ports,
        refetchShell: () => Promise.reject(new Error("offline")),
      }),
    ).rejects.toThrow("offline");
    expect(log).not.toContain("reload");
  });
});

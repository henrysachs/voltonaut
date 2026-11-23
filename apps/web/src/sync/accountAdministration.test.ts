import { expect, it, vi } from "vitest";
import type { AccountStatus, AdminUsers } from "@voltonaut/shared";
import { AdministrationFixture } from "./accountAdministrationFixture.spec.js";
import { deferred } from "./testdata/deferred.js";

it("uses the real ApplicationSession lease, clears old actions and aborts in-flight directory work on account replacement", async () => {
  const f = new AdministrationFixture();
  const pending = deferred<AdminUsers>();
  f.usersPending = pending.promise;
  await f.session.exchange("a");
  await vi.waitFor(() => {
    expect(f.reads).toEqual(["a"]);
  });
  const old = f.sync.administration.actions();
  f.usersPending = undefined;
  f.role = "user";
  await f.session.exchange("b");
  await vi.waitFor(() => {
    expect(f.views.at(-1)).toMatchObject({
      kind: "ready",
      status: { authorization: { role: "user" } },
      directory: null,
    });
  });
  pending.resolve(f.directory());
  await old.refresh();
  await old.save("target", { tier: "pro", vip: true });
  expect(f.writes).toEqual([]);
  expect(f.signals[0]?.aborted).toBe(true);
  expect(f.views.at(-1)).toMatchObject({ kind: "ready", directory: null });
  await f.session.logout();
  expect(f.views.at(-1)).toEqual({ kind: "guest" });
  expect(f.signals[1]?.aborted).toBe(true);
  expect(f.profileApplies).toBe(0);
});

it("ignores out-of-order status reads and removes admin affordances on fresh role revocation", async () => {
  const f = new AdministrationFixture();
  await f.session.exchange("a");
  await vi.waitFor(() => {
    expect(f.views.at(-1)).toMatchObject({ kind: "ready" });
  });
  const pending = deferred<AccountStatus>();
  f.statusPending = pending.promise;
  const old = f.sync.administration.actions();
  const older = old.refresh();
  f.role = "user";
  await f.sync.administration.actions().refresh();
  pending.resolve({ membership: { tier: "pro", vip: true }, authorization: { role: "admin" } });
  await older;
  await old.save("target", { tier: "pro", vip: true });
  expect(f.views.at(-1)).toMatchObject({
    kind: "ready",
    status: { authorization: { role: "user" } },
    directory: null,
  });
  expect(f.writes).toEqual([]);
});

it("does not retry an uncertain membership write and reloads authoritative data without profile changes", async () => {
  const f = new AdministrationFixture();
  await f.session.exchange("a");
  await vi.waitFor(() => {
    expect(f.views.at(-1)).toMatchObject({ kind: "ready" });
  });
  f.loseReply = true;
  await f.sync.administration.actions().save("target", { tier: "premium", vip: true });
  expect(f.writes).toEqual(["a:target"]);
  expect(f.views.at(-1)).toMatchObject({
    kind: "ready",
    directory: { users: [{ membership: { tier: "premium", vip: true } }] },
  });
  expect(JSON.stringify(f.views.at(-1))).toContain("keine automatische Wiederholung");
  expect(f.profileApplies).toBe(0);
});

it("cannot publish an old write reply or reuse a rendered write action in a new session generation", async () => {
  const f = new AdministrationFixture();
  await f.session.exchange("a");
  await vi.waitFor(() => {
    expect(f.views.at(-1)).toMatchObject({ kind: "ready" });
  });
  const pending = deferred<AccountStatus>();
  f.writePending = pending.promise;
  const old = f.sync.administration.actions();
  const writing = old.save("target", { tier: "pro", vip: true });
  await old.refresh();
  expect(f.reads).toEqual(["a"]);
  await f.session.exchange("a");
  await vi.waitFor(() => {
    expect(f.views.at(-1)).toMatchObject({ kind: "ready", busy: false });
  });
  pending.resolve(f.status());
  await writing;
  await old.save("target", { tier: "normal", vip: false });
  expect(f.writes).toEqual(["a:target"]);
  expect(f.signals[0]?.aborted).toBe(true);
  expect(f.views.at(-1)).toMatchObject({ kind: "ready", message: "" });
});

it("keeps an uncertain write explicit when the authoritative reload also fails", async () => {
  const f = new AdministrationFixture();
  await f.session.exchange("a");
  await vi.waitFor(() => {
    expect(f.views.at(-1)).toMatchObject({ kind: "ready" });
  });
  f.loseReply = true;
  f.statusPending = Promise.reject(new Error("server offline"));
  await f.sync.administration.actions().save("target", { tier: "pro", vip: true });
  expect(f.writes).toEqual(["a:target"]);
  expect(f.views.at(-1)).toEqual({
    kind: "failed",
    message:
      "Änderung nicht bestätigt. Serverstand nicht erreichbar; keine automatische Wiederholung.",
  });
});

it.each([false, true])(
  "serializes retained refresh, next and save through authoritative readback (lost PATCH reply: %s)",
  async (loseReply) => {
    const f = new AdministrationFixture();
    f.nextCursor = "target";
    await f.session.exchange("a");
    await vi.waitFor(() => {
      expect(f.views.at(-1)).toMatchObject({ kind: "ready" });
    });
    const old = f.sync.administration.actions();
    const status = deferred<AccountStatus>();
    const users = deferred<AdminUsers>();
    f.statusPending = status.promise;
    f.loseReply = loseReply;
    const writing = old.save("target", { tier: "premium", vip: true });
    await vi.waitFor(() => {
      expect(f.reads).toEqual(["a", "a"]);
    });
    const confirmationViews = f.views.length;
    await old.refresh();
    await old.next();
    await f.sync.administration.actions().refresh();
    await old.save("target", { tier: "pro", vip: false });
    expect(f.reads).toEqual(["a", "a"]);
    expect(f.writes).toEqual(["a:target"]);
    expect(f.views).toHaveLength(confirmationViews);
    f.usersPending = users.promise;
    status.resolve(f.status());
    await old.next();
    expect(f.views.at(-1)).toMatchObject({ kind: "loading" });
    expect(f.reads).toEqual(["a", "a"]);
    users.resolve(f.directory());
    await writing;
    expect(f.views.at(-1)).toMatchObject({
      kind: "ready",
      busy: false,
      directory: { users: [{ membership: { tier: "premium", vip: true } }] },
    });
    await f.sync.administration.actions().refresh();
    expect(f.reads).toEqual(["a", "a", "a"]);
    expect(f.writes).toEqual(["a:target"]);
  },
);

it.each(["a", "b"])(
  "does not let an old write completion unlock the new generation's readback for account %s",
  async (account) => {
    const f = new AdministrationFixture();
    f.nextCursor = "target";
    await f.session.exchange("a");
    await vi.waitFor(() => {
      expect(f.views.at(-1)).toMatchObject({ kind: "ready" });
    });
    const oldReply = deferred<AccountStatus>();
    f.writePending = oldReply.promise;
    const oldWriting = f.sync.administration.actions().save("target", { tier: "pro", vip: true });
    f.writePending = undefined;
    await f.session.exchange(account);
    await vi.waitFor(() => {
      expect(f.views.at(-1)).toMatchObject({ kind: "ready", busy: false });
    });
    const current = f.sync.administration.actions();
    const confirmation = deferred<AccountStatus>();
    f.statusPending = confirmation.promise;
    const writing = current.save("target", { tier: "premium", vip: false });
    await vi.waitFor(() => {
      expect(f.reads).toEqual(["a", account, account]);
    });
    oldReply.resolve(f.status());
    await oldWriting;
    await current.refresh();
    await current.next();
    await current.save("target", { tier: "normal", vip: false });
    expect(f.reads).toEqual(["a", account, account]);
    expect(f.writes).toEqual(["a:target", `${account}:target`]);
    expect(f.views.at(-1)).toMatchObject({ kind: "loading" });
    confirmation.resolve(f.status());
    await writing;
    expect(f.views.at(-1)).toMatchObject({ kind: "ready", busy: false });
  },
);

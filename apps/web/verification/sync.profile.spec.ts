import assert from "node:assert/strict";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_RIDER_PROFILE, SessionResponseSchema } from "@voltonaut/shared";
import type { PendingInput } from "./profileRaceFixture.js";
import { openGameMenu } from "../e2e/helpers/gameMenu.js";

const web = process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5193";
const api = process.env["API_ORIGIN"] ?? "";
const control = process.env["SYNC_CONTROL"] ?? "";

async function savedName() {
  const fixture = await import("../verification/profileRaceFixture.js");

  return fixture.savedName();
}

async function hold(name: "voltonaut" | "voltonaut-account-outbox") {
  const fixture = await import("../verification/profileRaceFixture.js");
  await fixture.holdDatabase(name);
}

async function release(name: string) {
  const fixture = await import("../verification/profileRaceFixture.js");
  await fixture.releaseDatabase(name);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page lifecycle handle.
async function setup(page: Readonly<Page>) {
  expect((await fetch(`${control}/a`, { method: "POST" })).status).toBe(204);
  await page.goto(`${web}/?sim=1`);
  await openGameMenu(page, "Konto");
  const exchange = page.waitForResponse(`${api}/v1/auth/oidc/exchange`);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const raw: unknown = await (await exchange).json();
  const session = SessionResponseSchema.parse(raw);
  await openGameMenu(page, "Konto");
  await expect(page.getByRole("region", { name: "Konto", exact: true })).toContainText(
    session.user.email,
  );
  await openGameMenu(page, "Profil");
  await page.getByTestId("profile-displayName").fill("Pending Local");
  await page.getByTestId("profile-save").click();
  await expect.poll(() => page.evaluate(savedName)).toBe("Pending Local");

  const response = await fetch(`${api}/v1/me/profile`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...DEFAULT_RIDER_PROFILE, displayName: "Old Remote" }),
  });

  expect(response.status).toBe(200);
  await openGameMenu(page, "Konto");
  await page
    .getByRole("button", { name: "Kontodaten und lokales Archiv aktualisieren", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Serverprofil: Old Remote",
  );
  await expect(
    page.getByRole("button", {
      name: "Serverprofil für nächste Fahrt lokal verwenden",
      exact: true,
    }),
  ).toBeEnabled();
  const other = await page.context().newPage();
  await other.goto(`${web}/src/styles.css`);

  return { other, owner: { apiOrigin: api, userId: session.user.id } };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns Page and native dialog handles.
async function pull(page: Readonly<Page>): Promise<void> {
  const dialog = page.waitForEvent("dialog");

  const clicking = page
    .getByRole("button", { name: "Serverprofil für nächste Fahrt lokal verwenden", exact: true })
    .click();

  await (await dialog).accept();
  await clicking;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync pending profile blocks pull while a real cross-tab outbox read is held", async ({
  page,
}) => {
  const { other, owner } = await setup(page);
  await other.evaluate(async (value: Readonly<PendingInput>) => {
    const fixture = await import("../verification/profileRaceFixture.js");
    await fixture.queuePending(value);
  }, owner);
  await other.evaluate(hold, "voltonaut-account-outbox");

  try {
    await page
      .getByRole("button", { name: "Kontodaten und lokales Archiv aktualisieren", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Serverprofil für nächste Fahrt lokal verwenden",
        exact: true,
      }),
    ).toBeDisabled();
    expect(await page.evaluate(savedName)).toBe("Pending Local");
  } finally {
    await other.evaluate(release, "voltonaut-account-outbox");
  }

  expect(
    await other.evaluate(async (value: Readonly<PendingInput>) => {
      const fixture = await import("../verification/profileRaceFixture.js");

      return fixture.pendingName(value);
    }, owner),
  ).toBe("Pending Local");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync pull freshly checks another tab's pending profile despite a ready cached view", async ({
  page,
}) => {
  const { other, owner } = await setup(page);
  await other.evaluate(async (value: Readonly<PendingInput>) => {
    const fixture = await import("../verification/profileRaceFixture.js");
    await fixture.queuePending(value);
  }, owner);
  await other.evaluate(hold, "voltonaut-account-outbox");

  try {
    await pull(page);
    await expect(
      page.getByRole("button", {
        name: "Serverprofil für nächste Fahrt lokal verwenden",
        exact: true,
      }),
    ).toBeDisabled();
    expect(await page.evaluate(savedName)).toBe("Pending Local");
  } finally {
    await other.evaluate(release, "voltonaut-account-outbox");
  }

  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Ein lokales Profil wartet",
  );
  expect(await page.evaluate(savedName)).toBe("Pending Local");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync actual logout aborts a profile pull queued behind another tab's native transaction", async ({
  page,
}) => {
  const { other } = await setup(page);
  await other.evaluate(hold, "voltonaut");

  try {
    await pull(page);
    await page.waitForTimeout(100);
    const logout = page.waitForResponse(`${api}/v1/auth/logout`);
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    expect((await logout).status()).toBe(204);
  } finally {
    await other.evaluate(release, "voltonaut");
  }

  expect(await page.evaluate(savedName)).toBe("Pending Local");
  await page.reload();
  await openGameMenu(page, "Profil");
  await expect(page.getByTestId("profile-displayName")).toHaveValue("Pending Local");
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync native profile lease cancels an already queued write", async ({ page }) => {
  await page.goto(`${web}/src/styles.css`);

  const result = await page.evaluate(async () => {
    const fixture = await import("../verification/profileRaceFixture.js");

    return fixture.queuedRevocation();
  });

  expect(result).toEqual({ outcome: "aborted", name: "Previous" });
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync fresh outbox read failure refuses profile application", async ({ page }) => {
  const { other, owner } = await setup(page);
  await other.evaluate(async (value: Readonly<PendingInput>) => {
    const fixture = await import("../verification/profileRaceFixture.js");
    await fixture.corruptOutbox(value);
  }, owner);
  await pull(page);
  await expect(page.getByRole("region", { name: "Kontodaten", exact: true })).toContainText(
    "Serverprofil nicht lokal gespeichert",
  );
  await expect(
    page.getByRole("button", {
      name: "Serverprofil für nächste Fahrt lokal verwenden",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await page.evaluate(savedName)).toBe("Pending Local");
});

async function selectionStatus() {
  const fixture = await import("../verification/profileRaceFixture.js");

  return fixture.selectionStatus();
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync profile claim cannot commit between fresh pending check and local profile commit", async ({
  page,
}) => {
  const { other, owner } = await setup(page);
  await other.evaluate(hold, "voltonaut");
  let claiming: Promise<string> = Promise.resolve("not started");

  try {
    await pull(page);
    await expect.poll(async () => (await page.evaluate(selectionStatus)).held).toBe(true);
    claiming = other
      .evaluate(async (value: Readonly<PendingInput>) => {
        const fixture = await import("../verification/profileRaceFixture.js");
        await fixture.queuePending(value);
      }, owner)
      .then(() => "claimed")
      .catch(() => "failed");
    await expect.poll(async () => (await page.evaluate(selectionStatus)).pending).toBe(true);
    await expect(page.getByTestId("profile-displayName")).toHaveValue("Pending Local");
  } finally {
    await other.evaluate(release, "voltonaut");
  }

  expect(await claiming).toBe("claimed");
  await expect(page.getByTestId("profile-displayName")).toHaveValue("Old Remote");
  expect(await page.evaluate(savedName)).toBe("Old Remote");
  expect(
    await other.evaluate(async (value: Readonly<PendingInput>) => {
      const fixture = await import("../verification/profileRaceFixture.js");

      return fixture.pendingName(value);
    }, owner),
  ).toBe("Pending Local");
});

for (const mode of ["signal", "transaction"] satisfies readonly ("signal" | "transaction")[]) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
  test(`sync profile ${mode} abort after put-success never reports commit`, async ({ page }) => {
    await page.goto(`${web}/src/styles.css`);

    const result = await page.evaluate(async (value) => {
      const fixture = await import("../verification/profileRaceFixture.js");

      return fixture.abortAfterPut(value);
    }, mode);

    assert.deepEqual(result, { outcome: "aborted", name: "Previous" });
  });
}

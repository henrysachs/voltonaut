import { afterEach, expect, it } from "vitest";

import {
  CONSENT_VERSION,
  JOURNAL_ID,
  NOW_MS,
  SESSION_GENERATION,
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  expectApiError,
  expectNoProgressWrites,
  fixture,
  grantConsent,
  postCheckpoints,
  principal,
} from "./progress.fixtures.spec.js";
import { bodyOf } from "../testing/test-app.spec.js";

afterEach(closeProgressApps);

it("enforces enabled consent, consent version and session hash", async () => {
  const f = await fixture();
  const value = batch([checkpoint()]);

  const missing = await postCheckpoints(f.server, f.owner.sessionToken, value).expect(403);
  expect(bodyOf(missing)).toMatchObject({ error: { code: "progress_consent_required" } });

  grantConsent(f.db, f.owner, { enabled: false });
  const disabled = await postCheckpoints(f.server, f.owner.sessionToken, value).expect(403);
  expect(bodyOf(disabled)).toMatchObject({ error: { code: "progress_consent_required" } });

  grantConsent(f.db, f.owner, { version: 2 });
  const stale = await postCheckpoints(f.server, f.owner.sessionToken, value).expect(409);
  expect(bodyOf(stale)).toMatchObject({ error: { code: "progress_consent_conflict" } });

  grantConsent(f.db, f.owner, { sessionHash: "0".repeat(64) });
  const wrongSession = await postCheckpoints(f.server, f.owner.sessionToken, value).expect(409);
  expect(bodyOf(wrongSession)).toMatchObject({ error: { code: "progress_consent_conflict" } });

  grantConsent(f.db, f.owner);
  await postCheckpoints(f.server, f.owner.sessionToken, value).expect(200);
});

it("resumes an existing journal with a new browser generation without changing authorization", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner, { sessionGeneration: SESSION_GENERATION });

  const first = accept(f, f.owner, batch([checkpoint()]));

  const second = accept(
    f,
    f.owner,
    batch(
      [checkpoint({ sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 })],
      CONSENT_VERSION,
      2,
    ),
  );

  expect(first.startTick).toBe(0);
  expect(second.startTick).toBe(1);
  expect(
    f.db.$client
      .prepare(
        "SELECT session_generation, last_end_tick, last_sequence FROM ride_progress_journals",
      )
      .get(),
  ).toEqual({ session_generation: SESSION_GENERATION, last_end_tick: 2, last_sequence: 1 });
  expect(f.db.$client.prepare("SELECT session_generation FROM progress_consents").get()).toEqual({
    session_generation: SESSION_GENERATION,
  });
});

it("blocks an existing journal immediately when consent is revoked", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  accept(f, f.owner, batch([checkpoint()]));

  f.db.$client
    .prepare("UPDATE progress_consents SET enabled = 0, version = 2 WHERE user_id = ?")
    .run(f.owner.user.id);

  expectApiError(
    () =>
      accept(
        f,
        f.owner,
        batch(
          [checkpoint({ sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 })],
          2,
          SESSION_GENERATION,
        ),
      ),
    403,
    "progress_consent_required",
  );
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

it("rechecks session activity inside acceptance", async () => {
  expect.hasAssertions();
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const session = principal(f.owner);
  f.db.$client.prepare("DELETE FROM sessions WHERE token_hash = ?").run(session.sessionTokenHash);

  expectApiError(
    () => f.service.accept(session, batch([checkpoint()]), NOW_MS),
    401,
    "unauthorized",
  );
  expectNoProgressWrites(f);
});

it("maps disabled policy and simulation to their shared progress errors", async () => {
  const disabled = await fixture("disabled");
  grantConsent(disabled.db, disabled.owner);

  const policy = await postCheckpoints(
    disabled.server,
    disabled.owner.sessionToken,
    batch([checkpoint()]),
  ).expect(403);

  expect(bodyOf(policy)).toMatchObject({ error: { code: "progress_source_disabled" } });
  expectNoProgressWrites(disabled);

  const enabled = await fixture();
  grantConsent(enabled.db, enabled.owner);

  const sim = await postCheckpoints(
    enabled.server,
    enabled.owner.sessionToken,
    batch([checkpoint({ source: "sim" })]),
  ).expect(422);

  expect(bodyOf(sim)).toMatchObject({ error: { code: "progress_source_rejected" } });
  expectNoProgressWrites(enabled);
});

it("hides a globally foreign journal without changing either account", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  grantConsent(f.db, f.other);
  const owned = accept(f, f.owner, batch([checkpoint({ journalId: JOURNAL_ID })]));

  expectApiError(
    () =>
      accept(
        f,
        f.other,
        batch([checkpoint({ sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 })]),
      ),
    404,
    "not_found",
  );

  expect(f.economy.balance(f.owner.user.id)).toBe(owned.awardedVolts);
  expect(f.economy.balance(f.other.user.id)).toBe(0);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

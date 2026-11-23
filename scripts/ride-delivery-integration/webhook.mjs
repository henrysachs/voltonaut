/// <reference types="node" />
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** @param {string} endpoint */
async function verifyChallenge(endpoint) {
  const challenge = await fetch(
    `${endpoint}?hub.mode=subscribe&hub.challenge=built-public-proof&hub.verify_token=${"b".repeat(64)}`,
  );

  assert.equal(challenge.status, 200);
  assert.deepEqual(await challenge.json(), { "hub.challenge": "built-public-proof" });

  const wrong = await fetch(
    `${endpoint}?hub.mode=subscribe&hub.challenge=proof&hub.verify_token=${"a".repeat(64)}`,
  );

  assert.equal(wrong.status, 403);
  await wrong.body?.cancel();

  return { challenge: challenge.status, wrongToken: wrong.status };
}

/** @param {string} endpoint @param {string} body @param {number} expected @param {string} media */
async function postWebhook(endpoint, body, expected, media = "application/json") {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": media },
    body,
  });

  assert.equal(response.status, expected);

  if (expected === 200) assert.equal(await response.text(), "");
  else await response.body?.cancel();

  return response.status;
}

/** @param {string} api @param {string} artifacts */
export async function verifyBuiltWebhook(api, artifacts) {
  const endpoint = `${api}/v1/strava/webhook`;
  const challenge = await verifyChallenge(endpoint);

  const event = {
    object_type: "athlete",
    object_id: 42,
    aspect_type: "update",
    owner_id: 42,
    subscription_id: 999,
    event_time: 1,
    updates: { authorized: "false" },
  };

  const ignored = await postWebhook(endpoint, JSON.stringify(event), 200);
  const malformed = await postWebhook(endpoint, "{", 400);
  const media = await postWebhook(endpoint, JSON.stringify(event), 415, "text/plain");

  const large = await postWebhook(
    endpoint,
    JSON.stringify({ ...event, updates: { title: "x".repeat(9000) } }),
    413,
  );

  await writeFile(
    join(artifacts, "built-webhook.json"),
    JSON.stringify(
      {
        ...challenge,
        ignored,
        malformed,
        media,
        large,
      },
      null,
      2,
    ),
  );
}

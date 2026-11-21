from dataclasses import dataclass
from enum import Enum
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Protocol
from urllib import error, parse, request

import provision_env as provision

TARGET = Path("/srv/voltonaut/strava-webhook.env")
CALLBACK = "https://api.voltonaut.stammkneipe.dev/v1/strava/webhook"
ENDPOINT = "https://www.strava.com/api/v3/push_subscriptions"


class State(Enum):
    ABSENT = "absent"
    MATCHING = "matching"
    CONFLICTING = "conflicting"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Subscription:
    state: State
    subscription_id: int = 0


def subscriptions(raw: object, client_id: str) -> Subscription:
    if not isinstance(raw, list):
        return Subscription(State.UNKNOWN)
    if not raw:
        return Subscription(State.ABSENT)
    if len(raw) != 1 or not isinstance(raw[0], dict):
        return Subscription(State.UNKNOWN)
    row = raw[0]
    identity = row.get("id")
    if (type(identity) is not int or identity <= 0 or identity > 9007199254740991
            or type(row.get("application_id")) is not int
            or str(row["application_id"]) != client_id or not isinstance(row.get("callback_url"), str)):
        return Subscription(State.UNKNOWN)
    return Subscription(State.MATCHING if row["callback_url"] == CALLBACK else State.CONFLICTING, identity)


class Provider(Protocol):
    def list(self) -> Subscription: ...
    def create(self) -> int | None: ...


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpProvider:
    def __init__(self, values: dict[str, str], endpoint: str = ENDPOINT):
        self.values = values
        self.endpoint = endpoint
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def _request(self, method: str) -> object:
        fields = {"client_id": self.values["STRAVA_CLIENT_ID"], "client_secret": self.values["STRAVA_CLIENT_SECRET"]}
        if method == "POST":
            fields.update(callback_url=CALLBACK, verify_token=self.values["STRAVA_WEBHOOK_VERIFY_TOKEN"])
        encoded = parse.urlencode(fields).encode("ascii")
        url = self.endpoint + ("?" + encoded.decode("ascii") if method == "GET" else "")
        req = request.Request(url, data=encoded if method == "POST" else None, method=method,
                              headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with self.opener.open(req, timeout=10) as response:
                if response.status not in (200, 201) or response.headers.get_content_type() != "application/json":
                    return None
                body = response.read(16385)
                if len(body) > 16384:
                    return None
                return json.loads(body, object_pairs_hook=provision.json_object)
        except error.HTTPError as failure:
            failure.close()
            return None
        except (OSError, ValueError, HTTPException, RecursionError, error.URLError, provision.ProvisionError):
            return None

    def list(self) -> Subscription:
        return subscriptions(self._request("GET"), self.values["STRAVA_CLIENT_ID"])

    def create(self) -> int | None:
        raw = self._request("POST")
        if isinstance(raw, dict) and type(raw.get("id")) is int and 0 < raw["id"] <= 9007199254740991:
            return raw["id"]
        return None


@dataclass(frozen=True)
class Registration:
    subscription_id: int

    def values(self) -> dict[str, str]:
        return {"STRAVA_WEBHOOK_SUBSCRIPTION_ID": str(self.subscription_id)}


def register(provider: Provider, target: Path = TARGET) -> provision.Result:
    current = provider.list()
    if current.state in (State.UNKNOWN, State.CONFLICTING):
        raise provision.ProvisionError("subscription not safely reconcilable")
    if current.state == State.ABSENT:
        if target.exists() or target.is_symlink():
            raise provision.ProvisionError("saved registration no longer matches provider")
        created_id = provider.create()
        current = provider.list()
        if current.state != State.MATCHING or (created_id is not None and current.subscription_id != created_id):
            raise provision.ProvisionError("subscription creation not confirmed; reconcile before retry")
    return provision.write_config(target, Registration(current.subscription_id))


def local_values(path: Path = provision.STRAVA_TARGET) -> dict[str, str]:
    values = provision.private_values(path)
    config = provision.parse_strava({key: value for key, value in values.items()
                                    if key not in ("STRAVA_TOKEN_KEY", "STRAVA_WEBHOOK_VERIFY_TOKEN")})
    provision.strava_matches(path, config)
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".strava-compose-") as private:
        private.write(provision.render_values(values))
        private.flush()
        try:
            compose = "services:\n  decoder:\n    image: scratch\n    environment:\n" + "".join(
                f"      {key}: ${{{key}:?required}}\n" for key in values)
            result = subprocess.run(["docker", "compose", "--env-file", private.name,
                                     "-f", "-", "config", "--environment"],
                                    input=compose.encode(),
                                    capture_output=True,
                                    env=environment, timeout=15, check=False)
        except (OSError, subprocess.SubprocessError):
            raise provision.ProvisionError("private configuration unavailable") from None
    if result.returncode != 0:
        raise provision.ProvisionError("private configuration unavailable")
    resolved = dict(line.split("=", 1) for line in result.stdout.decode().splitlines() if "=" in line)
    if any(resolved.get(key) != value for key, value in values.items()):
        raise provision.ProvisionError("private configuration rejected")
    return {key: resolved[key] for key in (*provision.STRAVA_SECRET_KEYS, "STRAVA_WEBHOOK_VERIFY_TOKEN")}


def main(argv: list[str], load=local_values, factory=HttpProvider, target: Path = TARGET) -> int:
    try:
        if argv != ["register"]:
            raise provision.ProvisionError("invalid command")
        result = register(factory(load()), target)
        print(result.value)
        return 0
    except (provision.ProvisionError, OSError, UnicodeError, ValueError):
        print("subscription registration failed; reconcile before retry", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

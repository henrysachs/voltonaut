"""Initial OIDC configuration transfer. ADR-020; never replace existing credentials."""

from dataclasses import dataclass
from enum import Enum
import base64
import binascii
import contextlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import tempfile
from typing import Protocol
from urllib.parse import urlsplit


TARGET = Path("/srv/voltonaut/deploy.env")
MAX_PAYLOAD_BYTES = 1024 * 1024
CLIENT_ORIGIN = "https://voltonaut.stammkneipe.dev"
# The server reads a provider list (ADR-026). Provisioning installs exactly the Cloudflare Access
# provider. SECRET_KEYS stay the names of the GitHub secrets that the workflow passes in.
PROVIDER_ID = "cloudflare"
REDIRECT_URI = "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback"
SECRET_KEYS = ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET")
# Format written before ADR-026; only `migrate` still reads it.
LEGACY_REDIRECT_URI = "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback"
LEGACY_KEYS = ("AUTH_MODE", "CLIENT_ORIGIN", "OIDC_REDIRECT_URI", *SECRET_KEYS)
WRITTEN_KEYS = ("AUTH_MODE", "CLIENT_ORIGIN", "OIDC_PROVIDERS", "OIDC_CLOUDFLARE_REDIRECT_URI",
                "OIDC_CLOUDFLARE_ISSUER", "OIDC_CLOUDFLARE_CLIENT_ID", "OIDC_CLOUDFLARE_CLIENT_SECRET")
STRAVA_TARGET = Path("/srv/voltonaut/strava.env")
STRAVA_REDIRECT_URI = "https://api.voltonaut.stammkneipe.dev/v1/strava/callback"
STRAVA_SECRET_KEYS = ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET")


class ProvisionError(Exception):
    pass


class Result(Enum):
    CREATED = "created"
    UNCHANGED = "unchanged"
    MIGRATED = "migrated"


class EnvironmentValues(Protocol):
    def values(self) -> dict[str, str]: ...


@dataclass(frozen=True, repr=False)
class Config:
    issuer: str
    client_id: str
    client_secret: str

    def values(self) -> dict[str, str]:
        return {
            "AUTH_MODE": "oidc",
            "CLIENT_ORIGIN": CLIENT_ORIGIN,
            "OIDC_PROVIDERS": PROVIDER_ID,
            "OIDC_CLOUDFLARE_REDIRECT_URI": REDIRECT_URI,
            "OIDC_CLOUDFLARE_ISSUER": self.issuer,
            "OIDC_CLOUDFLARE_CLIENT_ID": self.client_id,
            "OIDC_CLOUDFLARE_CLIENT_SECRET": self.client_secret,
        }


@dataclass(frozen=True, repr=False)
class StravaConfig:
    client_id: str
    client_secret: str

    def values(self) -> dict[str, str]:
        return {"STRAVA_MODE": "enabled", "STRAVA_CLIENT_ID": self.client_id,
                "STRAVA_CLIENT_SECRET": self.client_secret,
                "STRAVA_REDIRECT_URI": STRAVA_REDIRECT_URI,
                "RIDE_SOURCE_POLICY": "declared_ble_v1"}


def parse_strava(raw: object) -> StravaConfig:
    if not isinstance(raw, dict):
        raise ProvisionError("invalid configuration")
    client_id, secret = raw.get("STRAVA_CLIENT_ID"), raw.get("STRAVA_CLIENT_SECRET")
    if (not isinstance(client_id, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", client_id)
            or not isinstance(secret, str) or not re.fullmatch(r"[!-~]{1,1024}", secret)
            or secret.lower() in {"changeme", "change-me", "replace-me", "placeholder", "your-client-secret"}):
        raise ProvisionError("invalid configuration")
    config = StravaConfig(client_id, secret)
    if raw != config.values():
        raise ProvisionError("invalid configuration")
    return config


def parse_written(raw: object) -> Config:
    """Validates the exact provider-list format that is written to deploy.env."""
    if not isinstance(raw, dict) or set(raw) != set(WRITTEN_KEYS):
        raise ProvisionError("invalid configuration")
    config = parse_config({
        "AUTH_MODE": raw["AUTH_MODE"],
        "CLIENT_ORIGIN": raw["CLIENT_ORIGIN"],
        "OIDC_REDIRECT_URI": raw["OIDC_CLOUDFLARE_REDIRECT_URI"],
        "OIDC_ISSUER": raw["OIDC_CLOUDFLARE_ISSUER"],
        "OIDC_CLIENT_ID": raw["OIDC_CLOUDFLARE_CLIENT_ID"],
        "OIDC_CLIENT_SECRET": raw["OIDC_CLOUDFLARE_CLIENT_SECRET"],
    })
    if raw != config.values():
        raise ProvisionError("invalid configuration")
    return config


def parse_config(raw: object) -> Config:
    """Validates the secret input format (GitHub secret names) used by the workflow."""
    keys = {"AUTH_MODE", "CLIENT_ORIGIN", "OIDC_REDIRECT_URI", *SECRET_KEYS}
    if not isinstance(raw, dict) or set(raw) != keys:
        raise ProvisionError("invalid configuration")
    values: dict[str, str] = {}
    for key in keys:
        value = raw[key]
        if not isinstance(value, str) or not value.strip() or any(c in value for c in "\r\n\0"):
            raise ProvisionError("invalid configuration")
        values[key] = value
    if (values["AUTH_MODE"] != "oidc" or values["CLIENT_ORIGIN"] != CLIENT_ORIGIN
            or values["OIDC_REDIRECT_URI"] != REDIRECT_URI):
        raise ProvisionError("invalid configuration")
    issuer = values["OIDC_ISSUER"]
    try:
        url = urlsplit(issuer)
        host = url.hostname
        port = url.port
        if (url.scheme != "https" or not host or url.username is not None
                or url.password is not None or "?" in issuer or "#" in issuer
                or any(c.isspace() for c in issuer) or "\\" in issuer
                or host.rstrip(".").lower() in {"localhost", "127.0.0.1", "::1"}
                or host.rstrip(".").lower().endswith((".localhost", ".invalid"))
                or host.rstrip(".").lower() == "invalid" or port == 0):
            raise ProvisionError("invalid configuration")
        try:
            address = ipaddress.ip_address(host.rstrip("."))
        except ValueError:
            pass
        else:
            if address.is_loopback or address.is_unspecified:
                raise ProvisionError("invalid configuration")
    except ValueError:
        raise ProvisionError("invalid configuration") from None
    if values["OIDC_CLIENT_SECRET"].strip().lower() in {
        "changeme", "change-me", "replace-me", "placeholder", "your-client-secret",
    }:
        raise ProvisionError("invalid configuration")
    return Config(issuer, values["OIDC_CLIENT_ID"], values["OIDC_CLIENT_SECRET"])


def json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ProvisionError("invalid configuration")
        result[key] = value
    return result


def parse_payload(payload: bytes) -> Config | StravaConfig:
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise ProvisionError("invalid configuration")
    try:
        raw: object = json.loads(payload, object_pairs_hook=json_object)
        if isinstance(raw, dict) and "STRAVA_MODE" in raw:
            return parse_strava(raw)
        return parse_written(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise ProvisionError("invalid configuration") from None


def render_values(values: dict[str, str]) -> bytes:
    def quote(value: str) -> str:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "$$") + '"'

    return "".join(f"{key}={quote(value)}\n" for key, value in values.items()).encode("utf-8")


def render_config(config: EnvironmentValues) -> bytes:
    return render_values(config.values())


def private_values(path: Path) -> dict[str, str]:
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(directory_fd)
        if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o022:
            raise ProvisionError("unsafe configuration directory")
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    except OSError:
        raise ProvisionError("existing configuration rejected") from None
    finally:
        os.close(directory_fd)
    with os.fdopen(fd, "rb") as source:
        metadata = os.fstat(source.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600):
            raise ProvisionError("existing configuration rejected")
        content = source.read(MAX_PAYLOAD_BYTES + 1)
    if len(content) > MAX_PAYLOAD_BYTES:
        raise ProvisionError("existing configuration rejected")
    values: dict[str, str] = {}
    for line in content.decode("utf-8").splitlines():
        match = re.fullmatch(r'([A-Z_]+)="((?:[^"\\\r\n\0]|\\["\\])*)"', line)
        if match is None or match[1] in values:
            raise ProvisionError("existing configuration rejected")
        values[match[1]] = re.sub(r'\\(["\\])', r'\1', match[2]).replace("$$", "$")
    if render_values(values) != content:
        raise ProvisionError("existing configuration rejected")
    return values


def strava_matches(path: Path, config: StravaConfig) -> Result:
    values = private_values(path)
    key = values.pop("STRAVA_TOKEN_KEY", "")
    if not re.fullmatch(r"[a-f0-9]{64}", key):
        try:
            decoded = base64.b64decode(key, validate=True)
        except (ValueError, binascii.Error):
            raise ProvisionError("existing configuration rejected") from None
        if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != key:
            raise ProvisionError("existing configuration rejected")
    if not re.fullmatch(r"[a-f0-9]{64}", values.pop("STRAVA_WEBHOOK_VERIFY_TOKEN", "")):
        raise ProvisionError("existing configuration rejected")
    if values != config.values():
        raise ProvisionError("existing configuration rejected")
    return Result.UNCHANGED


def encrypted_tokens_absent() -> bool:
    script = ("const DB=require('better-sqlite3');"
              "try{const db=new DB('/app/data/voltonaut.db',{readonly:true,fileMustExist:true});"
              "const row=db.prepare('SELECT count(*) AS n FROM strava_connections "
              "WHERE length(encrypted_tokens)>0').get();"
              "process.stdout.write(row.n===0?'empty':'blocked');db.close();}"
              "catch{process.exitCode=1;}")
    result = run_command(["docker", "exec", "voltonaut-server-1", "node", "-e", script])
    return result.code == 0 and result.stdout == b"empty"


def write_strava(path: Path, config: StravaConfig, tokens_absent=encrypted_tokens_absent) -> Result:
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(directory_fd)
        if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o022:
            raise ProvisionError("unsafe configuration directory")
        try:
            os.stat(path.name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            return strava_matches(path, config)
        if not tokens_absent():
            raise ProvisionError("existing encrypted credentials require original key")
        expected = render_values({**config.values(), "STRAVA_TOKEN_KEY": secrets.token_hex(32),
                                  "STRAVA_WEBHOOK_VERIFY_TOKEN": secrets.token_hex(32)})
        fd, staged = tempfile.mkstemp(prefix=".provision-strava-", dir=path.parent)
        staged_name = Path(staged).name
        try:
            with os.fdopen(fd, "wb") as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(expected)
                output.flush()
                os.fsync(output.fileno())
            try:
                os.link(staged_name, path.name, src_dir_fd=directory_fd,
                        dst_dir_fd=directory_fd, follow_symlinks=False)
            except FileExistsError:
                return strava_matches(path, config)
            os.fsync(directory_fd)
            return Result.CREATED
        finally:
            os.unlink(staged_name, dir_fd=directory_fd)
            os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def existing_matches(directory_fd: int, name: str, expected: bytes) -> Result:
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
        with os.fdopen(fd, "rb") as existing:
            metadata = os.fstat(existing.fileno())
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid()
                    or stat.S_IMODE(metadata.st_mode) != 0o600
                    or existing.read(len(expected) + 1) != expected):
                raise ProvisionError("existing configuration rejected")
    except OSError:
        raise ProvisionError("existing configuration rejected") from None
    return Result.UNCHANGED


def write_config(path: Path, config: EnvironmentValues) -> Result:
    expected = render_config(config)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(directory_fd)
        if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o022:
            raise ProvisionError("unsafe configuration directory")
        try:
            os.stat(path.name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            return existing_matches(directory_fd, path.name, expected)
        fd, staged = tempfile.mkstemp(prefix=".provision-env-", dir=path.parent)
        staged_name = Path(staged).name
        try:
            with os.fdopen(fd, "wb") as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(expected)
                output.flush()
                os.fsync(output.fileno())
            try:
                os.link(staged_name, path.name, src_dir_fd=directory_fd,
                        dst_dir_fd=directory_fd, follow_symlinks=False)
            except FileExistsError:
                return existing_matches(directory_fd, path.name, expected)
            os.fsync(directory_fd)
            return Result.CREATED
        finally:
            os.unlink(staged_name, dir_fd=directory_fd)
            os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def migrate_legacy(path: Path) -> Result:
    """Rewrites a provisioned single-set deploy.env into the provider-list format.

    Only the exact file this provisioner wrote before ADR-026 is accepted. The values stay the
    same; only the redirect URI moves to the provider route. The previous file is kept as
    `<name>.legacy` (same owner and mode) and an existing backup is never replaced.
    """
    values = private_values(path)
    if set(values) == set(WRITTEN_KEYS):
        parse_written(values)
        return Result.UNCHANGED
    if set(values) != set(LEGACY_KEYS) or values["OIDC_REDIRECT_URI"] != LEGACY_REDIRECT_URI:
        raise ProvisionError("existing configuration rejected")
    expected = render_config(parse_config({**values, "OIDC_REDIRECT_URI": REDIRECT_URI}))
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd, staged = tempfile.mkstemp(prefix=".provision-env-", dir=path.parent)
        staged_name = Path(staged).name
        try:
            with os.fdopen(fd, "wb") as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(expected)
                output.flush()
                os.fsync(output.fileno())
            try:
                os.link(path.name, f"{path.name}.legacy", src_dir_fd=directory_fd,
                        dst_dir_fd=directory_fd, follow_symlinks=False)
            except FileExistsError:
                raise ProvisionError("legacy backup already exists") from None
            os.replace(staged_name, path.name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
            os.fsync(directory_fd)
            return Result.MIGRATED
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(staged_name, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)


@dataclass(frozen=True, repr=False)
class CommandResult:
    code: int
    stdout: bytes


class Runner(Protocol):
    def __call__(self, argv: list[str], payload: bytes = b"") -> CommandResult: ...


def run_command(argv: list[str], payload: bytes = b"") -> CommandResult:
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG") if key in os.environ}
    try:
        completed = subprocess.run(argv, input=payload, capture_output=True,
                                   env=environment, timeout=60, check=False)
        return CommandResult(completed.returncode, completed.stdout)
    except (OSError, subprocess.SubprocessError):
        raise ProvisionError("transport failed") from None


def ssh_options() -> list[str]:
    return ["-F", "/dev/null", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "HostKeyAlias=voltonaut-production", "-o", "IdentitiesOnly=yes",
            "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", "ConnectTimeout=15", "-o", "UserKnownHostsFile=" + str(Path.home() / ".ssh/known_hosts"),
            "-i", str(Path.home() / ".ssh/id_ed25519")]


def send(user: str, host: str, config: Config | StravaConfig, runner: Runner = run_command) -> Result:
    if (not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", user)
            or len(host) > 253 or not re.fullmatch(
                r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host)
            or any(not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                   for label in host.split("."))):
        raise ProvisionError("invalid destination")
    payload = json.dumps(config.values(), ensure_ascii=True).encode("utf-8")
    parse_payload(payload)
    destination = user + "@" + host
    ssh = ["ssh", *ssh_options(), destination]
    created = runner([*ssh, "mktemp -d /srv/voltonaut/.provision-XXXXXXXXXXXX"])
    if created.code != 0:
        raise ProvisionError("remote staging failed")
    try:
        directory = created.stdout.decode("ascii").removesuffix("\n")
    except UnicodeError:
        raise ProvisionError("remote staging failed") from None
    if not re.fullmatch(r"/srv/voltonaut/\.provision-[A-Za-z0-9]{12}", directory):
        raise ProvisionError("remote staging failed")
    script = directory + "/provision_env.py"
    try:
        copied = runner(["scp", *ssh_options(), str(Path(__file__).resolve()), destination + ":" + script])
        if copied.code != 0:
            raise ProvisionError("script transfer failed")
        received = runner([*ssh, "python3 " + script + " receive"], payload)
        if received.code != 0:
            raise ProvisionError("remote provisioning failed")
        if received.stdout == b"created\n":
            return Result.CREATED
        if received.stdout == b"unchanged\n":
            return Result.UNCHANGED
        raise ProvisionError("remote result rejected")
    finally:
        cleaned = runner([*ssh, "rm -f -- " + script + " && rmdir -- " + directory])
        if cleaned.code != 0:
            raise ProvisionError("remote cleanup failed")


def main(argv: list[str]) -> int:
    try:
        if argv == ["migrate"]:
            result = migrate_legacy(TARGET)
        elif argv == ["receive"]:
            config = parse_payload(sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1))
            result = (write_strava(STRAVA_TARGET, config) if isinstance(config, StravaConfig)
                      else write_config(TARGET, config))
        elif len(argv) in (3, 4) and argv[0] == "send":
            profile = argv[3] if len(argv) == 4 else "oidc"
            if profile == "oidc":
                raw = {key: os.environ.get(key, "") for key in SECRET_KEYS}
                raw.update(AUTH_MODE="oidc", CLIENT_ORIGIN=CLIENT_ORIGIN, OIDC_REDIRECT_URI=REDIRECT_URI)
                config = parse_config(raw)
            elif profile == "strava":
                config = parse_strava(StravaConfig(os.environ.get("STRAVA_CLIENT_ID", ""),
                                      os.environ.get("STRAVA_CLIENT_SECRET", "")).values())
            else:
                raise ProvisionError("invalid command")
            result = send(argv[1], argv[2], config)
        else:
            raise ProvisionError("invalid command")
        print(result.value)
        return 0
    except (ProvisionError, OSError, UnicodeError):
        print("provisioning failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

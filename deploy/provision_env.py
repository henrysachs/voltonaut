"""Initial OIDC configuration transfer. ADR-020; never replace existing credentials."""

from dataclasses import dataclass
from enum import Enum
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from typing import Protocol
from urllib.parse import urlsplit


TARGET = Path("/srv/voltonaut/deploy.env")
MAX_PAYLOAD_BYTES = 1024 * 1024
CLIENT_ORIGIN = "https://voltonaut.stammkneipe.dev"
REDIRECT_URI = "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback"
SECRET_KEYS = ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET")


class ProvisionError(Exception):
    pass


class Result(Enum):
    CREATED = "created"
    UNCHANGED = "unchanged"


@dataclass(frozen=True, repr=False)
class Config:
    issuer: str
    client_id: str
    client_secret: str

    def values(self) -> dict[str, str]:
        return {
            "AUTH_MODE": "oidc",
            "CLIENT_ORIGIN": CLIENT_ORIGIN,
            "OIDC_REDIRECT_URI": REDIRECT_URI,
            "OIDC_ISSUER": self.issuer,
            "OIDC_CLIENT_ID": self.client_id,
            "OIDC_CLIENT_SECRET": self.client_secret,
        }


def parse_config(raw: object) -> Config:
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


def parse_payload(payload: bytes) -> Config:
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise ProvisionError("invalid configuration")
    try:
        raw: object = json.loads(payload, object_pairs_hook=json_object)
        return parse_config(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise ProvisionError("invalid configuration") from None


def render_config(config: Config) -> bytes:
    def quote(value: str) -> str:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "$$") + '"'

    return "".join(f"{key}={quote(value)}\n" for key, value in config.values().items()).encode("utf-8")


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


def write_config(path: Path, config: Config) -> Result:
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


def send(user: str, host: str, config: Config, runner: Runner = run_command) -> Result:
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
        if argv == ["receive"]:
            config = parse_payload(sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1))
            result = write_config(TARGET, config)
        elif len(argv) == 3 and argv[0] == "send":
            raw = {key: os.environ.get(key, "") for key in SECRET_KEYS}
            raw.update(AUTH_MODE="oidc", CLIENT_ORIGIN=CLIENT_ORIGIN, OIDC_REDIRECT_URI=REDIRECT_URI)
            result = send(argv[1], argv[2], parse_config(raw))
        else:
            raise ProvisionError("invalid command")
        print(result.value)
        return 0
    except (ProvisionError, OSError, UnicodeError):
        print("provisioning failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

import concurrent.futures
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

import provision_env as provision


def secret_input(secret: str = "synthetic-only") -> dict[str, str]:
    """The workflow's input format: GitHub secret names plus fixed public values."""
    return {
        "AUTH_MODE": "oidc",
        "CLIENT_ORIGIN": "https://voltonaut.stammkneipe.dev",
        "OIDC_REDIRECT_URI": "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback",
        "OIDC_ISSUER": "https://login.example.com/oidc",
        "OIDC_CLIENT_ID": "synthetic-client",
        "OIDC_CLIENT_SECRET": secret,
    }


def config(secret: str = "synthetic-only") -> provision.Config:
    return provision.parse_config(secret_input(secret))


class WriterTests(unittest.TestCase):
    def test_write_failure_never_publishes_partial_file_and_removes_own_stage(self):
        script = """
import resource
import signal
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import provision_env
config = provision_env.parse_payload(sys.stdin.buffer.read())
signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
resource.setrlimit(resource.RLIMIT_FSIZE, (1, 1))
try:
    provision_env.write_config(Path(sys.argv[2]), config)
except OSError:
    sys.exit(0)
sys.exit(2)
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"
            completed = subprocess.run([sys.executable, "-c", script, str(Path(__file__).parent), str(path)],
                                       input=json.dumps(config().values()).encode(), capture_output=True,
                                       check=False)
            self.assertEqual(completed.returncode, 0, "synthetic disk-write failure was not handled")
            self.assertEqual(completed.stdout + completed.stderr, b"")
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_staged_file_has_exact_mode_despite_restrictive_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"
            previous = os.umask(0o777)
            try:
                provision.write_config(path, config())
            finally:
                os.umask(previous)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_create_repeat_and_conflict_preserve_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"
            self.assertEqual(provision.write_config(path, config()), provision.Result.CREATED)
            original = path.read_bytes()
            inode = path.stat().st_ino
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(provision.write_config(path, config()), provision.Result.UNCHANGED)
            with self.assertRaises(provision.ProvisionError):
                provision.write_config(path, config("different"))
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_nonregular_files_and_unsafe_parent_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"
            path.mkdir(mode=0o600)
            with self.assertRaises(provision.ProvisionError):
                provision.write_config(path, config())
            path.rmdir()
            os.mkfifo(path, 0o600)
            with self.assertRaises(provision.ProvisionError):
                provision.write_config(path, config())
            self.assertTrue(stat.S_ISFIFO(path.lstat().st_mode))
            path.unlink()
            Path(directory).chmod(0o777)
            try:
                with self.assertRaises(provision.ProvisionError):
                    provision.write_config(path, config())
                self.assertFalse(path.exists())
            finally:
                Path(directory).chmod(0o700)

    @unittest.skipUnless(os.geteuid() == 0, "foreign ownership requires root; no privilege escalation")
    def test_foreign_owner_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"
            path.write_bytes(provision.render_config(config()))
            path.chmod(0o600)
            os.chown(path, 65534, -1)
            with self.assertRaises(provision.ProvisionError):
                provision.write_config(path, config())
            self.assertEqual(path.stat().st_uid, 65534)

    def test_symlink_and_insecure_mode_are_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "original"
            target.write_bytes(b"preserve")
            path = Path(directory) / "deploy.env"
            path.symlink_to(target)
            with self.assertRaises(provision.ProvisionError):
                provision.write_config(path, config())
            self.assertTrue(path.is_symlink())
            self.assertEqual(target.read_bytes(), b"preserve")
            path.unlink()
            path.write_bytes(provision.render_config(config()))
            path.chmod(0o644)
            with self.assertRaises(provision.ProvisionError):
                provision.write_config(path, config())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)

    def test_concurrent_creators_publish_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: provision.write_config(path, config()), range(24)))
            self.assertEqual(results.count(provision.Result.CREATED), 1)
            self.assertEqual(results.count(provision.Result.UNCHANGED), 23)
            self.assertEqual(path.read_bytes(), provision.render_config(config()))
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_concurrent_different_credentials_never_replace_winner(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deploy.env"

            def attempt(index: int) -> bool:
                try:
                    return provision.write_config(path, config(f"synthetic-{index}")) == provision.Result.CREATED
                except provision.ProvisionError:
                    return False

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                outcomes = list(pool.map(attempt, range(16)))
            self.assertEqual(sum(outcomes), 1)
            self.assertIn(path.read_bytes(), [provision.render_config(config(f"synthetic-{i}")) for i in range(16)])
            self.assertEqual(list(Path(directory).iterdir()), [path])


class ValidationTests(unittest.TestCase):
    def test_exact_schema_and_nonempty_strings(self):
        valid = secret_input()
        for key in valid:
            for value in (None, 42, False, [], {}, "", " \t", "a\rb", "a\nb", "a\0b"):
                with self.subTest(key=key, kind=type(value).__name__):
                    with self.assertRaises(provision.ProvisionError):
                        provision.parse_config({**valid, key: value})
            missing = valid.copy()
            del missing[key]
            with self.assertRaises(provision.ProvisionError):
                provision.parse_config(missing)
        for invalid in ([], None, {**valid, "STRAVA_CLIENT_SECRET": "forbidden"},
                        {**valid, "AUTH_MODE": "disabled"},
                        {**valid, "CLIENT_ORIGIN": "https://different.example.com"},
                        {**valid, "OIDC_REDIRECT_URI": provision.REDIRECT_URI + "?a=b"}):
            with self.assertRaises(provision.ProvisionError):
                provision.parse_config(invalid)

    def test_issuer_and_placeholders_rejected(self):
        for issuer in ("http://login.example.com", "https://localhost", "https://127.0.0.1",
                       "https://[::1]", "https://login.invalid", "https://login.example.com?",
                       "https://login.example.com/#", "https://user:pass@login.example.com",
                       "https://login.example.com:bad", "https://login.example.com:0",
                       "https://login.example.com\\elsewhere", "https://login example.com",
                       "https://invalid.", "https://127.0.0.2", "https://0.0.0.0"):
            with self.subTest(issuer=issuer), self.assertRaises(provision.ProvisionError):
                provision.parse_config({**secret_input(), "OIDC_ISSUER": issuer})
        for secret in ("changeme", "replace-me", "placeholder", "your-client-secret"):
            with self.assertRaises(provision.ProvisionError):
                config(secret)

    def test_writes_the_server_provider_list_format(self):
        self.assertEqual(config().values(), {
            "AUTH_MODE": "oidc",
            "CLIENT_ORIGIN": "https://voltonaut.stammkneipe.dev",
            "OIDC_PROVIDERS": "cloudflare",
            "OIDC_CLOUDFLARE_REDIRECT_URI":
                "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback",
            "OIDC_CLOUDFLARE_ISSUER": "https://login.example.com/oidc",
            "OIDC_CLOUDFLARE_CLIENT_ID": "synthetic-client",
            "OIDC_CLOUDFLARE_CLIENT_SECRET": "synthetic-only",
        })
        self.assertEqual(tuple(config().values()), provision.WRITTEN_KEYS)

    def test_written_payload_has_exact_schema(self):
        valid = config().values()
        for key in valid:
            for value in (None, 42, "", " \t", "a\nb"):
                with self.subTest(key=key, value=value), self.assertRaises(provision.ProvisionError):
                    provision.parse_payload(json.dumps({**valid, key: value}).encode())
            missing = valid.copy()
            del missing[key]
            with self.subTest(missing=key), self.assertRaises(provision.ProvisionError):
                provision.parse_payload(json.dumps(missing).encode())
        for invalid in ({**valid, "OIDC_PROVIDERS": "cloudflare,authentik"},
                        {**valid, "OIDC_PROVIDERS": "authentik"},
                        {**valid, "OIDC_CLOUDFLARE_REDIRECT_URI":
                            "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback"},
                        {**valid, "OIDC_ISSUER": "https://login.example.com/oidc"},
                        secret_input()):
            with self.subTest(invalid=sorted(invalid)), self.assertRaises(provision.ProvisionError):
                provision.parse_payload(json.dumps(invalid).encode())

    def test_legacy_single_set_redirect_uri_is_rejected_as_input(self):
        legacy = {**secret_input(), "OIDC_REDIRECT_URI":
                  "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback"}
        with self.assertRaises(provision.ProvisionError):
            provision.parse_config(legacy)

    def test_bounded_json_and_duplicate_fields(self):
        for payload in (b"{", b"\xff", b"[]", b" " * (provision.MAX_PAYLOAD_BYTES + 1),
                        b'{"AUTH_MODE":"disabled","AUTH_MODE":"oidc"}'):
            with self.assertRaises(provision.ProvisionError):
                provision.parse_payload(payload)
        original = config(" $'\"\\\tGrüße ")
        decoded = provision.parse_payload(json.dumps(original.values()).encode())
        self.assertEqual(decoded.values(), original.values())
        self.assertNotIn(original.client_secret, repr(original))

    def test_receiver_invalid_payload_has_constant_logs_and_no_traceback(self):
        secret = "synthetic-invalid-credential"
        payload = json.dumps({**config(secret).values(), "AUTH_MODE": "disabled"}).encode()
        completed = subprocess.run(["python3", str(Path(provision.__file__)), "receive"],
                                   input=payload, capture_output=True, check=False)
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr, b"provisioning failed\n")


def legacy_values(secret: str = "synthetic-only") -> dict[str, str]:
    """The exact deploy.env this provisioner wrote before ADR-025."""
    return {**secret_input(secret), "OIDC_REDIRECT_URI": provision.LEGACY_REDIRECT_URI}


class MigrationTests(unittest.TestCase):
    def write(self, directory: str, values: dict[str, str]) -> Path:
        path = Path(directory) / "deploy.env"
        path.write_bytes(provision.render_values(values))
        path.chmod(0o600)
        return path

    def test_migrates_the_legacy_file_once_and_keeps_a_private_backup(self):
        for secret in ("x", " $'\"\\Grüße\t ", "${DO_NOT_EXPAND}$USER$$"):
            with self.subTest(secret=secret), tempfile.TemporaryDirectory() as directory:
                path = self.write(directory, legacy_values(secret))
                original = path.read_bytes()
                self.assertEqual(provision.migrate_legacy(path), provision.Result.MIGRATED)
                self.assertEqual(provision.private_values(path), config(secret).values())
                backup = path.with_name("deploy.env.legacy")
                self.assertEqual(backup.read_bytes(), original)
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
                self.assertEqual(provision.migrate_legacy(path), provision.Result.UNCHANGED)
                self.assertEqual(backup.read_bytes(), original)
                self.assertEqual(sorted(p.name for p in Path(directory).iterdir()),
                                 ["deploy.env", "deploy.env.legacy"])

    def test_rejects_anything_but_the_exact_legacy_file_without_changes(self):
        invalid = (
            {**legacy_values(), "LITESTREAM_BUCKET": "synthetic"},
            {**legacy_values(), "OIDC_REDIRECT_URI": provision.REDIRECT_URI},
            {**legacy_values(), "OIDC_ISSUER": "http://login.example.com"},
            {**legacy_values(), "AUTH_MODE": "disabled"},
            legacy_values("changeme"),
            {key: value for key, value in legacy_values().items() if key != "OIDC_CLIENT_ID"},
            {**config().values(), "OIDC_PROVIDERS": "cloudflare,authentik"},
        )
        for values in invalid:
            with self.subTest(keys=sorted(values)), tempfile.TemporaryDirectory() as directory:
                path = self.write(directory, values)
                original = path.read_bytes()
                with self.assertRaises(provision.ProvisionError):
                    provision.migrate_legacy(path)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual([p.name for p in Path(directory).iterdir()], ["deploy.env"])

    def test_never_replaces_an_existing_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write(directory, legacy_values())
            original = path.read_bytes()
            backup = path.with_name("deploy.env.legacy")
            backup.write_bytes(b"earlier")
            with self.assertRaises(provision.ProvisionError):
                provision.migrate_legacy(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(backup.read_bytes(), b"earlier")
            self.assertEqual(sorted(p.name for p in Path(directory).iterdir()),
                             ["deploy.env", "deploy.env.legacy"])

    def test_rejects_unsafe_existing_file_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write(directory, legacy_values())
            path.chmod(0o644)
            with self.assertRaises(provision.ProvisionError):
                provision.migrate_legacy(path)
            self.assertEqual([p.name for p in Path(directory).iterdir()], ["deploy.env"])


class FakeRunner:
    def __init__(self, fail_at: int = -1, response: bytes = b"created\n"):
        self.calls: list[tuple[list[str], bytes]] = []
        self.fail_at = fail_at
        self.response = response

    def __call__(self, argv: list[str], payload: bytes = b"") -> provision.CommandResult:
        index = len(self.calls)
        self.calls.append((argv, payload))
        if index == self.fail_at:
            return provision.CommandResult(1, b"synthetic-secret-error")
        if index == 0:
            return provision.CommandResult(0, b"/srv/voltonaut/.provision-012345abcdef\n")
        if payload:
            return provision.CommandResult(0, self.response)
        return provision.CommandResult(0, b"")


class TransportTests(unittest.TestCase):
    def test_secrets_only_in_receiver_stdin_and_host_checks_always_pinned(self):
        runner = FakeRunner()
        cfg = config("synthetic-secret-$'\\")
        self.assertEqual(provision.send("voltonaut-deploy", "192.0.2.1", cfg, runner), provision.Result.CREATED)
        self.assertEqual(len(runner.calls), 4)
        for argv, payload in runner.calls:
            self.assertNotIn(cfg.client_secret, " ".join(argv))
            self.assertIn("BatchMode=yes", argv)
            self.assertIn("StrictHostKeyChecking=yes", argv)
            self.assertIn("HostKeyAlias=voltonaut-production", argv)
            self.assertNotIn("StrictHostKeyChecking=no", argv)
            self.assertNotIn("rm -rf", " ".join(argv))
            if payload:
                self.assertTrue(argv[-1].endswith("/provision_env.py receive"))
                self.assertEqual(provision.parse_payload(payload).values(), cfg.values())
        self.assertEqual(sum(bool(payload) for _, payload in runner.calls), 1)
        self.assertIn("rmdir -- /srv/voltonaut/.provision-012345abcdef", runner.calls[-1][0][-1])

    def test_transport_failure_and_untrusted_output_do_not_log_secrets(self):
        for fail_at in (1, 2, 3):
            runner = FakeRunner(fail_at=fail_at)
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                with self.assertRaises(provision.ProvisionError) as error:
                    provision.send("voltonaut-deploy", "api.example.com", config(), runner)
            self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
            self.assertNotIn("synthetic-secret-error", str(error.exception))
            self.assertTrue(runner.calls[-1][0][-1].startswith("rm -f -- "))
        runner = FakeRunner(response=b"synthetic-secret-error")
        with self.assertRaises(provision.ProvisionError):
            provision.send("voltonaut-deploy", "api.example.com", config(), runner)
        self.assertEqual(len(runner.calls), 4)

    def test_invalid_destination_and_configuration_never_reach_transport(self):
        runner = FakeRunner()
        for user, host in (("-oProxyCommand=bad", "example.com"), ("user;id", "example.com"),
                           ("user", "-oBad"), ("user", "host;id"), ("user", "x\ny"),
                           ("user", "a..com"), ("user", "a/b"), ("user", "$(id)")):
            with self.assertRaises(provision.ProvisionError):
                provision.send(user, host, config(), runner)
        with self.assertRaises(provision.ProvisionError):
            provision.send("user", "example.com", provision.Config("http://bad", "id", "secret"), runner)
        self.assertEqual(runner.calls, [])

    def test_unchanged_is_success(self):
        self.assertEqual(provision.send("user", "api.example.com", config(),
                                        FakeRunner(response=b"unchanged\n")), provision.Result.UNCHANGED)


class ComposeTests(unittest.TestCase):
    def test_actual_compose_preserves_literal_credentials(self):
        compose = Path(__file__).parent / "compose.yaml"
        environment = {key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ}
        environment["VOLTONAUT_TAG"] = "synthetic-only"
        for secret in ("x", " $'\"\\Grüße\t ", "${DO_NOT_EXPAND}$USER$$", "ends\\", "\\'\\\"\\n\\t#=;:"):
            with self.subTest(case=secret), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "deploy.env"
                provision.write_config(path, config(secret))
                argv = ["docker", "compose", "--env-file", str(path), "-f", str(compose), "config"]
                quiet = subprocess.run([*argv, "--quiet"], capture_output=True, env=environment, check=False)
                self.assertEqual(quiet.returncode, 0, "real Compose quiet validation failed")
                self.assertEqual(quiet.stdout, b"")
                decoded = subprocess.run([*argv, "--format", "json"], capture_output=True,
                                         env=environment, check=False)
                self.assertEqual(decoded.returncode, 0, "real Compose decoding failed")
                document = json.loads(decoded.stdout)
                actual = document["services"]["server"]["environment"]
                interpolation = subprocess.run([*argv, "--environment"], capture_output=True,
                                               env=environment, check=False)
                self.assertEqual(interpolation.returncode, 0, "real Compose environment decoding failed")
                resolved = dict(line.split("=", 1) for line in interpolation.stdout.decode().splitlines())
                for key, value in config(secret).values().items():
                    self.assertEqual(resolved[key], value)
                    if "$" not in value:
                        self.assertEqual(actual[key], value)
                self.assertEqual(actual["CORS_ORIGINS"], provision.CLIENT_ORIGIN)


if __name__ == "__main__":
    unittest.main()

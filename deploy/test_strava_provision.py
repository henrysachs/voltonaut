import concurrent.futures
import base64
import json
import os
from pathlib import Path
import stat
import sqlite3
import subprocess
import tempfile
import unittest

import provision_env as provision
import strava_subscription as subscription


def config(secret="synthetic-$'\"\\-only"):
    return provision.parse_strava(provision.StravaConfig("123", secret).values())


class StravaProvisionTests(unittest.TestCase):
    def test_existing_canonical_base64_token_key_is_retained_without_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            provision.write_strava(path, config(), lambda: True)
            values = provision.private_values(path)
            values["STRAVA_TOKEN_KEY"] = base64.b64encode(bytes.fromhex(values["STRAVA_TOKEN_KEY"])).decode("ascii")
            original = provision.render_values(values)
            path.write_bytes(original)
            self.assertEqual(provision.write_strava(path, config(), lambda: False), provision.Result.UNCHANGED)
            self.assertEqual(path.read_bytes(), original)

    def test_key_loss_preserves_actual_sqlite_cipher_and_ownership_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = sqlite3.connect(root / "existing.db")
            database.executescript("CREATE TABLE strava_connections(user_id TEXT, encrypted_tokens TEXT);"
                                   "INSERT INTO strava_connections VALUES ('owner','original-cipher');"
                                   "CREATE TABLE rides(user_id TEXT,payload TEXT);"
                                   "INSERT INTO rides VALUES ('owner','original-recording');")
            before = list(database.iterdump())
            with self.assertRaises(provision.ProvisionError):
                provision.write_strava(root / "strava.env", config(), lambda: database.execute(
                    "SELECT count(*) FROM strava_connections WHERE length(encrypted_tokens)>0").fetchone()[0] == 0)
            self.assertEqual(list(database.iterdump()), before)
            self.assertFalse((root / "strava.env").exists())
            database.close()

    def test_create_repeat_retains_keys_and_oidc_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            oidc = Path(directory) / "deploy.env"
            oidc.write_bytes(b"never touch existing OIDC\n")
            self.assertEqual(provision.write_strava(path, config(), lambda: True), provision.Result.CREATED)
            original = path.read_bytes()
            values = provision.private_values(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertRegex(values["STRAVA_TOKEN_KEY"], "^[a-f0-9]{64}$")
            self.assertRegex(values["STRAVA_WEBHOOK_VERIFY_TOKEN"], "^[a-f0-9]{64}$")
            self.assertNotEqual(values["STRAVA_TOKEN_KEY"], values["STRAVA_WEBHOOK_VERIFY_TOKEN"])
            self.assertEqual(provision.write_strava(path, config(), lambda: False), provision.Result.UNCHANGED)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(oidc.read_bytes(), b"never touch existing OIDC\n")
            with self.assertRaises(provision.ProvisionError):
                provision.write_strava(path, config("different"), lambda: True)
            self.assertEqual(path.read_bytes(), original)

    def test_concurrent_losers_adopt_winner_not_their_new_random_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: provision.write_strava(path, config(), lambda: True), range(32)))
            self.assertEqual(results.count(provision.Result.CREATED), 1)
            self.assertEqual(results.count(provision.Result.UNCHANGED), 31)
            self.assertEqual(list(Path(directory).iterdir()), [path])
            self.assertEqual(provision.strava_matches(path, config()), provision.Result.UNCHANGED)

    def test_missing_original_key_with_ciphers_or_unavailable_database_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            for predicate in (lambda: False, lambda: None):
                with self.assertRaises(provision.ProvisionError):
                    provision.write_strava(path, config(), predicate)
                self.assertFalse(path.exists())
            provision.write_strava(path, config(), lambda: True)
            values = provision.private_values(path)
            del values["STRAVA_TOKEN_KEY"]
            broken = provision.render_values(values)
            path.write_bytes(broken)
            with self.assertRaises(provision.ProvisionError):
                provision.write_strava(path, config(), lambda: True)
            self.assertEqual(path.read_bytes(), broken)

    def test_unsafe_files_symlinks_modes_and_noncanonical_content_stay_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            provision.write_strava(path, config(), lambda: True)
            original = path.read_bytes()
            for unsafe in (original + b"STRAVA_MODE=disabled\n", original.replace(b'enabled', b'disabled'),
                           original.replace(b'STRAVA_TOKEN_KEY="', b'STRAVA_TOKEN_KEY="z'),
                           b"$(do-not-run)\n", original + b"OIDC_CLIENT_SECRET=forbidden\n"):
                path.write_bytes(unsafe)
                with self.assertRaises(provision.ProvisionError):
                    provision.write_strava(path, config(), lambda: True)
                self.assertEqual(path.read_bytes(), unsafe)
            path.write_bytes(original)
            path.chmod(0o644)
            with self.assertRaises(provision.ProvisionError):
                provision.write_strava(path, config(), lambda: True)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
            path.unlink()
            other = Path(directory) / "other"
            other.write_bytes(b"preserve")
            path.symlink_to(other)
            with self.assertRaises(provision.ProvisionError):
                provision.write_strava(path, config(), lambda: True)
            self.assertTrue(path.is_symlink())
            self.assertEqual(other.read_bytes(), b"preserve")

    @unittest.skipUnless(os.geteuid() == 0, "foreign ownership requires root; no privilege escalation")
    def test_foreign_owner_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            provision.write_strava(path, config(), lambda: True)
            original = path.read_bytes()
            os.chown(path, 65534, -1)
            with self.assertRaises(provision.ProvisionError):
                provision.write_strava(path, config(), lambda: True)
            self.assertEqual(path.read_bytes(), original)

    def test_sender_accepts_only_fixed_static_profile_and_never_receiver_keys(self):
        values = config().values()
        self.assertEqual(provision.parse_payload(json.dumps(values).encode()).values(), values)
        for invalid in ({**values, "STRAVA_TOKEN_KEY": "a" * 64},
                        {**values, "STRAVA_WEBHOOK_VERIFY_TOKEN": "b" * 64},
                        {**values, "AUTH_MODE": "oidc"},
                        {**values, "RIDE_SOURCE_POLICY": "disabled"},
                        {**values, "STRAVA_REDIRECT_URI": provision.STRAVA_REDIRECT_URI + "?secret=x"},
                        {**values, "STRAVA_CLIENT_SECRET": "bad\nsecret"}):
            with self.assertRaises(provision.ProvisionError):
                provision.parse_payload(json.dumps(invalid).encode())
        self.assertNotIn(config().client_secret, repr(config()))

    def test_actual_compose_and_node_process_preserve_opaque_values(self):
        compose = Path(__file__).parent / "compose.yaml"
        environment = {key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava.env"
            provision.write_strava(path, config("x$USER${PRIVATE}$$'\"\\end"), lambda: True)
            decoded = subscription.local_values(path)
            self.assertEqual(decoded["STRAVA_CLIENT_SECRET"], config("x$USER${PRIVATE}$$'\"\\end").client_secret)
            # Use the actual Compose env_file runtime, not serialized `config` dollar escaping.
            runtime = Path(directory) / "runtime.yaml"
            runtime.write_text("services:\n  probe:\n    image: node:24.22.3-bookworm-slim\n"
                               "    env_file:\n      - path: ./strava.env\n    entrypoint: [node, -e]\n"
                               "    command: ['process.stdout.write(JSON.stringify({secret:process.env.STRAVA_CLIENT_SECRET,key:process.env.STRAVA_TOKEN_KEY}))']\n")
            result = subprocess.run(["docker", "compose", "-f", str(runtime), "run", "--rm", "--no-deps", "probe"],
                                    capture_output=True, env=environment, timeout=120, check=False)
            self.assertEqual(result.returncode, 0, "actual Compose Node probe failed")
            actual = json.loads(result.stdout)
            self.assertEqual(actual["secret"], decoded["STRAVA_CLIENT_SECRET"])
            self.assertEqual(actual["key"], provision.private_values(path)["STRAVA_TOKEN_KEY"])
            environment.update(VOLTONAUT_TAG="synthetic", AUTH_MODE="disabled", CLIENT_ORIGIN=provision.CLIENT_ORIGIN,
                               STRAVA_MODE="enabled", STRAVA_CLIENT_SECRET="must-not-be-forwarded")
            result = subprocess.run(["docker", "compose", "-f", str(compose), "config", "--format", "json"],
                                    capture_output=True, env=environment, check=False)
            self.assertEqual(result.returncode, 0)
            server = json.loads(result.stdout)["services"]["server"]
            self.assertNotIn("STRAVA_MODE", server["environment"])
            self.assertNotIn("STRAVA_CLIENT_SECRET", server["environment"])


if __name__ == "__main__":
    unittest.main()

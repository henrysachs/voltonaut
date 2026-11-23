import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

import provision_env as provision
import strava_subscription as subscription


class Peer:
    def __init__(self):
        self.rows = []
        self.posts = 0
        self.gets = 0
        self.fault = "none"
        self.bad_credentials = 0
        self.verify_token = "b" * 64
        peer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, body, status=200):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

            def valid(self, fields):
                valid = fields.get("client_id") == ["123"] and fields.get("client_secret") == ["synthetic-$only"]
                if not valid:
                    peer.bad_credentials += 1
                    self.reply({}, 401)
                return valid

            def do_GET(self):
                peer.gets += 1
                if not self.valid(parse_qs(urlsplit(self.path).query)):
                    return
                if peer.fault == "list":
                    self.reply({}, 503)
                else:
                    self.reply(peer.rows)

            def do_POST(self):
                fields = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
                if not self.valid(fields):
                    return
                peer.posts += 1
                if fields.get("callback_url") != [subscription.CALLBACK] or fields.get("verify_token") != [peer.verify_token]:
                    self.reply({}, 400)
                    return
                if peer.rows:
                    self.reply({}, 400)
                    return
                peer.rows = [{"id": 1234, "application_id": 123, "callback_url": subscription.CALLBACK}]
                if peer.fault == "lost":
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                else:
                    self.reply({"id": 1234}, 201)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.provider = subscription.HttpProvider({"STRAVA_CLIENT_ID": "123", "STRAVA_CLIENT_SECRET": "synthetic-$only",
                                                   "STRAVA_WEBHOOK_VERIFY_TOKEN": "b" * 64},
                                                  f"http://127.0.0.1:{self.server.server_port}/api/v3/push_subscriptions")

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


class SubscriptionTests(unittest.TestCase):
    def test_exact_transferred_operator_bundle_runs_with_private_files_and_real_http(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "reviewed-operator"
            bundle.mkdir(mode=0o700)
            for name in ("strava_subscription.py", "provision_env.py"):
                shutil.copyfile(Path(__file__).parent / name, bundle / name)
            config = root / "strava.env"
            provision.write_strava(config, provision.StravaConfig("123", "synthetic-$only"), lambda: True)
            original = config.read_bytes()
            peer = Peer()
            self.addCleanup(peer.close)
            peer.verify_token = provision.private_values(config)["STRAVA_WEBHOOK_VERIFY_TOKEN"]
            driver = '''
import json,sys
from pathlib import Path
import strava_subscription as operator
settings=json.load(sys.stdin)
sys.exit(operator.main(["register"], lambda: operator.local_values(Path(settings["config"])),
                       lambda values: operator.HttpProvider(values, settings["endpoint"]),
                       Path(settings["target"])))
'''
            settings = {"config": str(config), "target": str(root / "strava-webhook.env"),
                        "endpoint": f"http://127.0.0.1:{peer.server.server_port}/api/v3/push_subscriptions"}
            for expected in (b"created\n", b"unchanged\n"):
                completed = subprocess.run([sys.executable, "-c", driver], cwd=bundle,
                                           input=json.dumps(settings).encode(), capture_output=True, check=False)
                self.assertEqual(completed.returncode, 0, "transferred operator bundle failed")
                self.assertEqual(completed.stdout, expected)
                self.assertEqual(completed.stderr, b"")
            self.assertEqual(config.read_bytes(), original)
            self.assertEqual(peer.posts, 1)
            invalid = subprocess.run([sys.executable, "strava_subscription.py", "invalid"], cwd=bundle,
                                     capture_output=True, check=False)
            self.assertEqual(invalid.returncode, 1)
            self.assertEqual(invalid.stdout, b"")
            self.assertEqual(invalid.stderr, b"subscription registration failed; reconcile before retry\n")

    def test_strict_states_and_foreign_callbacks(self):
        self.assertEqual(subscription.subscriptions([], "123").state, subscription.State.ABSENT)
        for invalid in (None, {}, [None], [{"id": True}], [{"id": 1, "application_id": 124, "callback_url": subscription.CALLBACK}]):
            self.assertEqual(subscription.subscriptions(invalid, "123").state, subscription.State.UNKNOWN)
        self.assertEqual(subscription.subscriptions([{"id": 1, "application_id": 123, "callback_url": "https://foreign.example/hook"}], "123").state,
                         subscription.State.CONFLICTING)

    def test_real_http_create_adopt_and_lost_response_reconcile_without_second_post(self):
        for fault in ("none", "lost"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                peer = Peer()
                self.addCleanup(peer.close)
                peer.fault = fault
                path = Path(directory) / "strava-webhook.env"
                oidc = Path(directory) / "deploy.env"
                key = Path(directory) / "strava.env"
                oidc.write_bytes(b"OIDC-original")
                key.write_bytes(b"key-original")
                self.assertEqual(subscription.register(peer.provider, path), provision.Result.CREATED)
                original = path.read_bytes()
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(provision.private_values(path), {"STRAVA_WEBHOOK_SUBSCRIPTION_ID": "1234"})
                self.assertEqual(subscription.register(peer.provider, path), provision.Result.UNCHANGED)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(peer.posts, 1)
                self.assertEqual(peer.bad_credentials, 0)
                self.assertEqual(oidc.read_bytes(), b"OIDC-original")
                self.assertEqual(key.read_bytes(), b"key-original")

    def test_conflict_unknown_or_saved_mismatch_never_create_delete_or_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "strava-webhook.env"
            peer = Peer()
            self.addCleanup(peer.close)
            peer.rows = [{"id": 9, "application_id": 123, "callback_url": "https://foreign.example/hook"}]
            with self.assertRaises(provision.ProvisionError):
                subscription.register(peer.provider, path)
            self.assertEqual(peer.posts, 0)
            self.assertFalse(path.exists())
            peer.fault = "list"
            with self.assertRaises(provision.ProvisionError):
                subscription.register(peer.provider, path)
            self.assertEqual(peer.posts, 0)
            peer.fault = "none"
            peer.rows = []
            provision.write_config(path, subscription.Registration(9))
            original = path.read_bytes()
            with self.assertRaises(provision.ProvisionError):
                subscription.register(peer.provider, path)
            self.assertEqual(peer.posts, 0)
            self.assertEqual(path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()

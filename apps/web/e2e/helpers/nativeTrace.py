import collections
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    events = json.load(source)["traceEvents"]

threads = {
    (event["pid"], event["tid"]): event.get("args", {}).get("name", "")
    for event in events
    if event["name"] == "thread_name"
}


def public_event(event):
    data = event.get("args", {}).get("data", {})
    return {
        "thread": threads.get((event["pid"], event["tid"])),
        "pid": event["pid"],
        "tid": event["tid"],
        "name": event["name"],
        "startUs": event["ts"],
        "durationUs": event.get("dur"),
        "function": data.get("functionName"),
        "path": data.get("url", "").split("?")[0],
    }


longest = sorted(
    (event for event in events if event["ph"] == "X" and event.get("dur", 0) >= 10000),
    key=lambda event: event["dur"],
    reverse=True,
)
native = [event for event in longest if any(
    part in event["name"].lower()
    for part in ("read", "shader", "compile", "linkprogram", "present", "offscreen")
)]
samples = collections.Counter()
profiles = {}
profile_threads = {
    (event["pid"], event.get("id")): (event["pid"], event["tid"])
    for event in events if event["name"] == "Profile"
}
for event in events:
    profile = event.get("args", {}).get("data", {}).get("cpuProfile", {})
    profile_key = (event["pid"], event.get("id"))
    nodes = profiles.setdefault(profile_key, {})
    for node in profile.get("nodes", []):
        frame = node.get("callFrame", {})
        owner = profile_threads.get(profile_key, (event["pid"], event["tid"]))
        key = (threads.get(owner), owner[1], frame.get("functionName"), frame.get("url", "").split("?")[0])
        nodes[node["id"]] = key
    for node_id in profile.get("samples", []):
        samples[nodes.get(node_id, (None, 0, "unresolved", ""))] += 1

print(json.dumps({
    "event": "native-first-frame-summary",
    "eventCount": len(events),
    "longest": [public_event(event) for event in longest[:40]],
    "native": [public_event(event) for event in native[:30]],
    "samples": [{"thread": key[0], "tid": key[1], "function": key[2], "path": key[3], "hits": count} for key, count in samples.most_common(20)],
}, separators=(",", ":")))

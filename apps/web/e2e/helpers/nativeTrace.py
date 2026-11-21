import collections
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    events = json.load(source)["traceEvents"]

stacks = collections.defaultdict(list)
completed = []
for event in sorted(events, key=lambda event: event["ts"]):
    key = (event["pid"], event["tid"])
    if event["ph"] == "B":
        stacks[key].append(event)
    elif event["ph"] == "E" and stacks[key]:
        start = stacks[key].pop()
        completed.append({**start, "ph": "X", "dur": event["ts"] - start["ts"]})
events.extend(completed)

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
        "phase": event["ph"],
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
native_pattern = re.compile(r"readpixels|readback|shader|compile|linkprogram|present|offscreen|drawingbuffer|getresourceforpushframe|getprogramiv|waitfor", re.I)
native = [event for event in longest if native_pattern.search(event["name"])]
open_spans = [event for stack in stacks.values() for event in stack]
marks = [event for event in events if event["name"].startswith("FIRST-FRAME-PIPELINE")]
worker_callbacks = [event for event in events if event["name"] == "FunctionCall" and
    re.search(r"/world/render-(worker|loop)\.ts", event.get("args", {}).get("data", {}).get("url", ""))]
worker_callbacks.sort(key=lambda event: event["ts"])
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
    "openSpans": [public_event(event) for event in open_spans[:20]],
    "marks": [public_event(event) for event in marks[:10]],
    "workerCallbacks": [public_event(event) for event in worker_callbacks[:12]],
    "samples": [{"thread": key[0], "tid": key[1], "function": key[2], "path": key[3], "hits": count} for key, count in samples.most_common(20)],
}, separators=(",", ":")))

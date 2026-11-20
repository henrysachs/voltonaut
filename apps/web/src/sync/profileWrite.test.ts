import { DEFAULT_RIDER_PROFILE, type StoredProfileRecord } from "@voltonaut/shared";
import { expect, it, vi } from "vitest";
import { writeProfileRecord } from "./profileWrite.js";

const record: StoredProfileRecord = Object.freeze({
  schemaVersion: 1,
  profile: DEFAULT_RIDER_PROFILE,
});

function createWrite() {
  const request = new EventTarget();
  const put = vi.fn<(record: StoredProfileRecord, key: string) => EventTarget>(() => request);
  const events = new EventTarget();

  const abort = vi.fn<() => void>(() => {
    events.dispatchEvent(new Event("abort"));
  });

  const transaction = Object.assign(events, {
    abort,
    objectStore: vi.fn<(name: string) => Readonly<{ put: typeof put }>>(() => ({ put })),
  });

  const database = {
    transaction: vi.fn<(name: string, mode: "readwrite") => typeof transaction>(() => transaction),
  };

  const controller = new AbortController();
  const current = vi.fn<() => boolean>(() => true);
  const lease = { signal: controller.signal, current };

  return { database, transaction, request, put, abort, controller, current, lease };
}

it("keeps a successful put pending until the transaction commits", async () => {
  const write = createWrite();
  let committed = false;

  const saving = writeProfileRecord(write.database, record).then(() => {
    committed = true;

    return committed;
  });

  expect(write.database.transaction).toHaveBeenCalledWith("profile", "readwrite");
  expect(write.put).toHaveBeenCalledWith(record, "current");
  write.request.dispatchEvent(new Event("success"));
  await Promise.resolve();
  await Promise.resolve();
  expect(committed).toBe(false);
  write.transaction.dispatchEvent(new Event("complete"));
  await saving;
  expect(committed).toBe(true);
  expect(write.abort).not.toHaveBeenCalled();
});

it("does not start an already aborted write", async () => {
  const write = createWrite();
  write.controller.abort();

  await expect(writeProfileRecord(write.database, record, write.lease)).rejects.toThrow(Error);
  expect(write.database.transaction).not.toHaveBeenCalled();
  expect(write.put).not.toHaveBeenCalled();
});

it("does not start an already superseded write", async () => {
  const write = createWrite();
  write.current.mockReturnValue(false);

  await expect(writeProfileRecord(write.database, record, write.lease)).rejects.toThrow(Error);
  expect(write.database.transaction).not.toHaveBeenCalled();
});

it.each([[], ["success"]])(
  "aborts revocation after request events %j",
  async (...events: readonly string[]) => {
    const write = createWrite();
    const saving = writeProfileRecord(write.database, record, write.lease);
    events.forEach((event) => {
      write.request.dispatchEvent(new Event(event));
    });
    write.controller.abort();

    await expect(saving).rejects.toThrow(Error);
    expect(write.abort).toHaveBeenCalledOnce();
  },
);

it("rejects revocation when native abort reports an already finished transaction", async () => {
  const write = createWrite();
  write.abort.mockImplementation(() => {
    throw new DOMException("Already finished", "InvalidStateError");
  });
  const saving = writeProfileRecord(write.database, record, write.lease);

  expect(() => {
    write.controller.abort();
  }).not.toThrow();
  await expect(saving).rejects.toThrow(Error);
});

it("aborts when ownership changes before put success", async () => {
  const write = createWrite();
  const saving = writeProfileRecord(write.database, record, write.lease);
  write.current.mockReturnValue(false);
  write.request.dispatchEvent(new Event("success"));

  await expect(saving).rejects.toThrow(Error);
  expect(write.abort).toHaveBeenCalledOnce();
});

it("rejects ownership lost just before transaction completion", async () => {
  const write = createWrite();
  const saving = writeProfileRecord(write.database, record, write.lease);
  write.request.dispatchEvent(new Event("success"));
  write.current.mockReturnValue(false);
  write.transaction.dispatchEvent(new Event("complete"));

  await expect(saving).rejects.toThrow(Error);
});

it("rejects a native transaction abort", async () => {
  const write = createWrite();
  const saving = writeProfileRecord(write.database, record, write.lease);
  write.transaction.dispatchEvent(new Event("abort"));

  await expect(saving).rejects.toThrow(Error);
});

it("aborts and rejects when the object store refuses put", async () => {
  const write = createWrite();
  write.put.mockImplementation(() => {
    throw new DOMException("Read only", "ReadOnlyError");
  });

  await expect(writeProfileRecord(write.database, record, write.lease)).rejects.toThrow(Error);
  expect(write.abort).toHaveBeenCalledOnce();
});

it.each([
  { event: "complete", result: "committed" },
  { event: "abort", result: "rejected" },
])(
  "detaches listeners after $event",
  async ({ event, result }: Readonly<{ event: string; result: string }>) => {
    const write = createWrite();
    const removeLease = vi.spyOn(write.lease.signal, "removeEventListener");
    const removeTransaction = vi.spyOn(write.transaction, "removeEventListener");

    const saving = writeProfileRecord(write.database, record, write.lease).then(
      () => "committed",
      () => "rejected",
    );

    write.transaction.dispatchEvent(new Event(event));
    expect(await saving).toBe(result);
    expect(removeLease).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeTransaction).toHaveBeenCalledWith("complete", expect.any(Function));
    expect(removeTransaction).toHaveBeenCalledWith("abort", expect.any(Function));
    write.controller.abort();
    expect(write.abort).not.toHaveBeenCalled();
  },
);

it("rejects an invalid profile before opening a transaction", async () => {
  const write = createWrite();
  const invalid = { ...record, profile: { ...record.profile, massKg: 5000 } };

  await expect(writeProfileRecord(write.database, invalid)).rejects.toThrow(Error);
  expect(write.database.transaction).not.toHaveBeenCalled();
});

const nativeFetch = globalThis.fetch;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fetch boundary forwards native Request/RequestInit objects unchanged.
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

  if (url.protocol !== "http:" || !loopback) {
    process.stderr.write("Verification blocked unexpected external network request.\n");
    process.exitCode = 1;
    throw new Error("verification permits loopback HTTP only");
  }

  return nativeFetch(input, init);
};

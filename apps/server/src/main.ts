// Thin dispatcher: ESM evaluates static imports before any code runs, so each command loads only
// its own module graph. `check-config` and `admin` must not pull in Nest's HTTP stack.
const args = process.argv.slice(2);

if (args.length === 0) {
  const { bootstrap } = await import("./server-boot.js");

  await bootstrap();
} else if (args[0] === "admin") {
  const { adminMain } = await import("./admin.js");

  adminMain(args.slice(1));
} else if (args[0] === "check-config") {
  const { checkConfigMain } = await import("./check-config.js");

  checkConfigMain(args.slice(1));
} else
  throw new Error(
    "usage: node dist/main.js [admin list [cursor] | admin grant|revoke <userId> | admin credit --operator <adminUserId> <userId> <volts> <reference> | check-config]",
  );

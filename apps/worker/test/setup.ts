import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Writes send outbox notes through the queue, whose consumer runs up to ~1 s later (batch
// timeout). A file can finish while a delivery is still loading code, and the pool then
// fails on teardown ("Closing rpc while 'resolve' was pending") although every test passed.
// Let those deliveries settle before the file's environment closes.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 2500));
});

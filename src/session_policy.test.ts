import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewBody, reviewSessions } from "./session_inventory.ts";

test("release review keeps the caller and revokes each other session once", async () => {
  const revoked: string[] = [];
  const inventory = {
    async list() { return [{ session_id: "console" }, { session_id: "old-laptop" }, { session_id: "old-laptop" }]; },
    async revoke(id: string) { revoked.push(id); }
  };
  const input = reviewBody.parse({ action: "sign_out_others", context: { kind: "release", operation: "prepare" } });
  const result = await reviewSessions(inventory, "developer", "console", input);
  assert.deepEqual(revoked, ["old-laptop"]);
  assert.deepEqual(result.active, [{ session_id: "console" }]);
});

test("an absent caller prevents every revocation", async () => {
  let writes = 0;
  await assert.rejects(reviewSessions({
    async list() { return [{ session_id: "other" }]; },
    async revoke() { writes += 1; }
  }, "developer", "missing", reviewBody.parse({
    action: "sign_out_others", context: { kind: "diagnostic", level: "info" }
  })), { message: "Session request rejected" });
  assert.equal(writes, 0);
});

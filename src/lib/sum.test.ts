import test from "node:test";
import assert from "node:assert/strict";

import { sum } from "./sum";

test("sum returns the total of two numbers", () => {
  assert.equal(sum(2, 3), 5);
});

import assert from "node:assert/strict";
import test from "node:test";

import { rollupDay, rollupStatement } from "../src/rollup.js";

test("rollupDay upserts the database current day and maps the returned columns", async () => {
  const calls = [];
  const database = {
    query: async (statement, values) => {
      calls.push({ statement, values });
      return { rows: [{ day: "2026-11-18", orders: 4, revenue_cents: 12900 }] };
    },
  };
  const summary = await rollupDay(database);
  assert.deepEqual(summary, { day: "2026-11-18", orders: 4, revenueCents: 12900 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [null]);
  assert.equal(calls[0].statement, rollupStatement);
});

test("rollupDay can be pinned to an explicit day", async () => {
  const calls = [];
  const database = {
    query: async (statement, values) => {
      calls.push({ statement, values });
      return { rows: [{ day: "2026-11-17", orders: 0, revenue_cents: 0 }] };
    },
  };
  const summary = await rollupDay(database, "2026-11-17");
  assert.equal(summary.day, "2026-11-17");
  assert.deepEqual(calls[0].values, ["2026-11-17"]);
});

test("rollupStatement only sums paid orders of the rolled day and upserts", () => {
  assert.match(rollupStatement, /WHERE status = 'paid'/);
  assert.match(rollupStatement, /ON CONFLICT \(day\) DO UPDATE/);
  assert.match(rollupStatement, /COALESCE\(\$1::date, CURRENT_DATE\)/);
});

test("rollupDay keeps a local-midnight Date on its own calendar day", async () => {
  const database = {
    query: async () => ({
      rows: [{ day: new Date(2026, 10, 18), orders: 0, revenue_cents: 0 }],
    }),
  };
  const summary = await rollupDay(database);
  assert.equal(summary.day, "2026-11-18");
});

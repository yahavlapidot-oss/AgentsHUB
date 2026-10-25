#!/usr/bin/env node
// Load test: many dashboard tabs and agents hitting the hub at once.
//
//   BASE_URL=http://localhost:3000 DASHBOARD_PASSWORD=... AGENT_TOKEN=ahub_... \
//     node scripts/load-test.mjs [seconds=20] [concurrency=20]
//
// Each worker loops over a mix like real traffic: the board's snapshot poll,
// the Live workspace poll, an agent heartbeat, an MCP tools/list and an
// activity event. Prints requests per second, latency percentiles and errors
// per endpoint, and exits 1 if any endpoint's p95 is over P95_LIMIT_MS (default
// 1000) or more than 1% of requests failed.
//
// Point it at a local or staging copy, not production: it writes heartbeats
// and events as the agent whose key you pass.

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const seconds = Number(process.argv[2] ?? 20);
const concurrency = Number(process.argv[3] ?? 20);
const P95_LIMIT_MS = Number(process.env.P95_LIMIT_MS ?? 1000);
const password = process.env.DASHBOARD_PASSWORD;
const token = process.env.AGENT_TOKEN;

const dash = password ? { authorization: `Basic ${Buffer.from(`you:${password}`).toString("base64")}` } : {};
const agent = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const endpoints = [
  { name: "GET /api/ui/snapshot", weight: 4, req: () => [`${BASE}/api/ui/snapshot`, { headers: dash }] },
  { name: "GET /api/ui/live", weight: 2, req: () => [`${BASE}/api/ui/live`, { headers: dash }] },
  ...(token
    ? [
        { name: "POST /api/v1/heartbeat", weight: 2, req: () => [`${BASE}/api/v1/heartbeat`, { method: "POST", headers: agent, body: JSON.stringify({ status: "active" }) }] },
        { name: "POST /api/mcp tools/list", weight: 1, req: () => [`${BASE}/api/mcp`, { method: "POST", headers: agent, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }] },
        { name: "POST /api/v1/events", weight: 1, req: () => [`${BASE}/api/v1/events`, { method: "POST", headers: agent, body: JSON.stringify({ type: "note", payload: { text: "load test" } }) }] },
      ]
    : []),
];
if (!token) console.log("AGENT_TOKEN not set: testing the dashboard endpoints only.");

const deck = endpoints.flatMap((e) => Array(e.weight).fill(e));
const stats = new Map(endpoints.map((e) => [e.name, { times: [], errors: 0, codes: new Map() }]));

async function worker(until) {
  for (let i = Math.floor(Math.random() * deck.length); Date.now() < until; i++) {
    const e = deck[i % deck.length];
    const s = stats.get(e.name);
    const t0 = performance.now();
    try {
      const res = await fetch(...e.req());
      await res.arrayBuffer();
      s.times.push(performance.now() - t0);
      if (!res.ok) {
        s.errors++;
        s.codes.set(res.status, (s.codes.get(res.status) ?? 0) + 1);
      }
    } catch (err) {
      s.times.push(performance.now() - t0);
      s.errors++;
      s.codes.set(err.cause?.code ?? "network", (s.codes.get(err.cause?.code ?? "network") ?? 0) + 1);
    }
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

console.log(`Load test: ${BASE}, ${concurrency} at once, ${seconds}s`);
const start = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker(start + seconds * 1000)));
const took = (Date.now() - start) / 1000;

let failed = false;
let total = 0;
console.log("\nendpoint                        req/s    p50     p95     p99   errors");
for (const [name, s] of stats) {
  const sorted = [...s.times].sort((a, b) => a - b);
  total += sorted.length;
  const p95 = pct(sorted, 95);
  const errRate = sorted.length ? s.errors / sorted.length : 0;
  if (p95 > P95_LIMIT_MS || errRate > 0.01) failed = true;
  const codes = [...s.codes].map(([c, n]) => `${c}×${n}`).join(" ");
  console.log(
    `${name.padEnd(30)} ${(sorted.length / took).toFixed(1).padStart(6)} ${pct(sorted, 50).toFixed(0).padStart(5)}ms ${p95.toFixed(0).padStart(5)}ms ${pct(sorted, 99).toFixed(0).padStart(5)}ms   ${s.errors}${codes ? ` (${codes})` : ""}`,
  );
}
console.log(`\n${total} requests in ${took.toFixed(1)}s (${(total / took).toFixed(0)}/s). ${failed ? `FAILED: p95 over ${P95_LIMIT_MS}ms or over 1% errors.` : "OK"}`);
process.exit(failed ? 1 : 0);

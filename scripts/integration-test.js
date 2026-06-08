#!/usr/bin/env node
// Manual integration test against real CourtListener API.
// Usage: COURTLISTENER_API_KEY=<key> node scripts/integration-test.js
//
// NOT run in CI. Requires a valid API key and is rate-limited (5 req/min free tier).
// Expect some 429 errors if run too frequently.

import { searchCases, lookupCitation, listOpinions, fetchOpinionText } from "../lib/courtlistener.js";
import { chunk } from "../lib/chunker.js";
import { fragmentId } from "../lib/envelope.js";

const token = process.env.COURTLISTENER_API_KEY || process.env.CL_API_TOKEN;
if (!token) {
  console.error("Set COURTLISTENER_API_KEY to run integration tests.");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: ${detail}`);
    failed++;
  }
}

// --- Test 1: Search ---
console.log("\n1. searchCases('deliberate indifference standard')");
const search = await searchCases("deliberate indifference standard", token);
assert("no error", !search.error, JSON.stringify(search.error));
assert("returns cases", search.cases?.length > 0, `got ${search.cases?.length}`);
if (search.cases?.length > 0) {
  const c = search.cases[0];
  assert("case has cluster_id", typeof c.cluster_id === "number", typeof c.cluster_id);
  assert("case has case_name", typeof c.case_name === "string", typeof c.case_name);
  assert("case has court_id", typeof c.court_id === "string", typeof c.court_id);
  assert("case has source_url", c.source_url?.startsWith("https://"), c.source_url);
}

// --- Test 2: Citation lookup ---
console.log("\n2. lookupCitation('511 U.S. 825')");
const cite = await lookupCitation("511 U.S. 825", token);
assert("no error", !cite.error, JSON.stringify(cite.error));
assert("finds clusters", cite.clusters?.length > 0, `got ${cite.clusters?.length}`);
if (cite.clusters?.length > 0) {
  assert("finds Farmer v. Brennan", cite.clusters[0].case_name === "Farmer v. Brennan", cite.clusters[0].case_name);
  assert("cluster has id", typeof cite.clusters[0].id === "number", typeof cite.clusters[0].id);
}

// --- Test 3: List opinions ---
if (cite.clusters?.length > 0) {
  const clusterId = cite.clusters[0].id;
  console.log(`\n3. listOpinions(${clusterId})`);
  const ops = await listOpinions(clusterId, token);
  assert("no error", !ops.error, JSON.stringify(ops.error));
  assert("has opinions", ops.opinions?.length > 0, `got ${ops.opinions?.length}`);
  if (ops.opinions?.length > 0) {
    const op = ops.opinions[0];
    assert("opinion has opinion_id", typeof op.opinion_id === "number", typeof op.opinion_id);
    assert("opinion has type", typeof op.type === "string", op.type);

    // --- Test 4: Fetch passages ---
    console.log(`\n4. fetchOpinionText(${op.opinion_id})`);
    const text = await fetchOpinionText(op.opinion_id, token);
    assert("no error", !text.error, JSON.stringify(text.error));
    assert("has text", text.text?.length > 0, `length: ${text.text?.length}`);

    if (text.text) {
      const paragraphs = chunk(text.text);
      assert("chunks into paragraphs", paragraphs.length > 1, `got ${paragraphs.length}`);
      const fid = fragmentId(op.opinion_id, 0);
      assert("fragment ID is well-formed", /^cl:\d+:p\d+$/.test(fid), fid);
    }
  }
}

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

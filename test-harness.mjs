#!/usr/bin/env node
/**
 * MCP Server Test Harness
 *
 * Spawns the built server with YT_TEST_MODE=true, talks JSON-RPC over stdio,
 * and verifies all Phase 1 acceptance criteria.
 */

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const env = {
  ...process.env,
  YOURSTRULY_API_KEY: "test_key_fake_not_real",
  YT_TEST_MODE: "true",
  YT_DEFAULT_CARD_IMAGE: "https://cards.yourstruly.ai/default-postcard.png",
  YT_SENDER_NAME: "Blue Wave Pools",
  YT_SENDER_ADDRESS: "456 Business Ave",
  YT_SENDER_CITY: "Austin",
  YT_SENDER_STATE: "TX",
  YT_SENDER_ZIP: "78701",
  YT_DAILY_LIMIT: "5",
};

const proc = spawn("node", ["build/index.js"], { env, stdio: ["pipe", "pipe", "pipe"] });

// Buffer stderr so we can show structured logs at the end
const stderrLines = [];
proc.stderr.on("data", (chunk) => {
  for (const line of chunk.toString().split("\n").filter(Boolean)) stderrLines.push(line);
});

// JSON-RPC frame parser (MCP uses newline-delimited JSON over stdio)
let buffer = "";
const pending = new Map();
let nextId = 1;

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch (e) {
      console.error("[parse error]", line);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`Timeout waiting for ${method}`)); }
    }, 10000);
  });
}

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const HEAD = (s) => `\n\x1b[1m\x1b[36m${s}\x1b[0m`;

let passes = 0, fails = 0;
function check(label, cond, detail = "") {
  if (cond) { passes++; console.log(`  ${PASS} ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fails++; console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`); }
}

function parseToolResult(res) {
  const text = res?.result?.content?.[0]?.text;
  if (!text) return { _raw: res };
  try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function main() {
  // ── 1. Initialize ──
  console.log(HEAD("1. MCP initialize handshake"));
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-harness", version: "1.0.0" },
  });
  check("initialize succeeds", !!init.result);
  check("server name = yourstruly-postcards", init.result?.serverInfo?.name === "yourstruly-postcards");
  check("server version = 1.0.0", init.result?.serverInfo?.version === "1.0.0");
  check("server has instructions", !!init.result?.instructions);

  // Send initialized notification (required after initialize)
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await wait(100);

  // ── 2. List tools ──
  console.log(HEAD("2. Tool registration"));
  const tools = await rpc("tools/list", {});
  const toolNames = (tools.result?.tools || []).map((t) => t.name);
  check(`2 tools registered (got ${toolNames.length}: ${toolNames.join(", ")})`, toolNames.length === 2);
  check("send_postcard registered", toolNames.includes("send_postcard"));
  check("generate_message registered", toolNames.includes("generate_message"));

  // ── 3. List prompts ──
  console.log(HEAD("3. Prompt registration"));
  const prompts = await rpc("prompts/list", {});
  const promptNames = (prompts.result?.prompts || []).map((p) => p.name);
  check(`1 prompt registered (got ${promptNames.length}: ${promptNames.join(", ")})`, promptNames.length === 1);
  check("compose_postcard_message registered", promptNames.includes("compose_postcard_message"));

  // ── 4. send_postcard test mode ──
  console.log(HEAD("4. send_postcard (test mode, valid input)"));
  const send1 = await rpc("tools/call", {
    name: "send_postcard",
    arguments: {
      to_name: "Jane Smith",
      to_address: "123 Oak St",
      to_city: "Austin",
      to_state: "TX",
      to_zip: "78701",
      message: "Hey Jane, your yard would look amazing with a new pool!",
    },
  });
  const r1 = parseToolResult(send1);
  check("returns success: true", r1.success === true);
  check("returns test_mode: true", r1.test_mode === true);
  check("returns mock_order_id", typeof r1.mock_order_id === "string");
  check("returns recipient name", r1.recipient === "Jane Smith");
  check("returns estimated_delivery", r1.estimated_delivery === "3-5 business days via USPS");
  check("returns daily_limit (5)", r1.daily_limit === 5);
  check("cards_sent_today = 1", r1.cards_sent_today === 1);

  // ── 5. generate_message (no CF AI) ──
  console.log(HEAD("5. generate_message (no CF AI configured)"));
  const gen = await rpc("tools/call", {
    name: "generate_message",
    arguments: {
      recipient_context: "John Smith, homeowner with no pool in backyard",
      tone: "warm",
      sender_context: "Blue Wave Pools, Austin TX",
    },
  });
  const rg = parseToolResult(gen);
  check("ai_generated: false", rg.ai_generated === false);
  check("message: null (fallback)", rg.message === null);
  check("returns prompt.system", typeof rg.prompt?.system === "string");
  check("returns prompt.user", typeof rg.prompt?.user === "string");
  check("system prompt mentions tone guidance", rg.prompt?.system?.includes("Write like a friendly neighbor"));
  check("user prompt includes recipient context", rg.prompt?.user?.includes("John Smith"));
  check("user prompt includes sender context", rg.prompt?.user?.includes("Blue Wave Pools"));
  check("returns instructions for self-generation", typeof rg.instructions === "string");

  // ── 6. Daily limit counter ──
  console.log(HEAD("6. Daily limit counter (limit=5, send 4 more, total=5, then 1 over)"));
  for (let i = 2; i <= 5; i++) {
    const s = await rpc("tools/call", {
      name: "send_postcard",
      arguments: {
        to_name: `Test ${i}`,
        to_address: "1 Test Ln",
        to_city: "Austin",
        to_state: "TX",
        to_zip: "78701",
        message: `Test card ${i}`,
      },
    });
    const r = parseToolResult(s);
    check(`send #${i}: cards_sent_today = ${i}`, r.cards_sent_today === i);
  }
  // 6th should fail
  const overLimit = await rpc("tools/call", {
    name: "send_postcard",
    arguments: {
      to_name: "Over Limit",
      to_address: "1 Test Ln",
      to_city: "Austin",
      to_state: "TX",
      to_zip: "78701",
      message: "This should fail",
    },
  });
  check(
    "send #6: blocked with daily limit error",
    overLimit.result?.isError === true && overLimit.result?.content?.[0]?.text?.includes("Daily limit reached"),
    overLimit.result?.content?.[0]?.text?.slice(0, 80)
  );

  // ── 7. Rate limiter ──
  console.log(HEAD("7. Rate limiter (2s min between sends)"));
  // Reset by spawning a new server with limit=20
  proc.kill();
  await wait(200);

  const proc2 = spawn("node", ["build/index.js"], {
    env: { ...env, YT_DAILY_LIMIT: "20" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc2.stderr.on("data", (c) => stderrLines.push("[p2] " + c.toString().trim()));

  let buf2 = "";
  const pending2 = new Map();
  let id2 = 1;
  proc2.stdout.on("data", (c) => {
    buf2 += c.toString();
    let i;
    while ((i = buf2.indexOf("\n")) >= 0) {
      const line = buf2.slice(0, i).trim();
      buf2 = buf2.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (m.id != null && pending2.has(m.id)) {
          pending2.get(m.id)(m);
          pending2.delete(m.id);
        }
      } catch {}
    }
  });
  function rpc2(method, params) {
    const id = id2++;
    return new Promise((resolve) => {
      pending2.set(id, resolve);
      proc2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  await rpc2("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  proc2.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await wait(100);

  const args = (n) => ({
    name: "send_postcard",
    arguments: { to_name: `R${n}`, to_address: "1 Test", to_city: "Austin", to_state: "TX", to_zip: "78701", message: `m${n}` },
  });

  const t0 = Date.now();
  await rpc2("tools/call", args(1));
  const t1 = Date.now();
  await rpc2("tools/call", args(2));
  const t2 = Date.now();
  await rpc2("tools/call", args(3));
  const t3 = Date.now();

  const gap1 = t1 - t0;
  const gap2 = t2 - t1;
  const gap3 = t3 - t2;
  check(`first send fast (${gap1}ms)`, gap1 < 1500, `${gap1}ms`);
  check(`second send delayed >=1900ms (got ${gap2}ms)`, gap2 >= 1900);
  check(`third send delayed >=1900ms (got ${gap3}ms)`, gap3 >= 1900);

  // ── 8. Input validation ──
  console.log(HEAD("8. Input validation"));

  // Bad state
  const badState = await rpc2("tools/call", {
    name: "send_postcard",
    arguments: { to_name: "X", to_address: "1 Test", to_city: "Austin", to_state: "ZZ", to_zip: "78701", message: "m" },
  });
  check(
    "invalid state code 'ZZ' → error",
    badState.result?.isError === true && badState.result?.content?.[0]?.text?.includes("Invalid state"),
    badState.result?.content?.[0]?.text?.slice(0, 60)
  );

  // Bad ZIP
  const badZip = await rpc2("tools/call", {
    name: "send_postcard",
    arguments: { to_name: "X", to_address: "1 Test", to_city: "Austin", to_state: "TX", to_zip: "ABC12", message: "m" },
  });
  check(
    "invalid ZIP 'ABC12' → error",
    badZip.result?.isError === true && badZip.result?.content?.[0]?.text?.includes("Invalid ZIP"),
    badZip.result?.content?.[0]?.text?.slice(0, 60)
  );

  // ZIP+4 should work
  const zipPlus4 = await rpc2("tools/call", {
    name: "send_postcard",
    arguments: { to_name: "X", to_address: "1 Test", to_city: "Austin", to_state: "TX", to_zip: "78701-1234", message: "m" },
  });
  check("ZIP+4 '78701-1234' → success", parseToolResult(zipPlus4).success === true);

  // Lowercase state should work (we uppercase internally)
  const lcState = await rpc2("tools/call", {
    name: "send_postcard",
    arguments: { to_name: "X", to_address: "1 Test", to_city: "Austin", to_state: "tx", to_zip: "78701", message: "m" },
  });
  check("lowercase state 'tx' → success (uppercased internally)", parseToolResult(lcState).success === true);

  // Message over 400 chars (zod schema rejects at protocol level)
  const longMsg = "x".repeat(401);
  const tooLong = await rpc2("tools/call", {
    name: "send_postcard",
    arguments: { to_name: "X", to_address: "1 Test", to_city: "Austin", to_state: "TX", to_zip: "78701", message: longMsg },
  });
  // Could be either: zod validation error, OR isError text response
  const tooLongErr = tooLong.error || (tooLong.result?.isError === true);
  check(
    "message > 400 chars → error",
    tooLongErr,
    tooLong.error?.message?.slice(0, 80) || tooLong.result?.content?.[0]?.text?.slice(0, 80)
  );

  proc2.kill();
  await wait(100);

  // ── Summary ──
  console.log(HEAD("RESULTS"));
  console.log(`  Passes: ${passes}`);
  console.log(`  Fails:  ${fails}`);

  if (process.env.SHOW_LOGS === "1") {
    console.log(HEAD("STDERR LOGS"));
    for (const l of stderrLines) console.log("  " + l);
  }

  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  proc.kill();
  process.exit(2);
});

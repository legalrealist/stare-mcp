import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "lib", "server.js");

function mcpSession(envOverrides = {}) {
  const proc = spawn("node", [SERVER_PATH], {
    env: { ...process.env, COURTLISTENER_API_KEY: "test-key", ...envOverrides },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  proc.stdout.on("data", (d) => (stdout += d.toString()));
  proc.stderr.on("data", () => {});

  function send(msg) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function collect() {
    return new Promise((resolve, reject) => {
      proc.on("close", () => {
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          resolve(lines.map((l) => JSON.parse(l)));
        } catch (e) {
          reject(new Error(`Parse error: ${stdout}`));
        }
      });
    });
  }

  return { proc, send, collect };
}

describe("MCP server v2", () => {
  it("responds to initialize with stare server info", async () => {
    const { proc, send, collect } = mcpSession();
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => proc.kill(), 3000);
    const responses = await collect();
    const init = responses.find((r) => r.id === 1);
    expect(init).toBeDefined();
    expect(init.result.serverInfo.name).toBe("stare");
  });

  it("lists all five tools", async () => {
    const { proc, send, collect } = mcpSession();
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    }, 500);
    setTimeout(() => proc.kill(), 4000);
    const responses = await collect();
    const tools = responses.find((r) => r.id === 2);
    expect(tools).toBeDefined();
    const names = tools.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["fetch_passages", "how_cited", "list_courts", "search_cases", "verify_citations"]);
  }, 10000);

  it("list_courts works without an API key (local data)", async () => {
    const { proc, send, collect } = mcpSession({ COURTLISTENER_API_KEY: "", CL_API_TOKEN: "" });
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "list_courts", arguments: { level: "circuit" } },
      });
    }, 500);
    setTimeout(() => proc.kill(), 4000);
    const responses = await collect();
    const call = responses.find((r) => r.id === 2);
    expect(call).toBeDefined();
    const body = JSON.parse(call.result.content[0].text);
    expect(body.data.length).toBe(13);
    expect(body.data[0]).toHaveProperty("court_id");
    expect(body.data[0].level).toBe("circuit");
    expect(body.provenance.source).toBe("courts-db (Free Law Project)");
  }, 10000);

  it("returns error envelope when no API key is set", async () => {
    const { proc, send, collect } = mcpSession({ COURTLISTENER_API_KEY: "", CL_API_TOKEN: "" });
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "search_cases", arguments: { query: "test" } },
      });
    }, 500);
    setTimeout(() => proc.kill(), 4000);
    const responses = await collect();
    const call = responses.find((r) => r.id === 2);
    expect(call).toBeDefined();
    const body = JSON.parse(call.result.content[0].text);
    expect(body.error.code).toBe("no_api_key");
  }, 10000);
});

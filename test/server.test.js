import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "lib", "server.js");

function sendJsonRpc(message) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SERVER_PATH], {
      env: { ...process.env, COURTLISTENER_API_KEY: "test-key" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", () => {});

    proc.on("close", () => {
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const responses = lines.map((l) => JSON.parse(l));
        resolve(responses);
      } catch (e) {
        reject(new Error(`Failed to parse server output: ${stdout}`));
      }
    });

    proc.stdin.write(JSON.stringify(message) + "\n");
    setTimeout(() => proc.kill(), 3000);
  });
}

describe("MCP server", () => {
  it("responds to initialize", async () => {
    const responses = await sendJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1.0" },
      },
    });

    const initResponse = responses.find((r) => r.id === 1);
    expect(initResponse).toBeDefined();
    expect(initResponse.result.serverInfo.name).toBe("stare");
  });

  it("lists the research tool", async () => {
    const proc = spawn("node", [SERVER_PATH], {
      env: { ...process.env, COURTLISTENER_API_KEY: "test-key" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", () => {});

    const result = await new Promise((resolve, reject) => {
      proc.on("close", () => {
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const responses = lines.map((l) => JSON.parse(l));
          resolve(responses);
        } catch (e) {
          reject(new Error(`Parse error: ${stdout}`));
        }
      });

      // Send initialize, then initialized notification, then tools/list
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0.1.0" },
          },
        }) + "\n"
      );

      setTimeout(() => {
        proc.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n"
        );
        proc.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
          }) + "\n"
        );
      }, 500);

      setTimeout(() => proc.kill(), 4000);
    });

    const toolsResponse = result.find((r) => r.id === 2);
    expect(toolsResponse).toBeDefined();
    expect(toolsResponse.result.tools).toHaveLength(1);
    expect(toolsResponse.result.tools[0].name).toBe("research");
  }, 10000);

  it("returns error when no API key is set", async () => {
    const proc = spawn("node", [SERVER_PATH], {
      env: { ...process.env, COURTLISTENER_API_KEY: "", CL_API_TOKEN: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", () => {});

    const result = await new Promise((resolve, reject) => {
      proc.on("close", () => {
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          resolve(lines.map((l) => JSON.parse(l)));
        } catch (e) {
          reject(new Error(`Parse error: ${stdout}`));
        }
      });

      proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0.1.0" },
          },
        }) + "\n"
      );

      setTimeout(() => {
        proc.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n"
        );
        proc.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "research",
              arguments: { query: "deliberate indifference" },
            },
          }) + "\n"
        );
      }, 500);

      setTimeout(() => proc.kill(), 4000);
    });

    const callResponse = result.find((r) => r.id === 2);
    expect(callResponse).toBeDefined();
    expect(callResponse.result.content[0].text).toContain("No CourtListener API key");
    expect(callResponse.result.isError).toBe(true);
  }, 10000);
});

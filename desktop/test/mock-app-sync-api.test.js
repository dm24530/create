const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const port = 9893;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

async function waitForServer(url, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // server is still starting
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`mock server did not start: ${url}`);
}

before(async () => {
    server = spawn(process.execPath, [path.resolve(__dirname, "../../mock-server/server.mjs")], {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...process.env, CREATE_MOCK_PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer(`${baseUrl}/api/v1/settings/public`);
});

after(async () => {
    if (!server) return;
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
});

test("mock server exposes GPT image quality ceiling", async () => {
    const response = await fetch(`${baseUrl}/v1/images/quality-capabilities`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data["gpt-image"].effective_max, "high");
});

test("mock server exposes image model performance for 24h and 7d", async () => {
    const response24 = await fetch(`${baseUrl}/api/v1/usage/image-model-performance?range=24h`);
    const payload24 = await response24.json();
    const response7d = await fetch(`${baseUrl}/api/v1/usage/image-model-performance?range=7d`);
    const payload7d = await response7d.json();
    assert.equal(payload24.data.models[0].model, "gpt-image-2");
    assert.equal(payload24.data.models[0].success_rate, 0.86);
    assert.equal(payload7d.data.models[0].success_rate, 0.92);
    assert.equal(payload24.data.models[0].series.length, 1);
});

test("mock server exposes video model performance with 24h and 7d metrics", async () => {
    const response = await fetch(`${baseUrl}/api/v1/model-plaza/video-performance`);
    const payload = await response.json();
    assert.ok(payload.data.models.length > 0);
    assert.equal(payload.data.models[0].last_24h.success_rate, 0.75);
    assert.equal(payload.data.models[0].last_7d.success_rate, 0.9);
});
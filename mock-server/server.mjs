import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.CREATE_MOCK_PORT || 9890);
const user = {
  id: 1001,
  username: "mock-user",
  email: "mock@example.com",
  display_name: "Mock User",
  role: "user",
  balance: 100,
  status: "active",
};
const group = {
  id: 1,
  name: "Mock Composite",
  description: "Local mock creation group",
  platform: "composite",
  allow_image_generation: true,
  video_capable: true,
  video_price_480p: 0.1,
  video_price_720p: 0.2,
  video_price_1080p: 0.4,
};
const apiKey = {
  id: 1,
  user_id: user.id,
  key: "sk-create-mock",
  name: "Mock Creation",
  group_id: group.id,
  status: "active",
  quota: 20,
  quota_used: 1.25,
  group,
};
const secondKey = {
  id: 2,
  user_id: user.id,
  key: "sk-create-mock-alt",
  name: "Mock Alternate",
  group_id: group.id,
  status: "active",
  quota: 0,
  quota_used: 0.5,
  group,
};
const videoCapabilities = {
  protocol: "seedance_video",
  min_duration: 4,
  max_duration: 12,
  default_duration: 8,
  duration_options: [4, 8, 12],
  resolutions: ["720p"],
  aspect_ratios: ["16:9", "9:16"],
  slots: { first_frame: 1, last_frame: 0, reference_image: 2, reference_video: 1, reference_audio: 0 },
  supports_generate_audio: true,
  outputs_audio: true,
  modes: ["text-to-video", "image-to-video", "reference-images", "reference-video"],
};
const projects = new Map();
const assets = new Map();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX0AAAAASUVORK5CYII=";
const mockStartedAt = Date.now();
const mockUsageLogs = [
  { id: 1, api_key_id: 1, model: "gpt-image-2", group_id: 1, input_tokens: 120, output_tokens: 80, total_cost: 0.03, actual_cost: 0.02, stream: false, created_at: new Date(mockStartedAt - 10 * 60 * 1000).toISOString() },
  { id: 2, api_key_id: 2, model: "grok-imagine-video", group_id: 1, input_tokens: 200, output_tokens: 150, total_cost: 0.09, actual_cost: 0.06, stream: false, created_at: new Date(mockStartedAt - 20 * 60 * 1000).toISOString() },
];

function envelope(data, status = 200, message = "ok") {
  return { status, body: { code: 0, message, data } };
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function send(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Accept-Language",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  });
  response.end(JSON.stringify(payload));
}

function sendVideo(response) {
  const payload = Buffer.from("mock-video-bytes");
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": payload.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Accept-Language",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  response.end(payload);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const path = url.pathname;
  const method = request.method || "GET";

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Accept-Language",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    response.end();
    return;
  }

  if (path === "/health") return send(response, 200, { ok: true });

  if (path === "/api/v1/auth/login" && method === "POST") {
    return send(response, 200, { code: 0, data: {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      user,
    }});
  }
  if (path === "/api/v1/auth/refresh" && method === "POST") {
    return send(response, 200, { code: 0, data: {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    }});
  }
  if (path === "/api/v1/auth/me") return send(response, 200, { code: 0, data: user });
  if (path === "/api/v1/auth/logout") return send(response, 200, { code: 0, data: { message: "ok" } });

  if (path === "/api/v1/settings/public") {
    return send(response, 200, { code: 0, data: {
      site_name: "Create Mock",
      api_base_url: "/v1",
      registration_enabled: false,
      payment_enabled: false,
    }});
  }
  if (path === "/api/v1/keys") {
    return send(response, 200, { code: 0, data: { items: [apiKey, secondKey], total: 2, page: 1, page_size: 100, pages: 1 } });
  }
  if (path === "/api/v1/groups/available") return send(response, 200, { code: 0, data: [group] });
  if (path === "/api/v1/models/available") {
    return send(response, 200, { code: 0, data: [{
      name: "Mock Composite Channel",
      description: "Mock capability source",
      platforms: [{
        platform: "composite",
        groups: [group],
        supported_models: [
          { name: "gpt-image-2", platform: "composite", pricing: null },
          { name: "brand-new-video", platform: "composite", pricing: { billing_mode: "video", per_request_price: 0.32, intervals: [] }, video_capabilities: videoCapabilities },
        ],
      }],
    }]});
  }
  if (path === "/api/v1/model-plaza") {
    return send(response, 200, { code: 0, data: {
      description: "Mock model plaza",
      groups: [{
        id: group.id,
        name: group.name,
        description: group.description,
        platform: group.platform,
        rate_multiplier: 1,
        models: [
          { name: "gpt-image-2", platform: "composite", description: "Mock image model", pricing: { billing_mode: "image", per_request_price: 0.02, intervals: [] } },
          { name: "brand-new-video", platform: "composite", description: "Mock video model", video_capabilities: videoCapabilities, pricing: { billing_mode: "video", per_request_price: 0.32, intervals: [
            { tier_label: "720p / 4s", min_tokens: 4, max_tokens: 4, per_request_price: 0.2 },
            { tier_label: "720p / 8s", min_tokens: 8, max_tokens: 8, per_request_price: 0.32 },
            { tier_label: "720p / 12s", min_tokens: 12, max_tokens: 12, per_request_price: 0.44 },
          ] } },
        ],
      }],
    }});
  }
  if (path === "/api/v1/prompts") {
    return send(response, 200, { code: 0, data: { items: [], total: 0, page: 1, page_size: 12, pages: 0 } });
  }
  if (path === "/api/v1/usage" && method === "GET") {
    return send(response, 200, { code: 0, data: { items: mockUsageLogs, total: mockUsageLogs.length, page: 1, page_size: 20, pages: 1 } });
  }
  if (path === "/api/v1/usage/stats") {
    return send(response, 200, { code: 0, data: { total_requests: 2, total_input_tokens: 320, total_output_tokens: 230, total_tokens: 550, total_cost: 0.12, total_actual_cost: 0.08 } });
  }
  if (path === "/api/v1/usage/image-display") {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    response.end();
    return;
  }

  if (path === "/v1/models") {
    return send(response, 200, { object: "list", data: [
      { id: "gpt-image-2", object: "model" },
      { id: "brand-new-video", object: "model" },
    ]});
  }
  if (path === "/v1/images/generations" && method === "POST") {
    return send(response, 200, { created: Math.floor(Date.now() / 1000), data: [{ url: `data:image/png;base64,${png}` }] });
  }
  if (path === "/v1/video/generations" && method === "POST") {
    return send(response, 200, { code: 0, data: { id: "mock-video-task", status: "queued" } });
  }
  if (path === "/v1/videos/mock-video-task" && method === "GET") {
    return send(response, 200, { code: 0, data: { id: "mock-video-task", status: "completed" } });
  }
  if (path === "/v1/videos/mock-video-task/content" && method === "GET") {
    return sendVideo(response);
  }

  if (path === "/api/v1/canvas/projects" && method === "GET") {
    return send(response, 200, { code: 0, data: Array.from(projects.values()).map(({ graph, ...item }) => item) });
  }
  if (path === "/api/v1/canvas/projects/full" && method === "GET") {
    return send(response, 200, { code: 0, data: Array.from(projects.values()) });
  }
  const projectMatch = path.match(/^\/api\/v1\/canvas\/projects\/([A-Za-z0-9_-]+)$/);
  if (projectMatch) {
    const id = projectMatch[1];
    if (method === "GET") {
      const project = projects.get(id);
      return project ? send(response, 200, { code: 0, data: project }) : send(response, 404, { code: 404, message: "not found" });
    }
    if (method === "PUT") {
      const payload = await body(request);
      const existing = projects.get(id);
      if (existing && Number(payload.version || 0) !== existing.version) {
        return send(response, 409, { code: 409, message: "画布版本已变化，请刷新后重试" });
      }
      const now = new Date().toISOString();
      const project = {
        id,
        title: String(payload.title || "Mock Canvas"),
        graph: payload.graph || {},
        version: existing ? existing.version + 1 : 1,
        created_at: existing?.created_at || now,
        updated_at: now,
        assets: existing?.assets || [],
        node_count: Array.isArray(payload.graph?.nodes) ? payload.graph.nodes.length : 0,
        connection_count: Array.isArray(payload.graph?.connections) ? payload.graph.connections.length : 0,
      };
      projects.set(id, project);
      return send(response, 200, { code: 0, data: { id, version: project.version, updated_at: now } });
    }
    if (method === "DELETE") {
      projects.delete(id);
      return send(response, 200, { code: 0, data: { deleted: true } });
    }
  }

  if (path === "/api/v1/canvas/assets" && method === "POST") {
    const id = randomUUID().replaceAll("-", "");
    const asset = {
      id,
      project_id: "mock-project",
      node_id: "",
      kind: "image",
      url: `/api/v1/public/canvas-assets/${id}/content`,
      thumb_url: `/api/v1/public/canvas-assets/${id}/thumb`,
    };
    assets.set(id, asset);
    return send(response, 200, { code: 0, data: asset });
  }
  if (path.startsWith("/api/v1/public/")) {
    if (path.endsWith("/content") || path.endsWith("/thumb")) {
      response.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" });
      response.end(Buffer.from(png, "base64"));
      return;
    }
    return send(response, 404, { code: 404, message: "not found" });
  }

  return send(response, 404, { code: 404, message: `mock endpoint not implemented: ${method} ${path}` });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Create Mock listening on http://127.0.0.1:${port}`);
});

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
const projects = new Map();
const assets = new Map();
const videoTasks = new Map();
let mockVideoSequence = 0;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX0AAAAASUVORK5CYII=";
const mockStartedAt = Date.now();
const mockUsageLogs = [
  { id: 1, api_key_id: 1, model: "gpt-image-2", group_id: 1, input_tokens: 120, output_tokens: 80, total_cost: 0.03, actual_cost: 0.02, stream: false, created_at: new Date(mockStartedAt - 10 * 60 * 1000).toISOString() },
  { id: 2, api_key_id: 2, model: "grok-imagine-video", group_id: 1, input_tokens: 200, output_tokens: 150, total_cost: 0.09, actual_cost: 0.06, stream: false, created_at: new Date(mockStartedAt - 20 * 60 * 1000).toISOString() },
];

function envelope(data, status = 200, message = "ok") {
  return { status, body: { code: 0, message, data } };
}

function lastUserText(payload) {
  const input = Array.isArray(payload?.input) ? payload.input : [];
  const message = [...input].reverse().find((item) => item?.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n");
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
      { id: "grok-imagine-video", object: "model" },
      { id: "gpt-5.5", object: "model" },
    ]});
  }
  if (path === "/v1/responses" && method === "POST") {
    const payload = await body(request);
    const current = lastUserText(payload);
    const detailed = current.includes("便携榨汁杯");
    const briefPatch = detailed
      ? {
          productName: "便携榨汁杯",
          category: "厨房小家电",
          targetAudience: ["通勤上班族", "健身人群"],
          sellingPoints: [{ id: "fact-1", text: "一键榨汁，杯身便携", source: "user" }],
          scenarios: ["办公室", "健身后"],
          visualStyle: ["清爽", "高级"],
          colorPreference: ["#111111", "#F5F0E8"],
          copyTone: ["直接", "可信"],
          forbiddenContent: ["绝对化承诺"],
        }
      : current.includes("京东")
        ? { platform: "jd" }
        : current.includes("拼多多")
          ? { platform: "pdd" }
          : current.includes("淘宝") || current.includes("天猫")
            ? { platform: "taobao" }
            : {};
    const answer = {
      message: detailed ? "商品信息已经足够，可以生成 6 页页面分镜了。" : Object.keys(briefPatch).length ? "平台已记录。继续告诉我商品名称和类目，也可以直接上传商品图。" : "我听到了。继续补充商品名称、类目、目标人群和已确认卖点。",
      briefPatch,
      ...(detailed ? {} : { question: { field: "productName", prompt: "商品名称是什么？", options: ["我上传商品图", "我直接描述商品"] } }),
      readyToPlan: detailed,
      assumptions: detailed ? ["商品图尚未上传，底图会仅按文字 Brief 策划"] : [],
      risks: [],
      actions: detailed ? [{ type: "plan_storyboard", label: "生成页面分镜" }] : [],
    };
    const text = JSON.stringify(answer);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`);
    response.write(`data: ${JSON.stringify({ type: "response.completed", response: { output_text: text } })}\n\n`);
    response.end();
    return;
  }
  if (path === "/v1/images/generations" && method === "POST") {
    return send(response, 200, { created: Math.floor(Date.now() / 1000), data: [{ url: `data:image/png;base64,${png}` }] });
  }
  if ((path === "/v1/videos/generations" || path === "/v1/videos" || path === "/v1/video/generations") && method === "POST") {
    const id = `mock-video-${++mockVideoSequence}`;
    videoTasks.set(id, Date.now());
    return send(response, 200, { id, object: "video", status: "pending" });
  }
  const videoStatusMatch = path.match(/^\/v1\/videos\/([^/]+)$/);
  if (videoStatusMatch && method === "GET") {
    const id = videoStatusMatch[1];
    const createdAt = videoTasks.get(id);
    if (!createdAt) return send(response, 404, { error: { message: "Video request not found" } });
    const status = Date.now() - createdAt >= 3000 ? "completed" : "pending";
    return send(response, 200, { id, object: "video", status });
  }
  const videoContentMatch = path.match(/^\/v1\/videos\/([^/]+)\/content$/);
  if (videoContentMatch && method === "GET") {
    response.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": "18",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(Buffer.from("mock-video-content"));
    return;
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

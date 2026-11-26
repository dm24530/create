import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const videoBoundaryGroup = {
  ...group,
  id: 2,
  name: "Mock Video Boundary",
  description: "Image-enabled group whose key only exposes video models",
};
const imageBoundaryGroup = {
  ...group,
  id: 3,
  name: "Mock Image Boundary",
  description: "Video-enabled group whose key only exposes image models",
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
const videoBoundaryKey = {
  id: 3,
  user_id: user.id,
  key: "sk-create-mock-video-boundary",
  name: "Mock Video Key",
  group_id: videoBoundaryGroup.id,
  status: "active",
  quota: 20,
  quota_used: 0,
  group: videoBoundaryGroup,
};
const imageBoundaryKey = {
  id: 4,
  user_id: user.id,
  key: "sk-create-mock-image-boundary",
  name: "Mock Image Key",
  group_id: imageBoundaryGroup.id,
  status: "active",
  quota: 20,
  quota_used: 0,
  group: imageBoundaryGroup,
};
const mockRoot = path.dirname(fileURLToPath(import.meta.url));
const videoCatalog = JSON.parse(readFileSync(path.resolve(mockRoot, "../web/src/lib/__tests__/fixtures/momoapi-video-31.json"), "utf8")).models;
const mockResolutionPrices = {
  "480p": 0.32,
  "720p": 0.52,
  "768p": 0.6,
  "1080p": 0.9,
  "2k": 1.4,
  "4k": 2.2,
  "8k": 4.4,
};
const videoModelEntries = videoCatalog.map((entry) => {
  const resolutions = Array.isArray(entry.capabilities?.resolutions) ? entry.capabilities.resolutions : [];
  const tiers = resolutions.length ? resolutions : ["标准"];
  const intervals = tiers.map((resolution, index) => ({
    tier_label: resolution,
    per_request_price: mockResolutionPrices[String(resolution).toLowerCase()] ?? Number((0.32 + index * 0.2).toFixed(2)),
  }));
  return {
    name: entry.model_name,
    platform: "composite",
    description: "视频能力模拟数据",
    video_capabilities: entry.capabilities,
    pricing: {
      billing_mode: "video",
      per_request_price: intervals[0].per_request_price,
      intervals,
    },
  };
});
function inferMockVideoMode(body) {
  if (body?.mode === "video-edit" || body?.mode === "video-extension") return body.mode;
  if (Array.isArray(body?.keyframes) && body.keyframes.length) return "keyframes";
  if (body?.first_frame_image_url && body?.last_frame_image_url) return "first-last-frame";
  if (Array.isArray(body?.images) && body.images.length) return "image-to-video";
  if (Array.isArray(body?.reference_video_urls) && body.reference_video_urls.length) return "reference-video";
  if (Array.isArray(body?.reference_image_urls) && body.reference_image_urls.length) return "reference-images";
  return "text-to-video";
}

function validateMockVideoRequest(body) {
  const model = videoModelEntries.find((entry) => entry.name === body?.model);
  if (!model) return { error: `unknown video model: ${body?.model || ""}` };
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return { error: "prompt is required" };
  const capability = model.video_capabilities || {};
  const mode = inferMockVideoMode(body);
  if (!(capability.modes || []).includes(mode)) return { error: `unsupported mode ${mode} for ${body.model}` };
  if (mode !== "video-edit" && mode !== "video-extension" && body.mode != null) {
    return { error: `mode must be omitted for ${mode}` };
  }
  if (body.images != null && !(Array.isArray(body.images) && body.images.length === 1 && body.images.every((url) => typeof url === "string"))) {
    return { error: "images must contain exactly one URL" };
  }
  if (mode === "image-to-video" && (!Array.isArray(body.images) || body.images.length !== 1)) {
    return { error: "image-to-video requires images[1]" };
  }
  if (mode === "image-to-video" && body.first_frame_image_url != null) {
    return { error: "image-to-video must use images, not first_frame_image_url" };
  }
  if (mode === "first-last-frame" && (typeof body.first_frame_image_url !== "string" || typeof body.last_frame_image_url !== "string")) {
    return { error: "first-last-frame requires first_frame_image_url and last_frame_image_url" };
  }
  if (mode === "keyframes") {
    if (!Array.isArray(body.keyframes) || !body.keyframes.length) return { error: "keyframes must not be empty" };
    let previous = 0;
    for (const keyframe of body.keyframes) {
      if (!keyframe || !Number.isInteger(keyframe.timestamp_s) || keyframe.timestamp_s <= previous || typeof keyframe.image_url !== "string" || !keyframe.image_url) {
        return { error: "keyframes require increasing integer timestamp_s and image_url" };
      }
      previous = keyframe.timestamp_s;
    }
    if (body.keyframe_image_urls != null) return { error: "use keyframes objects, not keyframe_image_urls" };
  }
  if (mode === "reference-images" && (!Array.isArray(body.reference_image_urls) || !body.reference_image_urls.length)) {
    return { error: "reference-images requires reference_image_urls" };
  }
  if (mode === "reference-video" && (!Array.isArray(body.reference_video_urls) || !body.reference_video_urls.length)) {
    return { error: "reference-video requires reference_video_urls" };
  }
  if (mode === "video-edit" || mode === "video-extension") {
    if (typeof body.reference_video_url !== "string" || !body.reference_video_url) return { error: `${mode} requires reference_video_url` };
    if (body.reference_video_urls != null) return { error: `${mode} must not use reference_video_urls` };
    if (body.reference_image_urls != null || body.reference_audio_urls != null) return { error: `${mode} only accepts the source video` };
  }
  const modeResolutions = capability.mode_capabilities?.[mode]?.resolution_options;
  const resolutions = Array.isArray(modeResolutions) && modeResolutions.length ? modeResolutions : capability.resolutions || [];
  if (body.resolution != null && resolutions.length && !resolutions.includes(String(body.resolution).toLowerCase())) {
    return { error: `unsupported resolution ${body.resolution} for ${mode}` };
  }
  if (body.aspect_ratio != null && Array.isArray(capability.aspect_ratios) && capability.aspect_ratios.length && !capability.aspect_ratios.includes(body.aspect_ratio)) {
    return { error: `unsupported aspect_ratio ${body.aspect_ratio}` };
  }
  return { mode };
}

let lastVideoGenerationRequest = null;
const referenceAssetRequests = [];
const projects = new Map();
const assets = new Map();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX0AAAAASUVORK5CYII=";
const mockStartedAt = Date.now();
let failNextImageGeneration = false;
let lastImageRequest = null;
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

function sendSse(response, content) {
  const event = JSON.stringify({ choices: [{ delta: { content } }] });
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Accept-Language",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  response.end(`data: ${event}\n\ndata: [DONE]\n\n`);
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
    return send(response, 200, { code: 0, data: { items: [apiKey, secondKey, videoBoundaryKey, imageBoundaryKey], total: 4, page: 1, page_size: 100, pages: 1 } });
  }
  if (path === "/api/v1/groups/available") return send(response, 200, { code: 0, data: [group, videoBoundaryGroup, imageBoundaryGroup] });
  if (path === "/api/v1/models/available") {
    return send(response, 200, { code: 0, data: [{
      name: "Mock Composite Channel",
      description: "Mock capability source",
      platforms: [{
        platform: "composite",
        groups: [group],
        supported_models: [
          { name: "gpt-image-2", platform: "composite", pricing: null },
          { name: "gpt-image-2-alt", platform: "composite", pricing: null },
          { name: "gpt-5.5", platform: "composite", pricing: null },
          ...videoModelEntries,
        ],
      }],
    }]});
  }
  if (path === "/v1/images/quality-capabilities" && method === "GET") {
    return send(response, 200, {
      object: "image.quality_capabilities",
      data: {
        "gpt-image": {
          display_max: "max",
          effective_max: "high",
        },
      },
    });
  }
  if (path === "/api/v1/usage/image-model-performance" && method === "GET") {
    const range = url.searchParams.get("range") === "7d" ? "7d" : "24h";
    const now = new Date().toISOString();
    return send(response, 200, { code: 0, message: "success", data: {
      range,
      bucket: range === "24h" ? "hour" : "day",
      start_at: now,
      end_at: now,
      models: [{
        group_id: group.id,
        model: "gpt-image-2",
        sample_count: 12,
        data_sufficient: true,
        success_rate: range === "24h" ? 0.86 : 0.92,
        avg_duration_ms: range === "24h" ? 32000 : 35000,
        last_used_at: now,
        series: range === "24h" ? [{ bucket_start: now, sample_count: 12, success_rate: 0.86, avg_duration_ms: 32000 }] : [],
      }],
    }});
  }
  if (path === "/api/v1/model-plaza/video-performance" && method === "GET") {
    const now = new Date().toISOString();
    return send(response, 200, { code: 0, message: "success", data: {
      group: "all",
      refreshed_at: now,
      stale: false,
      partial: false,
      models: [{
        model: videoModelEntries[0]?.name || "mock-video",
        last_24h: { success_rate: 0.75, avg_latency_ms: 180000, series: [{ bucket_start: now, success_rate: 0.75 }] },
        last_7d: { success_rate: 0.9, avg_latency_ms: 200000, series: null },
      }],
    }});
  }  if (path === "/api/v1/model-plaza") {
    return send(response, 200, { code: 0, data: {
      description: "Mock model plaza",
      groups: [{
        id: group.id,
        name: group.name,
        description: group.description,
        platform: group.platform,
        rate_multiplier: 1,
        models: [
          { name: "gpt-image-2", platform: "composite", description: "图像模型模拟数据", pricing: { billing_mode: "image", per_request_price: 0.02, intervals: [{ tier_label: "1K", per_request_price: 0.02 }, { tier_label: "2K", per_request_price: 0.04 }, { tier_label: "4K", per_request_price: 0.08 }] } },
          { name: "gpt-image-2-alt", platform: "composite", description: "图像模型模拟数据（备用）", pricing: { billing_mode: "image", per_request_price: 0.03, intervals: [{ tier_label: "1K", per_request_price: 0.03 }, { tier_label: "2K", per_request_price: 0.05 }, { tier_label: "4K", per_request_price: 0.09 }] } },
          { name: "gpt-5.5", platform: "composite", description: "文本模型模拟数据", pricing: { billing_mode: "text", input_price: 0.5, output_price: 1.5, intervals: [] } },
          ...videoModelEntries,
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
    const authorization = String(request.headers.authorization || "");
    let modelIds = [
      "gpt-image-2",
      "gpt-image-2-alt",
      "gpt-5.5",
      ...videoModelEntries.map((model) => model.name),
    ];
    if (authorization.includes("sk-create-mock-video-boundary")) {
      modelIds = videoModelEntries.map((model) => model.name);
    } else if (authorization.includes("sk-create-mock-image-boundary")) {
      modelIds = ["gpt-image-2", "gpt-image-2-alt", "gpt-5.5"];
    }
    return send(response, 200, { object: "list", data: modelIds.map((id) => ({ id, object: "model" })) });
  }
  if (path === "/v1/images/generations" && method === "POST") {
    const payload = await body(request);
    lastImageRequest = {
      model: String(payload?.model || ""),
      prompt: String(payload?.prompt || ""),
      size: String(payload?.size || ""),
      quality: String(payload?.quality || ""),
      output_format: String(payload?.output_format || ""),
      createdAt: Date.now(),
    };
    if (failNextImageGeneration) {
      failNextImageGeneration = false;
      return send(response, 500, { error: { message: "mock image generation failure" } });
    }
    return send(response, 200, { created: Math.floor(Date.now() / 1000), data: [{ url: `data:image/png;base64,${png}` }] });
  }
  if (path === "/__mock/reset-image-state" && method === "POST") {
    failNextImageGeneration = false;
    lastImageRequest = null;
    return send(response, 200, { data: { ok: true } });
  }
  if (path === "/__mock/fail-next-image" && method === "POST") {
    failNextImageGeneration = true;
    return send(response, 200, { data: { ok: true } });
  }
  if (path === "/__mock/last-image-request" && method === "GET") {
    return send(response, 200, { data: lastImageRequest });
  }
  if (path === "/v1/images/edits" && method === "POST") {
    await body(request);
    return send(response, 200, { created: Math.floor(Date.now() / 1000), data: [{ url: `data:image/png;base64,${png}` }] });
  }
  if (path === "/v1/responses" && method === "POST") {
    await body(request);
    return send(response, 501, { error: { message: "responses endpoint is not implemented in mock" } });
  }
  if (path === "/v1/chat/completions" && method === "POST") {
    const payload = await body(request);
    const raw = JSON.stringify(payload);
    const storyboardRoles = ["hero", "pain-point", "core-benefit", "feature-detail", "scenario", "closing"];
    const storyboard = {
      id: "mock-product-storyboard",
      revision: 1,
      status: "draft",
      pages: storyboardRoles.map((role, index) => ({
        id: `mock-page-${index + 1}`,
        order: index + 1,
        role,
        title: `Mock 页面 ${index + 1}`,
        message: index === 0 ? "便携榨汁杯的核心卖点" : "清晰展示商品价值",
        copy: [
          { id: `copy-title-${index + 1}`, kind: "title", text: `Mock 页面 ${index + 1}` },
          { id: `copy-body-${index + 1}`, kind: "body", text: "适合办公室和健身场景。" },
          ...(role === "closing" ? [{ id: `copy-cta-${index + 1}`, kind: "cta", text: "立即了解" }] : []),
        ],
        visualPrompt: `第 ${index + 1} 页商品摄影底图，场景和构图独立`,
        negativePrompt: ["不得生成文字", "不得改变商品外观"],
        referenceAssetIds: [],
        factRefs: ["fact-1"],
        layoutTemplateId: "clean-commerce",
        status: "draft",
      })),
    };
    const content = raw.includes("商品详情页生成结构化分镜")
      ? JSON.stringify(storyboard)
      : JSON.stringify({
          message: "已整理商品信息，可以生成分镜。",
          briefPatch: {
            productName: "Mock 便携榨汁杯",
            category: "厨房小家电",
            description: "适合办公室和健身场景的便携榨汁杯",
            sellingPoints: [{ id: "fact-1", text: "一键榨汁", source: "user" }],
            targetAudience: ["上班族"],
            scenarios: ["办公室", "健身房"],
            platform: "taobao",
            pricePosition: "mid",
            visualStyle: ["清爽"],
            colorPreference: ["#111111"],
            copyTone: ["直接"],
            forbiddenContent: [],
            requiredModules: ["hero", "pain-point", "core-benefit", "feature-detail", "scenario", "closing"],
            assumptions: [],
          },
          question: null,
          readyToPlan: true,
          assumptions: [],
          risks: [],
          actions: [{ type: "plan_storyboard", label: "生成分镜" }],
        });
    return sendSse(response, content);
  }
  if (path === "/v1/video/generations" && method === "POST") {
    const payload = await body(request);
    const validation = validateMockVideoRequest(payload);
    if (validation.error) return send(response, 400, { code: 400, message: validation.error });
    lastVideoGenerationRequest = { ...payload, __mode: validation.mode };
    return send(response, 200, { code: 0, data: { id: "mock-video-task", status: "queued" } });
  }
  if (path === "/__mock/last-video-request" && method === "GET") {
    return send(response, 200, { code: 0, data: lastVideoGenerationRequest });
  }
  if (path === "/__mock/reference-assets" && method === "GET") {
    return send(response, 200, { code: 0, data: referenceAssetRequests });
  }
  if (path === "/api/v1/video-studio/reference-assets" && method === "POST") {
    const payload = await body(request);
    const kind = ["image", "video", "audio"].includes(payload.kind) ? payload.kind : "image";
    const id = randomUUID();
    referenceAssetRequests.push({ kind, dataPrefix: String(payload.data_url || "").slice(0, 32) });
    return send(response, 200, { code: 0, data: { url: `https://mock.local/reference/${kind}/${id}` } });
  }
  if (path === "/v1/videos/mock-video-task" && method === "GET") {
    const capabilityProbe = String(lastVideoGenerationRequest?.prompt || "").startsWith("mock capability ");
    return send(response, 200, {
      code: 0,
      data: capabilityProbe
        ? { id: "mock-video-task", status: "failed", error: { message: "mock capability probe complete" } }
        : { id: "mock-video-task", status: "completed" },
    });
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

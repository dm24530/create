import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureCanvasCloud,
  uploadCloudCanvasAsset,
  uploadCloudCanvasAssetFromURL,
} from "../canvas-cloud";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("canvas cloud asset upload", () => {
  beforeEach(() => {
    configureCanvasCloud("canvas-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads directly to object storage and completes the asset", async () => {
    const asset = {
      id: "asset-1",
      project_id: "project-1",
      node_id: "node-1",
      kind: "image",
      url: "https://cdn.example.test/asset-1.png",
      width: 640,
      height: 480,
      bytes: 5,
      mime_type: "image/png",
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        asset_id: "asset-1",
        object_key: "canvas-pending/user/project/asset-1.png",
        upload_url: "https://upload.example.test/asset-1",
        upload_headers: { "Content-Type": "image/png" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(asset));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadCloudCanvasAsset({
      projectId: "project-1",
      nodeId: "node-1",
      kind: "image",
      file: new Blob(["image"], { type: "image/png" }),
      filename: "image.png",
      width: 640,
      height: 480,
    });

    expect(result).toEqual(asset);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/assets/presign");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://upload.example.test/asset-1");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/assets/complete");
  });

  it.each([
    ["video", "video/mp4", "clip.mp4"],
    ["audio", "audio/mpeg", "clip.mp3"],
  ] as const)("supports %s direct uploads", async (kind, contentType, filename) => {
    const asset = {
      id: `asset-${kind}`,
      project_id: "project-1",
      node_id: "node-1",
      kind,
      url: `https://cdn.example.test/asset-${kind}`,
      width: 1280,
      height: 720,
      bytes: 5,
      mime_type: contentType,
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        asset_id: asset.id,
        object_key: `canvas-pending/user/project/${filename}`,
        upload_url: `https://upload.example.test/${kind}`,
        upload_headers: { "Content-Type": contentType },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(asset));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadCloudCanvasAsset({
      projectId: "project-1",
      nodeId: "node-1",
      kind,
      file: new Blob(["media"], { type: contentType }),
      filename,
      width: 1280,
      height: 720,
    });

    expect(result).toEqual(asset);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to the legacy endpoint when the object storage PUT fails", async () => {
    const asset = {
      id: "asset-legacy",
      project_id: "project-1",
      node_id: "node-1",
      kind: "image",
      url: "https://cdn.example.test/asset-legacy.png",
      width: 640,
      height: 480,
      bytes: 5,
      mime_type: "image/png",
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        asset_id: "asset-1",
        object_key: "canvas-pending/user/project/asset-1.png",
        upload_url: "https://upload.example.test/asset-1",
        upload_headers: { "Content-Type": "image/png" },
      }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(asset));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await uploadCloudCanvasAsset({
      projectId: "project-1",
      nodeId: "node-1",
      kind: "image",
      file: new Blob(["image"], { type: "image/png" }),
      filename: "image.png",
      width: 640,
      height: 480,
    });

    expect(result).toEqual(asset);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("/canvas/assets");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]?.body).toBeInstanceOf(FormData);
  });

  it("falls back when only the thumbnail upload fails", async () => {
    const asset = {
      id: "asset-thumb-fallback",
      project_id: "project-1",
      node_id: "node-1",
      kind: "image",
      url: "https://cdn.example.test/asset-thumb-fallback.png",
      width: 640,
      height: 480,
      bytes: 5,
      mime_type: "image/png",
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        asset_id: "asset-1",
        object_key: "canvas-pending/user/project/asset-1.png",
        upload_url: "https://upload.example.test/asset-1",
        upload_headers: { "Content-Type": "image/png" },
        thumb_object_key: "canvas-pending/user/project/thumbs/asset-1.webp",
        thumb_upload_url: "https://upload.example.test/asset-1-thumb",
        thumb_upload_headers: { "Content-Type": "image/webp" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(asset));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await uploadCloudCanvasAsset({
      projectId: "project-1",
      nodeId: "node-1",
      kind: "image",
      file: new Blob(["image"], { type: "image/png" }),
      filename: "image.png",
      thumbnail: new Blob(["thumb"], { type: "image/webp" }),
      width: 640,
      height: 480,
    });

    expect(result).toEqual(asset);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain("/canvas/assets");
  });

  it("keeps the source URL upload path for remote-only assets", async () => {
    const asset = {
      id: "asset-url",
      project_id: "project-1",
      node_id: "node-1",
      kind: "image",
      url: "https://cdn.example.test/asset-url.png",
      width: 0,
      height: 0,
      bytes: 0,
      mime_type: "image/png",
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(asset));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadCloudCanvasAssetFromURL({
      projectId: "project-1",
      nodeId: "node-1",
      kind: "image",
      sourceUrl: "https://remote.example.test/source.png",
    });

    expect(result).toEqual(asset);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/canvas/assets");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("source_url")).toBe("https://remote.example.test/source.png");
  });
});

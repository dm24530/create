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

  it("uploads through the Create multipart endpoint", async () => {
    const asset = {
      id: "asset-1",
      project_id: "project-1",
      node_id: "node-1",
      kind: "image",
      url: "/api/v1/public/canvas-assets/asset-1/content",
      width: 640,
      height: 480,
      bytes: 5,
      mime_type: "image/png",
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(asset));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/canvas/assets");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it.each([
    ["video", "video/mp4", "clip.mp4"],
    ["audio", "audio/mpeg", "clip.mp3"],
  ] as const)("supports %s multipart uploads", async (kind, contentType, filename) => {
    const asset = {
      id: `asset-${kind}`,
      project_id: "project-1",
      node_id: "node-1",
      kind,
      url: `/api/v1/public/canvas-assets/asset-${kind}/content`,
      width: 1280,
      height: 720,
      bytes: 5,
      mime_type: contentType,
      created_at: "2026-11-07T00:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(asset));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps source URL import restricted to Create media paths", async () => {
    const asset = {
      id: "asset-url",
      project_id: "project-1",
      node_id: "node-1",
      kind: "image",
      url: "/api/v1/public/canvas-assets/asset-url/content",
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
      sourceUrl: "/api/v1/public/image-assets/source",
    });

    expect(result).toEqual(asset);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/canvas/assets");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("source_url")).toBe("/api/v1/public/image-assets/source");
  });
});

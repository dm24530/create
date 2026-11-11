import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteStoredMedia, getMediaBlob, uploadMediaFile } from "../file-storage";
import { deleteStoredImages, getImageBlob, previewUrlFor, uploadImage } from "../image-storage";

class MockImage {
  naturalWidth = 1600;
  naturalHeight = 1200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe("canvas local uploads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("stores, reads, and deletes local image blobs", async () => {
    let objectURL = 0;
    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 1600,
      height: 1200,
      close: vi.fn(),
    })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["thumbnail"], { type: "image/webp" }));
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:image-${++objectURL}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const source = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

    const uploaded = await uploadImage(source);

    expect(uploaded.storageKey).toMatch(/^image:/);
    expect(uploaded.width).toBe(1600);
    expect(uploaded.height).toBe(1200);
    expect(uploaded.mimeType).toBe("image/png");
    expect(uploaded.url).toMatch(/^blob:image-/);
    expect(previewUrlFor(uploaded.storageKey)).toMatch(/^blob:image-/);
    expect(await getImageBlob(uploaded.storageKey!)).toBeInstanceOf(Blob);

    await deleteStoredImages([uploaded.storageKey!]);
    expect(await getImageBlob(uploaded.storageKey!)).toBeNull();
  });

  it("stores, reads, and deletes local media blobs", async () => {
    let objectURL = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:media-${++objectURL}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const source = new Blob(["media"], { type: "application/octet-stream" });

    const uploaded = await uploadMediaFile(source, "file");

    expect(uploaded.storageKey).toMatch(/^file:/);
    expect(uploaded.bytes).toBe(source.size);
    expect(uploaded.mimeType).toBe("application/octet-stream");
    expect(await getMediaBlob(uploaded.storageKey)).toBeInstanceOf(Blob);

    await deleteStoredMedia([uploaded.storageKey]);
    expect(await getMediaBlob(uploaded.storageKey)).toBeNull();
  });
});

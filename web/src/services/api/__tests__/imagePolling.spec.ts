import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import axios from "axios";
import { configureCanvasAuth } from "@/services/canvas-auth";
import { waitForPersistentImageTask } from "../image";
import type { AiConfig } from "@/types/image";

vi.mock("axios", () => ({
    default: {
        get: vi.fn(),
        isCancel: vi.fn(() => false),
        isAxiosError: vi.fn(() => false),
    },
    isCancel: vi.fn(() => false),
    isAxiosError: vi.fn(() => false),
}));

const config = {
    baseUrl: "http://localhost:9896/v1",
    apiKey: "sk-test",
    model: "gemini-3-pro-image",
    outputFormat: "png",
} as AiConfig;

describe("waitForPersistentImageTask", () => {
    beforeEach(() => {
        configureCanvasAuth("canvas-access-token");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ data: { tracked: true } }),
        }));
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.mocked(axios.isAxiosError).mockReturnValue(false);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        configureCanvasAuth("");
    });

    it("accepts ready tasks as completed results", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                status: "ready",
                result: {
                    data: [{
                        b64_json: "aW1hZ2U=",
                        mime_type: "image/png",
                    }],
                },
            },
        });

        const result = await waitForPersistentImageTask(config, {
            taskId: "imgtask_ready",
            pollUrl: "/v1/images/tasks/imgtask_ready",
            provider: "openai",
        });

        expect(result).toHaveLength(1);
        expect(result[0]?.dataUrl).toBe("data:image/png;base64,aW1hZ2U=");
    });

    it("keeps polling when a ready task only has a pending preview and returns the original", async () => {
        vi.useFakeTimers();
        const onPreview = vi.fn();
        vi.mocked(axios.get)
            .mockResolvedValueOnce({
                data: {
                    status: "ready",
                    result: {
                        created: 1,
                        data: [{
                            preview_data_url: "data:image/jpeg;base64,cHJldmlldw==",
                            upload_status: "pending",
                        }],
                    },
                },
            })
            .mockResolvedValueOnce({
                data: {
                    status: "ready",
                    result: {
                        created: 1,
                        data: [{
                            b64_json: "b3JpZ2luYWw=",
                            mime_type: "image/png",
                            upload_status: "uploaded",
                        }],
                    },
                },
            });

        const pending = waitForPersistentImageTask(config, {
            taskId: "imgtask_preview_only",
            pollUrl: "/v1/images/tasks/imgtask_preview_only",
            provider: "openai",
        }, {
            onPreview,
        });
        await vi.advanceTimersByTimeAsync(500);
        const result = await pending;

        expect(result).toHaveLength(1);
        expect(result[0]?.dataUrl).toBe("data:image/png;base64,b3JpZ2luYWw=");
        expect(onPreview).toHaveBeenCalledWith([
            expect.objectContaining({ dataUrl: "data:image/jpeg;base64,cHJldmlldw==" }),
        ]);
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("reports the end-to-end canvas display duration for the image task", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-07T14:20:28.680Z"));
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ data: { tracked: true } }),
        });
        vi.stubGlobal("fetch", fetchMock);
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                status: "ready",
                result: {
                    data: [{
                        b64_json: "aW1hZ2U=",
                        mime_type: "image/png",
                    }],
                },
            },
        });

        await waitForPersistentImageTask(config, {
            taskId: "imgtask_canvas_timing",
            pollUrl: "/v1/images/tasks/imgtask_canvas_timing",
            provider: "openai",
        }, {
            startedAt: Date.now() - 28_680,
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/v1/usage/image-display",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: "Bearer canvas-access-token",
                    "Content-Type": "application/json",
                }),
                body: JSON.stringify({
                    task_id: "imgtask_canvas_timing",
                    duration_ms: 28_680,
                }),
            }),
        );
    });

    it("preserves the upstream failure reason from a failed image task", async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                status: "failed",
                error: {
                    message: "内容审核未通过：提示词包含受限内容",
                },
            },
        });

        await expect(waitForPersistentImageTask(config, {
            taskId: "imgtask_failed_reason",
            pollUrl: "/v1/images/tasks/imgtask_failed_reason",
            provider: "openai",
        })).rejects.toThrow("内容审核未通过：提示词包含受限内容");
    });

    it("surfaces the response body when polling the image task returns an HTTP error", async () => {
        vi.mocked(axios.get).mockRejectedValueOnce({
            code: "ERR_BAD_REQUEST",
            message: "Request failed with status code 400",
            response: {
                status: 400,
                data: {
                    error: {
                        message: "上游模型不支持当前尺寸参数",
                    },
                },
            },
        });
        vi.mocked(axios.isAxiosError).mockReturnValue(true);

        await expect(waitForPersistentImageTask(config, {
            taskId: "imgtask_http_error",
            pollUrl: "/v1/images/tasks/imgtask_http_error",
            provider: "openai",
        })).rejects.toThrow("上游模型不支持当前尺寸参数");
    });
});

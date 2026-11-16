import { ArrowLeft, ArrowRight, CheckSquare, ChevronDown, ClipboardPaste, Copy, Download, Film, FolderPlus, History, LoaderCircle, Music2, Plus, RefreshCw, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { type CSSProperties, type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parsePixelSize, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { getManagedKeySelection, listCreateManagedKeys, managedKeySupportsVideo, switchManagedKey, type CreateManagedKey } from "@/services/create-managed-channel";
import { WorkbenchModelSelect } from "@/components/workbench/model-select";
import { PanelResizeHandle, useStoredPanelWidth } from "@/components/workbench/panel-resize-handle";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { boolConfig, encodeChannelModel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const MAX_WORKBENCH_LOGS = 100;
const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_VIDEOS = 3;
const MAX_REFERENCE_AUDIOS = 3;
const MAX_VIDEO_TASKS = 4;
const MAX_PROMPT_LENGTH = 5000;
const VIDEO_SECONDS_PRESETS = [5, 8, 10, 15] as const;
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const logPanelRef = useRef<HTMLElement>(null);
    const workbenchPanelRef = useRef<HTMLDivElement>(null);
    const [logPanelWidth, setLogPanelWidth] = useStoredPanelWidth("create-canvas:video-workbench-layout:logs", 300);
    const [workbenchPanelWidth, setWorkbenchPanelWidth] = useStoredPanelWidth("create-canvas:video-workbench-layout:form", 600);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssets = useAssetStore((state) => state.cleanupImages);
    const session = useUserStore((state) => state.session);
    const [videoKeys, setVideoKeys] = useState<CreateManagedKey[]>([]);
    const [videoKeysLoading, setVideoKeysLoading] = useState(false);
    const [selectedVideoKeyId, setSelectedVideoKeyId] = useState(() => getManagedKeySelection().videoKeyId);
    const [switchingVideoKey, setSwitchingVideoKey] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [referenceVideos, setReferenceVideos] = useState<ReferenceVideo[]>([]);
    const [referenceAudios, setReferenceAudios] = useState<ReferenceAudio[]>([]);
    const [taskCount, setTaskCount] = useState(1);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const layoutStyle = {
        "--log-panel-width": `${logPanelWidth}px`,
        "--workbench-panel-width": `${workbenchPanelWidth}px`,
    } as CSSProperties;

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const videoModelGroups = effectiveConfig.channels
        .map((channel) => {
            const capableModels = channel.models.filter((item) => item.capability === "video").map((item) => ({ value: encodeChannelModel(channel.id, item.name), label: item.name }));
            const allModels = channel.models.map((item) => ({ value: encodeChannelModel(channel.id, item.name), label: item.name }));
            return { id: channel.id, name: channel.name, models: capableModels.length ? capableModels : allModels };
        })
        .filter((group) => group.models.length > 0);
    if (model && !videoModelGroups.some((group) => group.models.some((item) => item.value === model))) {
        videoModelGroups.push({ id: "current-model", name: "当前模型", models: [{ value: model, label: modelOptionName(model) }] });
    }
    const videoModelOptions = videoModelGroups.flatMap((group) => group.models.map((item) => item.value));
    const canGenerate = Boolean(prompt.trim());
    const resolution = parseVideoResolution(effectiveConfig.vquality);
    const selectedRatio = inferVideoRatio(effectiveConfig.size);
    const dimensions = readVideoDimensions(effectiveConfig.size, resolution, selectedRatio);
    const seconds = Number(clampVideoSeconds(effectiveConfig.videoSeconds || "5"));
    const generateAudio = boolConfig(effectiveConfig.videoGenerateAudio, true);
    const selectedSizeLabel = selectedRatio === "auto" ? "自适应" : `${videoOrientationLabel(selectedRatio)} ${dimensions.width}×${dimensions.height}`;

    const loadVideoKeys = useCallback(async () => {
        if (!session) {
            setVideoKeys([]);
            return;
        }
        setVideoKeysLoading(true);
        try {
            const keys = (await listCreateManagedKeys(session)).filter((item) => item.status === "active" && Boolean(item.key?.trim()) && managedKeySupportsVideo(item.group));
            setVideoKeys(keys);
            const storedId = getManagedKeySelection().videoKeyId;
            setSelectedVideoKeyId((current) => keys.find((item) => item.id === storedId)?.id || keys.find((item) => item.id === current)?.id || keys[0]?.id || 0);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载视频 API 密钥失败");
        } finally {
            setVideoKeysLoading(false);
        }
    }, [message, session]);

    const selectVideoKey = async (keyId: number) => {
        if (!session || !keyId || keyId === selectedVideoKeyId || switchingVideoKey) return;
        const key = videoKeys.find((item) => item.id === keyId);
        if (!key) return;
        const previousId = selectedVideoKeyId;
        setSelectedVideoKeyId(keyId);
        setSwitchingVideoKey(true);
        try {
            await switchManagedKey(session, key, "video");
            setSelectedVideoKeyId(getManagedKeySelection().videoKeyId || keyId);
            message.success(`已切换到 ${key.name}`);
            await loadVideoKeys();
        } catch (error) {
            setSelectedVideoKeyId(previousId);
            message.error(error instanceof Error ? error.message : "切换视频 API 密钥失败");
        } finally {
            setSwitchingVideoKey(false);
        }
    };

    useEffect(() => {
        void loadVideoKeys();
    }, [loadVideoKeys]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void (async () => {
            const pruned = await pruneStoredLogs();
            await refreshLogs();
            if (pruned) cleanupAssets();
        })();
    }, [cleanupAssets]);

    const addReferences = async (files?: FileList | File[] | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/"));
        if (unsupported.length) message.warning(t("videoWorkbench.unsupportedFiles"));

        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/"));
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/"));
        const audioFiles = selectedFiles.filter((file) => file.type.startsWith("audio/"));

        const acceptedImages = imageFiles.filter((file) => file.size <= 30 * 1024 * 1024).slice(0, Math.max(0, MAX_REFERENCE_IMAGES - references.length));
        const acceptedVideos = videoFiles.filter((file) => file.size <= 200 * 1024 * 1024).slice(0, Math.max(0, MAX_REFERENCE_VIDEOS - referenceVideos.length));
        const acceptedAudios = audioFiles.filter((file) => file.size <= 15 * 1024 * 1024).slice(0, Math.max(0, MAX_REFERENCE_AUDIOS - referenceAudios.length));
        if (imageFiles.some((file) => file.size > 30 * 1024 * 1024)) message.warning(t("videoWorkbench.imageTooLarge"));
        if (videoFiles.some((file) => file.size > 200 * 1024 * 1024)) message.warning(t("videoWorkbench.videoTooLarge"));
        if (audioFiles.some((file) => file.size > 15 * 1024 * 1024)) message.warning(t("videoWorkbench.audioTooLarge"));

        const [nextImages, nextVideos, nextAudios] = await Promise.all([
            Promise.all(
                acceptedImages.map(async (file) => {
                    const image = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            ),
            Promise.all(
                acceptedVideos.map(async (file) => {
                    const video = await uploadMediaFile(file, "video");
                    return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
                }),
            ),
            Promise.all(
                acceptedAudios.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                }),
            ),
        ]);

        const totalAudioMs = referenceAudios.reduce((total, item) => total + (item.durationMs || 0), 0);
        let runningAudioMs = totalAudioMs;
        const validAudios = nextAudios.filter((audio) => {
            const duration = audio.durationMs || 0;
            if (duration && (duration < 2_000 || duration > 15_000 || runningAudioMs + duration > 15_000)) return false;
            runningAudioMs += duration;
            return true;
        });
        if (validAudios.length !== nextAudios.length) message.warning(t("videoWorkbench.audioDurationInvalid"));

        setReferences((value) => [...value, ...nextImages].slice(0, MAX_REFERENCE_IMAGES));
        setReferenceVideos((value) => [...value, ...nextVideos].slice(0, MAX_REFERENCE_VIDEOS));
        setReferenceAudios((value) => [...value, ...validAudios].slice(0, MAX_REFERENCE_AUDIOS));
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(true);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(false);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(false);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, Math.max(0, MAX_REFERENCE_IMAGES - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, MAX_REFERENCE_IMAGES));
            message.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const copyPrompt = async () => {
        if (!prompt.trim()) return;
        try {
            await navigator.clipboard.writeText(prompt);
            message.success("提示词已复制");
        } catch {
            message.error("复制提示词失败");
        }
    };

    const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        void addReferences(files);
    };

    const selectResolution = (nextResolution: string) => {
        updateConfig("vquality", nextResolution);
        if (selectedRatio !== "auto") updateConfig("size", computeVideoSize(nextResolution, selectedRatio));
    };

    const selectVideoRatio = (ratio: string) => {
        updateConfig("size", ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio));
    };

    const commitSeconds = (raw: string) => {
        updateConfig("videoSeconds", clampVideoSeconds(raw));
    };

    const commitTaskCount = (raw: string) => {
        setTaskCount(Math.max(1, Math.min(MAX_VIDEO_TASKS, Math.floor(Number(raw) || 1))));
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        const requestedCount = Math.max(1, Math.min(MAX_VIDEO_TASKS, taskCount));
        const resultSlots: GenerationResult[] = Array.from({ length: requestedCount }, () => ({ id: nanoid(), status: "pending" }));
        setResults(resultSlots);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const settled = await Promise.allSettled(
            Array.from({ length: requestedCount }, () =>
                createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, {
                    videos: snapshot.referenceVideos,
                    audios: snapshot.referenceAudios,
                }),
            ),
        );
        const nextResults = [...resultSlots];
        const pendingLogs: Array<{ log: GenerationLog; slotId: string; index: number }> = [];
        let firstAgentTaskIndex = -1;

        for (let index = 0; index < settled.length; index += 1) {
            const settledResult = settled[index];
            const slot = resultSlots[index];
            if (settledResult.status === "fulfilled") {
                if (firstAgentTaskIndex < 0) firstAgentTaskIndex = index;
                const log = buildLog({
                    prompt: snapshot.text,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    referenceVideos: snapshot.referenceVideos,
                    referenceAudios: snapshot.referenceAudios,
                    durationMs: 0,
                    status: "pending",
                    task: settledResult.value,
                });
                pendingLogs.push({ log, slotId: slot.id, index });
            } else {
                const errorMessage = settledResult.reason instanceof Error ? settledResult.reason.message : t("workbench.generationFailed");
                nextResults[index] = { ...slot, status: "failed", error: errorMessage };
                await saveLog(
                    buildLog({
                        prompt: snapshot.text,
                        model,
                        config: snapshot.config,
                        references: snapshot.references,
                        referenceVideos: snapshot.referenceVideos,
                        referenceAudios: snapshot.referenceAudios,
                        durationMs: performance.now() - batchStartedAt,
                        status: "failed",
                        error: errorMessage,
                    }),
                );
                message.error(errorMessage);
            }
        }

        setResults(nextResults);
        if (!pendingLogs.length) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: requestedCount, error: t("workbench.generationFailed") });
            setRunning(false);
            return;
        }
        for (const { log, slotId, index } of pendingLogs) {
            await saveLog(log, false);
            void pollGenerationLog(log, snapshot.config, index === firstAgentTaskIndex ? agentTaskId : undefined, slotId);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return {
            text,
            config: buildVideoConfig(effectiveConfig, model),
            references: [...references],
            referenceVideos: [...referenceVideos],
            referenceAudios: [...referenceAudios],
        };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, MAX_REFERENCE_IMAGES));
        } else if (payload.kind === "video") {
            const source = payload.storageKey ? await resolveMediaUrl(payload.storageKey, payload.url) : payload.url;
            const stored = await uploadMediaFile(source, "video");
            setReferenceVideos((value) =>
                [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, width: stored.width, height: stored.height, durationMs: stored.durationMs }].slice(
                    0,
                    MAX_REFERENCE_VIDEOS,
                ),
            );
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setReferenceVideos([]);
        setReferenceAudios([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        void Promise.all(selectedLogIds.map((id) => logStore.removeItem(id))).then(async () => {
            await refreshLogs();
            cleanupAssets();
        });
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        await logStore.setItem(log.id, serializeLog(log));
        const pruned = await pruneStoredLogs();
        await refreshLogs(resumePending);
        if (pruned) cleanupAssets();
    };

    const refreshLogs = async (resumePending = true) => {
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string, resultSlotId?: string) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        const resultId = resultSlotId || log.id;
        const upsertResult = (next: Omit<GenerationResult, "id">) => {
            setResults((value) => {
                const index = value.findIndex((item) => item.id === resultId);
                if (index < 0) return [...value, { id: resultId, ...next }];
                return value.map((item, itemIndex) => (itemIndex === index ? { id: resultId, ...next } : item));
            });
        };
        activeLogIdsRef.current.add(log.id);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        setResults((value) => (value.some((item) => item.id === resultId) ? value : [...value, { id: resultId, status: "pending" }]));
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                if (state.status === "completed") {
                    const stored = await storeGeneratedVideo(state.result);
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        storageKey: stored.storageKey,
                        durationMs: Date.now() - log.createdAt,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    upsertResult({ status: "success", video: nextVideo, error: undefined });
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                    await saveLog({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
                    message.success(t("videoWorkbench.generated"));
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error(t("videoWorkbench.timeout"));
                await delay(2500);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            upsertResult({ status: "failed", error: errorMessage, video: undefined });
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setReferenceVideos(log.referenceVideos || []);
        setReferenceAudios(log.referenceAudios || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoMode) updateConfig("videoMode", log.config.videoMode);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || t("workbench.generationFailed") }]);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="workbench-main-grid grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:overflow-hidden" style={layoutStyle}>
                <aside ref={logPanelRef} className="thin-scrollbar hidden min-w-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                    />
                </aside>

                <PanelResizeHandle
                    className="hidden lg:flex"
                    label="调整生成记录宽度"
                    getWidth={() => logPanelRef.current?.getBoundingClientRect().width || logPanelWidth}
                    minWidth={280}
                    maxWidth={() => Math.min(520, window.innerWidth * 0.28)}
                    onWidthChange={setLogPanelWidth}
                />

                <section className="workbench-split-grid grid gap-3 lg:min-h-0 lg:overflow-hidden">
                    <div ref={workbenchPanelRef} className="thin-scrollbar flex min-w-0 flex-col rounded-xl border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto [&>*]:shrink-0">
                        <div className="flex items-center justify-between gap-3">
                            <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-stone-950 dark:text-stone-100">{t("videoWorkbench.title")}</h1>
                            <button
                                type="button"
                                className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100 lg:hidden"
                                title={t("workbench.logs")}
                                aria-label={t("workbench.logs")}
                                onClick={() => setLogsOpen(true)}
                            >
                                <History className="size-4" />
                            </button>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            <label className="relative flex h-10 min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 text-sm dark:border-stone-700 dark:bg-stone-900/60">
                                <span className="shrink-0 px-3 text-xs font-medium text-stone-500 dark:text-stone-400">API Key</span>
                                <span className="h-4 w-px shrink-0 bg-stone-300 dark:bg-stone-700" />
                                <select
                                    aria-label="视频 API Key"
                                    className="workbench-native-select h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-3 pr-9 text-sm text-stone-800 outline-none disabled:cursor-not-allowed disabled:text-stone-500 dark:text-stone-100"
                                    value={videoKeysLoading || !videoKeys.some((item) => item.id === selectedVideoKeyId) ? 0 : selectedVideoKeyId}
                                    disabled={videoKeysLoading || switchingVideoKey || !videoKeys.length}
                                    onChange={(event) => void selectVideoKey(Number(event.target.value))}
                                >
                                    {videoKeysLoading ? <option value={0}>正在加载...</option> : null}
                                    {!videoKeysLoading && !videoKeys.length ? <option value={0}>暂无可用密钥</option> : null}
                                    {!videoKeysLoading
                                        ? videoKeys.map((item) => (
                                              <option key={item.id} value={item.id}>
                                                  {item.name}
                                              </option>
                                          ))
                                        : null}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 size-4 text-stone-500" />
                            </label>
                            <button
                                type="button"
                                className="grid size-10 shrink-0 place-items-center rounded-xl border border-stone-200 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:cursor-wait disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                disabled={videoKeysLoading || switchingVideoKey || !session}
                                title="刷新视频 API 密钥"
                                aria-label="刷新视频 API 密钥"
                                onClick={() => void loadVideoKeys()}
                            >
                                <RefreshCw className={`size-4 ${videoKeysLoading || switchingVideoKey ? "animate-spin" : ""}`} />
                            </button>
                        </div>

                        <div className="mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/70">
                            <textarea
                                className="workbench-prompt-textarea block w-full flex-none resize-y bg-transparent px-4 py-4 text-[15px] leading-6 text-stone-900 outline-none placeholder:text-stone-500 dark:text-stone-100"
                                style={{ height: 180, minHeight: 180, maxHeight: 420 }}
                                value={prompt}
                                maxLength={MAX_PROMPT_LENGTH}
                                onChange={(event) => setPrompt(event.target.value)}
                                onPaste={handleComposerPaste}
                                placeholder={t("videoWorkbench.promptPlaceholder")}
                            />
                            <div className="flex items-center justify-between gap-2 px-2.5 pb-1">
                                <div className="min-w-0 max-w-[300px] flex-1">
                                    <WorkbenchModelSelect
                                        label="视频模型"
                                        value={videoModelGroups.some((group) => group.models.some((item) => item.value === model)) ? model : ""}
                                        groups={videoModelGroups}
                                        onChange={(value) => updateConfig("videoModel", value)}
                                        onEmptyOpen={() => openConfigDialog(false)}
                                    />
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                    <button
                                        type="button"
                                        className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                        disabled={!prompt.trim()}
                                        title="复制提示词"
                                        aria-label="复制提示词"
                                        onClick={() => void copyPrompt()}
                                    >
                                        <Copy className="size-4" />
                                    </button>
                                    <button
                                        type="button"
                                        className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                        disabled={references.length >= MAX_REFERENCE_IMAGES}
                                        title="从剪贴板添加参考图"
                                        aria-label="从剪贴板添加参考图"
                                        onClick={() => void addReferencesFromClipboard()}
                                    >
                                        <ClipboardPaste className="size-4" />
                                    </button>
                                    <button
                                        type="button"
                                        className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                        disabled={!prompt}
                                        title="清空提示词"
                                        aria-label="清空提示词"
                                        onClick={() => setPrompt("")}
                                    >
                                        <Trash2 className="size-4" />
                                    </button>
                                    <button
                                        type="button"
                                        className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                        title="查看我的资产"
                                        aria-label="查看我的资产"
                                        onClick={() => setAssetPickerOpen(true)}
                                    >
                                        <FolderPlus className="size-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="px-3 pb-2 text-right text-[11px] text-stone-500">
                                {prompt.length}/{MAX_PROMPT_LENGTH}
                            </div>
                        </div>

                        <div className="mt-3 min-w-0">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">参考素材</span>
                                <button
                                    type="button"
                                    className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    title="上传参考素材"
                                    aria-label="上传参考素材"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Upload className="size-4" />
                                </button>
                            </div>
                            <div
                                className={`hover-scrollbar hover-scrollbar-hint mt-2 flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-xl p-0.5 pb-2 overscroll-x-contain transition-colors ${referenceDragTarget ? "bg-stone-100 ring-2 ring-stone-400 dark:bg-stone-900/80 dark:ring-stone-500" : ""}`}
                                onDragEnter={handleReferenceDragEnter}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                }}
                                onDragLeave={handleReferenceDragLeave}
                                onDrop={handleReferenceDrop}
                                onWheel={(event) => {
                                    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                    event.preventDefault();
                                    event.currentTarget.scrollLeft += event.deltaY;
                                }}
                            >
                                {references.map((item, index) => (
                                    <div key={item.id} className="group relative size-24 shrink-0 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
                                        <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt={item.name} className="size-full object-cover" />
                                        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">图片{index + 1}</span>
                                        <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                        <button
                                            type="button"
                                            className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-md bg-black/65 text-white backdrop-blur group-hover:flex"
                                            onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                            aria-label={t("videoWorkbench.removeImage")}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {referenceVideos.map((item, index) => (
                                    <div key={item.id} className="group relative size-24 shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-900 dark:border-stone-700">
                                        <video src={item.url} muted preload="metadata" className="size-full object-cover opacity-80" />
                                        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                                            <Film className="size-3" /> 视频{index + 1}
                                        </span>
                                        <button
                                            type="button"
                                            className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-md bg-black/65 text-white backdrop-blur group-hover:flex"
                                            onClick={() => setReferenceVideos((value) => value.filter((ref) => ref.id !== item.id))}
                                            aria-label={t("videoWorkbench.removeVideo")}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {referenceAudios.map((item, index) => (
                                    <div
                                        key={item.id}
                                        className="group relative flex size-24 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-gradient-to-br from-stone-800 to-stone-900 p-2 text-center dark:border-stone-700"
                                    >
                                        <Music2 className="size-7 text-stone-300" />
                                        <span className="mt-2 line-clamp-2 text-[10px] leading-4 text-stone-300">{item.name}</span>
                                        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white">音频{index + 1}</span>
                                        <button
                                            type="button"
                                            className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-md bg-black/65 text-white backdrop-blur group-hover:flex"
                                            onClick={() => setReferenceAudios((value) => value.filter((ref) => ref.id !== item.id))}
                                            aria-label={t("videoWorkbench.removeAudio")}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-stone-500 text-stone-500 transition hover:border-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:hover:border-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                                    title={referenceDragTarget ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noImages")}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Plus className="size-7 stroke-[1.4]" />
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] leading-4 text-stone-500">可拖拽或粘贴参考图、视频或音频，图片最多 {MAX_REFERENCE_IMAGES} 张。</p>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">清晰度</div>
                            <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-stone-200 bg-stone-100/60 p-1 dark:border-stone-700 dark:bg-stone-900/60">
                                {["480", "720", "1080"].map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`h-9 rounded-lg text-sm transition ${resolution === value ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"}`}
                                        onClick={() => selectResolution(value)}
                                    >
                                        {value}P
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">尺寸</div>
                            <div className="relative">
                                <VideoSizeBadge ratio={selectedRatio} className="pointer-events-none absolute left-3 top-3 z-10 text-stone-400" />
                                <select
                                    aria-label="视频尺寸"
                                    className="workbench-native-select h-9 w-full cursor-pointer appearance-none rounded-xl border border-stone-200 bg-stone-50 pl-10 pr-9 text-sm text-stone-800 outline-none dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-100"
                                    value={selectedRatio}
                                    onChange={(event) => selectVideoRatio(event.target.value)}
                                >
                                    {videoRatioOptions
                                        .filter((item) => item.value !== "auto")
                                        .map((item) => (
                                            <option key={item.value} value={item.value}>
                                                {videoRatioSizeLabel(item.value, resolution)}
                                            </option>
                                        ))}
                                    <option value="auto">自适应</option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-stone-500" />
                            </div>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">秒数</div>
                            <div className="grid grid-cols-[1fr_96px] items-center gap-2">
                                <div className="grid grid-cols-4 rounded-xl border border-stone-200 p-1 dark:border-stone-700">
                                    {VIDEO_SECONDS_PRESETS.map((value) => (
                                        <button
                                            key={value}
                                            type="button"
                                            className={`h-9 rounded-lg text-sm transition ${seconds === value ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"}`}
                                            onClick={() => updateConfig("videoSeconds", String(value))}
                                        >
                                            {value}秒
                                        </button>
                                    ))}
                                </div>
                                <label className="flex h-9 items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                                    <input
                                        aria-label="自定义秒数"
                                        type="number"
                                        min={VIDEO_SECONDS_MIN}
                                        max={VIDEO_SECONDS_MAX}
                                        defaultValue={seconds}
                                        key={seconds}
                                        className="min-w-0 flex-1 bg-transparent px-2 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        onBlur={(event) => commitSeconds(event.currentTarget.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") event.currentTarget.blur();
                                        }}
                                    />
                                    <span className="pr-2 text-xs text-stone-500">秒</span>
                                </label>
                            </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">任务数量</span>
                            <label className="flex h-10 w-[96px] items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                                <input
                                    aria-label="视频任务数量"
                                    type="number"
                                    min={1}
                                    max={MAX_VIDEO_TASKS}
                                    defaultValue={taskCount}
                                    key={taskCount}
                                    className="min-w-0 flex-1 bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    onBlur={(event) => commitTaskCount(event.currentTarget.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") event.currentTarget.blur();
                                    }}
                                />
                            </label>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">生成音频</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={generateAudio}
                                aria-label="生成音频"
                                className={`relative h-6 w-10 shrink-0 rounded-full transition ${generateAudio ? "bg-stone-200" : "bg-stone-600"}`}
                                onClick={() => updateConfig("videoGenerateAudio", String(!generateAudio))}
                            >
                                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] ${generateAudio ? "left-[18px]" : "left-0.5"}`} />
                            </button>
                        </div>

                        <div className="mt-3">
                            <Button
                                type="primary"
                                size="large"
                                block
                                icon={<Sparkles className="size-4" />}
                                loading={running}
                                disabled={!canGenerate || running}
                                onClick={() => void generate()}
                                className="!h-10 !rounded-xl !border-0 !bg-stone-300 !font-semibold !text-stone-950 !shadow-none hover:!bg-stone-200 disabled:!bg-stone-600 disabled:!text-stone-300"
                            >
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <PanelResizeHandle
                        className="hidden xl:flex"
                        label="调整工作台宽度"
                        getWidth={() => workbenchPanelRef.current?.getBoundingClientRect().width || workbenchPanelWidth}
                        minWidth={360}
                        maxWidth={() => Math.min(820, window.innerWidth * 0.46)}
                        onWidthChange={setWorkbenchPanelWidth}
                    />

                    <div className="thin-scrollbar min-w-0 rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("videoWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                />
            </Drawer>
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function VideoSizeBadge({ ratio, className = "" }: { ratio: string; className?: string }) {
    const item = videoRatioOptions.find((option) => option.value === ratio);
    if (!item || item.value === "auto") return <span className={`block size-4 ${className}`} />;
    const longSide = Math.max(item.width, item.height);
    const width = Math.max(8, Math.round((item.width / longSide) * 18));
    const height = Math.max(8, Math.round((item.height / longSide) * 18));
    return <span className={`block rounded-[3px] border-2 border-current ${className}`} style={{ width, height }} />;
}

function videoOrientationLabel(ratio: string) {
    const item = videoRatioOptions.find((option) => option.value === ratio);
    if (!item || item.value === "auto") return "自适应";
    if (item.width === item.height) return "方形";
    return item.width > item.height ? "横屏" : "竖屏";
}

function videoRatioSizeLabel(ratio: string, resolution: string) {
    const pixels = parsePixelSize(computeVideoSize(resolution, ratio));
    if (!pixels) return "自适应";
    return `${videoOrientationLabel(ratio)} ${pixels.width}×${pixels.height}`;
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="flex min-w-0 items-start gap-2">
                <Checkbox className="mt-0.5 shrink-0" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 break-words text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red"}>
                            {t(`workbench.${log.status === "success" ? "success" : log.status === "pending" ? "generating" : "failed"}`)}
                        </Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function pruneStoredLogs() {
    const logs: GenerationLog[] = [];
    await logStore.iterate<GenerationLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    if (logs.length <= MAX_WORKBENCH_LOGS) return false;
    const removable = logs
        .filter((log) => log.status !== "pending")
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .slice(0, logs.length - MAX_WORKBENCH_LOGS);
    if (!removable.length) return false;
    await Promise.all(removable.map((log) => logStore.removeItem(log.id)));
    return true;
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const referenceVideos = await Promise.all((log.referenceVideos || []).map(async (item) => ({ ...item, url: await resolveMediaUrl(item.storageKey, item.url) })));
    const referenceAudios = await Promise.all((log.referenceAudios || []).map(async (item) => ({ ...item, url: await resolveMediaUrl(item.storageKey, item.url) })));
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        referenceVideos,
        referenceAudios,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        referenceVideos: log.referenceVideos.map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        referenceAudios: log.referenceAudios.map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode === "reference" ? "reference" : "frames",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    referenceVideos,
    referenceAudios,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        referenceVideos,
        referenceAudios,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

import { ArrowLeft, ArrowRight, CheckSquare, ChevronDown, ClipboardPaste, Copy, Download, Film, FolderPlus, History, LoaderCircle, Music2, Plus, RefreshCw, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { type CSSProperties, type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { FailedTaskDetailModal, type FailedTaskDetail } from "@/components/workbench/failed-task-detail-modal";
import { GeneratedMediaDetailModal, type GeneratedMediaDetailData } from "@/components/workbench/generated-media-detail-modal";
import { generationFailureReason } from "@/lib/generation-error";
import { matchingFailedTaskLogIds } from "@/lib/workbench-failed-task-deletion";
import { isCreateProductMode } from "@/lib/create-product";
import { appendVideoBatch, canResumeVideoTask, mergeVideoBatch, videoTaskElapsedMs, VIDEO_TASK_POLL_INTERVAL_MS, VIDEO_TASK_POLL_TIMEOUT_MS } from "@/lib/video-task-recovery";
import { normalizeVideoResolutionValue } from "@/components/video-settings-panel";
import { computeVideoSize, inferVideoRatio, parsePixelSize, parseVideoResolution, readVideoDimensions, videoRatioOptions } from "@/lib/media-size";
import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoDurationOptionAllowed, isVideoRatioSupported, isVideoResolutionSupported, supportsVideoGenerateAudioToggle } from "@/lib/video-model-profile";
import { autoSaveGeneratedFile, deleteGeneratedFile, readGeneratedFileAsset } from "@/lib/desktop-save";
import { captureVideoAssetCover } from "@/lib/video-asset-cover";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { deleteStoredMedia, getMediaBlob, resolveMediaUrl, setMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, isVideoTaskFailed, pollVideoGenerationTask, storeGeneratedVideo, type VideoDownloadProgress, type VideoGenerationPhase, type VideoGenerationTask } from "@/services/api/video";
import { createUserWorkbenchLogStore } from "@/services/workbench-log-storage";
import { configureCreateWorkspace, getManagedKeySelection, listCreateManagedKeys, managedKeySupportsVideo, switchManagedKey, type CreateManagedKey } from "@/services/create-managed-channel";
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
    localPath?: string;
    prompt?: string;
    model?: string;
};

type VideoRequestSnapshot = {
    text: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
};

type GenerationResult = {
    id: string;
    logId?: string;
    createdAt?: number;
    status: "pending" | "success" | "failed";
    phase?: VideoGenerationPhase;
    downloadProgress?: VideoDownloadProgress;
    video?: GeneratedVideo;
    error?: string;
    prompt?: string;
    model?: string;
    config?: AiConfig;
    references?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
    task?: VideoGenerationTask;
};

type GenerationLog = {
    id: string;
    userId?: number;
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

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoDurationAuto" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_VIDEOS = 3;
const MAX_REFERENCE_AUDIOS = 3;
const MAX_VIDEO_TASKS = 4;
const MAX_PROMPT_LENGTH = 5000;
const VIDEO_SECONDS_PRESETS = [5, 8, 10, 15] as const;
const { store: logStore, ensureMigrated: ensureLogStoreMigrated } = createUserWorkbenchLogStore("video_generation_logs");

export default function VideoPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const secondsInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const workbenchPanelRef = useRef<HTMLDivElement>(null);
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
    const [clockNow, setClockNow] = useState(() => Date.now());
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [previewMedia, setPreviewMedia] = useState<GeneratedMediaDetailData | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteResultTarget, setDeleteResultTarget] = useState<GenerationResult | null>(null);
    const [deleteOriginalToo, setDeleteOriginalToo] = useState(false);
    const [failedDetail, setFailedDetail] = useState<FailedTaskDetail | null>(null);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const messageRef = useRef(message);
    messageRef.current = message;
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const videoKeysRequestRef = useRef<{ accessToken: string; promise: Promise<CreateManagedKey[]> } | null>(null);

    const layoutStyle = {
        "--workbench-panel-width": `${workbenchPanelWidth}px`,
    } as CSSProperties;

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const videoModelName = modelOptionName(model);
    const videoProfile = getVideoModelProfile(videoModelName);
    const audioToggleDisabled = !supportsVideoGenerateAudioToggle(videoProfile);
    const maxReferenceImages = Math.min(MAX_REFERENCE_IMAGES, videoProfile.maxImages);
    const maxReferenceVideos = Math.min(MAX_REFERENCE_VIDEOS, videoProfile.maxVideos);
    const maxReferenceAudios = Math.min(MAX_REFERENCE_AUDIOS, videoProfile.maxAudios);
    const resolutionOptions = Array.from(new Set(["480", "720", "1080", ...videoProfile.resolutions])).sort((a, b) => Number(a) - Number(b));
    const selectedVideoKey = videoKeys.find((item) => item.id === selectedVideoKeyId) || null;
    const selectedVideoChannel = selectedVideoKey
        ? effectiveConfig.channels.find((channel) => channel.apiKey === selectedVideoKey.key) || null
        : null;
    const videoChannels = selectedVideoChannel ? [selectedVideoChannel] : effectiveConfig.channels;
    const hasVideoModels = videoChannels.some((channel) => channel.models.some((item) => item.capability === "video"));
    const videoModelGroups = videoChannels
        .map((channel) => {
            const models = channel.models.filter((item) => !hasVideoModels || item.capability === "video").map((item) => ({ value: encodeChannelModel(channel.id, item.name), label: item.name }));
            return { id: channel.id, name: channel.name, models };
        })
        .filter((group) => group.models.length > 0);
    if (!selectedVideoChannel && model && !videoModelGroups.some((group) => group.models.some((item) => item.value === model))) {
        videoModelGroups.push({ id: "current-model", name: "当前模型", models: [{ value: model, label: modelOptionName(model) }] });
    }
    const videoModelOptions = videoModelGroups.flatMap((group) => group.models.map((item) => item.value));
    useEffect(() => {
        if (!selectedVideoChannel || !videoModelOptions.length) return;
        if (!videoModelOptions.includes(model)) updateConfig("videoModel", videoModelOptions[0]);
    }, [model, selectedVideoChannel?.id, updateConfig, videoModelOptions.join("|")]);

    const canGenerate = Boolean(prompt.trim());
    const resolution = parseVideoResolution(effectiveConfig.vquality);
    const selectedRatio = inferVideoRatio(effectiveConfig.size);
    const dimensions = readVideoDimensions(effectiveConfig.size, resolution, selectedRatio);
    const seconds = Number(clampVideoSecondsForProfile(effectiveConfig.videoSeconds || String(videoProfile.defaultDuration || "5"), videoProfile));
    const durationAuto = effectiveConfig.videoDurationAuto === true;
    const generateAudio = boolConfig(effectiveConfig.videoGenerateAudio, true);
    const selectedSizeLabel = selectedRatio === "auto" ? "自适应" : `${videoOrientationLabel(selectedRatio)} ${dimensions.width}×${dimensions.height}`;

    const loadVideoKeys = useCallback(async (force = false) => {
        if (!session) {
            videoKeysRequestRef.current = null;
            setVideoKeys([]);
            setVideoKeysLoading(false);
            return;
        }
        setVideoKeysLoading(true);
        const accessToken = session.accessToken;
        if (videoKeysRequestRef.current?.accessToken !== accessToken) videoKeysRequestRef.current = null;
        try {
            let request = videoKeysRequestRef.current?.promise;
            if (!request) {
                request = (async () => {
                    await configureCreateWorkspace(session, {}, { force });
                    return (await listCreateManagedKeys(session)).filter((item) => item.status === "active" && Boolean(item.key?.trim()) && managedKeySupportsVideo(item.group));
                })();
                videoKeysRequestRef.current = { accessToken, promise: request };
            }
            const keys = await request;
            setVideoKeys(keys);
            const storedId = getManagedKeySelection().videoKeyId;
            setSelectedVideoKeyId((current) => keys.find((item) => item.id === storedId)?.id || keys.find((item) => item.id === current)?.id || keys[0]?.id || 0);
        } catch (error) {
            messageRef.current.error(error instanceof Error ? error.message : "加载视频 API 密钥失败");
        } finally {
            if (videoKeysRequestRef.current?.accessToken === accessToken) videoKeysRequestRef.current = null;
            setVideoKeysLoading(false);
        }
    }, [session]);

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
            await loadVideoKeys(true);
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
        setClockNow(Date.now());
        if (!running) return;
        const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);

    useEffect(() => {
        const nextResolution = isVideoResolutionSupported(videoProfile, resolution) ? resolution : videoProfile.resolutions[0] || "720";
        const nextRatio = isVideoRatioSupported(videoProfile, selectedRatio) ? selectedRatio : videoProfile.aspectRatios[0] || "16:9";
        if (nextResolution !== resolution) updateConfig("vquality", nextResolution);
        if (nextRatio !== selectedRatio) {
            updateConfig("size", computeVideoSize(nextResolution, nextRatio));
        } else if (nextResolution !== resolution && selectedRatio !== "auto") {
            updateConfig("size", computeVideoSize(nextResolution, selectedRatio));
        }
        const nextSeconds = clampVideoSecondsForProfile(effectiveConfig.videoSeconds || String(videoProfile.defaultDuration || "5"), videoProfile);
        if (String(effectiveConfig.videoSeconds || "").trim() !== nextSeconds) updateConfig("videoSeconds", nextSeconds);
        if (audioToggleDisabled && generateAudio) updateConfig("videoGenerateAudio", "false");
        const exceedsLimit = references.length > maxReferenceImages || referenceVideos.length > maxReferenceVideos || referenceAudios.length > maxReferenceAudios;
        if (exceedsLimit) {
            message.warning(`当前模型最多支持 ${maxReferenceImages} 张参考图、${maxReferenceVideos} 个参考视频、${maxReferenceAudios} 个参考音频，超出部分已移除`);
        }
        setReferences((value) => value.length > maxReferenceImages ? value.slice(0, maxReferenceImages) : value);
        setReferenceVideos((value) => value.length > maxReferenceVideos ? value.slice(0, maxReferenceVideos) : value);
        setReferenceAudios((value) => value.length > maxReferenceAudios ? value.slice(0, maxReferenceAudios) : value);
    }, [audioToggleDisabled, effectiveConfig.videoSeconds, generateAudio, maxReferenceAudios, maxReferenceImages, maxReferenceVideos, message, references, referenceAudios, referenceVideos, resolution, selectedRatio, updateConfig, videoProfile]);

    useEffect(() => {
        void refreshLogs(true, true);
    }, []);

    const addReferences = async (files?: FileList | File[] | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/"));
        if (unsupported.length) message.warning(t("videoWorkbench.unsupportedFiles"));

        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/"));
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/"));
        const audioFiles = selectedFiles.filter((file) => file.type.startsWith("audio/"));

        const acceptedImages = imageFiles.filter((file) => file.size <= 30 * 1024 * 1024).slice(0, Math.max(0, maxReferenceImages - references.length));
        const acceptedVideos = videoFiles.filter((file) => file.size <= 200 * 1024 * 1024).slice(0, Math.max(0, maxReferenceVideos - referenceVideos.length));
        const acceptedAudios = audioFiles.filter((file) => file.size <= 15 * 1024 * 1024).slice(0, Math.max(0, maxReferenceAudios - referenceAudios.length));
        if (imageFiles.some((file) => file.size > 30 * 1024 * 1024)) message.warning(t("videoWorkbench.imageTooLarge"));
        if (videoFiles.some((file) => file.size > 200 * 1024 * 1024)) message.warning(t("videoWorkbench.videoTooLarge"));
        if (audioFiles.some((file) => file.size > 15 * 1024 * 1024)) message.warning(t("videoWorkbench.audioTooLarge"));
        if (videoFiles.length && !maxReferenceVideos) message.warning("当前模型不支持参考视频");
        if (audioFiles.length && !maxReferenceAudios) message.warning("当前模型不支持参考音频");
        if (imageFiles.length && !maxReferenceImages) message.warning("当前模型不支持参考图");

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

        setReferences((value) => [...value, ...nextImages].slice(0, maxReferenceImages));
        setReferenceVideos((value) => [...value, ...nextVideos].slice(0, maxReferenceVideos));
        setReferenceAudios((value) => [...value, ...validAudios].slice(0, maxReferenceAudios));
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
                blobs.slice(0, Math.max(0, maxReferenceImages - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, maxReferenceImages));
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
        if (!isVideoResolutionSupported(videoProfile, nextResolution)) return;
        updateConfig("vquality", nextResolution);
        if (selectedRatio !== "auto") updateConfig("size", computeVideoSize(nextResolution, selectedRatio));
    };

    const selectVideoRatio = (ratio: string) => {
        if (!isVideoRatioSupported(videoProfile, ratio)) return;
        updateConfig("size", computeVideoSize(resolution, ratio));
    };

    const commitSeconds = (raw: string) => {
        updateConfig("videoDurationAuto", false);
        updateConfig("videoSeconds", clampVideoSecondsForProfile(raw, videoProfile));
    };

    const commitTaskCount = (raw: string) => {
        setTaskCount(Math.max(1, Math.min(MAX_VIDEO_TASKS, Math.floor(Number(raw) || 1))));
    };

    const generate = async (providedSnapshot?: VideoRequestSnapshot) => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = providedSnapshot || buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        const requestedCount = Math.max(1, Math.min(MAX_VIDEO_TASKS, taskCount));
        const batchCreatedAt = Date.now();
        const resultSlots: GenerationResult[] = Array.from({ length: requestedCount }, () => ({
            id: nanoid(),
            createdAt: batchCreatedAt,
            status: "pending",
            phase: "queued",
            prompt: snapshot.text,
            model: snapshot.model,
            config: snapshot.config,
            references: [...snapshot.references],
            referenceVideos: [...snapshot.referenceVideos],
            referenceAudios: [...snapshot.referenceAudios],
        }));
        setResults((current) => appendVideoBatch(current, resultSlots));
        const batchStartedAt = performance.now();

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
                    id: slot.id,
                    prompt: snapshot.text,
                    model: snapshot.model,
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
                const errorMessage = generationFailureReason(settledResult.reason, t("workbench.failureReasonUnavailable"));
                nextResults[index] = { ...slot, status: "failed", logId: slot.id, error: errorMessage };
                await saveLog(
                    buildLog({
                        id: slot.id,
                        prompt: snapshot.text,
                        model: snapshot.model,
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

        setResults((current) => mergeVideoBatch(current, nextResults));
        if (!pendingLogs.length) {
            const batchError = nextResults.find((result) => result.status === "failed" && result.error)?.error || t("workbench.failureReasonUnavailable");
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: requestedCount, error: batchError });
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
            message.warning(t(isCreateProductMode() ? "workbench.managedConfigUnavailable" : "workbench.configFirst"));
            if (!isCreateProductMode()) openConfigDialog(true);
            return null;
        }
        const requestConfig = buildVideoConfig(effectiveConfig, model);
        const typedSeconds = secondsInputRef.current?.value;
        if (typedSeconds) requestConfig.videoSeconds = clampVideoSecondsForProfile(typedSeconds, videoProfile);
        return {
            text,
            model,
            config: requestConfig,
            references: [...references],
            referenceVideos: [...referenceVideos],
            referenceAudios: [...referenceAudios],
        };
    };

    const retryResult = (result?: GenerationResult) => {
        if (result?.prompt && result.config) {
            void generate({
                text: result.prompt,
                model: result.model || model,
                config: result.config,
                references: [...(result.references || [])],
                referenceVideos: [...(result.referenceVideos || [])],
                referenceAudios: [...(result.referenceAudios || [])],
            });
            return;
        }
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = async (video: GeneratedVideo) => {
        let coverUrl = "";
        try {
            const source = video.storageKey ? await resolveMediaUrl(video.storageKey, video.url) : video.url;
            coverUrl = await captureVideoAssetCover(source);
        } catch (error) {
            console.warn("Failed to generate video cover from the first frame", error);
        }
        addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl,
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
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, maxReferenceImages));
        } else if (payload.kind === "video") {
            const source = payload.storageKey ? await resolveMediaUrl(payload.storageKey, payload.url) : payload.url;
            const stored = await uploadMediaFile(source, "video");
            setReferenceVideos((value) =>
                [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, width: stored.width, height: stored.height, durationMs: stored.durationMs }].slice(
                    0,
                    maxReferenceVideos,
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
        setClockNow(Date.now());
        setSelectedLogIds([]);
        setPreviewLog(null);
        setPreviewMedia(null);
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

    const confirmDeleteResult = async () => {
        const target = deleteResultTarget;
        const video = target?.video;
        if (!target || !video) return;
        setResults((value) => value.filter((item) => item.id !== target.id && item.video?.id !== video.id));
        for (const log of logs) {
            if (log.video?.id === video.id) await logStore.removeItem(log.id);
        }
        await refreshLogs();
        if (deleteOriginalToo) {
            if (video.storageKey) await deleteStoredMedia([video.storageKey]).catch((error) => console.warn("Failed to delete stored video", error));
            if (video.localPath) await deleteGeneratedFile("video", video.localPath).catch((error) => console.warn("Failed to delete local video file", error));
        }
        setDeleteResultTarget(null);
        setDeleteOriginalToo(false);
        message.success("生成结果已删除");
    };

    const deleteFailedResult = (result: GenerationResult) => {
        modal.confirm({
            centered: true,
            title: "删除失败任务",
            content: "确认删除这个失败任务吗？对应的工作台结果和历史记录都会移除。",
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                const matchingLogIds = matchingFailedTaskLogIds(logs, result);
                await Promise.all(matchingLogIds.map((id) => logStore.removeItem(id)));
                setResults((value) => value.filter((item) => item.id !== result.id));
                setFailedDetail((current) => current?.id === result.id ? null : current);
                await refreshLogs(false);
                message.success("失败任务已删除");
            },
        });
    };

    const showFailedDetail = (result: GenerationResult) => {
        setFailedDetail({
            id: result.id,
            logId: result.logId,
            prompt: result.prompt,
            error: result.error,
            model: result.model,
            referenceCount: (result.references?.length || 0) + (result.referenceVideos?.length || 0) + (result.referenceAudios?.length || 0),
        });
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        const userId = Number(useUserStore.getState().user?.id);
        const ownedLog = userId > 0 ? { ...log, userId } : log;
        await logStore.setItem(ownedLog.id, serializeLog(ownedLog));
        await refreshLogs(resumePending);
    };

    const refreshLogs = async (resumePending = true, resumeFailed = false) => {
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs, resumeFailed);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[], resumeFailed = false) => {
        const recentCutoff = Date.now() - 24 * 60 * 60_000;
        for (const log of items) {
            const shouldResume = log.status === "pending" || (resumeFailed && log.status === "failed" && log.createdAt >= recentCutoff);
            if (shouldResume && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string, resultSlotId?: string) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        const resultId = resultSlotId || log.id;
        const upsertResult = (next: Omit<GenerationResult, "id">) => {
            setResults((value) => {
                const index = value.findIndex((item) => item.id === resultId);
                if (index < 0) return [...value, { id: resultId, ...next }];
                return value.map((item, itemIndex) => (itemIndex === index ? { ...item, id: resultId, ...next } : item));
            });
        };
        const updatePhase = (phase: VideoGenerationPhase) => {
            setResults((value) => value.map((item) => item.id === resultId ? { ...item, phase } : item));
        };
        const updateDownloadProgress = (progress: VideoDownloadProgress) => {
            setResults((value) => value.map((item) => item.id === resultId ? { ...item, phase: "downloading", downloadProgress: progress } : item));
        };
        activeLogIdsRef.current.add(log.id);
        setRunning(true);
        setResults((value) => (value.some((item) => item.id === resultId) ? value : [...value, { id: resultId, createdAt: log.createdAt, status: "pending" }]));
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            const deadline = Date.now() + VIDEO_TASK_POLL_TIMEOUT_MS;
            let lastPollError: unknown;
            while (Date.now() < deadline) {
                let state: Awaited<ReturnType<typeof pollVideoGenerationTask>>;
                try {
                    state = await pollVideoGenerationTask(configOverride || taskConfig, log.task, {
                        onPhase: updatePhase,
                        onDownloadProgress: updateDownloadProgress,
                    });
                } catch (error) {
                    if (isVideoTaskFailed(error) || Date.now() >= deadline) throw error;
                    lastPollError = error;
                    await delay(VIDEO_TASK_POLL_INTERVAL_MS);
                    continue;
                }
                if (state.status === "pending") {
                    updatePhase(state.phase);
                    await delay(VIDEO_TASK_POLL_INTERVAL_MS);
                    continue;
                }
                if (state.status === "completed") {
                    let stored: Awaited<ReturnType<typeof storeGeneratedVideo>> | null = null;
                    let sourceBlob: Blob | null = state.result.blob || null;
                    let storageError: unknown = null;
                    try {
                        stored = await storeGeneratedVideo(state.result);
                        if (stored.storageKey) sourceBlob = await getMediaBlob(stored.storageKey).catch(() => sourceBlob);
                    } catch (error) {
                        storageError = error;
                    }
                    let localPath = "";
                    if (sourceBlob?.size) {
                        const saved = await autoSaveGeneratedFile(
                            sourceBlob,
                            "video",
                            stored?.mimeType || sourceBlob.type || "video/mp4",
                        ).catch(() => null);
                        localPath = saved?.savePath || "";
                    }
                    if (!stored && !sourceBlob) {
                        throw storageError instanceof Error ? storageError : new Error(t("videoWorkbench.generated"));
                    }
                    const storageKey = stored?.storageKey || `video:${nanoid()}`;
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored?.url || URL.createObjectURL(sourceBlob!),
                        storageKey,
                        ...(localPath ? { localPath } : {}),
                        durationMs: Date.now() - log.createdAt,
                        width: stored?.width || 1280,
                        height: stored?.height || 720,
                        bytes: stored?.bytes || sourceBlob?.size || 0,
                        mimeType: stored?.mimeType || sourceBlob?.type || "video/mp4",
                        prompt: log.prompt,
                        model: modelOptionName(log.model),
                    };                    upsertResult({ status: "success", logId: log.id, video: nextVideo, error: undefined });
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                    await saveLog({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
                    message.success(t("videoWorkbench.generated"));
                    return;
                }
                if (state.status === "failed") {
                    const failed = new Error(state.error);
                    failed.name = "VideoTaskFailed";
                    throw failed;
                }
            }
            if (lastPollError) throw lastPollError;
            throw new Error(t("videoWorkbench.timeout"));
        } catch (error) {
            const errorMessage = generationFailureReason(error, t("workbench.failureReasonUnavailable"));
            upsertResult({ status: "failed", logId: log.id, error: errorMessage, video: undefined, task: log.task });
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
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
        setResults(log.status === "pending" ? [{ id: log.id, createdAt: log.createdAt, status: "pending", task: log.task, prompt: log.prompt, model: log.model }] : log.video ? [{ id: log.video.id, createdAt: log.createdAt, status: "success", video: { ...log.video, prompt: log.video.prompt || log.prompt, model: log.video.model || modelOptionName(log.model) } }] : [{ id: log.id, logId: log.id, createdAt: log.createdAt, status: "failed", prompt: log.prompt, model: log.model, error: generationFailureReason(log.error, t("workbench.failureReasonUnavailable")), references: log.references, referenceVideos: log.referenceVideos, referenceAudios: log.referenceAudios, task: log.task }]);
    };

    const displayedResults: GenerationResult[] = [...results];
    const displayedResultIds = new Set(results.map((result) => result.id));
    const displayedVideoIds = new Set(results.flatMap((result) => (result.video ? [result.video.id] : [])));
    for (const log of logs) {
        if (log.status === "failed") {
            if (displayedResultIds.has(log.id)) continue;
            displayedResultIds.add(log.id);
            displayedResults.push({
                id: `history-failed:${log.id}`,
                logId: log.id,
                status: "failed",
                prompt: log.prompt,
                model: log.model,
                error: generationFailureReason(log.error, t("workbench.failureReasonUnavailable")),
                references: log.references,
                referenceVideos: log.referenceVideos,
                referenceAudios: log.referenceAudios,
                task: log.task,
            });
            continue;
        }
        if (log.status !== "success" || !log.video) continue;
        if (displayedVideoIds.has(log.video.id)) continue;
        displayedVideoIds.add(log.video.id);
        displayedResults.push({
            id: `history:${log.id}:${log.video.id}`,
            status: "success",
            video: { ...log.video, prompt: log.video.prompt || log.prompt, model: log.video.model || modelOptionName(log.model) },
        });
    }

    const activeElapsedMs = results.reduce((max, result) => result.status === "pending" ? Math.max(max, videoTaskElapsedMs(result.createdAt, clockNow)) : max, 0);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:overflow-hidden" style={layoutStyle}>
                <section className="workbench-split-grid grid gap-3 lg:min-h-0 lg:overflow-hidden">
                    <div ref={workbenchPanelRef} className="thin-scrollbar flex min-w-0 flex-col rounded-xl border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto [&>*]:shrink-0">
                        <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-stone-950 dark:text-stone-100">{t("videoWorkbench.title")}</h1>

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
                                onClick={() => void loadVideoKeys(true)}
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
                            <p className="mt-1 text-[11px] leading-4 text-stone-500">当前模型最多支持 {maxReferenceImages} 张参考图、{maxReferenceVideos} 个参考视频、{maxReferenceAudios} 个参考音频。</p>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">清晰度</div>
                            <div className="grid overflow-hidden rounded-xl border border-stone-200 bg-stone-100/60 p-1 dark:border-stone-700 dark:bg-stone-900/60" style={{ gridTemplateColumns: `repeat(${resolutionOptions.length}, minmax(0, 1fr))` }}>
                                {resolutionOptions.map((value) => {
                                    const supported = isVideoResolutionSupported(videoProfile, value);
                                    return (
                                        <button
                                            key={value}
                                            type="button"
                                            disabled={!supported}
                                            className={`h-9 rounded-lg text-sm transition ${resolution === value && supported ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : supported ? "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100" : "cursor-not-allowed text-stone-600 opacity-35 dark:text-stone-500"}`}
                                            onClick={() => selectResolution(value)}
                                        >
                                            {value}P
                                        </button>
                                    );
                                })}
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
                                            <option key={item.value} value={item.value} disabled={!isVideoRatioSupported(videoProfile, item.value)}>
                                                {videoRatioSizeLabel(item.value, resolution)}
                                            </option>
                                        ))}
                                    <option value="auto" disabled={!isVideoRatioSupported(videoProfile, "auto")}>自适应</option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-stone-500" />
                            </div>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">秒数</div>
                            <div className="grid grid-cols-[1fr_96px] items-center gap-2">
                                <div className="grid grid-cols-5 rounded-xl border border-stone-200 p-1 dark:border-stone-700">
                                    <button
                                        type="button"
                                        className={`h-9 rounded-lg text-sm transition ${durationAuto ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"}`}
                                        onClick={() => updateConfig("videoDurationAuto", true)}
                                    >
                                        自动
                                    </button>
                                    {VIDEO_SECONDS_PRESETS.map((value) => {
                                        const supported = isVideoDurationOptionAllowed(videoProfile, value);
                                        return (
                                            <button
                                                key={value}
                                                type="button"
                                                disabled={!supported}
                                                className={`h-9 rounded-lg text-sm transition ${!durationAuto && seconds === value && supported ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : supported ? "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" : "cursor-not-allowed text-stone-600 opacity-35 dark:text-stone-500"}`}
                                                onClick={() => {
                                                    updateConfig("videoDurationAuto", false);
                                                    updateConfig("videoSeconds", String(value));
                                                }}
                                            >
                                                {value}秒
                                            </button>
                                        );
                                    })}
                                </div>
                                <label className="flex h-9 items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                                    <input
                                        aria-label="自定义秒数"
                                        type="number"
                                        ref={secondsInputRef}
                                        min={videoProfile.minDuration}
                                        max={videoProfile.maxDuration}
                                        value={effectiveConfig.videoSeconds}
                                        disabled={durationAuto}
                                        className="min-w-0 flex-1 bg-transparent px-2 text-center text-sm outline-none disabled:cursor-not-allowed disabled:opacity-45 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        onChange={(event) => {
                                            const value = event.currentTarget.value;
                                            if (!value || /^\d+$/.test(value)) {
                                                updateConfig("videoDurationAuto", false);
                                                updateConfig("videoSeconds", value);
                                            }
                                        }}
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
                            <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${audioToggleDisabled ? "text-stone-600 dark:text-stone-500" : generateAudio ? "text-emerald-500" : "text-stone-500"}`}>{audioToggleDisabled ? "不支持" : generateAudio ? "开" : "关"}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={generateAudio}
                                    aria-label="生成音频"
                                    disabled={audioToggleDisabled}
                                    className={`relative h-6 w-10 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${generateAudio ? "bg-stone-200" : "bg-stone-600"}`}
                                    onClick={() => {
                                        if (!audioToggleDisabled) updateConfig("videoGenerateAudio", String(!generateAudio));
                                    }}
                                >
                                    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] ${generateAudio ? "left-[18px]" : "left-0.5"}`} />
                                </button>
                            </div>
                        </div>

                        <div className="mt-3">
                            <Button
                                type="primary"
                                size="large"
                                block
                                icon={<Sparkles className="size-4" />}
                                disabled={!canGenerate}
                                onClick={() => void generate()}
                                className="!h-10 !rounded-xl !border-0 !bg-stone-300 !font-semibold !text-stone-950 !shadow-none hover:!bg-stone-200 disabled:!bg-stone-600 disabled:!text-stone-300"
                            >
                                {t("workbench.generate")}
                            </Button>
                            {results.some((item) => item.status === "pending") ? (
                                <div className="mt-2 text-center text-[11px] leading-5 text-stone-500">已有视频任务在后台生成，可继续提交新任务；切换工作台不会中断。</div>
                            ) : null}
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
                            <div className="flex items-center gap-2">
                                {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(activeElapsedMs) })}</Tag> : null}
                                <Button size="small" icon={<History className="size-3.5" />} onClick={() => setLogsOpen(true)}>
                                    {t("workbench.logs")}
                                </Button>
                            </div>
                        </div>
                        {displayedResults.length ? (
                            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {displayedResults.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onPreview={setPreviewMedia} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} onDelete={() => { setDeleteOriginalToo(false); setDeleteResultTarget(result); }} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard
                                            key={result.id}
                                            result={result}
                                            error={generationFailureReason(result.error, t("workbench.failureReasonUnavailable"))}
                                            onRetry={() => retryResult(result)}
                                            onDetails={() => showFailedDetail(result)}
                                            onDelete={() => deleteFailedResult(result)}
                                        />
                                    ) : (
                                        <PendingVideoCard key={result.id} elapsedMs={videoTaskElapsedMs(result.createdAt, clockNow)} phase={result.phase} progress={result.downloadProgress} />
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
            <GeneratedMediaDetailModal data={previewMedia} onClose={() => setPreviewMedia(null)} />
            <Modal centered title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>

            <FailedTaskDetailModal
                detail={failedDetail}
                onClose={() => setFailedDetail(null)}
                onDelete={() => {
                    const result = results.find((item) => item.id === failedDetail?.id);
                    const failedResult = result || (failedDetail ? {
                        id: failedDetail.id,
                        logId: failedDetail.logId,
                        status: "failed" as const,
                        prompt: failedDetail.prompt,
                        error: failedDetail.error,
                        model: failedDetail.model,
                    } : null);
                    setFailedDetail(null);
                    if (failedResult) deleteFailedResult(failedResult);
                }}
            />

            <Modal
                centered
                title="删除生成结果"
                open={Boolean(deleteResultTarget)}
                onCancel={() => { setDeleteResultTarget(null); setDeleteOriginalToo(false); }}
                onOk={() => void confirmDeleteResult()}
                okText={t("common.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
            >
                <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">确认删除这个视频结果吗？工作台和历史记录中都会移除。</p>
                <Checkbox
                    checked={deleteOriginalToo}
                    disabled={!deleteResultTarget?.video?.storageKey && !deleteResultTarget?.video?.localPath}
                    onChange={(event) => setDeleteOriginalToo(event.target.checked)}
                >
                    同时删除本地原视频（不可恢复）
                </Checkbox>
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

function ResultVideoCard({
    video,
    onPreview,
    onDownload,
    onSaveAsset,
    onDelete,
}: {
    video: GeneratedVideo;
    onPreview: (data: GeneratedMediaDetailData) => void;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <video
                src={video.url}
                controls
                className="aspect-video w-full bg-black object-contain"
                onError={(event) => {
                    const element = event.currentTarget;
                    if (element.dataset.localFallback === "1") return;
                    element.dataset.localFallback = "1";
                    void recoverVideoFromLocalFile(video).then((recovered) => {
                        if (recovered?.url) element.src = recovered.url;
                    });
                }}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-300">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Tooltip title={t("common.addToAssets")}>
                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                            {t("common.addAssetShort")}
                        </Button>
                    </Tooltip>
                    <Button size="small" onClick={() => onPreview({ kind: "video", src: video.url, prompt: video.prompt, model: video.model, width: video.width, height: video.height, durationMs: video.durationMs, bytes: video.bytes })}>
                        {t("common.details")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                    <Button danger size="small" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                        {t("common.delete")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard({ elapsedMs, phase = "queued", progress }: { elapsedMs: number; phase?: VideoGenerationPhase; progress?: VideoDownloadProgress }) {
    const { t } = useTranslation();
    const label = phase === "queued"
        ? t("workbench.videoQueued")
        : phase === "downloading"
            ? t("workbench.videoDownloading")
            : t("workbench.videoGenerating");
    const progressLabel = phase === "downloading" && progress?.total
        ? ` · ${progress.percent}% ${formatBytes(progress.bytesPerSecond)}/s`
        : "";
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{label}{progressLabel} · {t("workbench.elapsed", { time: formatDuration(elapsedMs) })}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({
    result,
    error,
    onRetry,
    onDetails,
    onDelete,
}: {
    result: GenerationResult;
    error: string;
    onRetry: () => void;
    onDetails: () => void;
    onDelete: () => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const references = result.references || [];
    const referenceVideos = result.referenceVideos || [];
    const referenceAudios = result.referenceAudios || [];
    const prompt = result.prompt?.trim() || "";
    const copyPrompt = async () => {
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("common.promptCopied"));
        } catch {
            message.error(t("apiErrors.requestFailed"));
        }
    };
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex min-h-48 flex-col gap-4 p-5">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                    <Button size="small" disabled={!prompt} onClick={() => void copyPrompt()}>
                        {t("common.copyPrompt")}
                    </Button>
                </div>
                <div>
                    <div className="mb-1 text-[11px] font-medium text-red-500 dark:text-red-300">提示词</div>
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5 text-stone-800 dark:text-stone-100">{prompt || "无提示词"}</p>
                </div>
                <div>
                    <div className="mb-1 text-[11px] font-medium text-red-500 dark:text-red-300">失败原因</div>
                    <Typography.Paragraph ellipsis={{ rows: 3 }} className="!mb-0 !text-xs !leading-5 !text-red-600 dark:!text-red-300">
                        {error}
                    </Typography.Paragraph>
                </div>
                {references.length || referenceVideos.length || referenceAudios.length ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {references.slice(0, 6).map((item, index) => (
                            <div key={item.id} className="relative size-14 overflow-hidden rounded-lg border border-red-200 bg-stone-900 dark:border-red-950">
                                <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt={item.name || `参考图 ${index + 1}`} className="size-full object-cover" />
                                <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[9px] text-white">图{index + 1}</span>
                            </div>
                        ))}
                        {referenceVideos.length ? <Tag className="m-0">参考视频 {referenceVideos.length}</Tag> : null}
                        {referenceAudios.length ? <Tag className="m-0">参考音频 {referenceAudios.length}</Tag> : null}
                    </div>
                ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-red-200 px-4 py-3 dark:border-red-950">
                <span className="min-w-0 truncate text-[11px] text-stone-500 dark:text-stone-400">{result.model || ""}</span>
                <div className="flex shrink-0 gap-2">
                    <Button size="small" onClick={onDetails}>详情</Button>
                    <Button size="small" danger onClick={onDelete}>删除</Button>
                    <Button size="small" title={result.task ? "继续查询原任务，不会重新扣费" : undefined} onClick={onRetry}>{result.task ? "继续查询" : t("workbench.retry")}</Button>
                </div>
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
        await ensureLogStoreMigrated();
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        const normalized = await Promise.all(logs.map(async (stored) => {
            const log = await normalizeLog(stored);
            if (log.video && (log.video.storageKey !== stored.video?.storageKey || log.video.localPath !== stored.video?.localPath)) {
                await logStore.setItem(log.id, serializeLog(log)).catch(() => undefined);
            }
            return log;
        }));
        return normalized.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = await resolveStoredVideoForDisplay(log.video);
    const storedReferences = Array.isArray(log.references) ? log.references : [];
    const storedReferenceVideos = Array.isArray(log.referenceVideos) ? log.referenceVideos : [];
    const storedReferenceAudios = Array.isArray(log.referenceAudios) ? log.referenceAudios : [];
    const references = await Promise.all(
        storedReferences.map(async (item) => {
            void ensureImagePreview(item.storageKey);
            try {
                return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
            } catch {
                return item;
            }
        }),
    );
    const referenceVideos = await Promise.all(storedReferenceVideos.map(async (item) => {
        try {
            return { ...item, url: await resolveMediaUrl(item.storageKey, item.url) };
        } catch {
            return item;
        }
    }));
    const referenceAudios = await Promise.all(storedReferenceAudios.map(async (item) => {
        try {
            return { ...item, url: await resolveMediaUrl(item.storageKey, item.url) };
        } catch {
            return item;
        }
    }));
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        userId: log.userId || Number(useUserStore.getState().user?.id) || undefined,
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

async function recoverVideoFromLocalFile(video: GeneratedVideo): Promise<GeneratedVideo | null> {
    try {
        const recovered = await readGeneratedFileAsset({
            kind: "video",
            path: video.localPath,
            filename: video.localPath?.split(/[\\/]/).pop() || undefined,
            size: video.bytes,
            mimeType: video.mimeType,
        });
        if (!recovered?.blob.size) return null;
        const storageKey = video.storageKey?.trim() || `video:${nanoid()}`;
        let url = "";
        try {
            url = await setMediaBlob(storageKey, recovered.blob);
        } catch {
            url = URL.createObjectURL(recovered.blob);
        }
        return {
            ...video,
            storageKey,
            localPath: recovered.savePath || video.localPath || "",
            url,
            bytes: recovered.blob.size,
            mimeType: recovered.blob.type || video.mimeType || "video/mp4",
        };
    } catch {
        return null;
    }
}
async function resolveStoredVideoForDisplay(video?: GeneratedVideo): Promise<GeneratedVideo | undefined> {
    if (!video) return undefined;
    let localPath = video.localPath?.trim() || "";
    let url = "";
    if (video.storageKey) {
        url = await resolveMediaUrl(video.storageKey, "").catch(() => "");
    }
    if (!localPath) {
        const savedFile = await readGeneratedFileAsset({
            kind: "video",
            size: video.bytes,
            mimeType: video.mimeType,
        }).catch(() => null);
        if (savedFile?.blob.size) {
            localPath = savedFile.savePath;
            if (!url) {
                const storageKey = video.storageKey || `video:${nanoid()}`;
                url = await setMediaBlob(storageKey, savedFile.blob).catch(() => URL.createObjectURL(savedFile.blob));
                if (!video.storageKey) video = { ...video, storageKey };
            }
        }
    }
    if (url && !localPath && video.storageKey) {
        const blob = await getMediaBlob(video.storageKey).catch(() => null);
        if (blob?.size) {
            const saved = await autoSaveGeneratedFile(blob, "video", video.mimeType || blob.type || "video/mp4").catch(() => null);
            localPath = saved?.savePath || "";
        }
    }
    if (!url) {
        const recovered = await recoverVideoFromLocalFile({ ...video, localPath });
        if (recovered) return recovered;
    }
    const durableFallback = video.url && !video.url.startsWith("blob:") ? video.url : "";
    return { ...video, ...(localPath ? { localPath } : {}), url: url || durableFallback };
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
    id,
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
    id?: string;
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
        id: id || nanoid(),
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
    const profile = getVideoModelProfile(modelOptionName(model));
    const requestedResolution = normalizeResolution(config.vquality);
    const resolution = isVideoResolutionSupported(profile, requestedResolution) ? requestedResolution : profile.resolutions[0] || "720";
    const requestedRatio = inferVideoRatio(config.size);
    const ratio = isVideoRatioSupported(profile, requestedRatio) ? requestedRatio : profile.aspectRatios[0] || "16:9";
    return {
        ...config,
        model,
        videoModel: model,
        size: computeVideoSize(resolution, ratio),
        videoSeconds: clampVideoSecondsForProfile(config.videoSeconds, profile),
        vquality: resolution,
        videoGenerateAudio: supportsVideoGenerateAudioToggle(profile) ? String(boolConfig(config.videoGenerateAudio, true)) : "false",
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

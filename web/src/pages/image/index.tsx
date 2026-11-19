import { ArrowLeft, ArrowRight, CheckSquare, ChevronDown, ClipboardPaste, Copy, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { type CSSProperties, type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Modal, Popover, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { FailedTaskDetailModal, type FailedTaskDetail } from "@/components/workbench/failed-task-detail-modal";
import { GeneratedMediaDetailModal, type GeneratedMediaDetailData } from "@/components/workbench/generated-media-detail-modal";
import { resolveGeneratedImageBlob } from "@/lib/generated-image-download";
import { generationFailureReason } from "@/lib/generation-error";
import { matchingFailedTaskLogIds } from "@/lib/workbench-failed-task-deletion";
import { isCreateProductMode } from "@/lib/create-product";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { normalizeImageBackground, normalizeImageOutputFormat, supportsTransparentImageBackground } from "@/lib/image-output-format";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, parsePixelSize } from "@/lib/media-size";
import { encodeChannelModel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { autoSaveGeneratedFile, deleteGeneratedFile, generatedFileExtension, readGeneratedFileAsset, saveGeneratedFile } from "@/lib/desktop-save";
import { formatBytes, formatDownloadSpeed, formatDuration, formatPreciseDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration, submitPersistentImageTask, waitForPersistentImageTask } from "@/services/api/image";
import { deleteStoredImages, ensureImagePreview, getImageBlob, getImagePreviewRevision, prepareReferenceImagesForRequest, previewUrlFor, resolveImageUrl, setImageBlob, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { buildClientRequestTiming, saveClientRequestTiming } from "@/services/client-request-timing";
import { createUserWorkbenchLogStore } from "@/services/workbench-log-storage";
import { configureCreateWorkspace, getManagedKeySelection, listCreateManagedKeys, managedKeySupportsImage, switchManagedKey, type CreateManagedKey } from "@/services/create-managed-channel";
import { WorkbenchModelSelect } from "@/components/workbench/model-select";
import { PanelResizeHandle, useStoredPanelWidth } from "@/components/workbench/panel-resize-handle";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    localPath?: string;
    prompt?: string;
    model?: string;
    prepareDurationMs?: number;
    generationDurationMs?: number;
    downloadDurationMs?: number;
    previewOnly?: boolean;
};

type GenerationResult = {
    id: string;
    logId?: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
    prompt?: string;
    model?: string;
    config?: AiConfig;
    references?: ReferenceImage[];
    phase?: "compressing" | "generating" | "downloading";
    phaseStartedAt?: number;
    prepareDurationMs?: number;
    clientRequestId?: string;
    downloadProgress?: {
        percent: number;
        loaded: number;
        total: number;
        bytesPerSecond: number;
    };
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
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "success" | "failed";
    images: GeneratedImage[];
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const MAX_WORKBENCH_LOGS = 100;
const MAX_IMAGE_REFERENCES = 14;
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const { store: logStore, ensureMigrated: ensureLogStoreMigrated } = createUserWorkbenchLogStore("image_generation_logs");
const WORKBENCH_RESOLUTION_OPTIONS = ["auto", "4k", "2k", "1k"] as const;
const WORKBENCH_SIZE_GROUPS = (["1k", "2k", "4k"] as const).map((scale) => ({
    scale,
    label: scale.toUpperCase(),
    options: mediaRatioOptions
        .filter((item) => item.value !== "auto")
        .map((item) => ({ ratio: item.value, value: computeMediaSize(scale, item.value) })),
}));
const WORKBENCH_SIZE_VALUES = new Set(WORKBENCH_SIZE_GROUPS.flatMap((group) => group.options.map((option) => option.value)));

export default function ImagePage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const workbenchPanelRef = useRef<HTMLDivElement>(null);
    const [workbenchPanelWidth, setWorkbenchPanelWidth] = useStoredPanelWidth("create-canvas:image-workbench-layout:form", 600);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssets = useAssetStore((state) => state.cleanupImages);
    const session = useUserStore((state) => state.session);
    const [imageKeys, setImageKeys] = useState<CreateManagedKey[]>([]);
    const [imageKeysLoading, setImageKeysLoading] = useState(false);
    const [selectedImageKeyId, setSelectedImageKeyId] = useState(() => getManagedKeySelection().imageKeyId);
    const [switchingImageKey, setSwitchingImageKey] = useState(false);
    const [customSizeOpen, setCustomSizeOpen] = useState(false);
    const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [activeGenerations, setActiveGenerations] = useState(0);
    const running = activeGenerations > 0;
    const [logsOpen, setLogsOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [clockNow, setClockNow] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [previewMedia, setPreviewMedia] = useState<GeneratedMediaDetailData | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteResultTarget, setDeleteResultTarget] = useState<GenerationResult | null>(null);
    const [deleteOriginalToo, setDeleteOriginalToo] = useState(false);
    const [failedDetail, setFailedDetail] = useState<FailedTaskDetail | null>(null);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const messageRef = useRef(message);
    messageRef.current = message;
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const imageKeysRequestRef = useRef<{ accessToken: string; promise: Promise<CreateManagedKey[]> } | null>(null);

    const layoutStyle = {
        "--workbench-panel-width": `${workbenchPanelWidth}px`,
    } as CSSProperties;

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const selectedImageKey = imageKeys.find((item) => item.id === selectedImageKeyId) || null;
    const selectedImageChannel = selectedImageKey
        ? effectiveConfig.channels.find((channel) => channel.apiKey === selectedImageKey.key) || null
        : null;
    const imageChannels = selectedImageChannel ? [selectedImageChannel] : effectiveConfig.channels;
    const hasImageModels = imageChannels.some((channel) => channel.models.some((item) => item.capability === "image"));
    const imageModelGroups = imageChannels
        .map((channel) => {
            const models = channel.models.filter((item) => !hasImageModels || item.capability === "image").map((item) => ({ value: encodeChannelModel(channel.id, item.name), label: item.name }));
            return { id: channel.id, name: channel.name, models };
        })
        .filter((group) => group.models.length > 0);
    if (!selectedImageChannel && model && !imageModelGroups.some((group) => group.models.some((item) => item.value === model))) {
        imageModelGroups.push({ id: "current-model", name: "当前模型", models: [{ value: model, label: modelOptionName(model) }] });
    }
    const imageModelOptions = imageModelGroups.flatMap((group) => group.models.map((item) => item.value));
    useEffect(() => {
        if (!selectedImageChannel || !imageModelOptions.length) return;
        if (!imageModelOptions.includes(model)) updateConfig("imageModel", imageModelOptions[0]);
    }, [imageModelOptions.join("|"), model, selectedImageChannel?.id, updateConfig]);

    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const selectedRatio = inferMediaRatio(effectiveConfig.size);
    const selectedSize = workbenchSizePixels(effectiveConfig.size, selectedRatio);
    const activeResolutionScale = inferMediaScale(effectiveConfig.size);
    const currentSizeIsRatio = mediaRatioOptions.some((option) => option.value === effectiveConfig.size);
    const sizeSelectionValue = effectiveConfig.size === "auto" ? "auto" : WORKBENCH_SIZE_VALUES.has(effectiveConfig.size) ? effectiveConfig.size : "current";
    const sizeSelectionOption = WORKBENCH_SIZE_GROUPS.flatMap((group) => group.options).find((option) => option.value === sizeSelectionValue);
    const sizeSelectionLabel = sizeSelectionValue === "auto" ? "自动（由模型决定）" : sizeSelectionValue === "current" ? currentSizeIsRatio ? `${effectiveConfig.size} · 自动分辨率` : `自定义 ${selectedSize.width}x${selectedSize.height}` : sizeSelectionOption ? `${sizeSelectionOption.ratio} ${sizeSelectionOption.value}` : effectiveConfig.size;
    const outputFormat = normalizeImageOutputFormat(effectiveConfig.outputFormat);
    const transparentSupported = supportsTransparentImageBackground(effectiveConfig.model || model);
    const transparentAvailable = transparentSupported && outputFormat === "png";
    const transparentEnabled = transparentAvailable && normalizeImageBackground(effectiveConfig.model || model, effectiveConfig.background, outputFormat) === "transparent";

    const loadImageKeys = useCallback(async (force = false) => {
        if (!session) {
            imageKeysRequestRef.current = null;
            setImageKeys([]);
            setImageKeysLoading(false);
            return;
        }
        setImageKeysLoading(true);
        const accessToken = session.accessToken;
        if (imageKeysRequestRef.current?.accessToken !== accessToken) imageKeysRequestRef.current = null;
        try {
            let request = imageKeysRequestRef.current?.promise;
            if (!request) {
                request = (async () => {
                    await configureCreateWorkspace(session, {}, { force });
                    return (await listCreateManagedKeys(session)).filter((item) => item.status === "active" && Boolean(item.key?.trim()) && managedKeySupportsImage(item.group));
                })();
                imageKeysRequestRef.current = { accessToken, promise: request };
            }
            const keys = await request;
            setImageKeys(keys);
            const storedId = getManagedKeySelection().imageKeyId;
            setSelectedImageKeyId((current) => keys.find((item) => item.id === storedId)?.id || keys.find((item) => item.id === current)?.id || keys[0]?.id || 0);
        } catch (error) {
            messageRef.current.error(error instanceof Error ? error.message : "加载 API 密钥失败");
        } finally {
            if (imageKeysRequestRef.current?.accessToken === accessToken) imageKeysRequestRef.current = null;
            setImageKeysLoading(false);
        }
    }, [session]);

    const selectImageKey = async (keyId: number) => {
        if (!session || !keyId || keyId === selectedImageKeyId || switchingImageKey) return;
        const key = imageKeys.find((item) => item.id === keyId);
        if (!key) return;
        const previousId = selectedImageKeyId;
        setSelectedImageKeyId(keyId);
        setSwitchingImageKey(true);
        try {
            await switchManagedKey(session, key, "image");
            setSelectedImageKeyId(getManagedKeySelection().imageKeyId || keyId);
            message.success(`已切换到 ${key.name}`);
            await loadImageKeys(true);
        } catch (error) {
            setSelectedImageKeyId(previousId);
            message.error(error instanceof Error ? error.message : "切换 API 密钥失败");
        } finally {
            setSwitchingImageKey(false);
        }
    };

    useEffect(() => {
        void loadImageKeys();
    }, [loadImageKeys]);

    useEffect(() => {
        if (!running) {
            setClockNow(0);
            return;
        }
        const tick = () => setClockNow(performance.now());
        tick();
        const timer = window.setInterval(tick, 250);
        return () => window.clearInterval(timer);
    }, [running]);

    useEffect(() => {
        void (async () => {
            const pruned = await pruneStoredLogs();
            await refreshLogs();
            if (pruned) cleanupAssets();
        })();
    }, [cleanupAssets]);

    const addReferences = async (files?: FileList | File[] | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const remaining = Math.max(0, MAX_IMAGE_REFERENCES - references.length);
        if (!remaining) {
            message.warning(`参考图最多 ${MAX_IMAGE_REFERENCES} 张`);
            return;
        }
        if (imageFiles.length > remaining) message.warning(`参考图最多 ${MAX_IMAGE_REFERENCES} 张，已添加前 ${remaining} 张`);
        const nextReferences = await Promise.all(
            imageFiles.slice(0, remaining).map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, MAX_IMAGE_REFERENCES));
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const remaining = Math.max(0, MAX_IMAGE_REFERENCES - references.length);
            if (!remaining) {
                message.warning(`参考图最多 ${MAX_IMAGE_REFERENCES} 张`);
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, remaining).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, MAX_IMAGE_REFERENCES));
            message.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("imageWorkbench.clipboardEmpty"));
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

    const insertReferenceLabel = (index: number) => {
        const label = imageReferenceLabel(index);
        setPrompt((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}${label}`);
    };

    const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        void addReferences(files);
    };

    const selectOutputFormat = (format: "png" | "jpeg") => {
        updateConfig("outputFormat", format);
        if (format !== "png" && config.background === "transparent") updateConfig("background", "");
    };

    const selectResolutionScale = (scale: (typeof WORKBENCH_RESOLUTION_OPTIONS)[number]) => {
        updateConfig("quality", "auto");
        if (scale === "auto") {
            updateConfig("size", selectedRatio === "auto" ? "auto" : selectedRatio);
            return;
        }
        updateConfig("size", computeMediaSize(scale, selectedRatio === "auto" ? "1:1" : selectedRatio));
    };

    const selectImageSize = (value: string) => {
        if (value === "auto") selectResolutionScale("auto");
        else if (value !== "current") updateConfig("size", value);
        setSizeMenuOpen(false);
    };
    const commitCustomDimension = (axis: "width" | "height", raw: string) => {
        const current = workbenchSizePixels(effectiveConfig.size, selectedRatio);
        const parsed = Math.max(1, Math.floor(Number(raw) || current[axis]));
        const value = Math.ceil(parsed / 16) * 16;
        const next = axis === "width" ? { ...current, width: value } : { ...current, height: value };
        updateConfig("size", `${next.width}x${next.height}`);
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t(isCreateProductMode() ? "workbench.managedConfigUnavailable" : "workbench.configFirst"));
            if (!isCreateProductMode()) openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        setActiveGenerations((value) => value + 1);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        const batchStartedAt = performance.now();
        const batchResults: GenerationResult[] = Array.from(
            { length: generationCount },
            () => ({
                id: nanoid(),
                clientRequestId: nanoid(),
                status: "pending",
                phase: snapshot.references.length ? "compressing" : "generating",
                phaseStartedAt: batchStartedAt,
                prompt: text,
                model,
                config: { ...snapshot.config, count: "1" },
                references: [...snapshot.references],
            }),
        );
        setResults((value) => [...batchResults, ...value]);

        const tasks = batchResults.map((item) => runGenerationSlot(item.id, snapshot, item.clientRequestId!));

        const result = await Promise.allSettled(tasks);
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const successCount = successImages.length;
        const failCount = generationCount - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failCount ? generationFailureReason(failed?.reason, t("workbench.failureReasonUnavailable")) : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            if (successCount > 0) {
                await saveLog(
                    buildLog({
                        prompt: text,
                        model,
                        config: { ...snapshot.config, count: String(successCount) },
                        references: snapshot.references,
                        durationMs: performance.now() - batchStartedAt,
                        successCount,
                        failCount: 0,
                        status: "success",
                        images: successImages,
                    }),
                );
                message.success(t("imageWorkbench.generated"));
            } else {
                message.error(generationFailureReason(failed?.reason, t("workbench.failureReasonUnavailable")));
            }
        } finally {
            setActiveGenerations((value) => {
                const next = Math.max(0, value - 1);
                return next;
            });
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = async (image: GeneratedImage, index: number) => {
        if (image.previewOnly) {
            message.warning(t("canvas.node.originalProcessing"));
            return;
        }
        try {
            const blob = await resolveGeneratedImageBlob(image);
            const mimeType = blob.type || image.mimeType || "image/png";
            await saveGeneratedFile(blob, "image", mimeType, `image-${index + 1}.${generatedFileExtension("image", mimeType)}`);
            message.success(t("imageWorkbench.downloaded"));
        } catch (error) {
            console.error("Image download failed", error);
            message.error(t("imageWorkbench.downloadFailed"));
        }
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        if (image.previewOnly) { message.warning(t("canvas.node.originalProcessing")); return; }
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        if (image.previewOnly) { message.warning(t("canvas.node.originalProcessing")); return; }
        const stored = await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: t("imageWorkbench.resultTitle", { count: index + 1 }),
            coverUrl: stored.url,
            tags: [],
            source: t("imageWorkbench.source"),
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning(t("imageWorkbench.unsupportedAsset"));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setResults([]);
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
        const image = target?.image;
        if (!target || !image) return;
        setResults((value) => value.filter((item) => item.id !== target.id && item.image?.id !== image.id));
        for (const log of logs) {
            if (!log.images.some((item) => item.id === image.id)) continue;
            const images = log.images.filter((item) => item.id !== image.id);
            if (images.length) {
                await logStore.setItem(log.id, serializeLog({
                    ...log,
                    images,
                    successCount: images.length,
                    imageCount: images.length,
                    status: "success",
                }));
            } else {
                await logStore.removeItem(log.id);
            }
        }
        await refreshLogs();
        if (deleteOriginalToo) {
            if (image.storageKey) await deleteStoredImages([image.storageKey]).catch((error) => console.warn("Failed to delete stored image", error));
            if (image.localPath) await deleteGeneratedFile("image", image.localPath).catch((error) => console.warn("Failed to delete local image file", error));
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
                await refreshLogs();
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
            referenceCount: result.references?.length || 0,
        });
    };

    const saveLog = (log: GenerationLog) => {
        const userId = Number(useUserStore.getState().user?.id);
        const ownedLog = userId > 0 ? { ...log, userId } : log;
        void logStore.setItem(ownedLog.id, serializeLog(ownedLog)).then(async () => {
            const pruned = await pruneStoredLogs();
            await refreshLogs();
            if (pruned) cleanupAssets();
        });
    };

    const refreshLogs = async () => setLogs(await readStoredLogs());

    const previewGenerationLog = async (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults(log.images.map((image) => ({ id: image.id, status: "success", image: { ...image, prompt: image.prompt || log.prompt, model: image.model || modelOptionName(log.model) } })));
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t(isCreateProductMode() ? "workbench.managedConfigUnavailable" : "workbench.configFirst"));
            if (!isCreateProductMode()) openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (resultId: string, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, clientRequestId: string) => {
        const prepareStartedAt = performance.now();
        try {
            setResults((value) => updateResultById(value, resultId, { phase: "compressing", phaseStartedAt: prepareStartedAt, clientRequestId }));
            const requestReferences = snapshot.references.length ? await prepareReferenceImagesForRequest(snapshot.references) : [];
            const requestStartedAt = performance.now();
            const prepareDurationMs = requestStartedAt - prepareStartedAt;
            setResults((value) => updateResultById(value, resultId, { phase: "generating", phaseStartedAt: requestStartedAt, prepareDurationMs }));
            let downloadStartedAt: number | null = null;
            let lastProgressLoaded = 0;
            let lastProgressAt = 0;
            let lastProgressRate = 0;
            const requestOptions = {
                clientRequestId,
                onDownloadStart: () => {
                    if (downloadStartedAt) return;
                    downloadStartedAt = performance.now();
                    setResults((value) => updateResultById(value, resultId, {
                        phase: "downloading",
                        phaseStartedAt: downloadStartedAt || performance.now(),
                        downloadProgress: { percent: 0, loaded: 0, total: 0, bytesPerSecond: 0 },
                    }));
                },
                onDownloadProgress: (progress: { loaded: number; total: number; bytesPerSecond: number }) => {
                    if (!downloadStartedAt) {
                        downloadStartedAt = performance.now();
                    }
                    const now = performance.now();
                    if (!lastProgressAt) lastProgressAt = now;
                    const elapsedSeconds = Math.max(0.001, (now - lastProgressAt) / 1000);
                    const instantRate = Math.max(0, progress.loaded - lastProgressLoaded) / elapsedSeconds;
                    const bytesPerSecond = progress.bytesPerSecond > 0
                        ? progress.bytesPerSecond
                        : instantRate > 0
                          ? instantRate
                          : lastProgressRate;
                    lastProgressLoaded = Math.max(lastProgressLoaded, progress.loaded);
                    lastProgressAt = now;
                    lastProgressRate = bytesPerSecond;
                    const percent = progress.total > 0
                        ? Math.min(100, Math.max(0, (progress.loaded / progress.total) * 100))
                        : 0;
                    setResults((value) => updateResultById(value, resultId, {
                        phase: "downloading",
                        phaseStartedAt: downloadStartedAt || now,
                        downloadProgress: {
                            percent,
                            loaded: progress.loaded,
                            total: progress.total,
                            bytesPerSecond,
                        },
                    }));
                },
                onPreview: (previewImages: Array<{ id: string; dataUrl: string }>) => {
                    const preview = previewImages[0];
                    if (!preview) return;
                    const previewAt = performance.now();
                    setResults((value) =>
                        updateResultById(value, resultId, {
                            status: "success",
                            image: {
                                id: preview.id,
                                dataUrl: preview.dataUrl,
                                durationMs: previewAt - prepareStartedAt,
                                prepareDurationMs,
                                generationDurationMs: previewAt - requestStartedAt,
                                downloadDurationMs: 0,
                                width: 0,
                                height: 0,
                                bytes: 0,
                                mimeType: "image/jpeg",
                                prompt: snapshot.text,
                                model: modelOptionName(snapshot.config.model),
                            },
                        }),
                    );
                },
            };
            const persistentTask = await submitPersistentImageTask(snapshot.config, snapshot.text, requestReferences, requestOptions);
            const result = persistentTask
                ? await waitForPersistentImageTask(snapshot.config, persistentTask, requestOptions)
                : requestReferences.length
                  ? await requestEdit(snapshot.config, snapshot.text, requestReferences, requestOptions)
                  : await requestGeneration(snapshot.config, snapshot.text, requestOptions);
            const requestCompletedAt = performance.now();
            const phaseTiming = buildClientRequestTiming({
                prepareStartedAt,
                requestStartedAt,
                downloadStartedAt,
                completedAt: requestCompletedAt,
            });
            const { generationMs: generationDurationMs, downloadMs: downloadDurationMs, totalMs: totalDurationMs } = phaseTiming;
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            saveClientRequestTiming(clientRequestId, phaseTiming);
            const serverRequestId = result[0]?.serverRequestId;
            if (serverRequestId && serverRequestId !== clientRequestId) {
                saveClientRequestTiming(serverRequestId, phaseTiming);
            }
            const immediateImage: GeneratedImage = {
                id: image.id,
                dataUrl: image.previewDataUrl || image.dataUrl,
                durationMs: totalDurationMs,
                prepareDurationMs,
                generationDurationMs,
                downloadDurationMs,
                width: 0,
                height: 0,
                bytes: 0,
                mimeType: "",
                previewOnly: Boolean(image.previewOnly || image.previewDataUrl),
                prompt: snapshot.text,
                model: modelOptionName(snapshot.config.model),
            };
            // Match the canvas behavior: paint the returned image first, then
            // persist it to local storage in the background. A preview-only
            // response must never be persisted as the original artifact.
            setResults((value) => updateResultById(value, resultId, { status: "success", image: immediateImage }));
            if (image.previewOnly) return immediateImage;
            let stored: Awaited<ReturnType<typeof uploadImage>> | null = null;
            let durableBlob: Blob | null = null;
            try {
                stored = await uploadImage(image.dataUrl);
                if (stored.storageKey) durableBlob = await getImageBlob(stored.storageKey);
            } catch {
                // The desktop file is the durable fallback when IndexedDB is unavailable.
            }
            if (!durableBlob) {
                durableBlob = await resolveGeneratedImageBlob({ dataUrl: image.dataUrl }).catch(() => null);
            }
            let localPath = "";
            if (durableBlob?.size) {
                const saved = await autoSaveGeneratedFile(
                    durableBlob,
                    "image",
                    stored?.mimeType || durableBlob.type || "image/png",
                ).catch(() => null);
                localPath = saved?.savePath || "";
            }

            if (stored) {
                const nextImage: GeneratedImage = {
                    id: image.id,
                    dataUrl: stored.url,
                    ...(stored.storageKey ? { storageKey: stored.storageKey } : {}),
                    ...(localPath ? { localPath } : {}),
                    durationMs: totalDurationMs,
                    prepareDurationMs,
                    generationDurationMs,
                    downloadDurationMs,
                    width: stored.width,
                    height: stored.height,
                    bytes: stored.bytes,
                    mimeType: stored.mimeType,
                    previewOnly: false,
                    prompt: snapshot.text,
                    model: modelOptionName(snapshot.config.model),
                };
                setResults((value) => updateResultById(value, resultId, { status: "success", image: nextImage }));
                return nextImage;
            }

            if (durableBlob) {
                const nextImage: GeneratedImage = {
                    ...immediateImage,
                    dataUrl: URL.createObjectURL(durableBlob),
                    ...(localPath ? { localPath } : {}),
                    bytes: durableBlob.size,
                    mimeType: durableBlob.type || "image/png",
                    previewOnly: false,
                };
                setResults((value) => updateResultById(value, resultId, { status: "success", image: nextImage }));
                return nextImage;
            }

            // Storage failure must not replace a successfully generated image.
            return immediateImage;
        } catch (error) {
            const errorMessage = generationFailureReason(error, t("workbench.failureReasonUnavailable"));
            setResults((value) => updateResultById(value, resultId, { status: "failed", logId: resultId, error: errorMessage }));
            await saveLog(buildLog({
                id: resultId,
                prompt: snapshot.text,
                model: modelOptionName(snapshot.config.model),
                config: { ...snapshot.config, count: "1" },
                references: snapshot.references,
                durationMs: performance.now() - prepareStartedAt,
                successCount: 0,
                failCount: 1,
                status: "failed",
                images: [],
                error: errorMessage,
            }));
            throw error;
        }
    };

    const retryResult = async (resultId: string) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPreviewLog(null);
        const retryStartedAt = performance.now();
        const clientRequestId = nanoid();
        setResults((value) => updateResultById(value, resultId, {
            status: "pending",
            error: undefined,
            image: undefined,
            clientRequestId,
            phase: snapshot.references.length ? "compressing" : "generating",
            phaseStartedAt: retryStartedAt,
            prepareDurationMs: undefined,
        }));
        setActiveGenerations((value) => value + 1);
        try {
            const image = await runGenerationSlot(resultId, snapshot, clientRequestId);
            saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: "1" },
                    references: snapshot.references,
                    durationMs: performance.now() - retryStartedAt,
                    successCount: 1,
                    failCount: 0,
                    status: "success",
                    images: [image],
                }),
            );
            message.success(t("workbench.retrySuccess"));
        } catch {
            // runGenerationSlot has already marked the result as failed.
        } finally {
            setActiveGenerations((value) => {
                const next = Math.max(0, value - 1);
                return next;
            });
        }
    };

    const displayedResults: GenerationResult[] = [...results];
    const displayedResultIds = new Set(results.map((result) => result.id));
    const displayedImageIds = new Set(results.flatMap((result) => (result.image ? [result.image.id] : [])));
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
            });
            continue;
        }
        if (log.status !== "success") continue;
        for (const image of log.images) {
            if (displayedImageIds.has(image.id)) continue;
            displayedImageIds.add(image.id);
            displayedResults.push({
                id: `history:${log.id}:${image.id}`,
                status: "success",
                image: { ...image, prompt: image.prompt || log.prompt, model: image.model || modelOptionName(log.model) },
            });
        }
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:overflow-hidden" style={layoutStyle}>
                <section className="workbench-split-grid grid gap-3 lg:min-h-0 lg:overflow-hidden">
                    <div ref={workbenchPanelRef} className="thin-scrollbar flex min-w-0 flex-col rounded-xl border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto [&>*]:shrink-0">
                        <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-stone-950 dark:text-stone-100">{t("imageWorkbench.title")}</h1>

                        <div className="mt-3 flex items-center gap-2">
                            <label className="relative flex h-10 min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 text-sm dark:border-stone-700 dark:bg-stone-900/60">
                                <span className="shrink-0 px-3 text-xs font-medium text-stone-500 dark:text-stone-400">API Key</span>
                                <span className="h-4 w-px shrink-0 bg-stone-300 dark:bg-stone-700" />
                                <select
                                    aria-label="API Key"
                                    className="workbench-native-select h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-3 pr-9 text-sm text-stone-800 outline-none disabled:cursor-not-allowed disabled:text-stone-500 dark:text-stone-100"
                                    value={imageKeysLoading || !imageKeys.some((item) => item.id === selectedImageKeyId) ? 0 : selectedImageKeyId}
                                    disabled={imageKeysLoading || switchingImageKey || !imageKeys.length}
                                    onChange={(event) => void selectImageKey(Number(event.target.value))}
                                >
                                    {imageKeysLoading ? <option value={0}>正在加载...</option> : null}
                                    {!imageKeysLoading && !imageKeys.length ? <option value={0}>暂无可用密钥</option> : null}
                                    {!imageKeysLoading
                                        ? imageKeys.map((item) => (
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
                                disabled={imageKeysLoading || switchingImageKey || !session}
                                title="刷新 API 密钥"
                                aria-label="刷新 API 密钥"
                                onClick={() => void loadImageKeys(true)}
                            >
                                <RefreshCw className={`size-4 ${imageKeysLoading || switchingImageKey ? "animate-spin" : ""}`} />
                            </button>
                        </div>

                        <div className="mt-3 flex shrink-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/70">
                            <textarea
                                className="workbench-prompt-textarea block w-full flex-none resize-y bg-transparent px-4 py-4 text-[15px] leading-6 text-stone-900 outline-none placeholder:text-stone-500 dark:text-stone-100"
                                style={{ height: 180, minHeight: 180, maxHeight: 420 }}
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                onPaste={handleComposerPaste}
                                placeholder={t("imageWorkbench.promptPlaceholder")}
                            />
                            <div className="flex min-h-10 items-center justify-between gap-2 px-2.5 pb-2">
                                <div className="min-w-0 max-w-[300px] flex-1">
                                    <WorkbenchModelSelect
                                        label="生图模型"
                                        value={imageModelGroups.some((group) => group.models.some((item) => item.value === model)) ? model : ""}
                                        groups={imageModelGroups}
                                        onChange={(value) => updateConfig("imageModel", value)}
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
                                        disabled={references.length >= MAX_IMAGE_REFERENCES}
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
                                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t("imageWorkbench.references")}</span>
                                <button
                                    type="button"
                                    className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    title={t("workbench.upload")}
                                    aria-label={t("workbench.upload")}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Upload className="size-4" />
                                </button>
                            </div>
                            <div
                                className={`hover-scrollbar hover-scrollbar-hint mt-2 flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-xl p-0.5 pb-2 overscroll-x-contain transition-colors ${isReferenceDragActive ? "bg-stone-100 ring-2 ring-stone-400 dark:bg-stone-900/80 dark:ring-stone-500" : ""}`}
                                onDragEnter={(event) => {
                                    event.preventDefault();
                                    dragDepthRef.current += 1;
                                    if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                }}
                                onDragLeave={(event) => {
                                    event.preventDefault();
                                    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                    if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    dragDepthRef.current = 0;
                                    setIsReferenceDragActive(false);
                                    void addReferences(event.dataTransfer.files);
                                }}
                                onWheel={(event) => {
                                    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                    event.preventDefault();
                                    event.currentTarget.scrollLeft += event.deltaY;
                                }}
                            >
                                {references.map((item, index) => (
                                    <div key={item.id} className="group relative size-24 shrink-0 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
                                        <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt={item.name} className="size-full object-cover" />
                                        <button type="button" className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur" title="插入引用" onClick={() => insertReferenceLabel(index)}>
                                            {imageReferenceLabel(index)}
                                        </button>
                                        <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                        <button
                                            type="button"
                                            className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-md bg-black/65 text-white backdrop-blur group-hover:flex"
                                            onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                            aria-label={t("imageWorkbench.removeReference")}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-stone-500 text-stone-500 transition hover:border-stone-700 hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:border-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                                    disabled={references.length >= MAX_IMAGE_REFERENCES}
                                    title={isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Plus className="size-7 stroke-[1.4]" />
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] leading-4 text-stone-500">可拖拽或粘贴参考图，最多 {MAX_IMAGE_REFERENCES} 张；点击编号可插入引用。</p>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t("settingsPanels.image.transparent")}</span>
                                {!transparentAvailable ? <span className="ml-2 text-[11px] text-stone-500">{outputFormat !== "png" ? "仅 PNG 支持" : "当前模型不支持"}</span> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className={`text-xs font-medium ${transparentEnabled ? "text-emerald-500" : "text-stone-500"}`}>{transparentEnabled ? "开" : "关"}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={transparentEnabled}
                                    aria-label={t("settingsPanels.image.transparent")}
                                    disabled={!transparentAvailable}
                                    className={`relative h-6 w-10 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${transparentEnabled ? "bg-stone-200" : "bg-stone-600"}`}
                                    onClick={() => updateConfig("background", transparentEnabled ? "" : "transparent")}
                                >
                                    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] ${transparentEnabled ? "left-[18px]" : "left-0.5"}`} />
                                </button>
                            </div>
                        </div>

                        <div className="mt-3 grid grid-cols-[1.08fr_0.92fr] gap-4">
                            <div className="min-w-0">
                                <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">质量</div>
                                <div className="grid grid-cols-4 rounded-xl border border-stone-200 bg-stone-100/60 p-1 dark:border-stone-700 dark:bg-stone-900/60">
                                    {WORKBENCH_RESOLUTION_OPTIONS.map((value) => (
                                        <button
                                            key={value}
                                            type="button"
                                            className={`h-9 min-w-0 rounded-lg px-1 text-sm transition ${activeResolutionScale === value ? "bg-stone-100 font-semibold !text-stone-950 shadow-sm dark:bg-stone-100 dark:!text-stone-950" : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"}`}
                                            onClick={() => selectResolutionScale(value)}
                                        >
                                            {value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="min-w-0">
                                <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">格式</div>
                                <div className="grid grid-cols-2 rounded-xl border border-stone-200 bg-stone-100/60 p-1 dark:border-stone-700 dark:bg-stone-900/60">
                                    <button
                                        type="button"
                                        className={`h-9 rounded-lg text-sm transition ${outputFormat === "png" ? "bg-stone-100 font-semibold !text-stone-950 shadow-sm dark:bg-stone-100 dark:!text-stone-950" : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"}`}
                                        onClick={() => selectOutputFormat("png")}
                                    >
                                        PNG
                                    </button>
                                    <button
                                        type="button"
                                        className={`h-9 rounded-lg text-sm transition ${outputFormat === "jpeg" ? "bg-stone-100 font-semibold !text-stone-950 shadow-sm dark:bg-stone-100 dark:!text-stone-950" : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"}`}
                                        onClick={() => selectOutputFormat("jpeg")}
                                    >
                                        JPEG
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">尺寸</span>
                                <button type="button" className="text-xs text-stone-500 transition hover:text-stone-900 dark:hover:text-stone-100" onClick={() => { setSizeMenuOpen(false); setCustomSizeOpen((value) => !value); }}>
                                    自定义尺寸
                                </button>
                            </div>
                            <Popover
                                trigger="click"
                                placement="bottomLeft"
                                arrow={false}
                                open={sizeMenuOpen}
                                onOpenChange={setSizeMenuOpen}
                                content={(
                                    <div className="thin-scrollbar max-h-[440px] w-[320px] overflow-y-auto p-1" role="listbox" aria-label="尺寸">
                                        <button type="button" className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${sizeSelectionValue === "auto" ? "bg-stone-200 text-stone-950 dark:bg-stone-700 dark:text-white" : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"}`} onClick={() => selectImageSize("auto")}>
                                            <span className="text-sm font-semibold">自动</span>
                                            <span className="text-xs text-stone-500 dark:text-stone-400">由模型决定</span>
                                        </button>
                                        {sizeSelectionValue === "current" ? (
                                            <SizeRatioOption value={effectiveConfig.size} label={sizeSelectionLabel} selected onClick={() => selectImageSize("current")} />
                                        ) : null}
                                        {WORKBENCH_SIZE_GROUPS.map((group, groupIndex) => (
                                            <div key={group.scale} className={groupIndex === 0 && sizeSelectionValue !== "current" ? "mt-1" : ""}>
                                                <div className="px-3 pb-1 pt-3 text-xs font-semibold text-stone-500 dark:text-stone-400">{group.label}</div>
                                                {group.options.map((option) => (
                                                    <SizeRatioOption key={option.value} value={option.value} label={`${option.ratio} ${option.value}`} selected={sizeSelectionValue === option.value} onClick={() => selectImageSize(option.value)} />
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            >
                                <button
                                    type="button"
                                    aria-label="尺寸"
                                    aria-haspopup="listbox"
                                    aria-expanded={sizeMenuOpen}
                                    className="flex h-9 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 text-left text-sm text-stone-800 outline-none transition hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-100 dark:hover:border-stone-600"
                                >
                                    <span className="min-w-0 truncate">{sizeSelectionLabel}</span>
                                    <ChevronDown className={`size-4 shrink-0 text-stone-500 transition ${sizeMenuOpen ? "rotate-180" : ""}`} />
                                </button>
                            </Popover>                            {customSizeOpen ? (
                                <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                    <label className="flex h-9 items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                                        <span className="pl-3 text-xs text-stone-500">W</span>
                                        <input
                                            key={`width-${selectedSize.width}`}
                                            type="number"
                                            min={16}
                                            step={16}
                                            defaultValue={selectedSize.width}
                                            className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                            onBlur={(event) => commitCustomDimension("width", event.currentTarget.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") event.currentTarget.blur();
                                            }}
                                        />
                                    </label>
                                    <span className="text-stone-500">×</span>
                                    <label className="flex h-9 items-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                                        <span className="pl-3 text-xs text-stone-500">H</span>
                                        <input
                                            key={`height-${selectedSize.height}`}
                                            type="number"
                                            min={16}
                                            step={16}
                                            defaultValue={selectedSize.height}
                                            className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                            onBlur={(event) => commitCustomDimension("height", event.currentTarget.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") event.currentTarget.blur();
                                            }}
                                        />
                                    </label>
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">生成张数</div>
                            <div className="grid grid-cols-4 rounded-xl border border-stone-200 p-1 dark:border-stone-700">
                                {[1, 2, 3, 4].map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`h-9 rounded-lg text-sm transition ${generationCount === value ? "bg-stone-100 font-semibold !text-stone-950 shadow-sm dark:bg-stone-100 dark:!text-stone-950" : "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"}`}
                                        onClick={() => updateConfig("count", String(value))}
                                    >
                                        {value}
                                    </button>
                                ))}
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
                                {running ? `继续生成${activeGenerations > 1 ? ` (${activeGenerations})` : ""}` : t("workbench.generate")}
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
                            <Button size="small" icon={<History className="size-3.5" />} onClick={() => setLogsOpen(true)}>
                                {t("workbench.logs")}
                            </Button>
                        </div>
                        {displayedResults.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                {displayedResults.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} onPreview={setPreviewMedia} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} onDelete={() => { setDeleteOriginalToo(false); setDeleteResultTarget(result); }} />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard
                                            key={result.id}
                                            result={result}
                                            error={generationFailureReason(result.error, t("workbench.failureReasonUnavailable"))}
                                            onRetry={() => retryResult(result.id)}
                                            onDetails={() => showFailedDetail(result)}
                                            onDelete={() => deleteFailedResult(result)}
                                        />
                                    ) : (
                                        <PendingImageCard key={result.id} result={result} clockNow={clockNow} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("imageWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
                    onPreviewLog={(log) => void previewGenerationLog(log)}
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
                <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">确认删除这个生成结果吗？工作台和历史记录中都会移除。</p>
                <Checkbox
                    checked={deleteOriginalToo}
                    disabled={!deleteResultTarget?.image?.storageKey && !deleteResultTarget?.image?.localPath}
                    onChange={(event) => setDeleteOriginalToo(event.target.checked)}
                >
                    同时删除本地原图（不可恢复）
                </Checkbox>
            </Modal>
        </div>
    );
}

function SizeRatioOption({ value, label, selected, onClick }: { value: string; label: string; selected: boolean; onClick: () => void }) {
    const pixels = parsePixelSize(value);
    const ratioParts = value.split(":").map(Number);
    const widthUnits = pixels?.width || (ratioParts.length === 2 && ratioParts[0] > 0 ? ratioParts[0] : 1);
    const heightUnits = pixels?.height || (ratioParts.length === 2 && ratioParts[1] > 0 ? ratioParts[1] : 1);
    const aspect = widthUnits / Math.max(1, heightUnits);
    const previewWidth = aspect >= 1 ? 26 : Math.max(8, Math.round(26 * aspect));
    const previewHeight = aspect >= 1 ? Math.max(8, Math.round(26 / aspect)) : 26;
    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${selected ? "bg-stone-200 font-semibold text-stone-950 dark:bg-stone-700 dark:text-white" : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"}`}
            onClick={onClick}
        >
            <span className="flex size-7 shrink-0 items-center justify-center">
                <span className={`rounded-[3px] border-2 ${selected ? "border-stone-900 dark:border-white" : "border-stone-400/75 dark:border-stone-500"}`} style={{ width: previewWidth, height: previewHeight }} />
            </span>
            <span className="min-w-0 truncate text-sm">{label}</span>
        </button>
    );
}
function workbenchSizePixels(size: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    return parsePixelSize(computeMediaSize("1k", ratio)) || { width: 1024, height: 1024 };
}

function ResultImageCard({
    image,
    index,
    onPreview,
    onEdit,
    onDownload,
    onSaveAsset,
    onDelete,
}: {
    image: GeneratedImage;
    index: number;
    onPreview: (data: GeneratedMediaDetailData) => void;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => Promise<void>;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [recoveredImage, setRecoveredImage] = useState<GeneratedImage | null>(null);
    useEffect(() => setRecoveredImage(null), [image.id, image.storageKey, image.dataUrl]);
    const currentImage = recoveredImage || image;
    const imageSource = previewUrlFor(currentImage.storageKey) || currentImage.dataUrl;
    const previewOnly = Boolean(currentImage.previewOnly);
    const recoverImage = async () => {
        const recovered = await resolveStoredLogImage(currentImage).catch(() => currentImage);
        if (recovered.dataUrl || recovered.storageKey) setRecoveredImage(recovered);
    };
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <button
                type="button"
                className="group relative block w-full cursor-zoom-in overflow-hidden"
                title={t("common.details")}
                aria-label={t("common.details")}
                onClick={() => onPreview({ kind: "image", src: currentImage.dataUrl, prompt: currentImage.prompt, model: currentImage.model, width: currentImage.width, height: currentImage.height, durationMs: currentImage.durationMs, prepareDurationMs: currentImage.prepareDurationMs, generationDurationMs: currentImage.generationDurationMs, downloadDurationMs: currentImage.downloadDurationMs, bytes: currentImage.bytes })}
                onContextMenu={(event) => event.preventDefault()}
            >
                <Image src={imageSource} preview={false} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-square w-full object-cover" onError={() => void recoverImage()} />
                {previewOnly ? (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
                        {t("canvas.node.thumbnailPreview")}
                    </span>
                ) : null}
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">{t("common.details")}</span>
            </button>
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-300">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    {image.prepareDurationMs ? <span title={t("workbench.prepareDuration")}>{t("workbench.prepareDuration")} {formatPreciseDuration(image.prepareDurationMs)}</span> : null}
                    <span title={t("workbench.generationDuration")}>{t("workbench.generationDuration")} {formatPreciseDuration(image.generationDurationMs || image.durationMs)}</span>
                    {image.downloadDurationMs && image.downloadDurationMs > 0 ? <span title={t("workbench.downloadDuration")}>{t("workbench.downloadDuration")} {formatPreciseDuration(image.downloadDurationMs)}</span> : null}
                    <span title={t("workbench.totalDuration")}>{t("workbench.totalDuration")} {formatPreciseDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-4 gap-2">
                    <Tooltip title={t("common.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(currentImage, index)}>
                            {t("common.addAssetShort")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(currentImage, index)}>
                            {t("imageWorkbench.referenceShort")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={previewOnly ? t("canvas.node.originalProcessing") : t("common.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" disabled={previewOnly} icon={<Download className="size-3.5" />} onClick={() => void onDownload(currentImage, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.delete")}>
                        <Button danger className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                            {t("common.delete")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ result, clockNow }: { result: GenerationResult; clockNow: number }) {
    const { t } = useTranslation();
    const phase = result.phase || "generating";
    const phaseStartedAt = result.phaseStartedAt || clockNow;
    const phaseElapsedMs = Math.max(0, clockNow - phaseStartedAt);
    const phaseLabel = phase === "compressing"
        ? t("workbench.compressing")
        : phase === "downloading"
          ? t("workbench.downloading")
          : t("workbench.generating");
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{phaseLabel}</span>
                <span className="text-xs tabular-nums">{t("workbench.elapsed", { time: formatPreciseDuration(phaseElapsedMs) })}</span>
                {phase === "downloading" ? (
                    <div className="mt-1 flex w-full max-w-48 flex-col gap-1.5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                            <div
                                className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                                style={{ width: `${result.downloadProgress?.percent ?? 0}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[11px] tabular-nums">
                            <span>{result.downloadProgress?.total ? `${result.downloadProgress.percent.toFixed(1)}%` : "--%"}</span>
                            <span>{formatDownloadSpeed(result.downloadProgress?.bytesPerSecond ?? 0)}</span>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function FailedImageCard({
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
                    <Typography.Paragraph ellipsis={{ rows: 3 }} className="!mb-0 !text-xs !leading-5 !text-stone-800 dark:!text-stone-100">
                        {prompt || "无提示词"}
                    </Typography.Paragraph>
                </div>
                <div>
                    <div className="mb-1 text-[11px] font-medium text-red-500 dark:text-red-300">失败原因</div>
                    <Typography.Paragraph ellipsis={{ rows: 3 }} className="!mb-0 !text-xs !leading-5 !text-red-600 dark:!text-red-300">
                        {error}
                    </Typography.Paragraph>
                </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" onClick={onDetails}>详情</Button>
                <Button size="small" danger onClick={onDelete}>删除</Button>
                <Button size="small" onClick={onRetry}>{t("workbench.retry")}</Button>
            </div>
        </div>
    );
}

function updateResultById(results: GenerationResult[], id: string, next: Partial<GenerationResult>) {
    return results.map((item) => (item.id === id ? { ...item, ...next } : item));
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
                <div>
                    <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                </div>
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
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const thumbnails = log.images.filter((image) => image.dataUrl).slice(0, 4);

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
                    {thumbnails.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {thumbnails.map((image) => (
                                <img key={image.id} src={previewUrlFor(image.storageKey) || image.dataUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                            ))}
                        </div>
                    ) : null}
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                            {t("workbench.successCount", { count: log.successCount ?? log.imageCount })}
                        </Tag>
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                {t("workbench.failCount", { count: log.failCount })}
                            </Tag>
                        ) : null}
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{t("workbench.itemCount", { count: log.imageCount })}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                        <Tag className="m-0 flex h-6 max-w-full items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
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
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(async (stored) => {
            const log = await normalizeLog(stored);
            const changed = log.images.some((image, index) => {
                const previous = stored.images?.[index];
                return image.storageKey !== previous?.storageKey || image.localPath !== previous?.localPath;
            });
            if (changed) {
                await logStore.setItem(log.id, serializeLog(log)).catch(() => undefined);
            }
            return log;
        }));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function pruneStoredLogs() {
    await ensureLogStoreMigrated();
    const logs: GenerationLog[] = [];
    await logStore.iterate<GenerationLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    if (logs.length <= MAX_WORKBENCH_LOGS) return false;
    const removable = logs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, logs.length - MAX_WORKBENCH_LOGS);
    if (!removable.length) return false;
    await Promise.all(removable.map((log) => logStore.removeItem(log.id)));
    return true;
}

async function resolveStoredLogImage(image: GeneratedImage): Promise<GeneratedImage> {
    if (image.previewOnly) return image;
    let storageKey = image.storageKey?.trim() || "";
    let localPath = image.localPath?.trim() || "";
    let blob = storageKey ? await getImageBlob(storageKey).catch(() => null) : null;

    if (!blob || !localPath) {
        const recovered = await readGeneratedFileAsset({
            kind: "image",
            path: localPath,
            filename: localPath.split(/[\\/]/).pop() || undefined,
            size: image.bytes,
            mimeType: image.mimeType,
        }).catch(() => null);
        if (recovered?.blob.size) {
            blob = recovered.blob;
            localPath = recovered.savePath || localPath;
        }
    }

    if (!blob && image.dataUrl && !image.dataUrl.startsWith("blob:")) {
        blob = await resolveGeneratedImageBlob({ dataUrl: image.dataUrl }).catch(() => null);
    }
    if (blob?.size && !localPath) {
        const saved = await autoSaveGeneratedFile(blob, "image", image.mimeType || blob.type || "image/png").catch(() => null);
        localPath = saved?.savePath || "";
    }
    if (blob && !storageKey) storageKey = `image:${nanoid()}`;    if (blob && storageKey) {
        await setImageBlob(storageKey, blob).catch(() => undefined);
    }
    if (storageKey) {
        void ensureImagePreview(storageKey);
        const dataUrl = await resolveImageUrl(storageKey, "").catch(() => "");
        if (dataUrl) {
            return { ...image, storageKey, ...(localPath ? { localPath } : {}), dataUrl };
        }
    }
    if (blob) {
        return {
            ...image,
            ...(storageKey ? { storageKey } : {}),
            ...(localPath ? { localPath } : {}),
            dataUrl: URL.createObjectURL(blob),
            mimeType: blob.type || image.mimeType,
        };
    }

    // A blob: URL only belongs to the previous renderer session. Never persist
    // or display it as a durable source after restart.
    const durableFallback = image.dataUrl && !image.dataUrl.startsWith("blob:") ? image.dataUrl : "";
    return { ...image, ...(storageKey ? { storageKey } : {}), ...(localPath ? { localPath } : {}), dataUrl: durableFallback };
}async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const images = await Promise.all((log.images || []).map((item) => resolveStoredLogImage(item)));
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        userId: log.userId || Number(useUserStore.getState().user?.id) || undefined,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        images,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
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

function buildLog({
    id,
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
    error,
}: {
    id?: string;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
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
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        error,
    };
}

import { ArrowLeft, ArrowRight, CheckSquare, ChevronDown, ClipboardPaste, Copy, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { type CSSProperties, type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { normalizeImageBackground, normalizeImageOutputFormat, supportsTransparentImageBackground } from "@/lib/image-output-format";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, parsePixelSize } from "@/lib/media-size";
import { encodeChannelModel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration, submitPersistentImageTask, waitForPersistentImageTask } from "@/services/api/image";
import { ensureImagePreview, getImagePreviewRevision, previewUrlFor, resolveImageUrl, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { getManagedKeySelection, listCreateManagedKeys, managedKeySupportsImage, switchManagedKey, type CreateManagedKey } from "@/services/create-managed-channel";
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
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
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
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "success" | "failed";
    images: GeneratedImage[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const MAX_WORKBENCH_LOGS = 100;
const MAX_IMAGE_REFERENCES = 14;
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const WORKBENCH_RESOLUTION_OPTIONS = ["auto", "4k", "2k", "1k"] as const;
const WORKBENCH_SIZE_OPTIONS = mediaRatioOptions.filter((item) => item.value !== "auto").map((item) => ({ value: item.value, size: computeMediaSize("1k", item.value) }));

export default function ImagePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const logPanelRef = useRef<HTMLElement>(null);
    const workbenchPanelRef = useRef<HTMLDivElement>(null);
    const [logPanelWidth, setLogPanelWidth] = useStoredPanelWidth("create-canvas:image-workbench-layout:logs", 300);
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
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
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
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const layoutStyle = {
        "--log-panel-width": `${logPanelWidth}px`,
        "--workbench-panel-width": `${workbenchPanelWidth}px`,
    } as CSSProperties;

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const imageModelGroups = effectiveConfig.channels
        .map((channel) => {
            const capableModels = channel.models.filter((item) => item.capability === "image").map((item) => ({ value: encodeChannelModel(channel.id, item.name), label: item.name }));
            const allModels = channel.models.map((item) => ({ value: encodeChannelModel(channel.id, item.name), label: item.name }));
            return { id: channel.id, name: channel.name, models: capableModels.length ? capableModels : allModels };
        })
        .filter((group) => group.models.length > 0);
    if (model && !imageModelGroups.some((group) => group.models.some((item) => item.value === model))) {
        imageModelGroups.push({ id: "current-model", name: "当前模型", models: [{ value: model, label: modelOptionName(model) }] });
    }
    const imageModelOptions = imageModelGroups.flatMap((group) => group.models.map((item) => item.value));
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const selectedRatio = inferMediaRatio(effectiveConfig.size);
    const selectedSize = workbenchSizePixels(effectiveConfig.size, selectedRatio);
    const selectedSizeLabel = selectedRatio === "auto" ? "自动" : `${selectedRatio} ${selectedSize.width}x${selectedSize.height}`;
    const outputFormat = normalizeImageOutputFormat(effectiveConfig.outputFormat);
    const transparentSupported = supportsTransparentImageBackground(effectiveConfig.model || model);
    const transparentAvailable = transparentSupported && outputFormat === "png";
    const transparentEnabled = transparentAvailable && normalizeImageBackground(effectiveConfig.model || model, effectiveConfig.background, outputFormat) === "transparent";
    const activeResolutionScale = inferMediaScale(effectiveConfig.size);

    const loadImageKeys = useCallback(async () => {
        if (!session) {
            setImageKeys([]);
            return;
        }
        setImageKeysLoading(true);
        try {
            const keys = (await listCreateManagedKeys(session)).filter((item) => item.status === "active" && Boolean(item.key?.trim()) && managedKeySupportsImage(item.group));
            setImageKeys(keys);
            const storedId = getManagedKeySelection().imageKeyId;
            setSelectedImageKeyId((current) => keys.find((item) => item.id === storedId)?.id || keys.find((item) => item.id === current)?.id || keys[0]?.id || 0);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载 API 密钥失败");
        } finally {
            setImageKeysLoading(false);
        }
    }, [message, session]);

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
            await loadImageKeys();
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
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));

        const result = await Promise.allSettled(tasks);
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const successCount = successImages.length;
        const failCount = generationCount - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            saveLog(
                buildLog({
                    prompt: text,
                    model,
                    config: { ...snapshot.config, count: String(generationCount) },
                    references: snapshot.references,
                    durationMs: performance.now() - batchStartedAt,
                    successCount,
                    failCount,
                    status: successCount ? "success" : "failed",
                    images: successImages,
                }),
            );
            successCount ? message.success(t("imageWorkbench.generated")) : message.error(failed?.reason instanceof Error ? failed.reason.message : t("workbench.generationFailed"));
        } finally {
            setRunning(false);
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: t("imageWorkbench.busy") });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
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

    const saveLog = (log: GenerationLog) => {
        void logStore.setItem(log.id, serializeLog(log)).then(async () => {
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
        setResults(log.images.map((image) => ({ id: image.id, status: "success", image })));
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
        const itemStartedAt = performance.now();
        try {
            const persistentTask = await submitPersistentImageTask(snapshot.config, snapshot.text, snapshot.references);
            const requestOptions = {
                onPreview: (previewImages: Array<{ id: string; dataUrl: string }>) => {
                    const preview = previewImages[0];
                    if (!preview) return;
                    setResults((value) =>
                        updateResultAt(value, index, {
                            status: "success",
                            image: {
                                id: preview.id,
                                dataUrl: preview.dataUrl,
                                durationMs: performance.now() - itemStartedAt,
                                width: 0,
                                height: 0,
                                bytes: 0,
                                mimeType: "image/jpeg",
                            },
                        }),
                    );
                },
            };
            const result = persistentTask
                ? await waitForPersistentImageTask(snapshot.config, persistentTask, requestOptions)
                : snapshot.references.length
                  ? await requestEdit(snapshot.config, snapshot.text, snapshot.references, requestOptions)
                  : await requestGeneration(snapshot.config, snapshot.text, requestOptions);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const immediateImage: GeneratedImage = {
                id: image.id,
                dataUrl: image.previewDataUrl || image.dataUrl,
                durationMs: performance.now() - itemStartedAt,
                width: 0,
                height: 0,
                bytes: 0,
                mimeType: "",
            };
            // Match the canvas behavior: paint the returned image first, then
            // persist it to local storage in the background.
            setResults((value) => updateResultAt(value, index, { status: "success", image: immediateImage }));
            try {
                const stored = await uploadImage(image.dataUrl);
                const nextImage: GeneratedImage = {
                    id: image.id,
                    dataUrl: stored.url,
                    ...(stored.storageKey ? { storageKey: stored.storageKey } : {}),
                    durationMs: performance.now() - itemStartedAt,
                    width: stored.width,
                    height: stored.height,
                    bytes: stored.bytes,
                    mimeType: stored.mimeType,
                };
                setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
                return nextImage;
            } catch {
                // Storage failure must not replace a successfully generated image.
                return immediateImage;
            }
        } catch (error) {
            setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (index: number) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPreviewLog(null);
        setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        const retryStartedAt = performance.now();
        try {
            const image = await runGenerationSlot(index, snapshot);
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
        }
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
                        onPreviewLog={(log) => void previewGenerationLog(log)}
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
                            <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-stone-950 dark:text-stone-100">{t("imageWorkbench.title")}</h1>
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
                                onClick={() => void loadImageKeys()}
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
                                <div className="relative min-w-0 max-w-[260px] flex-1">
                                    <select
                                        aria-label="生图模型"
                                        className="workbench-native-select h-8 w-full cursor-pointer appearance-none rounded-xl border border-stone-200 bg-stone-100 px-3 pr-8 text-sm text-stone-700 outline-none dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-100"
                                        value={imageModelOptions.includes(model) ? model : ""}
                                        onFocus={() => {
                                            if (!imageModelOptions.length) openConfigDialog(false);
                                        }}
                                        onChange={(event) => updateConfig("imageModel", event.target.value)}
                                    >
                                        {!imageModelOptions.length ? (
                                            <option value="" disabled>
                                                请先配置模型
                                            </option>
                                        ) : null}
                                        {imageModelGroups.map((group) => (
                                            <optgroup key={group.id} label={group.name}>
                                                {group.models.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-2 size-4 text-stone-500" />
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
                                <button type="button" className="text-xs text-stone-500 transition hover:text-stone-900 dark:hover:text-stone-100" onClick={() => setCustomSizeOpen((value) => !value)}>
                                    自定义尺寸
                                </button>
                            </div>
                            <div className="relative mt-2">
                                <select
                                    aria-label="尺寸"
                                    className="workbench-native-select h-9 w-full cursor-pointer appearance-none rounded-xl border border-stone-200 bg-stone-50 px-3 pr-9 text-sm text-stone-800 outline-none dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-100"
                                    value={selectedRatio}
                                    onChange={(event) => updateConfig("size", event.target.value === "auto" ? "auto" : computeMediaSize("1k", event.target.value))}
                                >
                                    {WORKBENCH_SIZE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {selectedRatio === option.value ? selectedSizeLabel : `${option.value} ${option.size}`}
                                        </option>
                                    ))}
                                    <option value="auto">自动</option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-stone-500" />
                            </div>
                            {customSizeOpen ? (
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
                            <div>
                                <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            </div>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={() => retryResult(index)} />
                                    ) : (
                                        <PendingImageCard key={result.id} />
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
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function workbenchSizePixels(size: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const option = WORKBENCH_SIZE_OPTIONS.find((item) => item.value === ratio);
    return parsePixelSize(option?.size || "1024x1024") || { width: 1024, height: 1024 };
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <Image src={previewUrlFor(image.storageKey) || image.dataUrl} preview={{ src: image.dataUrl }} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-square object-cover" />
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title={t("common.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("common.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
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

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
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
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
    const removable = logs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, logs.length - MAX_WORKBENCH_LOGS);
    if (!removable.length) return false;
    await Promise.all(removable.map((log) => logStore.removeItem(log.id)));
    return true;
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
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
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
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
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
    };
}

import { ArrowLeft, ArrowRight, CheckSquare, ChevronDown, ClipboardPaste, Copy, Download, Film, FolderPlus, History, LoaderCircle, Music2, Plus, RefreshCw, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { type CSSProperties, type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { FailedTaskDetailModal, type FailedTaskDetail } from "@/components/workbench/failed-task-detail-modal";
import { GeneratedMediaDetailModal, type GeneratedMediaDetailData } from "@/components/workbench/generated-media-detail-modal";
import { generationFailureReason } from "@/lib/generation-error";
import { isCreateProductMode } from "@/lib/create-product";
import { normalizeVideoResolutionValue, VideoParameterFields } from "@/components/video-settings-panel";
import { computeVideoSize, inferVideoRatio, normalizeVideoResolutionToken, parsePixelSize, parseVideoResolution, readVideoDimensions, videoRatioOptions, videoResolutionDisplayLabel } from "@/lib/media-size";
import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoDurationOptionAllowed, isVideoRatioSupported, isVideoResolutionSupported, resolveVideoModeForReferencePlan, resolveVideoModeMediaPolicy, resolveVideoModeProfile, resolveVideoResolutionForProfile, supportsVideoGenerateAudioToggle, videoResolutionChoices } from "@/lib/video-model-profile";
import { autoSaveGeneratedFile, deleteGeneratedFile, readGeneratedFileAsset } from "@/lib/desktop-save";
import { captureVideoAssetCover } from "@/lib/video-asset-cover";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { deleteStoredMedia, getMediaBlob, resolveMediaUrl, setMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, isRetryableVideoPollingError, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask, type VideoGenerationTaskState } from "@/services/api/video";
import { createUserWorkbenchLogStore } from "@/services/workbench-log-storage";
import { buildVideoConfig, buildVideoLog as buildLog, normalizeVideoResolution as normalizeResolution, readVideoLogs, recoverVideoFromLocalFile, serializeVideoLog as serializeLog } from "@/lib/workbench/video-log";
import { configureCreateWorkspace, getManagedKeySelection, listCreateManagedKeys, managedKeySupportsVideo, switchManagedKey, type CreateManagedKey } from "@/services/create-managed-channel";
import { WorkbenchModelSelect } from "@/components/workbench/model-select";
import { useModelPlazaDetails } from "@/hooks/use-model-plaza-details";
import { PanelResizeHandle, useStoredPanelWidth } from "@/components/workbench/panel-resize-handle";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { boolConfig, encodeChannelModel, modelOptionName, useConfigStore, useEffectiveConfig, videoCapabilityOf, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { GeneratedVideo, VideoGenerationLog as GenerationLog, VideoGenerationLogConfig as GenerationLogConfig, VideoGenerationResult as GenerationResult, VideoRequestSnapshot } from "@/types/workbench";
import i18n from "@/i18n";

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const MAX_VIDEO_TASKS = 4;
const MAX_PROMPT_LENGTH = 5000;
type ReferenceRole = "reference_images" | "first_frame" | "last_frame" | "keyframes" | "reference_videos" | "video-edit" | "video-extension" | "reference_audio";
const REFERENCE_ROLE_META: Record<ReferenceRole, { label: string; description: string; accept: string }> = {
    reference_images: { label: "参考图", description: "默认用途。作为主体、场景或风格参考。", accept: "image/*" },
    first_frame: { label: "首帧", description: "画面从这张图开始运动。", accept: "image/*" },
    last_frame: { label: "尾帧", description: "画面运动到这张图结束。", accept: "image/*" },
    keyframes: { label: "关键帧", description: "按顺序控制画面变化。", accept: "image/*" },
    reference_videos: { label: "参考视频", description: "参考动作、镜头或节奏。", accept: "video/*" },
    "video-edit": { label: "视频编辑", description: "上传一个源视频进行编辑。", accept: "video/*" },
    "video-extension": { label: "视频续写", description: "上传一个源视频继续往后生成。", accept: "video/*" },
    reference_audio: { label: "参考音频", description: "参考声音、音乐或节奏。", accept: "audio/*" },
};
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
    const modelPlazaDetails = useModelPlazaDetails(session);
    const [videoKeys, setVideoKeys] = useState<CreateManagedKey[]>([]);
    const [videoKeysLoading, setVideoKeysLoading] = useState(false);
    const [selectedVideoKeyId, setSelectedVideoKeyId] = useState(() => getManagedKeySelection().videoKeyId);
    const [switchingVideoKey, setSwitchingVideoKey] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [referenceVideos, setReferenceVideos] = useState<ReferenceVideo[]>([]);
    const [referenceAudios, setReferenceAudios] = useState<ReferenceAudio[]>([]);
    const [referenceRoleOpen, setReferenceRoleOpen] = useState(false);
    const [pendingReferenceRole, setPendingReferenceRole] = useState<ReferenceRole>("reference_images");
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
    const videoCapability = videoCapabilityOf(effectiveConfig, model);
    const videoProfile = useMemo(() => getVideoModelProfile(videoModelName, videoCapability), [videoCapability, videoModelName]);
    const referenceImageRoles = useMemo(() => references.map((item) => item.videoRole || "reference"), [references]);
    const selectedVideoMode = useMemo(() => resolveVideoModeForReferencePlan(videoProfile, effectiveConfig.videoMode, {
        imageRoles: referenceImageRoles,
        imageCount: references.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    }), [effectiveConfig.videoMode, referenceAudios.length, referenceImageRoles, referenceVideos.length, references.length, videoProfile]);
    const orderedReferences = useMemo(() => {
        const first = references.find((item) => item.videoRole === "first_frame");
        const last = references.find((item) => item.videoRole === "last_frame");
        if (selectedVideoMode === "first-last-frame") return [first, last].filter((item): item is ReferenceImage => Boolean(item));
        if (selectedVideoMode === "image-to-video") return first ? [first] : [];
        if (selectedVideoMode === "keyframes") return references.filter((item) => item.videoRole === "keyframe");
        if (selectedVideoMode === "reference-images") return references.filter((item) => item.videoRole === "reference" || !item.videoRole);
        return references;
    }, [references, selectedVideoMode]);
    const modeProfile = useMemo(() => resolveVideoModeProfile(videoProfile, selectedVideoMode), [selectedVideoMode, videoProfile]);
    const audioToggleDisabled = !supportsVideoGenerateAudioToggle(modeProfile);
    const modeMediaPolicy = resolveVideoModeMediaPolicy(videoProfile, selectedVideoMode);
    const maxReferenceImages = modeMediaPolicy.max_images;
    const maxReferenceVideos = modeMediaPolicy.max_videos;
    const maxReferenceAudios = modeMediaPolicy.max_audios;
    const resolutionOptions = useMemo(() => videoResolutionChoices(videoProfile, selectedVideoMode), [selectedVideoMode, videoProfile]);
    const hasFirstFrame = references.some((item) => item.videoRole === "first_frame");
    const availableReferenceRoles = useMemo(() => {
        const modes = videoProfile.modes;
        const slots = videoProfile.slots;
        const roles: ReferenceRole[] = [];
        if (slots.reference_image > 0 && modes.includes("reference-images")) roles.push("reference_images");
        if (slots.first_frame > 0 && (modes.includes("image-to-video") || modes.includes("first-last-frame"))) roles.push("first_frame");
        if (hasFirstFrame && slots.last_frame > 0 && modes.includes("first-last-frame")) roles.push("last_frame");
        if (slots.keyframes > 0 && modes.includes("keyframes")) roles.push("keyframes");
        if (slots.reference_video > 0 && modes.includes("reference-video")) roles.push("reference_videos");
        if (slots.reference_video > 0 && modes.includes("video-edit")) roles.push("video-edit");
        if (slots.reference_video > 0 && modes.includes("video-extension")) roles.push("video-extension");
        if (slots.reference_audio > 0 && (modes.includes("reference-images") || modes.includes("reference-video"))) roles.push("reference_audio");
        return roles;
    }, [hasFirstFrame, videoProfile]);
    const referenceRoleOptions = useMemo(() => {
        const visibleRoles = (Object.keys(REFERENCE_ROLE_META) as ReferenceRole[]).filter((role) => role === "first_frame" || role === "last_frame" || availableReferenceRoles.includes(role));
        return visibleRoles.map((role) => {
            const supported = availableReferenceRoles.includes(role);
            const needsFirstFrame = role === "last_frame" && !hasFirstFrame;
            return {
                role,
                ...REFERENCE_ROLE_META[role],
                enabled: supported,
                reason: needsFirstFrame ? "请先添加首帧" : supported ? "" : "当前模型不支持此用途",
            };
        });
    }, [availableReferenceRoles, hasFirstFrame]);
    const referenceUploadDisabled = availableReferenceRoles.length === 0;
    const durationPresetOptions = useMemo(() => [5, 10, 15], []);
    const referenceModeHint = selectedVideoMode === "reference-images"
        ? `参考图模式 · 最多 ${videoProfile.slots.reference_image} 张图${videoProfile.slots.reference_audio ? ` / ${videoProfile.slots.reference_audio} 段音频` : ""}`
        : selectedVideoMode === "image-to-video"
            ? "首帧模式 · 上传 1 张首帧图"
            : selectedVideoMode === "first-last-frame"
                ? "首尾帧模式 · 上传首帧和尾帧"
                : selectedVideoMode === "keyframes"
                    ? `关键帧模式 · 最多 ${videoProfile.slots.keyframes} 张`
                    : selectedVideoMode === "reference-video"
                        ? "参考视频模式 · 可同时使用参考图、视频和音频"
                        : selectedVideoMode === "video-edit"
                            ? "视频编辑 · 上传一个源视频"
                            : selectedVideoMode === "video-extension"
                                ? "视频续写 · 上传一个源视频"
                                : "文生视频 · 直接输入提示词";
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
    const requestedResolution = normalizeVideoResolutionToken(effectiveConfig.vquality || modeProfile.resolutions[0] || "720");
    const selectedResolution = requestedResolution === "768" ? "720" : requestedResolution;
    const effectiveResolution = isVideoResolutionSupported(modeProfile, requestedResolution) ? resolveVideoResolutionForProfile(modeProfile, requestedResolution) : modeProfile.resolutions[0] || "720";
    const resolution = parseVideoResolution(effectiveResolution);
    const requestedRatio = inferVideoRatio(effectiveConfig.size);
    const ratioOptions = useMemo(() => videoRatioOptions.filter((item) => isVideoRatioSupported(modeProfile, item.value)), [modeProfile]);
    const selectedRatio = isVideoRatioSupported(modeProfile, requestedRatio) ? requestedRatio : modeProfile.aspectRatios[0] || "16:9";
    const dimensions = readVideoDimensions(effectiveConfig.size, resolution, selectedRatio);
    const seconds = Number(clampVideoSecondsForProfile(effectiveConfig.videoSeconds || String(modeProfile.defaultDuration || "5"), modeProfile));
    const durationAuto = effectiveConfig.videoDurationAuto === true;
    const displayedSeconds = durationAuto ? modeProfile.defaultDuration : seconds;
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
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        const nextResolution = isVideoResolutionSupported(modeProfile, requestedResolution) ? requestedResolution : modeProfile.resolutions[0] || "720";
        const nextRatio = isVideoRatioSupported(modeProfile, selectedRatio) ? selectedRatio : modeProfile.aspectRatios[0] || "16:9";
        if (nextResolution !== requestedResolution) updateConfig("vquality", nextResolution);
        if (nextRatio !== selectedRatio) {
            updateConfig("size", computeVideoSize(nextResolution, nextRatio));
        } else if (nextResolution !== requestedResolution && selectedRatio !== "auto") {
            updateConfig("size", computeVideoSize(nextResolution, selectedRatio));
        }
        const nextSeconds = clampVideoSecondsForProfile(effectiveConfig.videoSeconds || String(modeProfile.defaultDuration || "5"), modeProfile);
        if (String(effectiveConfig.videoSeconds || "").trim() !== nextSeconds) updateConfig("videoSeconds", nextSeconds);
        if (selectedVideoMode !== effectiveConfig.videoMode) updateConfig("videoMode", selectedVideoMode);
        if (audioToggleDisabled && generateAudio) updateConfig("videoGenerateAudio", "false");
    }, [audioToggleDisabled, effectiveConfig.videoMode, effectiveConfig.videoSeconds, generateAudio, maxReferenceAudios, maxReferenceImages, maxReferenceVideos, message, modeProfile, references, referenceAudios, referenceVideos, requestedResolution, selectedRatio, selectedVideoMode, updateConfig, videoProfile]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    const addReferences = async (files?: FileList | File[] | null, role: ReferenceRole = pendingReferenceRole) => {
        const selectedFiles = Array.from(files || []);
        if (!selectedFiles.length) return;
        if (role === "last_frame" && !references.some((item) => item.videoRole === "first_frame")) {
            message.warning("请先添加首帧，再添加尾帧");
            return;
        }
        const acceptedMime = REFERENCE_ROLE_META[role].accept.slice(0, -1);
        const matchingFiles = selectedFiles.filter((file) => file.type.startsWith(acceptedMime));
        if (matchingFiles.length !== selectedFiles.length) message.warning("已忽略与所选用途不匹配的文件");
        if (!matchingFiles.length) return;

        const { imageBytes, videoBytes, audioBytes } = videoProfile.fileLimits;
        const tooLarge = (kind: "image" | "video" | "audio", bytes: number) => {
            if (kind === "image") return bytes > imageBytes ? "videoWorkbench.imageTooLarge" : "";
            if (kind === "video") return bytes > videoBytes ? "videoWorkbench.videoTooLarge" : "";
            return bytes > audioBytes ? "videoWorkbench.audioTooLarge" : "";
        };

        if (role === "reference_images" || role === "first_frame" || role === "last_frame" || role === "keyframes") {
            const imageLimit = role === "reference_images" ? videoProfile.slots.reference_image : role === "keyframes" ? videoProfile.slots.keyframes : 1;
            const imageFiles = matchingFiles.filter((file) => file.type.startsWith("image/")).slice(0, Math.max(1, imageLimit));
            if (imageFiles.some((file) => tooLarge("image", file.size))) message.warning(t("videoWorkbench.imageTooLarge"));
            const nextImages = await Promise.all(
                imageFiles.filter((file) => !tooLarge("image", file.size)).map(async (file) => {
                    const image = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey } as ReferenceImage;
                }),
            );
            if (!nextImages.length) return;

            if (role === "first_frame") {
                const first = { ...nextImages[0], videoRole: "first_frame" as const };
                const last = references.find((item) => item.videoRole === "last_frame");
                setReferences((value) => [...value.filter((item) => item.videoRole !== "first_frame"), first]);
                const nextMode = last && videoProfile.modes.includes("first-last-frame")
                    ? "first-last-frame"
                    : videoProfile.modes.includes("image-to-video") ? "image-to-video" : "first-last-frame";
                updateConfig("videoMode", nextMode);
                return;
            }
            if (role === "last_frame") {
                const first = references.find((item) => item.videoRole === "first_frame");
                if (!first) {
                    message.warning("请先添加首帧，再添加尾帧");
                    return;
                }
                const last = { ...nextImages[0], videoRole: "last_frame" as const };
                setReferences((value) => [...value.filter((item) => item.videoRole !== "last_frame"), last]);
                updateConfig("videoMode", "first-last-frame");
                return;
            }
            if (role === "keyframes") {
                const keyframes = nextImages.map((item) => ({ ...item, videoRole: "keyframe" as const }));
                setReferences((value) => {
                    const others = value.filter((item) => item.videoRole !== "keyframe");
                    const existing = value.filter((item) => item.videoRole === "keyframe");
                    const added = keyframes.slice(0, Math.max(0, videoProfile.slots.keyframes - existing.length));
                    return [...others, ...existing, ...added];
                });
                updateConfig("videoMode", "keyframes");
                return;
            }

            const referenceImages = nextImages.map((item) => ({ ...item, videoRole: "reference" as const }));
            setReferences((value) => {
                const others = value.filter((item) => item.videoRole !== "reference" && item.videoRole);
                const existingReferences = value.filter((item) => item.videoRole === "reference" || !item.videoRole);
                const added = referenceImages.slice(0, Math.max(0, videoProfile.slots.reference_image - existingReferences.length));
                return [...others, ...existingReferences, ...added];
            });
            updateConfig("videoMode", "reference-images");
            return;
        }

        if (role === "reference_videos" || role === "video-edit" || role === "video-extension") {
            const videoLimit = role === "reference_videos" ? videoProfile.slots.reference_video : 1;
            const videoFiles = matchingFiles.filter((file) => file.type.startsWith("video/")).slice(0, Math.max(1, videoLimit));
            if (videoFiles.some((file) => tooLarge("video", file.size))) message.warning(t("videoWorkbench.videoTooLarge"));
            const nextVideos = await Promise.all(
                videoFiles.filter((file) => !tooLarge("video", file.size)).map(async (file) => {
                    const video = await uploadMediaFile(file, "video");
                    return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs } as ReferenceVideo;
                }),
            );
            if (!nextVideos.length) return;
            if (role === "reference_videos") {
                setReferenceVideos((value) => [...value, ...nextVideos].slice(0, videoProfile.slots.reference_video));
                updateConfig("videoMode", "reference-video");
            } else {
                setReferenceVideos([nextVideos[0]]);
                updateConfig("videoMode", role);
            }
            return;
        }

        const audioFiles = matchingFiles.filter((file) => file.type.startsWith("audio/"));
        if (audioFiles.some((file) => tooLarge("audio", file.size))) message.warning(t("videoWorkbench.audioTooLarge"));
        const nextAudios = await Promise.all(
            audioFiles.filter((file) => !tooLarge("audio", file.size)).map(async (file) => {
                const audio = await uploadMediaFile(file, "audio");
                return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs } as ReferenceAudio;
            }),
        );
        const totalAudioMs = referenceAudios.reduce((total, item) => total + (item.durationMs || 0), 0);
        let runningAudioMs = totalAudioMs;
        const validAudios = nextAudios.filter((audio) => {
            const duration = audio.durationMs || 0;
            if (duration && (duration < 2_000 || duration > 15_000 || runningAudioMs + duration > 15_000)) return false;
            runningAudioMs += duration;
            return true;
        });
        if (validAudios.length !== nextAudios.length) message.warning(t("videoWorkbench.audioDurationInvalid"));
        setReferenceAudios((value) => [...value, ...validAudios].slice(0, videoProfile.slots.reference_audio));
        if (!references.length && !referenceVideos.length) updateConfig("videoMode", "reference-images");
    };

    const openReferenceRolePicker = () => {
        if (!availableReferenceRoles.length) {
            message.warning("当前模型不支持添加参考素材");
            return;
        }
        setReferenceRoleOpen(true);
    };

    const chooseReferenceRole = (role: ReferenceRole) => {
        setPendingReferenceRole(role);
        setReferenceRoleOpen(false);
        window.setTimeout(() => fileInputRef.current?.click(), 0);
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
        void addReferences(event.dataTransfer.files, "reference_images");
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
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, videoRole: "reference" as const };
                }),
            );
            setReferences((value) => [...value.filter((item) => item.videoRole === "reference" || !item.videoRole), ...nextReferences].slice(0, videoProfile.slots.reference_image));
            updateConfig("videoMode", "reference-images");
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
        void addReferences(files, "reference_images");
    };

    const selectResolution = (nextResolution: string) => {
        if (!isVideoResolutionSupported(modeProfile, nextResolution)) return;
        updateConfig("vquality", nextResolution);
        if (selectedRatio !== "auto") updateConfig("size", computeVideoSize(nextResolution, selectedRatio));
    };

    const selectVideoRatio = (ratio: string) => {
        if (!isVideoRatioSupported(modeProfile, ratio)) return;
        updateConfig("size", computeVideoSize(resolution, ratio));
    };

    const commitSeconds = (raw: string) => {
        updateConfig("videoDurationAuto", false);
        updateConfig("videoSeconds", clampVideoSecondsForProfile(raw, modeProfile));
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
        const resultSlots: GenerationResult[] = Array.from({ length: requestedCount }, () => ({
            id: nanoid(),
            status: "pending",
            prompt: snapshot.text,
            model: snapshot.model,
            config: snapshot.config,
            references: [...snapshot.references],
            referenceVideos: [...snapshot.referenceVideos],
            referenceAudios: [...snapshot.referenceAudios],
        }));
        setResults((value) => [...resultSlots, ...value]);
        const batchStartedAt = performance.now();
        setStartedAt((value) => value || batchStartedAt);

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
                setResults((value) => value.map((item) => item.id === slot.id ? { ...item, status: "failed", logId: slot.id, error: errorMessage } : item));
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

        setResults((value) => [...nextResults, ...value.filter((item) => !nextResults.some((next) => next.id === item.id))]);
        if (!pendingLogs.length) {
            const batchError = nextResults.find((result) => result.status === "failed" && result.error)?.error || t("workbench.failureReasonUnavailable");
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: requestedCount, error: batchError });
            if (!activeLogIdsRef.current.size) setRunning(false);
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
                if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, updateAgentTask]);

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
        if (typedSeconds) requestConfig.videoSeconds = clampVideoSecondsForProfile(typedSeconds, modeProfile);
        return {
            text,
            model,
            config: requestConfig,
            references: [...orderedReferences],
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
            setReferences((value) => [...value.filter((item) => item.videoRole === "reference" || !item.videoRole), { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey, videoRole: "reference" as const }].slice(0, videoProfile.slots.reference_image));
            updateConfig("videoMode", "reference-images");
        } else if (payload.kind === "video") {
            const source = payload.storageKey ? await resolveMediaUrl(payload.storageKey, payload.url) : payload.url;
            const stored = await uploadMediaFile(source, "video");
            setReferenceVideos((value) =>
                [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, width: stored.width, height: stored.height, durationMs: stored.durationMs }].slice(
                    0,
                    videoProfile.slots.reference_video,
                ),
            );
            updateConfig("videoMode", "reference-video");
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
                const logIds = new Set([result.id, result.logId].filter((id): id is string => Boolean(id)));
                const matchingLogs = logs.filter((log) => logIds.has(log.id));
                await Promise.all(matchingLogs.map((log) => logStore.removeItem(log.id)));
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

    const refreshLogs = async (resumePending = true) => {
        const nextLogs = await readVideoLogs(logStore, ensureLogStoreMigrated);
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
            const deadline = Date.now() + 45 * 60_000;
            let pollFailures = 0;
            for (;;) {
                let state: VideoGenerationTaskState;
                try {
                    state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                    pollFailures = 0;
                } catch (error) {
                    if (isRetryableVideoPollingError(error) && Date.now() < deadline) {
                        pollFailures += 1;
                        await delay(Math.min(30_000, 2500 * (2 ** Math.min(pollFailures - 1, 4))));
                        continue;
                    }
                    throw error;
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
                    };
                    upsertResult({ status: "success", logId: log.id, video: nextVideo, error: undefined });
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                    await saveLog({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
                    message.success(t("videoWorkbench.generated"));
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (Date.now() >= deadline) throw new Error(t("videoWorkbench.timeout"));
                await delay(2500);
            }
        } catch (error) {
            const errorMessage = generationFailureReason(error, t("workbench.failureReasonUnavailable"));
            upsertResult({ status: "failed", logId: log.id, error: errorMessage, video: undefined });
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
        if (log.config.videoParameters) updateConfig("videoParameters", log.config.videoParameters);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: { ...log.video, prompt: log.video.prompt || log.prompt, model: log.video.model || modelOptionName(log.model) } }] : [{ id: log.id, status: "failed", error: generationFailureReason(log.error, t("workbench.failureReasonUnavailable")) }]);
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
                                        details={modelPlazaDetails}
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
                                        disabled={maxReferenceImages === 0 || references.length >= maxReferenceImages}
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
                                    className="grid size-7 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    disabled={referenceUploadDisabled}
                                    title={referenceUploadDisabled ? "当前模型不支持参考素材" : "添加参考素材"}
                                    aria-label="添加参考素材"
                                    onClick={openReferenceRolePicker}
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
                                {references.map((item, index) => {
                                    const roleLabel = item.videoRole === "first_frame" ? "首帧" : item.videoRole === "last_frame" ? "尾帧" : item.videoRole === "keyframe" ? `关键帧${index + 1}` : `参考图${index + 1}`;
                                    return (
                                        <div key={item.id} className={`group relative size-24 shrink-0 overflow-hidden rounded-xl border dark:border-stone-700 ${item.videoRole === "first_frame" ? "border-sky-500 ring-2 ring-sky-500/45" : item.videoRole === "last_frame" ? "border-amber-500 ring-2 ring-amber-500/45" : item.videoRole === "keyframe" ? "border-violet-500 ring-2 ring-violet-500/40" : "border-stone-200"}`}>
                                            <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className={`absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur ${item.videoRole === "first_frame" ? "bg-sky-600/90" : item.videoRole === "last_frame" ? "bg-amber-600/90" : item.videoRole === "keyframe" ? "bg-violet-600/90" : "bg-black/65"}`}>{roleLabel}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-md bg-black/65 text-white backdrop-blur group-hover:flex"
                                                onClick={() => setReferences((value) => {
                                                    const next = value.filter((ref) => ref.id !== item.id);
                                                    return item.videoRole === "first_frame" ? next.filter((ref) => ref.videoRole !== "last_frame") : next;
                                                })}
                                                aria-label={t("videoWorkbench.removeImage")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
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
                                    className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-stone-500 text-stone-500 transition hover:border-stone-700 hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:border-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                                    disabled={referenceUploadDisabled}
                                    title={referenceUploadDisabled ? "当前模型不支持参考素材" : referenceDragTarget ? t("videoWorkbench.dropReferences") : "添加参考素材"}
                                    onClick={openReferenceRolePicker}
                                >
                                    <Plus className="size-7 stroke-[1.4]" />
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] leading-4 text-stone-500">{referenceModeHint}</p>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">清晰度</div>
                            <div className="grid overflow-hidden rounded-xl border border-stone-200 bg-stone-100/60 p-1 dark:border-stone-700 dark:bg-stone-900/60" style={{ gridTemplateColumns: `repeat(${resolutionOptions.length}, minmax(0, 1fr))` }}>
                                {resolutionOptions.map((value) => {
                                    const supported = isVideoResolutionSupported(modeProfile, value);
                                    return (
                                        <button
                                            key={value}
                                            type="button"
                                            disabled={!supported}
                                            aria-pressed={selectedResolution === normalizeVideoResolutionToken(value) && supported}
                                            className={`h-9 rounded-lg text-sm transition ${selectedResolution === normalizeVideoResolutionToken(value) && supported ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : supported ? "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100" : "cursor-not-allowed text-stone-600 opacity-35 dark:text-stone-500"}`}
                                            onClick={() => selectResolution(value)}
                                        >
                                            {videoResolutionDisplayLabel(value)}
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
                                    {ratioOptions
                                        .filter((item) => item.value !== "auto")
                                        .map((item) => (
                                            <option key={item.value} value={item.value}>
                                                {videoRatioSizeLabel(item.value, resolution)}
                                            </option>
                                        ))}
                                    {ratioOptions.some((item) => item.value === "auto") ? <option value="auto">自适应</option> : null}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-stone-500" />
                            </div>
                        </div>

                        <div className="mt-3">
                            <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">秒数</div>
                            <div className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2">
                                <div className="grid grid-cols-4 gap-1 rounded-xl border border-stone-200 p-1 dark:border-stone-700">
                                    <button
                                        type="button"
                                        className={`h-9 whitespace-nowrap rounded-lg px-1 text-sm transition ${durationAuto ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"}`}
                                        onClick={() => updateConfig("videoDurationAuto", true)}
                                    >
                                        自动
                                    </button>
                                    {durationPresetOptions.map((value) => {
                                        const supported = isVideoDurationOptionAllowed(modeProfile, value);
                                        return (
                                            <button
                                                key={value}
                                                type="button"
                                                disabled={!supported}
                                                className={`h-9 whitespace-nowrap rounded-lg px-1 text-sm transition ${!durationAuto && seconds === value && supported ? "bg-stone-200 font-semibold !text-stone-950 shadow-sm dark:bg-stone-700 dark:!text-stone-100" : supported ? "text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" : "cursor-not-allowed text-stone-600 opacity-35 dark:text-stone-500"}`}
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
                                        min={modeProfile.minDuration}
                                        max={modeProfile.maxDuration}
                                        value={displayedSeconds}
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

                        {videoProfile.parameters.length ? (
                            <div className="mt-3">
                                <div className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">模型参数</div>
                                <VideoParameterFields
                                    profile={videoProfile}
                                    values={effectiveConfig.videoParameters}
                                    onChange={(key, value) => updateConfig("videoParameters", { ...effectiveConfig.videoParameters, [key]: value })}
                                />
                            </div>
                        ) : null}

                        <div className="mt-3">
                            <Button
                                type="primary"
                                size="large"
                                block
                                icon={<Sparkles className="size-4" />}
                                loading={running}
                                disabled={!canGenerate}
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
                            <div className="flex items-center gap-2">
                                {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
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
                                        <PendingVideoCard key={result.id} elapsedMs={elapsedMs} />
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
                accept={REFERENCE_ROLE_META[pendingReferenceRole].accept}
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files, pendingReferenceRole);
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
            <Modal centered title="添加参考素材" open={referenceRoleOpen} onCancel={() => setReferenceRoleOpen(false)} footer={null} width={560} destroyOnHidden>
                <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">选择素材用途。默认按参考图处理，生成模式会自动切换。</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {referenceRoleOptions.map((option) => (
                        <button
                            key={option.role}
                            type="button"
                            aria-label={option.label}
                            disabled={!option.enabled}
                            className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-left transition hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-stone-200 disabled:hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500 dark:hover:bg-stone-800 dark:disabled:hover:border-stone-700 dark:disabled:hover:bg-stone-900"
                            onClick={() => chooseReferenceRole(option.role)}
                        >
                            <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">{option.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">{option.description}</span>
                            {option.reason ? <span className="mt-1 block text-[11px] font-medium text-amber-600 dark:text-amber-400">{option.reason}</span> : null}
                        </button>
                    ))}
                </div>
            </Modal>
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

function PendingVideoCard({ elapsedMs }: { elapsedMs: number }) {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")} · 已用 {formatDuration(elapsedMs)}</span>
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
                    <Button size="small" onClick={onRetry}>{t("workbench.retry")}</Button>
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

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

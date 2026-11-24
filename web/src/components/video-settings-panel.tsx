import { type ReactNode } from "react";
import { Slider } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { computeVideoSize, inferVideoRatio, normalizeVideoResolutionToken, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions, videoResolutionDisplayLabel } from "@/lib/media-size";
import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoDurationOptionAllowed, isVideoModeSupported, isVideoRatioSupported, isVideoResolutionSupported, normalizeVideoModeValue, resolveVideoModeProfile, resolveVideoParameterValues, videoDurationChoices, videoModeChoices, videoResolutionChoices, type VideoModelProfile, type VideoParameterSpec } from "@/lib/video-model-profile";
import { modelOptionName, videoCapabilityOf, type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = ["480", "720", "768", "1080", "4k"].map((value) => ({ value, label: videoResolutionDisplayLabel(value) }));

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

export type VideoSettingKey = "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "videoParameters";
type VideoSettingValue = string | Record<string, unknown>;

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: VideoSettingKey, value: VideoSettingValue) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const videoModel = config.videoModel || config.model;
    const profile = getVideoModelProfile(modelOptionName(videoModel), videoCapabilityOf(config, videoModel));
    const normalizedMode = normalizeVideoModeValue(config.videoMode, profile);
    const videoMode = normalizedMode === "auto" ? profile.modes[0] || "text-to-video" : normalizedMode;
    const modeProfile = resolveVideoModeProfile(profile, videoMode);
    const resolutionChoices = videoResolutionChoices(profile, videoMode);
    const requestedResolution = normalizeVideoResolutionToken(config.vquality || modeProfile.resolutions[0] || "720");
    const resolution = isVideoResolutionSupported(modeProfile, requestedResolution) ? requestedResolution : modeProfile.resolutions[0] || "720";
    const requestedRatio = inferVideoRatio(config.size || "auto");
    const selectedRatio = isVideoRatioSupported(profile, requestedRatio) ? requestedRatio : profile.aspectRatios[0] || "16:9";
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const seconds = Number(clampVideoSecondsForProfile(config.videoSeconds || String(modeProfile.defaultDuration || 6), modeProfile));
    const durationPresetOptions = videoDurationChoices(modeProfile);
    const availableModes = videoModeChoices(profile);
    const parameterValues = resolveVideoParameterValues(profile, config.videoParameters);
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (!isVideoResolutionSupported(modeProfile, nextResolution)) return;
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="flex flex-wrap gap-2.5">
                        {resolutionChoices.map((item) => {
                            const supported = isVideoResolutionSupported(modeProfile, item);
                            return (
                                <OptionPill key={item} selected={resolution === normalizeVideoResolutionToken(item)} disabled={!supported} theme={theme} onClick={() => selectResolution(item)}>
                                    {videoResolutionDisplayLabel(item)}
                                </OptionPill>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {videoRatioOptions.map((item) => {
                            const supported = isVideoRatioSupported(profile, item.value);
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    disabled={!supported}
                                    className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                                    style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => selectRatio(item.value, resolution, onConfigChange)}
                                >
                                    <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                    <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="space-y-2.5" onMouseDown={(event) => event.stopPropagation()}>
                        {durationPresetOptions.length ? (
                            <div className="grid grid-flow-col auto-cols-[minmax(54px,1fr)] gap-2 overflow-x-auto pb-1">
                                {durationPresetOptions.map((value) => {
                                    const supported = isVideoDurationOptionAllowed(modeProfile, value);
                                    return (
                                        <OptionPill key={value} selected={seconds === value} disabled={!supported} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                            {value}s
                                        </OptionPill>
                                    );
                                })}
                            </div>
                        ) : (
                            <Slider className="min-w-0" min={profile.minDuration} max={profile.maxDuration} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        )}
                        <div className="flex items-center justify-end gap-2">
                            <SecondsInput value={seconds} profile={modeProfile} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                            <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                        </div>
                    </div>
                </SettingGroup>
                {availableModes.length > 1 ? (
                    <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            {availableModes.map((item) => {
                                const supported = isVideoModeSupported(profile, item);
                                return (
                                    <OptionPill key={item} selected={videoMode === item} disabled={!supported} theme={theme} onClick={() => onConfigChange("videoMode", item)}>
                                        {videoModeLabel(item)}
                                    </OptionPill>
                                );
                            })}
                        </div>
                    </SettingGroup>
                ) : null}
                {profile.parameters.length ? (
                    <SettingGroup title={t("settingsPanels.video.parameters")} color={theme.node.muted}>
                        <VideoParameterFields
                            profile={profile}
                            values={parameterValues}
                            theme={theme}
                            onChange={(key, value) => onConfigChange("videoParameters", { ...config.videoParameters, [key]: value })}
                        />
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return videoResolutionDisplayLabel(value);
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    const key = value === "frames" ? "image-to-video" : value === "reference" ? "reference-images" : value;
    return i18n.t(`settingsPanels.video.modes.${key}`, { defaultValue: key || "auto" });
}

export function normalizeVideoSelectionMode(value: string | undefined) {
    return normalizeVideoModeValue(value);
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function selectRatio(ratio: string, resolution: string, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    if (ratio === "auto") onConfigChange("size", "auto");
    else onConfigChange("size", computeVideoSize(resolution, ratio));
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} aria-pressed={selected} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SecondsInput({ value, profile, theme, onCommit }: { value: number; profile: VideoModelProfile; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(clampVideoSecondsForProfile(input.value, profile));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={profile.minDuration}
                max={profile.maxDuration}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

export function VideoParameterFields({ profile, values, onChange, theme, className = "space-y-2.5" }: { profile: VideoModelProfile; values?: Record<string, unknown>; onChange: (key: string, value: string | number | boolean) => void; theme?: CanvasTheme; className?: string }) {
    const parameterValues = resolveVideoParameterValues(profile, values);
    return (
        <div className={className}>
            {profile.parameters.map((parameter) => (
                <VideoParameterControl
                    key={parameter.key}
                    parameter={parameter}
                    value={parameterValues[parameter.key]}
                    theme={theme}
                    onChange={(value) => onChange(parameter.key, value)}
                />
            ))}
        </div>
    );
}

function VideoParameterControl({ parameter, value, theme, onChange }: { parameter: VideoParameterSpec; value: unknown; theme?: CanvasTheme; onChange: (value: string | number | boolean) => void }) {
    const current = value ?? parameter.default;
    const label = parameter.label || parameter.key;
    const inputStyle = theme ? { background: theme.node.fill, color: theme.node.text, borderColor: theme.node.stroke } : undefined;
    if (parameter.type === "boolean") {
        const checked = current === true;
        return (
            <div className="flex items-center justify-between gap-3" title={parameter.description}>
                <span className="min-w-0 truncate text-sm">{label}</span>
                <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`relative h-6 w-10 shrink-0 rounded-full transition ${theme ? "" : checked ? "bg-stone-700 dark:bg-stone-200" : "bg-stone-300 dark:bg-stone-700"}`} style={theme ? { background: checked ? theme.node.text : theme.node.stroke } : undefined} onClick={() => onChange(!checked)}>
                    <span className="absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left]" style={{ left: checked ? 18 : 2 }} />
                </button>
            </div>
        );
    }
    if (parameter.type === "enum") {
        return (
            <label className="flex items-center justify-between gap-3" title={parameter.description}>
                <span className="min-w-0 truncate text-sm">{label}</span>
                <select className="h-9 max-w-[170px] rounded-xl border border-stone-200 bg-stone-50 px-2 text-sm outline-none dark:border-stone-700 dark:bg-stone-900/60" style={inputStyle} value={String(current ?? "")} onChange={(event) => onChange(coerceParameterValue(parameter, event.target.value))}>
                    {parameter.options?.map((option) => {
                        const optionValue = typeof option === "object" ? option.value : option;
                        const optionLabel = typeof option === "object" && option.label ? option.label : String(optionValue);
                        return <option key={String(optionValue)} value={String(optionValue)}>{optionLabel}</option>;
                    })}
                </select>
            </label>
        );
    }
    return (
        <label className="flex items-center justify-between gap-3" title={parameter.description}>
            <span className="min-w-0 truncate text-sm">{label}</span>
            <input
                className="h-9 w-[170px] rounded-xl border border-stone-200 bg-stone-50 px-2 text-sm outline-none dark:border-stone-700 dark:bg-stone-900/60"
                style={inputStyle}
                type={parameter.type === "string" ? "text" : "number"}
                value={current === undefined ? "" : String(current)}
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                required={parameter.required}
                onChange={(event) => onChange(coerceParameterValue(parameter, event.target.value))}
            />
        </label>
    );
}

function coerceParameterValue(parameter: VideoParameterSpec, raw: string): string | number | boolean {
    if (parameter.type === "integer") return Math.trunc(Number(raw) || 0);
    if (parameter.type === "number") return Number(raw) || 0;
    if (parameter.type === "boolean") return raw === "true";
    return raw;
}

import { Alert, Button, Input, Modal, Switch } from "antd";
import { FolderOpen, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { getDesktopSaveBridge, type DesktopSaveKind, type LocalSaveSettings } from "@/lib/desktop-save";

const directoryFieldByKind = {
    image: "imageDir",
    video: "videoDir",
    canvas: "canvasDir",
    other: "otherDir",
} as const satisfies Record<DesktopSaveKind, keyof LocalSaveSettings>;

export function LocalSaveSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const bridge = getDesktopSaveBridge();
    const [settings, setSettings] = useState<LocalSaveSettings | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open || !bridge) return;
        setLoading(true);
        setError("");
        void bridge
            .getSaveSettings()
            .then(setSettings)
            .catch((cause) => setError(cause instanceof Error ? cause.message : "读取保存设置失败"))
            .finally(() => setLoading(false));
    }, [open, bridge]);

    const choose = async (kind: DesktopSaveKind) => {
        if (!bridge || !settings) return;
        setError("");
        try {
            const directory = await bridge.chooseSaveDirectory(kind);
            if (!directory) return;
            setSettings({ ...settings, [directoryFieldByKind[kind]]: directory });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "打开目录选择器失败");
        }
    };

    const openFolder = async (kind: DesktopSaveKind) => {
        if (!bridge) return;
        setError("");
        try {
            await bridge.openSaveFolder(kind);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "打开目录失败");
        }
    };
    const save = async () => {
        if (!bridge || !settings) return;
        setSaving(true);
        setError("");
        try {
            setSettings(await bridge.saveSaveSettings(settings));
            onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存设置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={700} title="本地保存设置">
            <div className="space-y-4">
                <p className="text-sm text-stone-500">图片和视频生成成功后会自动保存到下列目录；画布素材会保存到画布目录下按“画布名称-短ID”创建的独立文件夹。同名文件会自动追加时间后缀，不会覆盖原文件。</p>
                {error ? <Alert type="error" showIcon message={error} /> : null}
                {settings ? (
                    <>
                        <DirectoryRow label="画布目录" value={settings.canvasDir} disabled={loading || saving} kind="canvas" onChoose={choose} onOpen={openFolder} bridge={bridge} />
                        <DirectoryRow label="图片目录" value={settings.imageDir} disabled={loading || saving} kind="image" onChoose={choose} onOpen={openFolder} bridge={bridge} />
                        <DirectoryRow label="视频目录" value={settings.videoDir} disabled={loading || saving} kind="video" onChoose={choose} onOpen={openFolder} bridge={bridge} />
                        <DirectoryRow label="其他文件目录" value={settings.otherDir} disabled={loading || saving} kind="other" onChoose={choose} onOpen={openFolder} bridge={bridge} />
                        <label className="flex items-center justify-between rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-800">
                            <span>保存完成后在文件管理器中显示</span>
                            <Switch checked={settings.openFolderAfterSave} onChange={(checked) => setSettings({ ...settings, openFolderAfterSave: checked })} />
                        </label>
                        <div className="flex justify-end">
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                                保存设置
                            </Button>
                        </div>
                    </>
                ) : loading ? (
                    <div className="py-10 text-center text-sm text-stone-500">正在读取本地设置…</div>
                ) : null}
            </div>
        </Modal>
    );
}

function DirectoryRow({ label, value, disabled, kind, onChoose, onOpen, bridge }: { label: string; value: string; disabled: boolean; kind: DesktopSaveKind; onChoose: (kind: DesktopSaveKind) => Promise<void>; onOpen: (kind: DesktopSaveKind) => Promise<void>; bridge: ReturnType<typeof getDesktopSaveBridge> }) {
    return (
        <div>
            <div className="mb-1 text-sm text-stone-600 dark:text-stone-300">{label}</div>
            <div className="flex gap-2">
                <Input readOnly value={value} />
                <Button disabled={disabled || !bridge} onClick={() => void onChoose(kind)}>
                    选择目录
                </Button>
                <Button disabled={disabled || !bridge} icon={<FolderOpen className="size-4" />} title="打开目录" onClick={() => void onOpen(kind)} />
            </div>
        </div>
    );
}

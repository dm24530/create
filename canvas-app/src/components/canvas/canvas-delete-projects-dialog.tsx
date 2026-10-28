import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { deleteCloudCanvasProject } from "@/services/canvas-cloud";

import { useAssetStore } from "@/stores/use-asset-store";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = () => {
        deleteProjects(ids);
        flushCanvasStorePersistence();
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
        void Promise.allSettled(ids.map((id) => deleteCloudCanvasProject(id))).then((results) => {
            const failed = results.filter((result) => result.status === "rejected");
            if (failed.length > 0) {
                console.warn("Failed to delete cloud canvas projects", failed);
            }
        });
    };

    return (
        <Modal
            title={t("canvas.project.deleteTitle")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("common.cancel")}</Button>
                    <Button danger type="primary" onClick={confirm}>
                        {t("common.delete")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">{t("canvas.project.deleteDescription", { count: ids.length })}</p>
        </Modal>
    );
}

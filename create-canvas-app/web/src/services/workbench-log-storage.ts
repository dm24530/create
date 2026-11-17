import localforage from "localforage";

import { canvasStorageScope, scopedCanvasStoreName } from "@/lib/canvas-storage-scope";
import { useUserStore } from "@/stores/use-user-store";

type WorkbenchLogRecord = {
    id?: string;
    userId?: number;
};

const LEGACY_OWNER_KEY = "create-canvas:legacy-workbench-owner-user-id";
const migratedKeys = new Map<string, true>();

function currentUserId() {
    const id = Number(useUserStore.getState().user?.id);
    return Number.isFinite(id) && id > 0 ? id : 0;
}

function readLocal(key: string) {
    try {
        return localStorage.getItem(key) || "";
    } catch {
        return "";
    }
}

function writeLocal(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Legacy migration is best effort in hardened browser contexts.
    }
}

export function createUserWorkbenchLogStore(name: string) {
    const store = localforage.createInstance({
        name: "infinite-canvas",
        storeName: scopedCanvasStoreName(name),
    });
    const legacyStore = localforage.createInstance({
        name: "infinite-canvas",
        storeName: name,
    });
    const migrationKey = `create-canvas:${name}:legacy-migrated:${canvasStorageScope}`;
    let migration: Promise<void> | null = null;

    const ensureMigrated = async () => {
        if (migratedKeys.has(migrationKey) || readLocal(migrationKey) === "1" || migration) {
            return migration || undefined;
        }
        migration = (async () => {
            const userId = currentUserId();
            if (!userId) return;

            const recordedOwner = Number(readLocal(LEGACY_OWNER_KEY) || 0);
            const canClaimUnowned = !recordedOwner || recordedOwner === userId;
            if (!recordedOwner && canClaimUnowned) writeLocal(LEGACY_OWNER_KEY, String(userId));

            const records: WorkbenchLogRecord[] = [];
            await legacyStore.iterate<WorkbenchLogRecord, void>((value) => {
                if (!value || typeof value !== "object") return;
                const ownerId = Number(value.userId || 0);
                if ((ownerId && ownerId === userId) || (!ownerId && canClaimUnowned)) records.push(value);
            });

            await Promise.all(records.map(async (record) => {
                if (!record.id) return;
                await store.setItem(record.id, { ...record, userId });
            }));
            migratedKeys.set(migrationKey, true);
            writeLocal(migrationKey, "1");
        })().catch(() => {
            // Keep the legacy records available for a later retry.
        }).finally(() => {
            migration = null;
        });
        return migration;
    };

    return { store, ensureMigrated };
}
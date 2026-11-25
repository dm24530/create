import { useEffect, useState } from "react";

import { getCreateModelPlaza, type CreateModelPlazaGroup, type CreateModelPlazaModel } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";

export type WorkbenchModelDetail = {
    groupName: string;
    model: CreateModelPlazaModel;
    rate: number;
    imageRate: number;
    videoRate: number;
};

export type WorkbenchModelDetails = {
    byGroupModel: Record<string, WorkbenchModelDetail>;
    byModel: Record<string, WorkbenchModelDetail>;
};

function normalizeRate(value: unknown, fallback = 1) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function workbenchModelDetailKey(groupName: string, modelName: string) {
    return `${String(groupName || "").trim().toLowerCase()}::${String(modelName || "").trim().toLowerCase()}`;
}

export function workbenchGroupRates(group: CreateModelPlazaGroup) {
    const rate = normalizeRate(group.user_rate_multiplier ?? group.rate_multiplier ?? 1);
    const imageRate = group.image_rate_independent
        ? normalizeRate(group.image_rate_multiplier ?? 1)
        : rate;
    const videoRate = group.video_rate_independent
        ? normalizeRate(group.video_rate_multiplier ?? 1)
        : rate;
    return { rate, imageRate, videoRate };
}

function emptyDetails(): WorkbenchModelDetails {
    return { byGroupModel: {}, byModel: {} };
}

export function buildWorkbenchModelDetails(groups: CreateModelPlazaGroup[]): WorkbenchModelDetails {
    const details = emptyDetails();
    for (const group of groups || []) {
        const rates = workbenchGroupRates(group);
        for (const model of group.models || []) {
            if (!model?.name) continue;
            const detail: WorkbenchModelDetail = {
                groupName: group.name,
                model,
                ...rates,
            };
            details.byGroupModel[workbenchModelDetailKey(group.name, model.name)] = detail;
            const modelKey = model.name.trim().toLowerCase();
            if (!details.byModel[modelKey]) details.byModel[modelKey] = detail;
        }
    }
    return details;
}

let inflightToken = "";
let inflightPromise: Promise<WorkbenchModelDetails> | null = null;

async function loadDetails(session: CreateSession): Promise<WorkbenchModelDetails> {
    if (inflightToken === session.accessToken && inflightPromise) return inflightPromise;
    inflightToken = session.accessToken;
    const request = getCreateModelPlaza(session)
        .then((plaza) => buildWorkbenchModelDetails(plaza?.groups || []))
        .catch(() => emptyDetails())
        .finally(() => {
            if (inflightPromise === request) {
                inflightPromise = null;
                inflightToken = "";
            }
        });
    inflightPromise = request;
    return request;
}

/** Loads fresh model plaza descriptions/prices whenever the workbench mounts. */
export function useModelPlazaDetails(session: CreateSession | null | undefined): WorkbenchModelDetails {
    const [details, setDetails] = useState<WorkbenchModelDetails>(emptyDetails);
    const accessToken = session?.accessToken || "";
    useEffect(() => {
        if (!session || !accessToken) {
            setDetails(emptyDetails());
            return;
        }
        let cancelled = false;
        void loadDetails(session).then((result) => {
            if (!cancelled) setDetails(result);
        });
        return () => {
            cancelled = true;
        };
    }, [accessToken, session]);
    return details;
}
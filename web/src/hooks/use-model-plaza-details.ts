import { useEffect, useState } from "react";

import { getCreateModelPlaza, type CreateModelPlazaModel } from "@/services/create-account";
import type { CreateSession } from "@/services/create-auth";

export type WorkbenchModelDetails = Record<string, CreateModelPlazaModel>;

let inflightToken = "";
let inflightPromise: Promise<WorkbenchModelDetails> | null = null;

async function loadDetails(session: CreateSession): Promise<WorkbenchModelDetails> {
    if (inflightToken === session.accessToken && inflightPromise) return inflightPromise;
    inflightToken = session.accessToken;
    const request = getCreateModelPlaza(session)
        .then((plaza) => {
            const details: WorkbenchModelDetails = {};
            for (const group of plaza?.groups || []) {
                for (const model of group.models || []) {
                    if (model?.name && !details[model.name]) details[model.name] = model;
                }
            }
            return details;
        })
        .catch(() => ({}))
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
    const [details, setDetails] = useState<WorkbenchModelDetails>({});
    const accessToken = session?.accessToken || "";
    useEffect(() => {
        if (!session || !accessToken) {
            setDetails({});
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

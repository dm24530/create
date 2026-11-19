export type FailedTaskLogIdentity = {
    id: string;
};

export type FailedTaskResultIdentity = {
    id: string;
    logId?: string;
};

/**
 * Resolve the single persisted log represented by a failed task card.
 *
 * Failed cards can share the same prompt and failure text, so those fields must
 * never be used as deletion identity. Prefer the persisted logId, then fall back
 * to an exact result id for older records that did not store logId.
 */
export function matchingFailedTaskLogIds(
    logs: readonly FailedTaskLogIdentity[],
    result: FailedTaskResultIdentity,
): string[] {
    const exactLogId = result.logId?.trim();
    if (exactLogId) {
        return logs.some((log) => log.id === exactLogId) ? [exactLogId] : [];
    }
    const exactResultId = result.id.trim();
    if (!exactResultId) return [];
    return logs.some((log) => log.id === exactResultId) ? [exactResultId] : [];
}

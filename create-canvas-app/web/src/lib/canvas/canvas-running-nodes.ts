export function addRunningNodeId(current: ReadonlySet<string>, nodeId: string): Set<string> {
    if (current.has(nodeId)) return current instanceof Set ? current : new Set(current);
    return new Set(current).add(nodeId);
}

export function removeRunningNodeId(current: ReadonlySet<string>, nodeId: string): Set<string> {
    if (!current.has(nodeId)) return current instanceof Set ? current : new Set(current);
    const next = new Set(current);
    next.delete(nodeId);
    return next;
}

export function removeRunningNodeIds(current: ReadonlySet<string>, nodeIds: ReadonlySet<string>): Set<string> {
    if (![...current].some((nodeId) => nodeIds.has(nodeId))) return current instanceof Set ? current : new Set(current);
    return new Set([...current].filter((nodeId) => !nodeIds.has(nodeId)));
}

export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
    if (items.length === 0) return [] as R[];
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit)));
    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

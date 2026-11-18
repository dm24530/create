export function stableCanvasGraph(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanvasGraph);
  if (!value || typeof value !== "object") return value;
  const jsonValue = value as { toJSON?: () => unknown };
  if (typeof jsonValue.toJSON === "function") return stableCanvasGraph(jsonValue.toJSON());
  const stable: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "updatedAt" || item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    stable[key] = stableCanvasGraph(item);
  }
  return stable;
}

export function hashCanvasGraph(graph: unknown) {
  let length = 0;
  let first = 0x811c9dc5;
  let second = 0x9e3779b1;
  const update = (text: string) => {
    length += text.length;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    }
  };
  const visit = (value: unknown) => {
    if (value === null || value === undefined) {
      update("null");
      return;
    }
    if (Array.isArray(value)) {
      update("[");
      value.forEach((item, index) => {
        if (index > 0) update(",");
        visit(item);
      });
      update("]");
      return;
    }
    if (typeof value === "object") {
      const jsonValue = value as { toJSON?: () => unknown };
      if (typeof jsonValue.toJSON === "function") {
        visit(jsonValue.toJSON());
        return;
      }
      update("{");
      const record = value as Record<string, unknown>;
      Object.keys(record)
        .filter((key) => record[key] !== undefined && typeof record[key] !== "function" && typeof record[key] !== "symbol")
        .sort()
        .forEach((key, index) => {
          if (index > 0) update(",");
          update(JSON.stringify(key));
          update(":");
          visit(record[key]);
        });
      update("}");
      return;
    }
    if (typeof value === "bigint") {
      update(value.toString());
      return;
    }
    update(JSON.stringify(value));
  };
  visit(graph);
  return `${length}:${first.toString(16)}:${second.toString(16)}`;
}

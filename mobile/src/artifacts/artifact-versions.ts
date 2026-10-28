export type VersionedArtifact = { id: string; kind: "image" | "video" | "document"; parentId?: string; createdAt: number };
/** Resolve the selected image independently of completion order or a later document. */
export function resolveImageReference<T extends VersionedArtifact>(items: T[], explicitId?: string, activeId?: string, selectedId?: string): T {
  if (explicitId) {
    const item = items.find((entry) => entry.id === explicitId);
    if (!item || item.kind !== "image") throw new Error("指定的图片不存在，请重新选择原图或修改版本");
    return item;
  }
  for (const id of [activeId, selectedId]) {
    const item = items.find((entry) => entry.id === id && entry.kind === "image");
    if (item) return item;
  }
  const images = items.filter((entry) => entry.kind === "image");
  if (images.length === 1) return images[0];
  throw new Error(images.length ? "有多张图片，请先打开要使用的那一版，或指定图片编号" : "请先拍摄或选择一张图片");
}
export function artifactVersions<T extends VersionedArtifact>(items: T[], id: string): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const root = (item: T) => {
    const visited = new Set<string>(); let value = item;
    while (value.parentId && byId.has(value.parentId) && !visited.has(value.id)) { visited.add(value.id); value = byId.get(value.parentId)!; }
    return value.id;
  };
  const item = byId.get(id);
  if (!item) throw new Error("没有找到该作品");
  const family = root(item);
  return items.filter((entry) => root(entry) === family).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

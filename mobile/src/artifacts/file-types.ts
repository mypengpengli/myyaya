export const fileTypes: Record<string, { extension: string; kind: "image" | "video" | "document" }> = {
  "application/pdf": { extension: "pdf", kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extension: "docx", kind: "document" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { extension: "pptx", kind: "document" },
  "application/msword": { extension: "doc", kind: "document" }, "application/vnd.ms-powerpoint": { extension: "ppt", kind: "document" },
  "text/plain": { extension: "txt", kind: "document" }, "text/markdown": { extension: "md", kind: "document" },
  "application/json": { extension: "json", kind: "document" },
  "image/png": { extension: "png", kind: "image" }, "image/jpeg": { extension: "jpg", kind: "image" }, "image/webp": { extension: "webp", kind: "image" },
  "video/mp4": { extension: "mp4", kind: "video" },
};

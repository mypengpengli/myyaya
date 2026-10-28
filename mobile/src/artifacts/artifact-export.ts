import { documentNative } from "../../modules/document-preview";
import { withExternalActivityLease } from "../core/background-process-exit";
import type { PresentationItem } from "./presentation";

/** Copy the original bytes to the location selected by the user; never convert. */
export function exportOriginalArtifact(item: PresentationItem): Promise<boolean> {
  return withExternalActivityLease("artifact-file-export", () =>
    documentNative().saveOriginal(item.uri, item.mimeType ?? "application/octet-stream", item.title));
}
/** Keep the provider process available until the external office activity returns. */
export function openOriginalArtifact(item: PresentationItem): Promise<void> {
  return withExternalActivityLease("artifact-file-view", () =>
    documentNative().openOriginal(item.uri, item.mimeType ?? "application/octet-stream", item.title));
}

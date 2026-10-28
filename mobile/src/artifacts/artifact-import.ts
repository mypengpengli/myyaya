import { documentNative } from "../../modules/document-preview";
import { withExternalActivityLease } from "../core/background-process-exit";
import { registerArtifactFile } from "./artifact-store";

/** Keep the existing background-exit policy, but let an intentional picker finish. */
export function importLocalArtifact() {
  return withExternalActivityLease("artifact-file-import", async () => {
    const file = await documentNative().pickFile();
    return file ? registerArtifactFile(file) : null;
  });
}

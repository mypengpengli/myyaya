import type { HermesTask } from "../hermes/task-service";
import type { Artifact } from "../artifacts/artifact-store";
import type { MediaJob } from "../artifacts/media-job-service";
import type { ArtifactFocus } from "../artifacts/artifact-focus";

/** Rebuilt from durable stores on every turn, including the first turn after process exit. */
export function restoredCompanionContext(tasks: HermesTask[], artifacts: Artifact[], media: MediaJob[], focus: ArtifactFocus, activeId?: string): string {
  const task = tasks.find((item) => item.id === focus.taskId) ?? tasks[0];
  return JSON.stringify({
    selectedArtifactId: activeId ?? focus.artifactId, selectedImageId: focus.imageId,
    recentTaskId: task?.id,
    tasks: [...(task ? [task] : []), ...tasks.filter((item) => item.id !== task?.id)].slice(0, 5).map((item) => ({
      id: item.id, runId: item.runId, sessionId: item.sessionId ?? `myyaya-${item.id}`, previousTaskId: item.previousTaskId,
      input: item.input.slice(0, 600), status: item.status, result: item.output.slice(0, 1800), files: item.delivery?.artifactIds ?? [], fileStatus: item.delivery?.files,
    })),
    artifacts: artifacts.slice(0, 24).map(({ id, title, kind, parentId, sourceTaskId }) => ({ id, title, kind, parentId, sourceTaskId })),
    media: media.slice(0, 6).map(({ id, kind, model, aspectRatio, resolution, status, parentId, artifactId, notice }) => ({ id, kind, model, aspectRatio, resolution, status, parentId, artifactId, notice })),
  });
}

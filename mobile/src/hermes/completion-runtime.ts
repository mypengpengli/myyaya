import type { HermesConnection } from "./connection";
import { CompletionCoordinator } from "./completion-service";
import { receiveTaskFiles } from "./file-results";
import type { HermesTaskService } from "./task-service";
import { chineseVoice } from "../voice/chinese-voice-runtime";
import { queueCompanionTaskResult } from "../agent/companion-runtime";
import { photoCapture } from "../artifacts/phone-camera";
import { getPhoneRecording } from "../artifacts/phone-recording";

/** One coordinator per monitor; disposal/account changes invalidate its async results. */
export function createCompletionCoordinator(tasks: HermesTaskService, connection: HermesConnection, current: () => Promise<boolean>) {
  return new CompletionCoordinator(tasks, (task) => receiveTaskFiles(task, connection, current),
    (text) => photoCapture.getSnapshot().phase !== "idle" || ["preparing", "recording", "saving"].includes(getPhoneRecording().phase) ? Promise.resolve(false) : chineseVoice.announce(text),
    queueCompanionTaskResult, current);
}

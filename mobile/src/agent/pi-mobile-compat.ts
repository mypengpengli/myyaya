/** Official Pi utilities used by agent-core, without Node-only provider discovery.
 * The agent loop itself is the unmodified, pinned @earendil-works/pi-agent-core.
 */
export { createInitialSystemMessage, getCurrentSystemMessage, getCurrentSystemPrompt,
  toToolDeclaration, getCurrentTools, getToolStateChanges, normalizeContext,
} from "@earendil-works/pi-ai/utils/transcript";
export { EventStream, createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
export { mergeClientIdentity, PI_ATTRIBUTION } from "@earendil-works/pi-ai/utils/identity";
export { parseStreamingJson } from "@earendil-works/pi-ai/utils/json-parse";
export { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";

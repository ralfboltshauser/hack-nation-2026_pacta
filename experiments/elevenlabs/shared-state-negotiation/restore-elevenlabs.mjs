import {
  apiRequest,
} from "./lib/elevenlabs.mjs";
import {
  readRuntimeState,
  requireElevenLabsApiKey,
  writeRuntimeState,
} from "./lib/local-config.mjs";

async function main() {
  const state = await readRuntimeState();
  if (!state?.agentId || !state.originalAgent?.conversationConfig) {
    throw new Error("No saved agent configuration exists for this experiment.");
  }

  const apiKey = await requireElevenLabsApiKey();
  const current = await apiRequest(
    apiKey,
    `/v1/convai/agents/${encodeURIComponent(state.agentId)}`,
  );
  if (current.name !== state.agentName) {
    throw new Error(
      `Agent identity changed: expected ${state.agentName}, found ${current.name}. Refusing to restore.`,
    );
  }

  const branchQuery = state.agentBranchId
    ? `?branch_id=${encodeURIComponent(state.agentBranchId)}`
    : "";
  await apiRequest(
    apiKey,
    `/v1/convai/agents/${encodeURIComponent(state.agentId)}${branchQuery}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        conversation_config: state.originalAgent.conversationConfig,
        version_description: "Restore agent after shared-state negotiation proof",
      }),
    },
  );

  for (const toolId of Object.values(state.tools ?? {})) {
    try {
      await apiRequest(apiKey, `/v1/convai/tools/${encodeURIComponent(toolId)}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (!error.message.includes("404")) throw error;
    }
  }

  await writeRuntimeState({
    ...state,
    tools: {},
    publicUrl: null,
    restoredAt: new Date().toISOString(),
  });
  console.log(`Restored ${state.agentName} (${state.agentId}) and removed the demo tools.`);
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exitCode = 1;
});

import { configureElevenLabs } from "./lib/elevenlabs.mjs";

const publicUrl = process.argv[2] ?? process.env.PUBLIC_URL;
if (!publicUrl) {
  console.error("Usage: npm run setup -- https://your-public-tunnel.example");
  process.exit(1);
}

configureElevenLabs(publicUrl.replace(/\/$/, ""))
  .then((state) => {
    console.log(`Configured ${state.agentName} (${state.agentId}).`);
    console.log(`record_offer tool: ${state.tools.recordOffer}`);
    console.log(`sync_market_state tool: ${state.tools.syncMarket}`);
  })
  .catch((error) => {
    console.error(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  });

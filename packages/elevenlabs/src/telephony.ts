export const TWILIO_AUDIO_FORMAT = "ulaw_8000" as const;

export function buildTwilioAudioConfig(voiceId: string) {
  if (!voiceId.trim()) throw new Error("A Twilio agent voice ID is required.");
  return {
    asr: {
      quality: "high" as const,
      userInputAudioFormat: TWILIO_AUDIO_FORMAT,
    },
    tts: {
      modelId: "eleven_flash_v2" as const,
      voiceId,
      agentOutputAudioFormat: TWILIO_AUDIO_FORMAT,
      stability: 0.5,
      similarityBoost: 0.8,
      speed: 1,
    },
  };
}

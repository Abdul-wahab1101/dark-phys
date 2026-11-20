# Gemini Voice & Cinematic Sound Design

## Local Gemini TTS configuration

Add these entries to the local .env file used by Dark Phys. Keep the key private; never commit .env.

    GEMINI_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
    GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
    GEMINI_TTS_VOICE=Charon

If the existing key is stored as DARK_PHYS_LLM_API_KEY, the TTS adapter will reuse it only when DARK_PHYS_LLM_BASE_URL points to Google's Generative Language API or DARK_PHYS_LLM_PROVIDER=gemini. Explicit GEMINI_API_KEY / GOOGLE_API_KEY takes precedence.

Gemini is the primary narration provider. ElevenLabs remains an optional legacy provider and is not required. TTS model availability, quota and billing depend on the Google AI project and API access; a valid key alone does not guarantee preview-model access.

## Voice direction

The default voice is Charon, selected for an informative, mature documentary delivery. Orus is available as an alternate authoritative voice. The engine gives each script section a distinct direction:

- Hook: restrained urgency, confident delivery, deliberate pauses.
- Story: intimate, natural pacing and subtle emotional variation.
- Evidence: measured, precise, credible delivery.
- Payoff: quiet conviction and a memorable final line.

The engine preserves the approved narration text, synthesizes section by section, writes WAV source audio, converts the final narration to MP3, and performs two-pass FFmpeg loudness normalization. Every generated voice track remains marked for human review; no voice model can guarantee a particular perceived pitch or performance on every script.

## Sound design

agents/production/sound-design.js creates a scene-aware cue timeline from an approved scene plan and a local sound-effect library. Assets are matched by tags, cue timing follows scene boundaries, and the plan assigns documentary mood and music ducking guidance. Supply licensed local audio files with tags such as impact, reverse, riser, whoosh, drone, subtle-tick, warm-hit, tail, ambience, room-tone, or atmosphere. A scene can request ambience with its ambience flag or scene description.

agents/production/audio-mix.js provides voice-focused EQ, compression, voice-priority sidechain music ducking, timed SFX placement, limiting, and final loudness targeting (default -14 LUFS, -1.5 dBTP). Music and effects must be licensed or otherwise cleared for the channel.

## Validation

Run:

    node scripts/test-gemini-tts.js
    node scripts/test-sound-design.js
    node scripts/test-phase3-production.js
    node scripts/test-phase3-narration.js
    node scripts/narrate.js --help

The tests use mocked HTTP responses; they validate request construction and audio decoding without spending API quota. A real audio quality audition still requires an authorized Gemini API key and an actual render.

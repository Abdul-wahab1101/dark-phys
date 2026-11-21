# YouTube Agent Upgrade v6

## Is mein kya hai
1. `agents/thumbnail-designer-agent.js` : 12 design families, video-aware selection, behtar FLUX prompts, validation (pichla patch + ab video format plan se bhi hint leta hai)
2. `agents/video-format-planner.js` : **NAYA**
   - 6 formats: Signs List, Story+Analysis, Myth Buster, Direct Address, Research/Case Study, Short
   - Har video ke liye format khud chunta hai aur pichli videos se alag rakhta hai (consecutive same format nahi)
   - 3 hook lines (5 hook styles mein se, rotate hote hain), 3 title options
   - Sections ka time-plan, script word target, chapters
   - Shot list (har 3-6 sec, visual type, camera motion, b-roll query) -> CSV + JSON
   - Music brief (mood, YouTube Audio Library tags, gain, ducking, swell cues)
   - Captions: SRT + ASS (3-5 word chunks, keyword highlight, pop animation), `burnCaptions()` ffmpeg se
   - `mixAudio()` : narration + music, **auto ducking** + loudness -14 LUFS
   - Safety warnings (harmful title framing, medical wording, same format repeat)
3. Test scripts + `plan-video.js` CLI

## Install
1. Apni project ka backup lein (ya installer khud `.bak_<time>` bana deta hai).
2. Zip extract karein, phir:
   ```
   node install-patch.js "C:\...\youtube-automation-agent"
   ```
   (woh folder jis mein `agents` aur `utils` hain). Syntax fail ho to purani file khud wapas aa jati hai.
3. Test:
   ```
   node scripts\test-video-planner.js
   node scripts\test-thumbnail-designer.js
   node scripts\plan-video.js "7 Signs You Are Being Gaslighted"
   ```
   `ffmpeg` / `ffprobe` PATH mein hona chahiye (ya `FFMPEG_PATH` set karein).

## Apne pipeline mein kaise jorein
```js
const { VideoFormatPlanner } = require('./agents/video-format-planner');
const planner = new VideoFormatPlanner();

// 1) Script likhne se PEHLE
const plan = planner.planVideo({ title });          // format, hook, sections, shot plan, music, captions
// script writer ko do: plan.format, plan.hook.options, plan.sections (purpose), plan.scriptWordTarget

// 2) Voice-over ban jaye to
planner.generateCaptions({ words /* [{word,start,end}] ya {text,durationSec} */ }, plan, outDir);
planner.burnCaptions(video, assPath, outPath);
planner.mixAudio(voiceWav, musicFile, outM4a, { ...plan.music, durationSec });

// 3) Thumbnail
await thumbnailAgent.generateThumbnail({ title, formatPlan: plan });   // plan ke hisab se families ko halka bonus
```
Word-level timings (Whisper/TTS se) mile to captions bilkul sync honge; sirf text dein to estimate hota hai.

## Hadood (sach)
- Planner **plan** banata hai. Asli editing (clips jodna, zoom/pan lagana) aap ke OpenMontage/editor ko karni hai; shot list us ke liye input hai.
- Music ke liye track khud download karein (YouTube Audio Library). Planner sirf mood/tags/volume batata hai.
- Hook lines aur titles templates hain, behtar hai script writer unhein apne topic ke mutabiq badle.
- Views ki koi guarantee nahi. Quality aankhon se dekh kar parkhein.
- `data/video-format-history.json` mein history bnti hai; reset karna ho to delete kar dein.

# Production + Growth System (v11)

Node 20+ aur ffmpeg/ffprobe chahiye. Thumbnail pixel checks ke liye `sharp` (aapke project me pehle se hai).

## Layers (clean architecture)
    src/core    : pure logic, koi IO nahi (hook, interrupts, pacing, loudness, thumbnail rules, licence ledger, reuse risk)
    src/infra   : process supervisor, ffmpeg runner, checkpoint store, temp manager, jsonl store, thumbnail pixels
    src/app     : pipeline, chunked renderer, audio service, shot planner, report
    tests/      : 57+ tests (asli ffmpeg ke saath)
    scripts/    : run-tests.js, ci-hygiene.js, demo.js

## Chalana
    cd production-system
    npm test            # tests + warnings/leak check
    npm run hygiene     # static CI checks
    npm run demo        # nakli clips se poora pipeline

## Apne agent me jodna
    const { createProductionSystem } = require('./production-system/src');
    const sys = createProductionSystem({ root: 'C:\\yt\\state' });   // SHORT path rakho
    // har asset ek baar register karo (Pixabay clip, music, AI image):
    sys.ledger.register({ assetId, kind:'video', source:'pixabay', sourceUrl, author, licenseId:'pixabay-content-license' });
    const r = await sys.pipeline.run({ jobId, title, description, script, segments /*[{start,end,text}] TTS timings*/, words /*optional*/,
        narrationPath, clips:[{path, assetId}], musicPath, captionsAss, thumbnail:{ path, textBoxes:[{x,y,w,h,fontSize}], text }, outPath });
    // r.status: 'ready' | 'review' | 'blocked'; r.report.mustFix / consider; <out>.report.md bhi banta hai

## Features
1. Hook (pehle 5-15s): greeting, late start, punchy line, device, open loop, pace, dead air, title match. Score 0-100.
   Pattern interrupts: hook me har ~3-4s, baad me ~6-9s; zoom/flash ffmpeg se lagte hain, baqi (b-roll, sfx, text card) edit list me.
2. Dead air / filler: silencedetect se pauses chhote (0.28s rakhta hai), um/uh cut; aggressive mode optional. Captions ka time cuts ke baad khud theek hota hai.
   Loudness: two-pass loudnorm -14 LUFS, true peak <= -1.5; baad me measure karke verify.
3. Thumbnail: 360px aur 168px par contrast, safe zones (timestamp badge, margins, progress bar), font size, word count.
4. Licence ledger: har asset ka source/licence/hash. Block: unknown, non-commercial, ledger me nahi, attribution missing.
   Reuse risk: dusri videos se clip reuse, ek clip ka dominate karna, script similarity, same hook opening.
   Ye sab check render se PEHLE chalte hain; block ho to render shuru hi nahi hota.
5. Recovery: har stage ka checkpoint; render chhote chunks me hota hai, crash ke baad sirf adhoore chunks dobara bante hain.
   Hung ffmpeg (koi output nahi) stall detector se kill hota hai, poora process tree. Purane temp folders sirf marker wale delete hote hain.
6. CI hygiene: deprecated APIs, unused imports, console, focused tests, 'use strict'; test runner kisi bhi Node warning, leaked process ya temp folder par fail karta hai.

## Hadood (sach)
- Hook score aur interrupts craft rules hain; retention ya algorithm ki guarantee nahi.
- Filler detection ke liye word-level timings chahiye (`words`). Bina unke sirf silence cut hota hai.
- Licence table convenience hai, legal advice nahi; har source ka term khud confirm karo.
- Windows par process-tree kill `taskkill` se hota hai; ye sandbox (Linux) me hi test hua hai.
- Test sirf nakli tone/testsrc clips par hue, asli TTS/Pixabay clips par nahi.
- `npm run hygiene` apna simple checker hai, ESLint nahi (eslint.config.js optional diya hai, chalaya nahi).

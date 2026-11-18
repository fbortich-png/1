# Duckling After the Rain

A 15-second musical 3D cartoon for children aged 2–5, in English. Original characters and melody.

**Result:** `duckling_after_the_rain.mp4` (1920×1080, 16:9, 30 fps, 15.0 s, AAC stereo).

## Story and song (110 BPM, C major)

| Time | Action | Lyric |
|---|---|---|
| 0–3 s | A fluffy yellow duckling in blue rubber boots waddles through a blooming garden after the rain, notices a puddle and looks down at it | "Hello, sunshine! Hello, day!" |
| 3–7 s | Crouches, hops over the puddle and lands with a small splash and ripples | "Little duckling wants to play!" |
| 7–11 s | A smiling frog pops out from behind a bush and hops over; they jump together twice, then splash into the puddle | "Jump, jump, splash with me!" |
| 11–15 s | The friends face the viewer, smile and wave, nodding on "one, two, three"; slow gentle camera push-in | "Happy friends — one, two, three!" |

The last sung note ends at 14.73 s and the sound is silent by 15.0 s. The whole film is one continuous shot with a slow, smooth camera move and no cuts. There is no narrator, no on-screen text and no logos.

## How it is made (fully procedural)

- `audio/make_audio.py` builds the soundtrack:
  - **Vocals.** The melody is written phoneme by phoneme, then sung with the MBROLA `us1` voice. WORLD (pyworld) snaps the pitch exactly onto the notes and shifts the formants up to give a bright cartoon voice. From "Jump, jump…" onward a second, rounder voice (the frog) sings along.
  - **Instruments.** Karplus–Strong ukulele strums (re-entrant G-C-E-A tuning), glockenspiel bells, soft layered claps on the backbeat, a gentle bass, and quiet splash sounds.
  - **Lip sync.** It also writes `audio/out/lipsync.json`, which holds how wide each mouth should be open in every frame, taken from each voice's own track.
- `render/scene.js` is the three.js scene. Every frame is a pure function of time, so the output is the same every run. It includes soft shadows, a puddle with real reflections, ripples, splash droplets, swaying flowers, butterflies, a rainbow and drifting clouds.
- `render/render.js` renders the frames in headless Chromium.
- `build.sh` runs the whole pipeline: audio → frames → MP4.

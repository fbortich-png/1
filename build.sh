#!/usr/bin/env bash
# Rebuilds the whole cartoon: soundtrack -> 3D frames -> final MP4.
# Needs: python3 (numpy scipy pyworld soundfile), mbrola + mbrola-us1, node + playwright, ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"
python3 audio/make_audio.py
(cd render && npm install --silent)
FR=frames; rm -rf "$FR"; mkdir -p "$FR"
for r in "0 150" "150 300" "300 450"; do set -- $r; node render/render.js "$FR" 1920 1080 30 --from $1 --to $2 & done; wait
ffmpeg -y -framerate 30 -i "$FR/f_%04d.png" -i audio/out/soundtrack.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -t 15 -movflags +faststart \
  duckling_after_the_rain.mp4

#!/usr/bin/env python3
"""Synthesises the full 15-second soundtrack for "Duckling After the Rain".

- Vocals: sung note-by-note with MBROLA (.pho = phoneme, duration, pitch),
  then given a brighter, cartoon timbre with the WORLD vocoder (formant shift).
- Ukulele: Karplus-Strong plucked strings, re-entrant G-C-E-A voicings, strummed.
- Bells: soft glockenspiel (inharmonic additive partials).
- Claps: filtered noise bursts, gentle.
Tempo 110 BPM. The last sung note ends at beat 27 (14.73 s); everything is
silent by 15.0 s.

Outputs (in ./out): soundtrack.wav, lipsync.json (per-frame mouth openness).
"""
import json
import os
import subprocess
import tempfile

import numpy as np
import pyworld
import soundfile as sf
from scipy.signal import butter, lfilter, resample_poly

SR = 44100
BPM = 110
BEAT = 60.0 / BPM
TOTAL = 15.0
FPS = 30
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


N = {"C4": 60, "D4": 62, "E4": 64, "F4": 65, "G4": 67, "A4": 69, "B4": 71,
     "C5": 72, "D5": 74, "E5": 76, "G5": 79, "A5": 81, "C6": 84}

# ---------------------------------------------------------------- the song
# (onset consonants, vowel, coda consonants, note, start beat, length beats)
# Absolute beats from t=0. Original melody (sol-mi call, descending mi-re-do end).
SONG = [
    # 0-3 s  "Hello, sunshine! Hello, day!"
    (["h"], "E", [], "G4", 1.0, 0.5),
    (["l"], "@U", [], "E4", 1.5, 1.0),
    (["s"], "V", ["n"], "G4", 2.5, 0.5),
    (["S"], "AI", ["n"], "E4", 3.0, 1.0),
    (["h"], "E", [], "A4", 4.0, 0.5),
    (["l"], "@U", [], "A4", 4.5, 1.0),
    (["d"], "EI", [], "G4", 5.5, 1.5),
    # 3-7 s  "Little duckling wants to play!"
    (["l"], "I", [], "F4", 7.0, 0.5),
    (["4"], "@", ["l"], "F4", 7.5, 0.5),
    (["d"], "V", ["k"], "A4", 8.0, 0.5),
    (["l"], "I", ["N"], "A4", 8.5, 0.5),
    (["w"], "O", ["n", "t", "s"], "C5", 9.0, 0.75),
    (["t"], "u", [], "A4", 9.75, 0.75),
    (["p", "l"], "EI", [], "G4", 10.5, 2.0),
    # 7-11 s "Jump, jump, splash with me!"
    (["dZ"], "V", ["m", "p"], "G4", 14.0, 1.0),
    (["dZ"], "V", ["m", "p"], "G4", 15.0, 1.0),
    (["s", "p", "l"], "{", ["S"], "C5", 16.0, 1.0),
    (["w"], "I", ["D"], "A4", 17.0, 0.5),
    (["m"], "i", [], "G4", 17.5, 2.0),
    # 11-15 s "Happy friends - one, two, three!"
    (["h"], "{", [], "A4", 21.0, 0.5),
    (["p"], "i", [], "A4", 21.5, 0.5),
    (["f", "r"], "E", ["n", "d", "z"], "G4", 22.0, 1.0),
    (["w"], "V", ["n"], "E4", 23.0, 1.0),
    (["t_h"], "u", [], "D4", 24.0, 1.0),
    (["T", "r"], "i", [], "C4", 25.0, 2.0),
]
# which lines the frog sings along with (from "Jump, jump..." onward)
FROG_FROM_BEAT = 14.0

CONS_MS = {"h": 70, "l": 60, "s": 95, "S": 100, "d": 55, "4": 35, "w": 60,
           "t": 60, "t_h": 80, "p": 70, "k": 70, "N": 70, "n": 70, "m": 70,
           "dZ": 85, "D": 55, "f": 90, "r": 55, "z": 70, "T": 90}
VOICED = {"l", "d", "4", "w", "N", "n", "m", "dZ", "D", "r", "z"}
VOWELS = {"E", "@U", "V", "AI", "EI", "I", "@", "O", "u", "{", "i"}


def build_pho(semitone_shift=0, swing_ms=0):
    """Return (pho_text, vowel_intervals[(t0,t1)]) for the whole song."""
    events = []  # (start_s, dur_ms, phoneme, f0 or None, vibrato)
    vowels = []
    def onset_start(i):
        onset, _, _, _, b0, _ = SONG[i]
        return b0 * BEAT + swing_ms / 1000.0 - sum(CONS_MS[c] for c in onset) / 1000.0 + 0.015

    for i, (onset, vow, coda, note, b0, nb) in enumerate(SONG):
        f0 = midi_hz(N[note] + semitone_shift)
        t_end = (b0 + nb) * BEAT + swing_ms / 1000.0 - 0.03  # tiny breath gap
        if i + 1 < len(SONG):  # never run into the next syllable's consonants
            t_end = min(t_end, onset_start(i + 1) - 0.005)
        # onset consonants sit just before the beat so the vowel lands on it
        on_ms = [CONS_MS[c] for c in onset]
        t = onset_start(i)
        for c, d in zip(onset, on_ms):
            events.append((t, d, c, f0 if c in VOICED else None))
            t += d / 1000.0
        coda_ms = [CONS_MS[c] for c in coda]
        v_end = t_end - sum(coda_ms) / 1000.0
        v_dur = max(60, (v_end - t) * 1000)
        events.append((t, v_dur, vow, f0))
        vowels.append((t, t + v_dur / 1000.0))
        t += v_dur / 1000.0
        for c, d in zip(coda, coda_ms):
            events.append((t, d, c, f0 if c in VOICED else None))
            t += d / 1000.0
    lines = []
    cur = 0.0
    for t, d, ph, f0 in events:
        assert t > cur - 0.002, (ph, t, cur)
        if t > cur + 0.001:
            lines.append(f"_ {int(round((t - cur) * 1000))}")
            cur = t
        if f0 is None:
            lines.append(f"{ph} {int(round(d))}")
        elif ph in VOWELS:
            pts = []
            n = max(2, int(d / 25))
            for i in range(n + 1):
                p = 100.0 * i / n
                tt = d * i / n / 1000.0
                # slide in from slightly below, then gentle late vibrato
                glide = 1.0 - 0.035 * np.exp(-tt / 0.035)
                vib = 1.0 + (0.008 * np.sin(2 * np.pi * 5.5 * tt)
                             * min(1.0, max(0.0, (tt - 0.25) / 0.2)))
                pts.append(f"{p:.0f} {f0 * glide * vib:.1f}")
            lines.append(f"{ph} {int(round(d))} " + " ".join(pts))
        else:
            lines.append(f"{ph} {int(round(d))} 0 {f0:.1f} 100 {f0:.1f}")
        cur = t + d / 1000.0
    lines.append(f"_ {int(round((TOTAL - cur) * 1000))}")
    lines.append("_ 1")
    return "\n".join(lines) + "\n", vowels


def target_f0(tm):
    """Written melody as a pitch curve; glides between notes over 40 ms."""
    prev = None
    for onset, vow, coda, note, b0, nb in SONG:
        st = b0 * BEAT - 0.25
        en = (b0 + nb) * BEAT
        if st <= tm < en:
            f = midi_hz(N[note])
            dt = tm - b0 * BEAT
            if prev is not None and dt < 0.04:
                a = max(0.0, (dt + 0.0) / 0.04)
                f = prev ** (1 - a) * f ** a if dt >= 0 else prev
            age = tm - b0 * BEAT
            vib = 1 + 0.007 * np.sin(2 * np.pi * 5.5 * age) * min(
                1.0, max(0.0, (age - 0.3) / 0.2))
            return f * vib
        if tm >= en:
            prev = midi_hz(N[note])
    return 0.0


def mbrola(voice, pho):
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.pho")
        w = os.path.join(td, "s.wav")
        open(p, "w").write(pho)
        subprocess.run(["mbrola", f"/usr/share/mbrola/{voice}/{voice}", p, w],
                       check=True, capture_output=True)
        x, sr = sf.read(w)
    return x.astype(np.float64), sr


def cartoonize(x, sr, formant=1.18, f0_scale=1.0):
    """WORLD vocoder: keep the sung pitch, shift the spectral envelope up
    for a small, bright, friendly cartoon voice."""
    f0, t = pyworld.harvest(x, sr, f0_floor=120, f0_ceil=900, frame_period=5)
    sp = pyworld.cheaptrick(x, f0, t, sr)
    ap = pyworld.d4c(x, f0, t, sr)
    nb = sp.shape[1]
    idx = np.clip(np.arange(nb) / formant, 0, nb - 1)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, nb - 1)
    fr = idx - lo
    sp2 = np.ascontiguousarray(sp[:, lo] * (1 - fr) + sp[:, hi] * fr)
    # snap pitch to the written melody (exact notes, soft glide + vibrato)
    tgt = np.array([target_f0(tm) for tm in t])
    voiced = f0 > 0
    f0n = np.where(voiced & (tgt > 0), tgt, np.where(voiced, f0, 0))
    y = pyworld.synthesize(np.ascontiguousarray(f0n * f0_scale), sp2, ap, sr,
                           frame_period=5)
    return y


def to_sr(x, sr):
    if sr == SR:
        return x
    from math import gcd
    g = gcd(SR, sr)
    return resample_poly(x, SR // g, sr // g)


def fit(x, n):
    out = np.zeros(n)
    out[:min(n, len(x))] = x[:n]
    return out


def lowpass(x, fc, order=2):
    b, a = butter(order, fc / (SR / 2))
    return lfilter(b, a, x)


def highpass(x, fc, order=2):
    b, a = butter(order, fc / (SR / 2), btype="high")
    return lfilter(b, a, x)


def reverb(x, wet=0.18, decay=1.1):
    """Small, soft room: exponentially decaying filtered noise IR."""
    n = int(decay * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * decay / 6.9))
    ir = lowpass(ir, 5000)
    ir[:int(0.012 * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    from scipy.signal import fftconvolve
    w = fftconvolve(x, ir)[:len(x)]
    return x + wet * w


# ---------------------------------------------------------------- vocals
L = int(TOTAL * SR)
pho, vowel_iv = build_pho()
duck_raw, vsr = mbrola("us1", pho)
duck = cartoonize(duck_raw, vsr, formant=1.20)
duck = to_sr(duck, vsr)
duck = fit(duck, L)

frog_raw, fsr = mbrola("us1", build_pho(swing_ms=12)[0])
frog = cartoonize(frog_raw, fsr, formant=1.06)  # rounder, slightly deeper timbre
frog = fit(to_sr(frog, fsr), L)
tt = np.arange(L) / SR
frog *= np.clip((tt - (FROG_FROM_BEAT * BEAT - 0.25)) / 0.05, 0, 1)

for v in (duck, frog):
    v[:] = highpass(v, 110)
duck /= np.max(np.abs(duck)) + 1e-9
frog /= np.max(np.abs(frog)) + 1e-9
sf.write(os.path.join(OUT, "stem_duck.wav"), duck, SR)
sf.write(os.path.join(OUT, "stem_frog.wav"), frog, SR)

# ---------------------------------------------------------------- ukulele
UKE = {  # re-entrant G4 C4 E4 A4 strings, chord shapes as midi notes
    "C": [67, 60, 64, 72], "F": [69, 60, 65, 69], "G": [67, 62, 67, 71],
    "Am": [69, 60, 64, 69], "G7": [67, 62, 65, 71],
}


def ks_pluck(freq, dur, amp=1.0, bright=0.5):
    n = int(dur * SR)
    p = max(2, int(round(SR / freq)))
    buf = rng.uniform(-1, 1, p)
    buf = lowpass(np.concatenate([buf, buf]), 2000 + 5000 * bright)[p:]
    out = np.zeros(n)
    decay = 0.996
    for i in range(n):
        v = buf[i % p]
        out[i] = v
        buf[i % p] = decay * 0.5 * (v + buf[(i + 1) % p])
    env = np.minimum(1, np.arange(n) / (0.002 * SR))
    return amp * out * env


_pluck_cache = {}


def pluck(m, dur, bright):
    key = (m, round(dur, 2), round(bright, 2))
    if key not in _pluck_cache:
        _pluck_cache[key] = ks_pluck(midi_hz(m), dur, bright=bright)
    return _pluck_cache[key]


uke = np.zeros(L + SR)


def strum(chord, beat, down=True, amp=1.0, ring=1.4):
    notes = UKE[chord] if down else UKE[chord][::-1]
    t0 = beat * BEAT
    for k, m in enumerate(notes):
        s = int((t0 + k * 0.012) * SR)
        x = pluck(m, ring, 0.55 if down else 0.35)
        uke[s:s + len(x)] += amp * x * (0.8 if not down else 1.0)


CHORDS = [  # (from beat, to beat, chord)
    (0, 1, "C"), (1, 4, "C"), (4, 5.5, "F"), (5.5, 7, "C"),
    (7, 9, "F"), (9, 10.5, "F"), (10.5, 14, "G"),
    (14, 16, "C"), (16, 18, "F"), (18, 19, "C"), (19, 21, "G7"),
    (21, 22, "F"), (22, 23, "C"), (23, 24, "C"), (24, 25, "G"), (25, 27, "C"),
]


def chord_at(b):
    for a, z, c in CHORDS:
        if a <= b < z:
            return c
    return "C"


b = 0.0
while b < 25.0:
    c = chord_at(b)
    if b == int(b):
        strum(c, b, True, 0.55)
    else:
        strum(c, b, False, 0.30)
    b += 0.5
# final: one gentle ringing strum on beat 25, let it ring then damp at 14.75 s
strum("C", 25.0, True, 0.6, ring=2.0)
strum("C", 26.0, False, 0.25, ring=1.2)
uke = uke[:L]

# ---------------------------------------------------------------- bass (soft)
bass = np.zeros(L + SR)
ROOT = {"C": 48, "F": 41, "G": 43, "Am": 45, "G7": 43}
for a, z, c in CHORDS:
    s = int(a * BEAT * SR)
    d = (z - a) * BEAT
    n = int(d * SR)
    t = np.arange(n) / SR
    f = midi_hz(ROOT[c])
    x = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t))
    env = np.minimum(1, t / 0.01) * np.exp(-t / 0.9) * np.minimum(1, (d - t) / 0.05)
    bass[s:s + n] += 0.22 * x * env
bass = bass[:L]

# ---------------------------------------------------------------- bells


def bell(m, amp=0.3, dur=1.6):
    f = midi_hz(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.55)
         + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.18)
         + 0.15 * np.sin(2 * np.pi * f * 5.40 * t) * np.exp(-t / 0.08))
    return amp * x * np.minimum(1, t / 0.001)


bells = np.zeros(L + 2 * SR)


def add_bell(beat, note, amp=0.25):
    s = int(beat * BEAT * SR)
    x = bell(N[note] if isinstance(note, str) else note, amp)
    bells[s:s + len(x)] += x


# intro sparkle
for i, nt in enumerate(["C5", "E5", "G5"]):
    add_bell(0.0 + i * 0.25, nt, 0.18)
# answer phrases between lines (glock "echo" of the sol-mi motif)
for bb, nt in [(6.0, "G5"), (6.5, "E5"), (12.5, "D5"), (13.0, "G5"), (13.5, "D5")]:
    add_bell(bb, nt, 0.2)
# splash twinkles
for bb in (16.0,):
    for i, nt in enumerate(["C6", "G5", "E5", "C6"]):
        add_bell(bb + i * 0.125, nt, 0.12)
for bb, nt in [(19.5, "G5"), (20.0, "A5"), (20.5, "G5")]:
    add_bell(bb, nt, 0.2)
# doubling "one, two, three" + final shimmer
for bb, nt in [(23, "E5"), (24, "D5"), (25, "C5"), (25.0, "G5"), (25.0, "E5")]:
    add_bell(bb, nt, 0.16)
bells = bells[:L]

# ---------------------------------------------------------------- claps
claps = np.zeros(L + SR)


def clap(beat, amp=0.18):
    s = int(beat * BEAT * SR)
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    env = np.zeros(n)
    for k, off in enumerate((0.0, 0.008, 0.016)):  # several hands = softer clap
        e = np.where(t >= off, np.exp(-(t - off) / 0.022), 0)
        env += e * (0.7 if k else 1.0)
    x = x * env
    x = highpass(lowpass(x, 3500), 700)
    claps[s:s + n] += amp * x / (np.max(np.abs(x)) + 1e-9)


for bb in np.arange(8.0, 25.0, 2.0):   # backbeat (beats 2 & 4 of each bar)
    clap(bb, 0.12 if bb < 14 else 0.17)
clap(25.0, 0.2)
claps = claps[:L]

# ---------------------------------------------------------------- puddle splash sfx (very soft)
splash = np.zeros(L + SR)


def add_splash(t0, amp=0.08):
    s = int(t0 * SR)
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n) * np.exp(-t / 0.08)
    x = lowpass(highpass(x, 1200), 6000)
    splash[s:s + n] += amp * x / np.max(np.abs(x))


add_splash(9.0 * BEAT + 0.02, 0.07)    # duckling's little splash (~4.9 s)
add_splash(15.0 * BEAT + 0.02, 0.06)   # jump together
add_splash(16.0 * BEAT + 0.02, 0.08)   # splash with me
splash = splash[:L]

# ---------------------------------------------------------------- mix
vox = reverb(0.62 * duck + 0.40 * frog, wet=0.16)
inst = reverb(0.55 * uke / (np.max(np.abs(uke)) + 1e-9) + bass + bells, wet=0.22)
mix = vox + 0.75 * inst + claps + splash

# final fade so the last note is finished by 15 s
fade = np.ones(L)
f0i, f1i = int(14.55 * SR), int(14.97 * SR)
fade[f0i:f1i] = np.linspace(1, 0, f1i - f0i) ** 1.5
fade[f1i:] = 0
fade[:int(0.01 * SR)] = np.linspace(0, 1, int(0.01 * SR))
mix *= fade
mix = np.tanh(1.1 * mix / (np.max(np.abs(mix)) + 1e-9)) * 0.89
stereo = np.stack([mix, mix], axis=1)
# a touch of width: uke slightly left, bells slightly right
w = 0.06
stereo[:, 0] += w * fade * inst
stereo[:, 1] -= w * fade * inst
stereo /= np.max(np.abs(stereo)) / 0.89
sf.write(os.path.join(OUT, "soundtrack.wav"), stereo, SR, subtype="PCM_16")

# ---------------------------------------------------------------- lip sync data
def env_per_frame(x):
    hop = SR // FPS
    nf = int(TOTAL * FPS)
    e = np.array([np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12)
                  for i in range(nf)])
    e = e / (np.percentile(e, 98) + 1e-9)
    e = np.clip((e - 0.08) / 0.92, 0, 1)
    # smooth a little so the beak moves softly
    k = np.array([0.25, 0.5, 0.25])
    return np.convolve(e, k, mode="same")


syl = []
for onset, vow, coda, note, b0, nb in SONG:
    syl.append({"t": round(b0 * BEAT, 3), "len": round(nb * BEAT, 3),
                "vowel": vow})
data = {
    "fps": FPS, "bpm": BPM, "beat": BEAT,
    "duck": [round(float(v), 3) for v in env_per_frame(duck)],
    "frog": [round(float(v), 3) for v in env_per_frame(frog)],
    "syllables": syl,
}
json.dump(data, open(os.path.join(OUT, "lipsync.json"), "w"))
print("ok", len(mix) / SR, "s")

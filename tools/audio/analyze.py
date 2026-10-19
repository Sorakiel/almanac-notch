# Sound analysis for stage 9a (docs/PROGRESS.md): measure a reference (coucou's WAVs) and our
# synthesized sounds with the same numbers.
#   python3 -m venv /tmp/audio-venv && /tmp/audio-venv/bin/pip install numpy scipy
#   node tools/audio/render.mjs $PWD/apps/desktop/src/synth.ts <dir>   - our sounds as WAV
#   analyze.py a.wav b.wav ...   - length, RMS, spectral centroid, bands, attack, -40 dB tail, stereo
#   roll.py file.wav [step]      - a piano roll: the strongest pitches every `step` s
#   onsets.py file.wav           - note onsets (log spectral flux) with the new pitch at each
#   verify.py greeting.wav '{"beat": seconds, ...}'  - each beat vs the nearest onset, and strays
import sys, wave, numpy as np

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def name(f):
    if f <= 0: return '-'
    m = round(69 + 12 * np.log2(f / 440))
    return f'{NOTES[m % 12]}{m // 12 - 1}'

def load(p):
    w = wave.open(p)
    sr, nc = w.getframerate(), w.getnchannels()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    a = a.reshape(-1, nc)
    return sr, a

def analyze(p, onsets_detail=True):
    sr, a = load(p)
    m = a.mean(axis=1)
    n = len(m)
    rms = np.sqrt((m ** 2).mean())
    # stereo
    if a.shape[1] == 2:
        L, R = a[:, 0], a[:, 1]
        corr = np.corrcoef(L, R)[0, 1]
        side = np.sqrt(((L - R) / 2) ** 2).mean() / (np.sqrt(((L + R) / 2) ** 2).mean() + 1e-9)
    else:
        corr, side = 1, 0
    # spectrum
    spec = np.abs(np.fft.rfft(m * np.hanning(n)))
    fr = np.fft.rfftfreq(n, 1 / sr)
    centroid = (spec * fr).sum() / spec.sum()
    # energy above bands
    tot = (spec ** 2).sum()
    bands = [(0, 200), (200, 800), (800, 2500), (2500, 6000), (6000, 24000)]
    bp = [((spec[(fr >= lo) & (fr < hi)] ** 2).sum() / tot) for lo, hi in bands]
    # envelope 5 ms
    hop = int(sr * 0.005)
    env = np.array([np.sqrt((m[i:i + hop] ** 2).mean()) for i in range(0, n - hop, hop)])
    peak_i = env.argmax()
    attack_ms = peak_i * 5
    above = np.where(env > env.max() * 10 ** (-40 / 20))[0]
    tail_ms = (above[-1] - peak_i) * 5 if len(above) else 0
    print(f'== {p.split("/")[-1]}  {n/sr:.2f}s  ch{a.shape[1]}  rms {rms:.3f}  centroid {centroid:.0f}Hz  '
          f'bands lo/lowmid/mid/hi/air {"/".join(f"{x*100:.0f}" for x in bp)}%  '
          f'attack {attack_ms}ms  tail-40dB {tail_ms}ms  LRcorr {corr:.2f} side {side:.2f}')
    if not onsets_detail: return
    # onsets: spectral flux on 20 ms frames, 5 ms hop
    win = int(sr * 0.04)
    frames = []
    for i in range(0, n - win, hop):
        frames.append(np.abs(np.fft.rfft(m[i:i + win] * np.hanning(win))))
    frames = np.array(frames)
    flux = np.maximum(frames[1:] - frames[:-1], 0).sum(axis=1)
    thr = flux.mean() + 1.2 * flux.std()
    ons = []
    for i in range(1, len(flux) - 1):
        if flux[i] > thr and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1]:
            if not ons or i - ons[-1] > 12: ons.append(i)
    ffr = np.fft.rfftfreq(win, 1 / sr)
    for o in ons:
        t = (o + 1) * hop / sr
        seg = m[int(t * sr) + int(0.01 * sr): int(t * sr) + int(0.01 * sr) + int(sr * 0.08)]
        if len(seg) < 256: continue
        N = 1 << 15
        s = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), N))
        f = np.fft.rfftfreq(N, 1 / sr)
        s[f < 80] = 0
        # top 3 peaks
        idx = []
        ss = s.copy()
        for _ in range(4):
            k = ss.argmax()
            if ss[k] < s.max() * 0.15: break
            idx.append(k)
            ss[max(0, k - 40):k + 40] = 0
        lvl = 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)
        print(f'  {t:5.2f}s  {lvl:6.1f}dB  ' + '  '.join(f'{name(f[k])}({f[k]:.0f})' for k in idx))

if __name__ == "__main__":
  for p in sys.argv[1:]:
    analyze(p, onsets_detail='greeting' in p or len(sys.argv) <= 3)

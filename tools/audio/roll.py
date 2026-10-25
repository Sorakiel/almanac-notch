# see analyze.py
import sys, numpy as np
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from analyze import load, name
sr, a = load(sys.argv[1]); m = a.mean(axis=1)
step = float(sys.argv[2]) if len(sys.argv) > 2 else 0.05
win = int(sr * 0.06); N = 1 << 15
f = np.fft.rfftfreq(N, 1 / sr)
for t in np.arange(0, len(m) / sr - 0.06, step):
    seg = m[int(t * sr): int(t * sr) + win]
    lvl = 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)
    if lvl < -50: continue
    s = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), N)); s[f < 70] = 0
    out = []; ss = s.copy(); mx = s.max()
    for _ in range(4):
        k = ss.argmax()
        if ss[k] < mx * 0.2: break
        out.append(f'{name(f[k])}:{20*np.log10(ss[k]/mx):.0f}'); ss[max(0, k-30):k+30] = 0
    print(f'{t:5.2f} {lvl:6.1f}dB  ' + ' '.join(out))

# see analyze.py
# Each struck note of the greeting vs the measured beat it belongs to; any onset louder than -32 dB
# that is not near a beat and not inside a held note is a stray.
import sys, json
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from onsets import onsets
from analyze import load
import numpy as np
sr, x = load(sys.argv[1]); mono = x.mean(axis=1)
def lvl(a, b):
    seg = mono[int(a*sr):int(b*sr)]
    return 20*np.log10(np.sqrt((seg**2).mean())+1e-9)
beats = json.loads(sys.argv[2])
held = [(0.0, 0.88), (1.952, 2.7), (3.056, 3.49), (3.504, 4.6)]   # the curtain's air, the pad, the hello's held notes
ons = onsets(sys.argv[1], 1.0)
BIAS = -0.02  # the detector's window reports ~20 ms early (measured on known strikes)
print(f"{'beat':10} {'кадр, с':>8} {'атака, с':>9} {'Δ, мс':>6}  нота")
for name, t in beats.items():
    near = [o for o in ons if abs(o[0] - BIAS - t) < 0.06]
    if near:
        o = max(near, key=lambda o: o[3]); print(f"{name:10} {t:8.3f} {o[0]-BIAS:9.3f} {round((o[0]-BIAS-t)*1000):6d}  {o[1]} {o[3]} dB")
    else:
        jump = lvl(t, t+0.02) - lvl(t-0.03, t-0.005)
        # a low soft strike shows as a jump in level rather than in the spectrum
        print(f"{name:10} {t:8.3f} {'':>9} {'':>6}  " + (f"скачок громкости +{jump:.0f} дБ ровно на кадре" if jump >= 6 else "без удара (нарастание)"))
stray = [o for o in ons if o[3] > -32 and all(abs(o[0]-BIAS-t) >= 0.06 for t in beats.values()) and not any(a < o[0] < b for a, b in held)]
print('лишние атаки громче -32 дБ:', stray or 'нет')

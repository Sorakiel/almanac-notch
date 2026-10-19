# see analyze.py
import sys, numpy as np
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from analyze import load, name
def onsets(path, sens=1.0):
    sr, a = load(path); m = a.mean(axis=1)
    hop = int(sr*0.005); win = int(sr*0.03); N = 4096
    fr = []
    for i in range(0, len(m)-win, hop):
        fr.append(np.log1p(100*np.abs(np.fft.rfft(m[i:i+win]*np.hanning(win), N))))
    fr = np.array(fr)
    flux = np.maximum(fr[1:]-fr[:-1], 0).sum(axis=1)
    out = []
    w = 20
    for i in range(1, len(flux)-1):
        lo, hi = max(0, i-w), min(len(flux), i+w)
        thr = np.median(flux[lo:hi]) + sens*flux[lo:hi].std() + 0.5
        if flux[i] > thr and flux[i] == flux[max(0,i-6):i+7].max():
            t = (i+1)*hop/sr
            seg = m[int((t+0.015)*sr): int((t+0.075)*sr)]
            if len(seg) < 512: continue
            s = np.abs(np.fft.rfft(seg*np.hanning(len(seg)), 1<<15)); f = np.fft.rfftfreq(1<<15, 1/sr)
            s[f < 70] = 0
            # strongest new partial: compare with spectrum just before onset
            pre = m[int((t-0.07)*sr): int((t-0.01)*sr)]
            sp = np.abs(np.fft.rfft(pre*np.hanning(len(pre)), 1<<15)) if len(pre) > 256 else np.zeros_like(s)
            d = np.maximum(s - sp, 0)
            k = d.argmax()
            lvl = 20*np.log10(np.sqrt((seg**2).mean())+1e-9)
            out.append((round(t,3), name(f[k]), round(f[k]), round(lvl,1)))
    return out
if __name__ == '__main__':
    for o in onsets(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1.0): print(*o)

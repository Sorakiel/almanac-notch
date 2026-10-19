# Motion energy per frame (60 fps) and transition segments: start, end, t50/t90 of the
# cumulative change (a proxy for progress along the transition).
import sys, subprocess, numpy as np
def frames(path, w=320):
    pr = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',path],capture_output=True,text=True).stdout.split(',')
    W,H = int(pr[0]), int(pr[1]); h = int(round(H*w/W/2))*2
    raw = subprocess.run(['ffmpeg','-v','error','-i',path,'-vf',f'scale={w}:{h}','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
    return np.frombuffer(raw,np.uint8).reshape(-1,h,w).astype(np.float32)
for path in sys.argv[1:]:
    F = frames(path); E = np.abs(np.diff(F,axis=0)).mean(axis=(1,2))
    thr = max(np.median(E)*4, 0.15)
    on = E > thr; segs=[]; i=0
    while i < len(on):
        if on[i]:
            j=i
            while j < len(on) and (on[j] or any(on[j:j+4])): j+=1
            segs.append((i,j)); i=j
        else: i+=1
    print(f'== {path.split("/")[-1]} frames={len(F)} thr={thr:.2f}')
    for a,b in segs:
        if b-a < 3: continue
        c = np.cumsum(E[a:b]); c/=c[-1]
        t50 = a+np.searchsorted(c,.5); t90=a+np.searchsorted(c,.9)
        pk = a+int(np.argmax(E[a:b]))
        print(f'  {a/60:6.3f}-{b/60:6.3f}s dur {(b-a)/60:.3f}  t50 +{(t50-a)/60:.3f} t90 +{(t90-a)/60:.3f} peak +{(pk-a)/60:.3f} ({E[pk]:.1f})')

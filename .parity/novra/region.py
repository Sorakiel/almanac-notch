# Mean brightness of regions over time, normalised first->last frame (0..1): when a piece of content appears.
import sys, numpy as np
F=np.load(sys.argv[1]).astype(np.float32); n=int(sys.argv[2])
regs=[tuple(map(int,r.split(':'))) for r in sys.argv[3:]]
for name_i,(x0,y0,x1,y1) in enumerate(regs):
    m=F[:n,y0:y1,x0:x1].mean(axis=(1,2)); a,b=m[0],m[-1]; p=(m-a)/(b-a)
    def first(f):
        i=np.argmax(p>=f); return round(i/60,3) if p[i]>=f else None
    print(f'region {x0},{y0}-{x1},{y1}: t10 {first(.1)} t50 {first(.5)} t90 {first(.9)} t99 {first(.99)} max {p.max():.2f}')

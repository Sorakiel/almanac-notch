import sys, numpy as np
F=np.load(sys.argv[1]); y=int(sys.argv[2]); x0,x1=int(sys.argv[3]),int(sys.argv[4]); n=int(sys.argv[5])
for i,f in enumerate(F[:n]):
    row=f[y,x0:x1].astype(int); xs=np.where(row<6)[0]
    print(f'{i/60:.3f} {x0+xs.min() if len(xs) else -1} {x0+xs.max() if len(xs) else -1}')

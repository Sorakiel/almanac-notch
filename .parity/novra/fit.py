# Fit a measured 0..1 progress curve with a damped spring (response, damping, start delay)
# and with a cubic-bezier ease (duration, start delay); print t10/50/90/99 and overshoot.
import sys, numpy as np, itertools
t,p=np.loadtxt(sys.argv[1],unpack=True)
def spring(ts,resp,z):
    w=2*np.pi/resp; out=[];x=0;v=0;h=1/1200;T=0;k=0
    res=np.zeros_like(ts)
    for i,tt in enumerate(ts):
        while T<tt:
            a=-w*w*(x-1)-2*z*w*v; v+=a*h; x+=v*h; T+=h
        res[i]=x if tt>0 else 0
    return res
def metrics(ts,ps):
    def first(f):
        i=np.argmax(ps>=f); return ts[i] if ps[i]>=f else None
    return {k:(round(first(f),3) if first(f) is not None else None) for k,f in (('t10',.1),('t50',.5),('t90',.9),('t99',.99))}, round(100*(ps.max()-1),1)
print('measured',metrics(t,p))
best=None
for resp in np.arange(0.2,0.9,0.01):
  for z in np.arange(0.5,1.01,0.02):
    for d in np.arange(-0.05,0.1,0.01):
      m=spring(t-d,resp,z); e=np.mean((m-p)**2)
      if best is None or e<best[0]: best=(e,resp,z,d)
e,resp,z,d=best
print(f'spring fit: response {resp:.2f} damping {z:.2f} delay {d:+.2f}  rms {np.sqrt(e):.3f}  -> k {(2*np.pi/resp)**2:.0f} zeta {z:.2f}')

# Stage 9g: duration, peak, loudness and brightness of our sounds and coucou's, pair by pair.
# python3 tools/sounds-metrics.py <coucou sounds dir> <our dir from sounds-pair.mjs>
import sys, json, subprocess, numpy as np
cc, ours = sys.argv[1:3]
def load(p):
    r = subprocess.run(['ffmpeg','-v','error','-i',p,'-f','f32le','-ac','1','-ar','44100','-'],capture_output=True).stdout
    return np.frombuffer(r,dtype=np.float32)
def m(x):
    pk=np.abs(x).max(); act=np.where(np.abs(x)>pk*0.03)[0]; d=(act[-1]-act[0])/44100 if len(act) else 0
    seg=x[act[0]:act[-1]+1] if len(act) else x
    rms=np.sqrt((seg**2).mean()); S=np.abs(np.fft.rfft(seg*np.hanning(len(seg)))); f=np.fft.rfftfreq(len(seg),1/44100)
    return d, 20*np.log10(pk+1e-9), 20*np.log10(rms+1e-9), (S*f).sum()/(S.sum()+1e-9), act[0]/44100 if len(act) else 0
print('ours -> coucou       dur(s)        peak dB      rms dB       centroid Hz   attack-start s')
for a,b in json.load(open(ours+'/pairs.json')).items():
    A=m(load(f'{ours}/ours-{a}.wav')); B=m(load(f'{cc}/{b}.wav'))
    print(f'{a:>9} -> {b:<9}'+''.join(f'{x:6.2f}|{y:6.2f}   ' for x,y in zip(A,B)))

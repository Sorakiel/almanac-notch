// Renders the island's sounds off the main thread (stage 9a): the greeting alone takes ~130 ms,
// which would stall the frame its animation starts on.
import { synth, type SoundName } from './synth';

interface Ask {
  id: number;
  name: SoundName;
  sampleRate: number;
  seed: number;
}

self.onmessage = (e: MessageEvent<Ask>) => {
  const { id, name, sampleRate, seed } = e.data,
    r = synth(name, sampleRate, seed);
  (self as unknown as Worker).postMessage(
    { id, channels: r.channels },
    r.channels.map((c) => c.buffer as ArrayBuffer),
  );
};

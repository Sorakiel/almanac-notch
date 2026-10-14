// Placeholder until stage 2: proves the workspace link to packages/island works in Vite.
import { mulberry32, PARITY_SEED } from '@almanac-notch/island';

const status = document.getElementById('status');
if (status) status.dataset['rng'] = mulberry32(PARITY_SEED)().toFixed(6);

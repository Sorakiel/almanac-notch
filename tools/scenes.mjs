// Visual reference scenes. Each scene is a list of high-level actions that both targets understand:
// the prototype (prototype/island-prototype.html) and the port (the dev harness of packages/island).
// Time is virtual: page.clock drives requestAnimationFrame, so the same scene gives the same frame.
//
// Actions
//   { wait: ms }                     advance virtual time
//   { screen: 'mac' | 'win' }        which screen the island sits on
//   { nstate: 'auto' | 'closed' | 'half' | 'open' }
//   { trigger: '<event>' }           attention, question, working, thinking, searching, ratelimit,
//                                    success, error, dance, greeting, sleep (toggles)
//   { focus: '<module>' | null }     claude, github, cal, music, almanac
//   { tab: 'home' | 'chat' | 'add' | 'settings' }
//   { pokes: n }                     n quick pokes on the mascot (6 = overload)
//   { answer: 'approve' | 'deny' | 'opt:0' }
//   { hover: [dx, dy] }              pointer over the island, offset from the island canvas top centre (CSS px)
//   { leave: true }                  pointer off the island and away from the stage
//   { click: act | [act, fx] }       click a hit zone by its act ('tab:chat', 'm:seek'...), fx = spot along its width
//   { dbl: act }  { point: act }     double click / hover a hit zone
//   { key: 'y' }                     key press
//   { tick: i }                      tick habit i directly (only 3 of 5 habits are clickable in the prototype)
//   { shot: 'name', area: 'island' | 'stage' | 'loupe' | 'page' }

const base = [{ leave: true }, { wait: 6500 }]; // let the launch greeting finish

export const SCENES = [
  // closed
  { name: 'mac-closed', steps: [...base, { nstate: 'closed' }, { wait: 800 }, { shot: 'mac-closed', area: 'island' }] },
  { name: 'win-closed-tile', steps: [...base, { screen: 'win' }, { nstate: 'closed' }, { wait: 800 }, { shot: 'win-closed-tile', area: 'island' }] },

  // half-open
  { name: 'half-after-launch', steps: [...base, { shot: 'half-after-launch', area: 'island' }, { shot: 'half-after-launch-loupe', area: 'loupe' }] },
  ...['working', 'thinking', 'searching', 'ratelimit', 'success', 'error', 'dance', 'attention', 'question'].map(ev => ({
    name: 'half-' + ev,
    steps: [...base, { nstate: 'half' }, { trigger: ev }, { wait: ev === 'success' || ev === 'error' ? 350 : 1200 },
      { shot: 'half-' + ev, area: 'island' }, { shot: 'half-' + ev + '-loupe', area: 'loupe' }]
  })),
  { name: 'half-sleep', steps: [...base, { nstate: 'half' }, { trigger: 'sleep' }, { wait: 2500 }, { shot: 'half-sleep', area: 'island' }] },
  { name: 'win-half-working', steps: [...base, { screen: 'win' }, { nstate: 'half' }, { trigger: 'working' }, { wait: 1200 }, { shot: 'win-half-working', area: 'island' }] },

  // open: home with each module in focus
  ...['claude', 'github', 'cal', 'music', 'almanac'].map(f => ({
    name: 'open-focus-' + f,
    steps: [...base, { nstate: 'open' }, { focus: f }, { wait: 900 }, { shot: 'open-focus-' + f, area: 'island' }]
  })),
  { name: 'open-music-rail-hover', steps: [...base, { nstate: 'open' }, { focus: 'music' }, { wait: 600 }, { hover: [222, 80] }, { wait: 500 }, { shot: 'open-music-rail-hover', area: 'island' }] },
  { name: 'open-working-steps', steps: [...base, { nstate: 'open' }, { trigger: 'working' }, { wait: 2600 }, { shot: 'open-working-steps', area: 'island' }] },
  { name: 'open-github-error', steps: [...base, { nstate: 'open' }, { trigger: 'error' }, { wait: 400 }, { shot: 'open-github-error', area: 'island' }] },
  { name: 'open-attention', steps: [...base, { nstate: 'open' }, { trigger: 'attention' }, { wait: 1200 }, { shot: 'open-attention', area: 'island' }] },
  { name: 'open-attention-approved', steps: [...base, { nstate: 'open' }, { trigger: 'attention' }, { wait: 1000 }, { answer: 'approve' }, { wait: 250 }, { shot: 'open-attention-approved', area: 'island' }] },
  { name: 'open-question', steps: [...base, { nstate: 'open' }, { trigger: 'question' }, { wait: 1200 }, { shot: 'open-question', area: 'island' }] },
  { name: 'open-ratelimit', steps: [...base, { nstate: 'open' }, { trigger: 'ratelimit' }, { wait: 1200 }, { shot: 'open-ratelimit', area: 'island' }] },
  { name: 'open-overload', steps: [...base, { nstate: 'auto' }, { pokes: 6 }, { wait: 300 }, { shot: 'overload-0.3s', area: 'island' }, { wait: 900 }, { shot: 'overload-1.2s', area: 'island' }, { shot: 'overload-1.2s-stage', area: 'stage' }, { wait: 2600 }, { shot: 'overload-after', area: 'island' }] },
  { name: 'open-tabs', steps: [...base, { nstate: 'open' }, { tab: 'chat' }, { wait: 400 }, { shot: 'open-tab-chat', area: 'island' }, { tab: 'add' }, { wait: 400 }, { shot: 'open-tab-add', area: 'island' }, { tab: 'settings' }, { wait: 400 }, { shot: 'open-tab-settings', area: 'island' }] },

  // pointer and keyboard input on the open island
  ...[
    ['input-tab-chat', [{ click: 'tab:chat' }, { wait: 400 }]],
    ['input-settings-pref', [{ click: 'tab:settings' }, { wait: 300 }, { click: 'pref:2' }, { wait: 300 }]],
    ['input-mute', [{ click: 'mute' }, { wait: 300 }]],
    ['input-focus-chip', [{ click: 'focus:github' }, { wait: 900 }]],
    ['input-rail-click', [{ focus: 'music' }, { wait: 600 }, { hover: [222, 80] }, { wait: 400 }, { click: 'focus:cal' }, { wait: 900 }]],
    ['input-player-pause', [{ focus: 'music' }, { wait: 600 }, { click: 'm:toggle' }, { wait: 300 }]],
    ['input-player-next', [{ focus: 'music' }, { wait: 600 }, { click: 'm:next' }, { wait: 300 }]],
    ['input-player-controls', [{ focus: 'music' }, { wait: 600 }, { click: ['m:seek', 0.25] }, { click: ['m:vol', 0.3] }, { click: 'm:shuffle' }, { click: 'm:repeat' }, { wait: 300 }]],
    ['input-habit', [{ focus: 'almanac' }, { wait: 600 }, { click: 'habit:2' }, { wait: 400 }]],
    ['input-habits-all-done', [{ focus: 'almanac' }, { wait: 600 }, { tick: 4 }, { click: 'habit:2' }, { wait: 1200 }]],
    ['input-approve-hover', [{ trigger: 'attention' }, { wait: 1200 }, { point: 'approve' }, { wait: 200 }]],
    ['input-approve-click', [{ trigger: 'attention' }, { wait: 1200 }, { click: 'approve' }, { wait: 1200 }]],
    ['input-deny-key', [{ trigger: 'attention' }, { wait: 1200 }, { key: 'n' }, { wait: 300 }]],
    ['input-question-key', [{ trigger: 'question' }, { wait: 1200 }, { key: '2' }, { wait: 300 }]],
    ['input-question-click', [{ trigger: 'question' }, { wait: 1200 }, { click: 'opt:0' }, { wait: 300 }]],
    ['input-card-dblclick', [{ dbl: 'mascot' }, { wait: 300 }]],
  ].map(([name, steps]) => ({ name, steps: [...base, { nstate: 'open' }, { wait: 900 }, ...steps, { shot: name, area: 'island' }] })),

  // launch greeting, beat by beat
  { name: 'greeting', steps: [{ leave: true }, { wait: 500 }, ...[300, 900, 1500, 2300, 3000, 3600, 4300].flatMap((ms, i, a) => [{ wait: ms - (i ? a[i - 1] : 0) }, { shot: 'greeting-' + String(ms).padStart(4, '0'), area: 'island' }])] },

  // the big stage mascot
  { name: 'stage-idle', steps: [...base, { shot: 'stage-idle', area: 'stage' }] },
  ...['working', 'thinking', 'searching', 'ratelimit', 'dance'].map(ev => ({
    name: 'stage-' + ev, steps: [...base, { trigger: ev }, { wait: 1200 }, { shot: 'stage-' + ev, area: 'stage' }]
  })),
  { name: 'stage-success', steps: [...base, { trigger: 'success' }, { wait: 1100 }, { shot: 'stage-success', area: 'stage' }] },
  { name: 'stage-sleep', steps: [...base, { trigger: 'sleep' }, { wait: 3000 }, { shot: 'stage-sleep', area: 'stage' }] },
  { name: 'stage-grumpy', steps: [...base, { pokes: 3 }, { wait: 500 }, { shot: 'stage-grumpy', area: 'stage' }] },

  // whole page, for layout context
  { name: 'page', steps: [...base, { shot: 'page', area: 'page' }] }
];

// Short clips of the motion that screenshots cannot show. Recorded from the prototype only.
export const CLIPS = [
  { name: 'greeting', steps: [{ leave: true }, { wait: 6000 }] },
  { name: 'overload', steps: [...base, { pokes: 6 }, { wait: 4500 }] },
  { name: 'success-error', steps: [...base, { nstate: 'half' }, { trigger: 'success' }, { wait: 2600 }, { trigger: 'error' }, { wait: 3000 }] },
  { name: 'attention-answer', steps: [...base, { nstate: 'open' }, { trigger: 'attention' }, { wait: 1500 }, { answer: 'approve' }, { wait: 2500 }] },
  { name: 'question-answer', steps: [...base, { nstate: 'open' }, { trigger: 'question' }, { wait: 1500 }, { answer: 'opt:1' }, { wait: 2000 }] },
  { name: 'states-auto', steps: [...base, { nstate: 'auto' }, { trigger: 'working' }, { wait: 2500 }, { hover: [0, 20] }, { wait: 2000 }, { leave: true }, { wait: 1500 }, { trigger: 'working' }, { wait: 1500 }] },
  { name: 'music-dance', steps: [...base, { nstate: 'open' }, { focus: 'music' }, { wait: 3500 }, { hover: [222, 80] }, { wait: 1200 }, { leave: true }, { wait: 800 }] },
  { name: 'focus-switch', steps: [...base, { nstate: 'open' }, ...['claude', 'github', 'cal', 'almanac', 'music'].flatMap(f => [{ focus: f }, { wait: 1400 }])] },
  { name: 'win-states', steps: [...base, { screen: 'win' }, { nstate: 'closed' }, { wait: 1000 }, { nstate: 'half' }, { wait: 1200 }, { nstate: 'open' }, { wait: 1500 }, { nstate: 'closed' }, { wait: 1200 }] },
  { name: 'ratelimit', steps: [...base, { nstate: 'half' }, { trigger: 'ratelimit' }, { wait: 5000 }] }
];

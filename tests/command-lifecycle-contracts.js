const BOTH_MODES = Object.freeze(['model', 'paper'])
const MODEL_MODE = Object.freeze(['model'])
const PAPER_MODE = Object.freeze(['paper'])

function contract({
  cancel = 'command-signal',
  input,
  modes = BOTH_MODES,
  prompt,
}) {
  return Object.freeze({
    cancel,
    input: Object.freeze(input),
    modes,
    prompt,
  })
}

// This manifest is deliberately independent from the runtime registry: a new
// registry entry must make an explicit lifecycle decision here before the
// registry-wide smoke suite can pass.
const COMMAND_LIFECYCLE_CONTRACTS = Object.freeze({
  HELP: contract({
    cancel: 'immediate',
    input: ['action'],
    prompt: null,
  }),
  LINE: contract({
    cancel: 'drawing-event',
    input: ['pointer', 'coordinate', 'value'],
    prompt: 'Click to start drawing a Line',
  }),
  CIRCLE: contract({
    cancel: 'drawing-event',
    input: ['pointer', 'coordinate', 'value'],
    prompt: 'Click to set center',
  }),
  ELLIPSE: contract({
    input: ['pointer', 'coordinate', 'value'],
    prompt: 'Click to set center',
  }),
  RECTANGLE: contract({
    cancel: 'rectangle-dimension',
    input: ['pointer', 'coordinate', 'value'],
    prompt: 'Click to start drawing a Rectangle',
  }),
  MOVE: contract({
    input: ['selection', 'pointer', 'coordinate', 'value'],
    prompt: 'Select elements to move',
  }),
  COPY: contract({
    input: ['selection', 'pointer', 'coordinate', 'value'],
    modes: MODEL_MODE,
    prompt: 'Select elements to copy',
  }),
  ROTATE: contract({
    input: ['selection', 'pointer', 'value'],
    modes: MODEL_MODE,
    prompt: 'Select elements to rotate',
  }),
  SCALE: contract({
    input: ['selection', 'pointer', 'value'],
    modes: MODEL_MODE,
    prompt: 'Select elements to scale',
  }),
  OFFSET: contract({
    input: ['selection', 'pointer', 'value'],
    modes: MODEL_MODE,
    prompt: 'Enter a distance to offset',
  }),
  FILLET: contract({
    input: ['selection', 'value'],
    modes: MODEL_MODE,
    prompt: 'Select elements to fillet',
  }),
  MATCH_PROPERTIES: contract({
    input: ['selection'],
    modes: MODEL_MODE,
    prompt: 'Select source object',
  }),
  ERASE: contract({
    input: ['selection'],
    modes: MODEL_MODE,
    prompt: 'Select elements to erase',
  }),
  EXTEND: contract({
    input: ['selection', 'pointer'],
    modes: MODEL_MODE,
    prompt: 'Select boundary elements',
  }),
  TRIM: contract({
    input: ['selection', 'pointer'],
    modes: MODEL_MODE,
    prompt: 'Select boundary elements',
  }),
  ARC: contract({
    cancel: 'drawing-event',
    input: ['pointer'],
    prompt: 'Click to set the start point',
  }),
  DIST: contract({
    input: ['pointer', 'coordinate'],
    modes: MODEL_MODE,
    prompt: 'Specify first point',
  }),
  MIRROR: contract({
    cancel: 'keyboard-escape',
    input: ['selection', 'pointer'],
    modes: MODEL_MODE,
    prompt: 'Select elements to mirror',
  }),
  GROUP: contract({
    cancel: 'immediate',
    input: ['selection'],
    modes: MODEL_MODE,
    prompt: 'No elements selected to group',
  }),
  UNGROUP: contract({
    cancel: 'immediate',
    input: ['selection'],
    modes: MODEL_MODE,
    prompt: 'No groups selected to ungroup',
  }),
  HATCH: contract({
    input: ['pointer'],
    modes: MODEL_MODE,
    prompt: 'Click inside a closed region',
  }),
  TEXT: contract({
    input: ['pointer', 'coordinate', 'text'],
    prompt: 'Click to set insertion point',
  }),
  POLYLINE: contract({
    cancel: 'drawing-event',
    input: ['pointer'],
    prompt: 'Click to add points',
  }),
  SPLINE: contract({
    cancel: 'drawing-event',
    input: ['pointer'],
    prompt: 'Click to add spline points',
  }),
  VIEWPORT: contract({
    input: ['pointer', 'coordinate', 'value'],
    modes: PAPER_MODE,
    prompt: 'Specify first corner of viewport',
  }),
  DIMLINEAR: contract({
    input: ['pointer', 'coordinate'],
    modes: MODEL_MODE,
    prompt: 'Specify first extension line origin',
  }),
  DIMALIGNED: contract({
    input: ['pointer', 'coordinate'],
    modes: MODEL_MODE,
    prompt: 'Specify first extension line origin',
  }),
  AREA: contract({
    input: ['selection'],
    prompt: 'Select a closed polyline or rectangle',
  }),
  BLOCK: contract({
    input: ['selection', 'pointer', 'dialog'],
    modes: MODEL_MODE,
    prompt: 'Select elements to define as a block',
  }),
  INSERT: contract({
    input: ['pointer', 'dialog'],
    modes: MODEL_MODE,
    prompt: 'INSERT ',
  }),
})

export { COMMAND_LIFECYCLE_CONTRACTS }

/**
 * ============================================================================
 *  PLAYER — the audio graph the subtitle sync listens through
 * ============================================================================
 *  Three things about tapping a `<video>`'s audio are true, unpleasant, and the
 *  whole reason this is a module rather than a few lines in the hook that uses
 *  it:
 *
 *    1. **`createMediaElementSource` can be called once per element, ever.** A
 *       second call throws, and there is no way to undo the first — the routing
 *       is for the life of the element. So the graph is built once and memoised
 *       against the element it belongs to, and every later call gets that one.
 *
 *    2. **Routing through a graph takes the element's volume away from it.**
 *       Whether `video.volume` and `video.muted` still apply afterwards differs
 *       between browsers and has differed between versions of the same one, and
 *       getting it wrong is the difference between watching a film at the
 *       volume you chose and watching it at one you did not. So once the graph
 *       exists, the output level is a `GainNode` and the element is pinned
 *       open — one place applies it, whatever the browser believes. See
 *       `setOutput`, which is what the player calls instead of setting the
 *       element's own properties.
 *
 *    3. **A cross-origin element gives silence.** The node is not an error, it
 *       is a zero, and a zero correlates with nothing — so a viewer would be
 *       told "could not tell" when the truth is "could not hear". Every provider
 *       on this site returns a same-origin `/api/<provider>/proxy` URL, so this
 *       is not expected to happen; `readLevel` returning nothing is how it would
 *       show.
 *
 *  And one cost that is not a bug but is worth knowing: routed through a graph,
 *  the sound goes to this device's output rather than wherever the element was
 *  sending it. A viewer casting the tab to a television and then starting a sync
 *  would move the film's audio to the machine in front of them. It is the price
 *  of being able to measure the audio at all, and it lasts as long as (1) does.
 *
 *  Nothing here knows about subtitles. It measures a loudness and it sets a
 *  volume, and `useAudioSync` is the part that cares what the loudness means.
 * ============================================================================
 */

/** Every graph built so far, keyed by the element it was built from. */
const GRAPHS = new WeakMap();

/**
 * The band the measurement is taken in, in Hz.
 *
 * Speech lives here and most of what a film puts on top of speech — the low end
 * of a score, rumble, explosions — does not. A single biquad at this centre is
 * a nudge rather than a filter bank; it is here because the correlation it feeds
 * is asking "is somebody talking", and the closer the signal is to the answer
 * the fewer of the ways this feature can be wrong.
 */
const SPEECH_LOW = 300;
const SPEECH_HIGH = 3400;

/** The element's own output level, handed over to the gain node. */
function adoptOutput(graph, video) {
  graph.gain.gain.value = video.muted ? 0 : video.volume;

  // From here the gain node is the only thing applying a level. The element is
  // left wide open underneath it, so the two cannot multiply — see (2) above.
  video.volume = 1;
  video.muted = false;
}

/**
 * The graph for `video`, built on the first call and reused on every one after.
 *
 * Must be called from somewhere a user gesture has happened: an `AudioContext`
 * created without one starts suspended, and a suspended context is not silence
 * you can measure, it is silence you get. `start()` on the hook is that gesture.
 *
 * @returns {{context: AudioContext, analyser: AnalyserNode, gain: GainNode, buffer: Float32Array}|null}
 *          null where Web Audio is missing or the element cannot be tapped, in
 *          which case the caller is expected to offer nothing rather than a
 *          button that cannot work.
 */
export function audioGraph(video) {
  if (!video) return null;

  const existing = GRAPHS.get(video);
  if (existing) return existing;

  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;

  let context;
  let source;

  try {
    context = new AudioContextClass();
    source = context.createMediaElementSource(video);
  } catch {
    // Something else has already claimed the element, or the browser refuses.
    // Either way there is nothing to measure.
    context?.close?.();
    return null;
  }

  const bandpass = context.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = Math.sqrt(SPEECH_LOW * SPEECH_HIGH);
  bandpass.Q.value = 0.7;

  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  // No smoothing: the envelope is built from the raw level of each moment, and
  // a filter that averages this reading with the last one would blur exactly the
  // onsets the correlation is looking for.
  analyser.smoothingTimeConstant = 0;

  const gain = context.createGain();

  // Two branches off the same source: one to hear, one to measure. The analyser
  // is not connected onward, so the band-pass shapes what is measured and
  // nothing about what is played.
  source.connect(gain);
  gain.connect(context.destination);
  source.connect(bandpass);
  bandpass.connect(analyser);

  const graph = { context, analyser, gain, buffer: new Float32Array(analyser.fftSize) };

  GRAPHS.set(video, graph);
  adoptOutput(graph, video);

  return graph;
}

/** Whether a graph has been built for this element already. */
export function hasGraph(video) {
  return Boolean(video && GRAPHS.get(video));
}

/**
 * The element's output level, wherever it currently lives.
 *
 * The player calls this from the same two effects that used to set `volume` and
 * `muted` directly, so there is one path for both cases and no state kept here:
 * before a graph exists it is a pass-through to the element and behaves exactly
 * as it always did, and after one exists the gain node is the output and the
 * element stays pinned open.
 */
export function setOutput(video, { volume, muted }) {
  const graph = video ? GRAPHS.get(video) : null;

  if (!graph) {
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    return;
  }

  graph.gain.gain.value = muted ? 0 : volume;
  if (video.volume !== 1) video.volume = 1;
  if (video.muted) video.muted = false;
}

/**
 * How loud the film is right now, as an RMS over the analysed window.
 *
 * Also hands back how far behind the picture this reading is. The graph is fed
 * from the decoder and heard later, so the sample read at the moment the clock
 * says `t` belongs to `t - latency`; the caller subtracts it, or every offset
 * this feature reports would be out by the size of the output buffer — small,
 * but it is a bias, and a bias is the one thing a correlation cannot see.
 *
 * @returns {{level: number, latency: number}|null}  null with no graph
 */
export function readLevel(graph) {
  if (!graph) return null;

  graph.analyser.getFloatTimeDomainData(graph.buffer);

  let sum = 0;
  for (let index = 0; index < graph.buffer.length; index += 1) {
    sum += graph.buffer[index] * graph.buffer[index];
  }

  // `outputLatency` is Chrome and Firefox; Safari has neither it nor a
  // substitute, and reports zero, which is the honest answer for a browser that
  // will not say.
  const latency = Number.isFinite(graph.context.outputLatency)
    ? graph.context.outputLatency
    : 0;

  return { level: Math.sqrt(sum / graph.buffer.length), latency };
}

/** Wakes the context, which a suspended one needs after any interruption. */
export function resume(graph) {
  if (graph?.context.state !== 'running') graph?.context.resume?.().catch(() => {});
}

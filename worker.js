// Runs the generator off the main thread so the page stays responsive.
importScripts('insectdraw.js');

self.onmessage = e => {
  const {id, opt} = e.data;
  try {
    const R = generate(opt);
    const P = R.params, A = ARCHETYPES[P.arch];
    const slots = {};
    for (const s of Object.keys(SLOTS)) slots[s] = {v: P[s], borrowed: !A[s].includes(P[s])};
    const layers = penOrder(R).map(pen => {
      const ss = R.strokes.filter(s => s.pen === pen);
      return {pen, color: R.colors[pen][0], name: R.colors[pen][1], count: ss.length, mm: Math.round(ss.reduce((a, s) => a + polyLen(s.pts), 0))};
    });
    const mut = Object.keys(P.mut).filter(k => P.mut[k]);
    self.postMessage({id, ok: true, name: R.name, svg: toSVG(R, {strokeWidth: opt.thumb ? 0.5 : 0.3}), json: opt.thumb ? null : toJSON(R), arch: P.arch, weird: P.weird, slots, layers, mut, antenna2: P.antenna2 || null});
  } catch (err) { self.postMessage({id, ok: false, error: String(err && err.stack || err)}); }
};

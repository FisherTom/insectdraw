#!/usr/bin/env node
// insectdraw.js — procedurally generated (and occasionally surreal) insect drawings for pen plotters.
//
// Inspired by fishdraw by Lingdong Huang (MIT): https://github.com/LingDong-/fishdraw
// Hershey font data is taken from fishdraw (Hershey fonts are public domain).
//
// Everything is a pen-tagged polyline: {pen, pts:[[x,y],...]}. pen 0 = black, 1..k = colour pens.
// Parts are added to a Scene front-to-back; each new part is clipped against the silhouettes of
// everything already in front of it (hidden-line removal), exactly like fishdraw's clip_multi trick.
'use strict';

const {PI, sin, cos, atan2, sqrt, abs, min, max, pow, exp, floor, hypot} = Math;
const D2R = PI / 180;

// ============================================================ RNG & noise
let jsr = 0x5EED;
function rand() { jsr ^= jsr << 17; jsr ^= jsr >> 13; jsr ^= jsr << 5; return (jsr >>> 0) / 4294967296; }
function srand(n) { jsr = (n >>> 0) || 1; for (let i = 0; i < 8; i++) rand(); }
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 1; }
function rnd(a = 0, b = 1) { return a + rand() * (b - a); }
function rint(a, b) { return floor(rnd(a, b + 1)); }
function chance(p) { return rand() < p; }
function choice(opts, w) {
  if (!w) w = opts.map(() => 1);
  let s = 0; for (const x of w) s += x;
  let r = rand() * s;
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
  return opts[opts.length - 1];
}
function rndtri(a, b, c) { // triangular distribution: min, mode, max
  const u = rand(), F = (b - a) / (c - a);
  return u < F ? a + sqrt(u * (c - a) * (b - a)) : c - sqrt((1 - u) * (c - a) * (c - b));
}
function hash2(x, y) { const s = sin(x * 127.1 + y * 311.7) * 43758.5453; return s - floor(s); }

let PERM = null;
function initNoise() {
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  PERM = new Uint8Array(512); for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function grad(h, x, y, z) { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
function noise(x, y = 0, z = 0) { // classic Perlin, mapped to ~[0,1]
  const X = floor(x) & 255, Y = floor(y) & 255, Z = floor(z) & 255;
  x -= floor(x); y -= floor(y); z -= floor(z);
  const u = fade(x), v = fade(y), w = fade(z), P = PERM;
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const r = lerp(lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  return 0.5 + 0.5 * r;
}

// ============================================================ basic geometry
function lerp(a, b, t) { return a + (b - a) * t; }
function lerp2(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
function dist(p, q) { return hypot(p[0] - q[0], p[1] - q[1]); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return {x0, y0, x1, y1};
}
function bbOverlap(a, b) { return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1); }
function pip(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) c = !c;
  }
  return c;
}
function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx; if (den === 0) return -1;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return (t >= 0 && t < 1 && u >= 0 && u < 1) ? t : -1;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = clamp(t, 0, 1);
  return hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function polyDist(p, poly) { let d = Infinity; for (let i = 0; i < poly.length; i++) d = min(d, segDist(p, poly[i], poly[(i + 1) % poly.length])); return d; }
function centroid(poly) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
function polyLen(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }
function closed(poly) { return poly.concat([poly[0]]); }

function tr(pts, dx, dy) { return pts.map(p => [p[0] + dx, p[1] + dy]); }
function rot(pts, a, cx = 0, cy = 0) { const c = cos(a), s = sin(a); return pts.map(p => { const x = p[0] - cx, y = p[1] - cy; return [cx + x * c - y * s, cy + x * s + y * c]; }); }
function scl(pts, sx, sy = sx, cx = 0, cy = 0) { return pts.map(p => [cx + (p[0] - cx) * sx, cy + (p[1] - cy) * sy]); }
function mirX(pts) { return pts.map(p => [-p[0], p[1]]); }
function xform(pts, a, dx, dy) { return tr(rot(pts, a), dx, dy); }

function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0].slice()]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = dist(a, b); if (d === 0) continue;
    let t = step - carry;
    while (t <= d) { out.push(lerp2(a, b, t / d)); t += step; }
    carry = d - (t - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.2) out.push(last.slice()); else out[out.length - 1] = last.slice();
  return out;
}
function catmull(pts, closedLoop = true, seg = 10) {
  const n = pts.length, out = [];
  const P = i => closedLoop ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
  const lim = closedLoop ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  if (!closedLoop) out.push(pts[n - 1].slice());
  return out;
}
function ellipse(cx, cy, rx, ry, a = 0, n = 40) {
  const o = []; for (let i = 0; i < n; i++) { const t = i / n * PI * 2; o.push([rx * cos(t), ry * sin(t)]); }
  return xform(o, a, cx, cy);
}
function arcPath(x, y, a0, a1, len, n = 24) { // heading interpolates a0 -> a1 (radians)
  const pts = [[x, y]], step = len / (n - 1);
  for (let i = 1; i < n; i++) { const a = lerp(a0, a1, (i - 0.5) / (n - 1)); x += cos(a) * step; y += sin(a) * step; pts.push([x, y]); }
  return pts;
}
function quadPath(a, c, b, n = 16) { const o = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); o.push(lerp2(lerp2(a, c, t), lerp2(c, b, t), t)); } return o; }
function subPath(pts, t0, t1) { // sub-polyline by arc-length fraction
  const L = polyLen(pts), s0 = t0 * L, s1 = t1 * L, out = []; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = dist(a, b);
    if (acc + d >= s0 && acc <= s1) {
      if (!out.length) out.push(lerp2(a, b, clamp((s0 - acc) / (d || 1), 0, 1)));
      if (acc + d <= s1) out.push(b.slice()); else { out.push(lerp2(a, b, clamp((s1 - acc) / (d || 1), 0, 1))); break; }
    }
    acc += d;
  }
  return out.length > 1 ? out : [pts[0], pts[pts.length - 1]];
}
function pathAt(pts, t) { const s = subPath(pts, 0, clamp(t, 0.0001, 1)); return s[s.length - 1]; }
function pathDir(pts, t) { const a = pathAt(pts, clamp(t - 0.01, 0, 1)), b = pathAt(pts, clamp(t + 0.01, 0, 1)); return atan2(b[1] - a[1], b[0] - a[0]); }

// symmetric body-part outline along the midline: half-width w(t), t from front (0) to back (1)
function profilePoly(y0, len, wfn, opt = {}) {
  const n = opt.n || 48, R = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); R.push([max(wfn(t), 0.001), y0 + t * len]); }
  const edge = (w, y, bow, m = 10) => { const o = []; for (let k = 1; k < m; k++) { const x = lerp(-w, w, k / m); o.push([x, y + bow * (1 - (x / w) ** 2)]); } return o; };
  const front = (opt.front && R[0][0] > 0.01) ? edge(R[0][0], y0, opt.front) : [];
  const back = (opt.back && R[n - 1][0] > 0.01) ? edge(R[n - 1][0], y0 + len, opt.back).reverse() : [];
  return [...front, ...R, ...back, ...mirX(R).reverse()];
}
// outline of a thick stroke along a centreline, with round caps
function tube(pts, wfn, caps = true) {
  const n = pts.length, L = [], R = []; let acc = 0; const tot = polyLen(pts) || 1;
  const N = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += dist(pts[i - 1], pts[i]);
    const a = pts[max(i - 1, 0)], b = pts[min(i + 1, n - 1)];
    const d = hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / d, ty = (b[1] - a[1]) / d;
    const w = max(wfn(acc / tot), 0.02), p = pts[i];
    L.push([p[0] - ty * w, p[1] + tx * w]); R.push([p[0] + ty * w, p[1] - tx * w]); N.push([tx, ty, w]);
  }
  const cap = (p, t, sgn) => { const o = []; for (let k = 1; k < 6; k++) { const a = k / 6 * PI; o.push([p[0] + sgn * (-t[1] * t[2] * cos(a) + t[0] * t[2] * sin(a)), p[1] + sgn * (t[0] * t[2] * cos(a) + t[1] * t[2] * sin(a))]); } return o; };
  if (!caps) return [...L, ...R.reverse()];
  return [...L, ...cap(pts[n - 1], N[n - 1], 1), ...R.reverse(), ...cap(pts[0], N[0], -1)];
}

// ============================================================ clipping & scene
function clipPts(pts, poly, pbb) { // -> [insideRuns, outsideRuns]
  const lbb = bbox(pts);
  if (!bbOverlap(lbb, pbb)) return [[], [pts]];
  const ins = [], outs = [], n = poly.length;
  let inside = pip(pts[0][0], pts[0][1], poly), cur = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const sx0 = min(a[0], b[0]), sx1 = max(a[0], b[0]), sy0 = min(a[1], b[1]), sy1 = max(a[1], b[1]);
    if (!(sx1 < pbb.x0 || sx0 > pbb.x1 || sy1 < pbb.y0 || sy0 > pbb.y1)) {
      const ts = [];
      for (let j = 0; j < n; j++) {
        const c = poly[j], d = poly[(j + 1) % n];
        if ((c[0] < sx0 && d[0] < sx0) || (c[0] > sx1 && d[0] > sx1) || (c[1] < sy0 && d[1] < sy0) || (c[1] > sy1 && d[1] > sy1)) continue;
        const t = segX(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
        if (t >= 0) ts.push(t);
      }
      if (ts.length) {
        ts.sort((p, q) => p - q);
        for (const t of ts) { const p = lerp2(a, b, t); cur.push(p); (inside ? ins : outs).push(cur); cur = [p]; inside = !inside; }
      }
    }
    cur.push(b);
  }
  (inside ? ins : outs).push(cur);
  return [ins.filter(r => r.length > 1), outs.filter(r => r.length > 1)];
}
function clipS(strokes, poly, keepInside, pbb) {
  pbb = pbb || bbox(poly); const out = [];
  for (const s of strokes) { const r = clipPts(s.pts, poly, pbb)[keepInside ? 0 : 1]; for (const p of r) out.push({pen: s.pen, pts: p}); }
  return out;
}
function St(pts, pen = 0) { return {pen, pts}; }
function polysOf(s) { if (!s || !s.length) return []; return Array.isArray(s[0][0]) ? s : [s]; }

class Scene {
  constructor() { this.occ = []; this.strokes = []; }
  add(strokes, sils) {
    strokes = (strokes || []).filter(s => s.pts.length > 1);
    for (const o of this.occ) { if (!strokes.length) break; strokes = clipS(strokes, o.poly, false, o.bb); }
    this.strokes.push(...strokes);
    for (const p of polysOf(sils)) if (p.length > 2) this.occ.push({poly: p, bb: bbox(p)});
  }
  addPart(part) { this.add(part.strokes, part.sils); }
}
function part(strokes, sils) { return {strokes, sils: polysOf(sils)}; }
function mirPart(p) { return {strokes: p.strokes.map(s => St(mirX(s.pts), s.pen)), sils: p.sils.map(mirX)}; }
function xformPart(p, a, dx, dy) { return {strokes: p.strokes.map(s => St(xform(s.pts, a, dx, dy), s.pen)), sils: p.sils.map(q => xform(q, a, dx, dy))}; }
function addPair(S, parts) { for (const p of parts) S.addPart(p); for (const p of parts) S.addPart(mirPart(p)); }

// ============================================================ fills (no rand() in here: keeps two-pass builds deterministic)
let SP = 0.7;      // hatch spacing in world units, set per pass so the final spacing is constant in mm
let FILLS = true;  // first (measuring) pass skips fills

function scanLines(poly, ang, sp, phase = 0.5) { // parallel hatch lines clipped inside poly
  if (!FILLS) return [];
  const rp = rot(poly, -ang), bb = bbox(rp), out = [];
  for (let y = bb.y0 + sp * phase + 1e-4 * sp; y < bb.y1; y += sp) {
    const xs = [];
    for (let i = 0, j = rp.length - 1; i < rp.length; j = i++) {
      const a = rp[i], b = rp[j];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > sp * 0.2) out.push(rot([[xs[k], y], [xs[k + 1], y]], ang));
  }
  return out;
}
function hatch(poly, ang, sp = SP, pen = 0, phase = 0.5) { return scanLines(poly, ang, sp, phase).map(p => St(p, pen)); }
// volumetric rim shading: hatch inside poly minus a shrunken, raised copy of itself
function rimShade(poly, sp = SP * 1.1, k = 0.78, lift = 0.25, ang = PI / 4, pen = 0) {
  if (!FILLS) return [];
  const c = centroid(poly), bb = bbox(poly);
  const carve = tr(scl(poly, k, k, c[0], c[1]), 0, -(bb.y1 - bb.y0) * (1 - k) * lift);
  let ls = clipS(hatch(poly, ang, sp, pen), carve, false);
  // taper: trim each stroke at the end nearest the carve centre
  return ls.map(s => {
    if (s.pts.length !== 2) return s;
    let [a, b] = s.pts; const t = 0.15 + 0.45 * hash2(a[0], a[1]);
    if (dist(a, c) < dist(b, c)) a = lerp2(a, b, t); else b = lerp2(b, a, t);
    return St([a, b], s.pen);
  }).filter(s => polyLen(s.pts) > sp * 0.4);
}
// transverse bowed contour lines (follow the curvature of a body segment)
function crossContour(poly, sp = SP * 1.3, bow = null, pen = 0) {
  if (!FILLS) return [];
  const bb = bbox(poly), hw = (bb.x1 - bb.x0) / 2, cx = (bb.x0 + bb.x1) / 2; bow = bow == null ? hw * 0.35 : bow;
  const lines = [];
  for (let y = bb.y0 - abs(bow); y < bb.y1; y += sp) {
    const l = []; for (let k = 0; k <= 24; k++) { const x = lerp(bb.x0 - 1, bb.x1 + 1, k / 24); l.push([x, y + bow * (1 - ((x - cx) / (hw + 1)) ** 2)]); }
    lines.push(St(l, pen));
  }
  return clipS(lines, poly, true);
}
// longitudinal contour lines for a profile shape (w(t) along y)
function longContour(y0, len, wfn, sp = SP * 1.3, pen = 0, gap = 0) {
  if (!FILLS) return [];
  let wm = 0; for (let i = 0; i <= 40; i++) wm = max(wm, wfn(i / 40));
  const n = floor(wm / sp), out = [];
  for (let k = -n; k <= n; k++) {
    const f = k / (n + 1); if (abs(f) < gap) continue;
    const l = []; for (let i = 0; i <= 40; i++) { const t = lerp(0.01, 0.99, i / 40); l.push([f * wfn(t), y0 + t * len]); }
    out.push(St(l, pen));
  }
  return out;
}
// radial fan fill from a point; adds rays at larger radii to keep spacing even
function radialFill(poly, cx, cy, sp = SP, phase = 0) {
  if (!FILLS) return [];
  let R = 0, angs = [];
  for (const p of poly) { R = max(R, hypot(p[0] - cx, p[1] - cy)); angs.push(atan2(p[1] - cy, p[0] - cx)); }
  let a0 = min(...angs), a1 = max(...angs);
  if (pip(cx, cy, poly) || a1 - a0 > PI * 1.2) { a0 = -PI; a1 = PI; }
  const daf = sp / R, K = 7, out = [], pbb = bbox(poly);
  let j = 0;
  for (let a = a0 + daf * (phase + 0.1372); a < a1; a += daf, j++) {
    let lvl = 0; while (lvl < K && (j % (1 << (lvl + 1))) === 0) lvl++;
    const rs = lvl >= K ? 0 : R / (1 << (lvl + 1)) * (0.6 + 0.8 * hash2(j, lvl));
    const seg = [[cx + cos(a) * rs, cy + sin(a) * rs], [cx + cos(a) * R * 1.02, cy + sin(a) * R * 1.02]];
    for (const r of clipPts(seg, poly, pbb)[0]) out.push(St(r, 0));
  }
  return out;
}
// split strokes into runs by fn(x,y) -> pen (or -1 = don't draw)
function penSplit(strokes, fn, step = SP * 0.5) {
  const out = [];
  for (const s of strokes) {
    const pts = resample(s.pts, step); if (pts.length < 2) continue;
    let v = fn(pts[0][0], pts[0][1]), cur = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const w = fn(pts[i][0], pts[i][1]);
      if (w !== v) { const m = lerp2(pts[i - 1], pts[i], 0.5); cur.push(m); if (v >= 0) out.push(St(cur, v)); cur = [m]; v = w; }
      cur.push(pts[i]);
    }
    if (v >= 0 && cur.length > 1) out.push(St(cur, v));
  }
  return out;
}
function stipple(poly, sp = SP * 2.2, pen = 0, dens = () => 1) {
  if (!FILLS) return [];
  const bb = bbox(poly), out = [];
  for (let y = bb.y0; y < bb.y1; y += sp) for (let x = bb.x0; x < bb.x1; x += sp) {
    const px = x + (hash2(x, y) - 0.5) * sp * 0.9, py = y + (hash2(y, x) - 0.5) * sp * 0.9;
    if (hash2(px * 3.1, py * 1.7) > dens(px, py) || !pip(px, py, poly)) continue;
    const r = SP * 0.18; out.push(St([[px - r, py], [px + r, py + r * 0.3]], pen));
  }
  return out;
}
function signedArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
// fur: hairs bristling out of the outline plus combed hairs over the surface
function fur(poly, len, pen = 0, dir = PI / 2, inner = true) {
  if (!FILLS) return [];
  const out = [], sgn = signedArea(poly) > 0 ? 1 : -1, pts = resample(closed(poly), SP * 1.3);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], t = atan2(b[1] - a[1], b[0] - a[0]);
    const n = t - sgn * PI / 2 + (noise(a[0] * 0.3, a[1] * 0.3, 5) - 0.5) * 1.6;
    const l = len * (0.5 + 0.8 * hash2(a[0], a[1]));
    const s = [a[0] - cos(n) * l * 0.25, a[1] - sin(n) * l * 0.25];
    out.push(St(quadPath(s, [s[0] + cos(n) * l * 0.6, s[1] + sin(n) * l * 0.6], [s[0] + cos(n + 0.4) * l, s[1] + sin(n + 0.4) * l], 4), pen));
  }
  if (inner) {
    const bb = bbox(poly), g = SP * 2.4, inn = [];
    for (let y = bb.y0; y < bb.y1; y += g) for (let x = bb.x0; x < bb.x1; x += g) {
      const px = x + (hash2(x, y) - 0.5) * g, py = y + (hash2(y, x) - 0.5) * g;
      if (!pip(px, py, poly) || polyDist([px, py], poly) < len * 0.3) continue;
      const a = dir + (noise(px * 0.15, py * 0.15, 9) - 0.5) * 2.2 + (px < 0 ? 0.25 : -0.25), l = len * (0.4 + 0.5 * hash2(px, py));
      inn.push(St([[px, py], [px + cos(a) * l * 0.5, py + sin(a) * l * 0.5], [px + cos(a + 0.3) * l, py + sin(a + 0.3) * l]], pen));
    }
    return out.concat(clipS(inn, poly, true));
  }
  return out;
}
function hexFacets(poly, cell, pen = 0) {
  if (!FILLS) return [];
  const bb = bbox(poly), out = [], w = cell * sqrt(3), h = cell * 1.5;
  for (let r = 0, y = bb.y0 - h; y < bb.y1 + h; y += h, r++) for (let x = bb.x0 - w + (r % 2) * w / 2; x < bb.x1 + w; x += w) {
    const v = k => [x + cell * cos(PI / 6 + k * PI / 3), y + cell * sin(PI / 6 + k * PI / 3)];
    out.push(St([v(5), v(0), v(1), v(2)], pen));
  }
  return clipS(out, poly, true);
}

// ============================================================ Delaunay / Voronoi (Bowyer–Watson)
function circum(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return [x, y, (a[0] - x) ** 2 + (a[1] - y) ** 2];
}
function voronoiEdges(points) {
  const bb = bbox(points), M = max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 10, cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  const P = points.concat([[cx - M, cy - M], [cx + M, cy - M], [cx, cy + M]]), n = points.length;
  let tris = [{v: [n, n + 1, n + 2], c: circum(P[n], P[n + 1], P[n + 2])}];
  for (let i = 0; i < n; i++) {
    const p = P[i], bad = [], keep = [];
    for (const t of tris) ((t.c && (p[0] - t.c[0]) ** 2 + (p[1] - t.c[1]) ** 2 < t.c[2]) ? bad : keep).push(t);
    const ec = new Map();
    for (const t of bad) for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; ec.set(key, (ec.get(key) || 0) + 1); if (ec.get(key) === 1) ec.set('e' + key, [a, b]); }
    tris = keep;
    for (const [key, cnt] of ec) if (key[0] !== 'e' && cnt === 1) { const [a, b] = ec.get('e' + key); const c = circum(P[a], P[b], p); if (c) tris.push({v: [a, b, i], c}); }
  }
  const em = new Map(), edges = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; if (!em.has(key)) em.set(key, []); em.get(key).push(t.c); }
  for (const [, cs] of em) if (cs.length === 2) edges.push([[cs[0][0], cs[0][1]], [cs[1][0], cs[1][1]]]);
  return edges;
}
function poissonVar(bb, rfn, tries = 4000) { // variable-radius dart throwing (uses rand)
  const pts = [];
  for (let k = 0; k < tries; k++) {
    const p = [rnd(bb.x0, bb.x1), rnd(bb.y0, bb.y1)], r = rfn(p);
    let ok = true; for (const q of pts) if (dist(p, q) < min(r, q[2])) { ok = false; break; }
    if (ok) pts.push([p[0], p[1], r]);
  }
  return pts.map(p => [p[0], p[1]]);
}

// ============================================================ parts bin & archetypes
// Every slot is chosen independently. With probability `weird` a slot ignores the archetype
// and is drawn from the full parts bin, so beetles can grow moth antennae and butterfly wings.
const SLOTS = {
  head: ['round', 'wide', 'triangular', 'small', 'big', 'mantis', 'elongate', 'square', 'hidden'],
  eyes: ['small', 'medium', 'huge', 'stalked', 'holoptic', 'corner', 'tiny'],
  mouth: ['none', 'mandibles', 'stag', 'rostrum', 'proboscis', 'palps', 'tusks', 'sponge', 'beak'],
  horn: ['none', 'head', 'pronotum', 'both', 'trident', 'antlers', 'pair'],
  antenna: ['filiform', 'moniliform', 'clubbed', 'capitate', 'lamellate', 'pectinate', 'plumose', 'geniculate', 'setaceous', 'serrate', 'longhorn',
    'aristate', 'flabellate', 'whip', 'clavate', 'hooked'],
  pronotum: ['shield', 'collar', 'hairy', 'spiky', 'saddle', 'hood', 'neck', 'shoulders', 'leafy'],
  thorax: ['smooth', 'hairy', 'plated', 'long', 'humped', 'scutellum'],
  waist: ['none', 'petiole', 'node', 'stalk', 'beads'],
  abdomen: ['oval', 'teardrop', 'long', 'round', 'stick', 'flat', 'sinuous', 'swollen', 'cone'],
  forewing: ['elytra', 'scaled', 'net', 'membrane', 'none', 'tegmina', 'hemelytra', 'clear', 'leaf'],
  hindwing: ['scaled', 'tailed', 'net', 'membrane', 'none', 'fan', 'halteres', 'clear'],
  legs: ['walking', 'long', 'hairy', 'spiny', 'stick', 'leafy'],
  frontLegs: ['normal', 'raptorial', 'fossorial', 'long'],
  hindLegs: ['normal', 'jumping', 'paddle', 'long'],
  tail: ['none', 'stinger', 'ovipositor', 'cerci', 'forceps', 'scorpion', 'filaments', 'tuft'],
  texture: ['hatch', 'contour', 'cross', 'stipple', 'fur', 'glossy', 'scales', 'flow', 'rings', 'dots'],
  pattern: ['none', 'spots', 'stripes', 'bands', 'marbled', 'chevrons', 'checker', 'zigzag', 'ocelli'],
  wingPattern: ['none', 'eyespots', 'bands', 'border', 'patches', 'crosslines', 'tint', 'spots', 'stripes', 'windows', 'marbled', 'gradient'],
};
const N_ = ['normal'];
const ARCHETYPES = {
  beetle: {
    head: ['round', 'round', 'small', 'big', 'square'], eyes: ['small', 'small', 'medium'], mouth: ['mandibles', 'mandibles', 'mandibles', 'stag', 'tusks', 'none'],
    horn: ['none', 'none', 'none', 'none', 'head', 'pronotum', 'both', 'trident', 'antlers', 'pair'], antenna: ['filiform', 'capitate', 'lamellate', 'serrate', 'moniliform', 'longhorn', 'clavate', 'flabellate'],
    pronotum: ['shield', 'shield', 'shield', 'spiky', 'shoulders'], thorax: ['smooth'], waist: ['none'], abdomen: ['oval', 'oval', 'round'],
    forewing: ['elytra'], hindwing: ['none', 'none', 'none', 'none', 'membrane'], legs: ['walking', 'walking', 'long', 'spiny'], frontLegs: ['normal', 'normal', 'fossorial'], hindLegs: ['normal', 'normal', 'normal', 'paddle', 'jumping'], tail: ['none'],
    texture: ['contour', 'hatch', 'cross', 'stipple', 'glossy', 'dots', 'rings'], pattern: ['spots', 'spots', 'stripes', 'none', 'bands', 'marbled', 'chevrons', 'zigzag', 'checker'], wingPattern: ['none', 'tint'],
    palettes: ['ladybird', 'jewel', 'tropical', 'wasp', 'morpho', 'rust', 'neon', 'bronze', 'candy'],
  },
  weevil: {
    head: ['round', 'small'], eyes: ['small', 'tiny'], mouth: ['rostrum'], horn: ['none'], antenna: ['geniculate', 'clavate', 'capitate'], pronotum: ['shield', 'collar'],
    thorax: ['smooth'], waist: ['none'], abdomen: ['round', 'oval', 'swollen'], forewing: ['elytra'], hindwing: ['none'], legs: ['walking', 'spiny'], frontLegs: N_, hindLegs: N_, tail: ['none'],
    texture: ['dots', 'scales', 'stipple', 'glossy'], pattern: ['spots', 'stripes', 'checker', 'marbled', 'none'], wingPattern: ['none'], palettes: ['bronze', 'jewel', 'neon', 'candy', 'arctic'],
  },
  earwig: {
    head: ['round', 'square'], eyes: ['small'], mouth: ['mandibles', 'palps'], horn: ['none'], antenna: ['moniliform', 'filiform'], pronotum: ['collar', 'shield'], thorax: ['smooth'],
    waist: ['none'], abdomen: ['flat', 'long'], forewing: ['elytra'], hindwing: ['none'], legs: ['walking'], frontLegs: N_, hindLegs: N_, tail: ['forceps'],
    texture: ['glossy', 'contour', 'hatch'], pattern: ['none', 'bands'], wingPattern: ['none'], palettes: ['rust', 'bronze', 'moth', 'desert'],
  },
  butterfly: {
    head: ['round', 'small'], eyes: ['medium'], mouth: ['proboscis'], horn: ['none'], antenna: ['clubbed', 'clubbed', 'hooked'], pronotum: ['collar', 'hairy'], thorax: ['hairy'],
    waist: ['none'], abdomen: ['long', 'teardrop'], forewing: ['scaled'], hindwing: ['scaled', 'tailed'], legs: ['walking'], frontLegs: N_, hindLegs: N_, tail: ['none'],
    texture: ['fur', 'contour'], pattern: ['none', 'bands'], wingPattern: ['eyespots', 'bands', 'border', 'patches', 'spots', 'stripes', 'windows', 'gradient'],
    palettes: ['monarch', 'morpho', 'tropical', 'orchid', 'ladybird', 'sunset', 'candy', 'ocean'],
  },
  moth: {
    head: ['round', 'small'], eyes: ['medium'], mouth: ['none', 'proboscis', 'palps'], horn: ['none'], antenna: ['pectinate', 'plumose', 'plumose', 'filiform', 'flabellate'], pronotum: ['hairy'],
    thorax: ['hairy'], waist: ['none'], abdomen: ['teardrop', 'oval'], forewing: ['scaled'], hindwing: ['scaled', 'scaled', 'tailed'], legs: ['hairy', 'walking'], frontLegs: N_, hindLegs: N_, tail: ['none', 'tuft'],
    texture: ['fur', 'fur', 'scales'], pattern: ['none', 'bands'], wingPattern: ['crosslines', 'crosslines', 'bands', 'eyespots', 'border', 'marbled', 'gradient'],
    palettes: ['moth', 'moth', 'orchid', 'rust', 'monarch', 'plum', 'desert', 'arctic'],
  },
  dragonfly: {
    head: ['wide'], eyes: ['huge', 'holoptic'], mouth: ['none'], horn: ['none'], antenna: ['setaceous'], pronotum: ['collar'], thorax: ['plated', 'smooth'], waist: ['none'],
    abdomen: ['long'], forewing: ['net'], hindwing: ['net'], legs: ['walking', 'spiny'], frontLegs: N_, hindLegs: N_, tail: ['cerci', 'none'], texture: ['hatch', 'cross', 'contour', 'rings'],
    pattern: ['bands', 'spots', 'none', 'chevrons'], wingPattern: ['none', 'none', 'tint', 'spots', 'gradient'], palettes: ['dragonfly', 'jewel', 'tropical', 'rust', 'ocean', 'neon'],
  },
  lacewing: {
    head: ['small', 'round'], eyes: ['medium', 'stalked'], mouth: ['mandibles', 'none'], horn: ['none'], antenna: ['filiform', 'moniliform', 'whip'], pronotum: ['collar'],
    thorax: ['smooth'], waist: ['none'], abdomen: ['long', 'oval'], forewing: ['net'], hindwing: ['net'], legs: ['walking', 'long'], frontLegs: N_, hindLegs: N_, tail: ['none', 'cerci'],
    texture: ['contour', 'hatch'], pattern: ['none', 'stripes'], wingPattern: ['none', 'tint', 'spots', 'marbled'], palettes: ['lacewing', 'lacewing', 'jewel', 'orchid', 'forest'],
  },
  mayfly: {
    head: ['small', 'round'], eyes: ['huge', 'medium', 'holoptic'], mouth: ['none'], horn: ['none'], antenna: ['setaceous', 'aristate'], pronotum: ['collar'], thorax: ['smooth', 'humped'],
    waist: ['none'], abdomen: ['long', 'stick'], forewing: ['net', 'clear'], hindwing: ['none', 'net'], legs: ['long', 'walking'], frontLegs: ['long', 'normal'], hindLegs: N_, tail: ['filaments'],
    texture: ['contour', 'hatch', 'rings'], pattern: ['bands', 'chevrons', 'none'], wingPattern: ['none', 'spots', 'tint', 'marbled'], palettes: ['arctic', 'ocean', 'desert', 'orchid'],
  },
  wasp: {
    head: ['triangular', 'round'], eyes: ['medium'], mouth: ['mandibles'], horn: ['none'], antenna: ['geniculate', 'filiform', 'clavate'], pronotum: ['collar'],
    thorax: ['smooth', 'plated'], waist: ['petiole', 'petiole', 'stalk'], abdomen: ['teardrop'], forewing: ['membrane'], hindwing: ['membrane'], legs: ['walking', 'long'], frontLegs: N_, hindLegs: N_,
    tail: ['stinger', 'ovipositor'], texture: ['hatch', 'contour', 'glossy'], pattern: ['bands', 'bands', 'spots', 'chevrons'], wingPattern: ['none', 'tint', 'gradient'],
    palettes: ['wasp', 'wasp', 'rust', 'jewel', 'sunset', 'neon'],
  },
  bee: {
    head: ['triangular', 'round'], eyes: ['medium'], mouth: ['mandibles'], horn: ['none'], antenna: ['geniculate'], pronotum: ['hairy'], thorax: ['hairy'],
    waist: ['none'], abdomen: ['round', 'oval'], forewing: ['membrane'], hindwing: ['membrane'], legs: ['hairy'], frontLegs: N_, hindLegs: N_, tail: ['stinger', 'none'],
    texture: ['fur'], pattern: ['bands'], wingPattern: ['none', 'tint'], palettes: ['wasp', 'wasp', 'rust', 'orchid', 'sunset', 'berry'],
  },
  ant: {
    head: ['big', 'round', 'square'], eyes: ['small', 'tiny'], mouth: ['mandibles', 'stag', 'tusks'], horn: ['none'], antenna: ['geniculate'], pronotum: ['collar'], thorax: ['smooth'],
    waist: ['node', 'beads'], abdomen: ['round', 'oval', 'swollen'], forewing: ['none', 'none', 'membrane'], hindwing: ['none', 'none', 'membrane'], legs: ['long', 'walking'], frontLegs: N_, hindLegs: N_,
    tail: ['none', 'stinger'], texture: ['contour', 'hatch', 'stipple', 'glossy', 'dots'], pattern: ['none', 'none', 'bands'], wingPattern: ['none'],
    palettes: ['rust', 'wasp', 'ladybird', 'moth', 'bronze'],
  },
  mantis: {
    head: ['mantis'], eyes: ['corner'], mouth: ['palps', 'mandibles'], horn: ['none', 'none', 'pair'], antenna: ['filiform', 'whip'], pronotum: ['neck'], thorax: ['smooth'], waist: ['none'],
    abdomen: ['oval', 'long', 'flat'], forewing: ['tegmina', 'leaf'], hindwing: ['fan', 'fan', 'none'], legs: ['walking', 'long', 'leafy'], frontLegs: ['raptorial'], hindLegs: ['normal', 'long'],
    tail: ['cerci', 'none'], texture: ['contour', 'hatch', 'flow'], pattern: ['none', 'stripes', 'ocelli'], wingPattern: ['none', 'eyespots', 'tint', 'marbled', 'bands'],
    palettes: ['forest', 'lacewing', 'orchid', 'desert', 'candy'],
  },
  stick: {
    head: ['elongate'], eyes: ['small', 'tiny'], mouth: ['none', 'mandibles', 'palps'], horn: ['none', 'pair'], antenna: ['whip', 'filiform', 'moniliform'], pronotum: ['collar', 'neck'],
    thorax: ['long'], waist: ['none'], abdomen: ['stick'], forewing: ['none', 'none', 'tegmina'], hindwing: ['none', 'none', 'fan'], legs: ['stick', 'stick', 'leafy', 'spiny'], frontLegs: ['normal', 'long'], hindLegs: ['normal', 'long'],
    tail: ['cerci', 'none'], texture: ['contour', 'hatch', 'dots', 'rings'], pattern: ['none', 'stripes', 'bands'], wingPattern: ['none', 'tint', 'bands'],
    palettes: ['forest', 'desert', 'moth', 'bronze'],
  },
  grasshopper: {
    head: ['elongate', 'round'], eyes: ['medium', 'corner'], mouth: ['mandibles', 'palps'], horn: ['none'], antenna: ['filiform', 'whip', 'clavate'], pronotum: ['saddle'], thorax: ['smooth'],
    waist: ['none'], abdomen: ['long', 'oval'], forewing: ['tegmina'], hindwing: ['fan', 'none'], legs: ['walking', 'spiny'], frontLegs: N_, hindLegs: ['jumping'],
    tail: ['none', 'cerci', 'ovipositor'], texture: ['hatch', 'contour', 'flow', 'dots'], pattern: ['stripes', 'chevrons', 'bands', 'zigzag', 'none'], wingPattern: ['bands', 'spots', 'marbled', 'tint'],
    palettes: ['forest', 'desert', 'moth', 'sunset', 'lacewing'],
  },
  cicada: {
    head: ['wide'], eyes: ['corner', 'medium'], mouth: ['beak', 'none'], horn: ['none'], antenna: ['setaceous', 'aristate'], pronotum: ['shield', 'shoulders'], thorax: ['humped'],
    waist: ['none'], abdomen: ['cone', 'teardrop'], forewing: ['clear'], hindwing: ['clear'], legs: ['walking', 'spiny'], frontLegs: ['normal', 'fossorial'], hindLegs: N_, tail: ['none', 'stinger'],
    texture: ['hatch', 'cross', 'contour', 'scales'], pattern: ['none', 'bands', 'chevrons'], wingPattern: ['none', 'tint', 'spots', 'stripes'], palettes: ['forest', 'bronze', 'arctic', 'jewel'],
  },
  shieldbug: {
    head: ['triangular', 'small'], eyes: ['small'], mouth: ['beak'], horn: ['none'], antenna: ['filiform', 'moniliform', 'clavate'], pronotum: ['shoulders'], thorax: ['scutellum'],
    waist: ['none'], abdomen: ['flat', 'oval'], forewing: ['hemelytra'], hindwing: ['none', 'membrane'], legs: ['walking', 'spiny'], frontLegs: N_, hindLegs: N_, tail: ['none'],
    texture: ['dots', 'stipple', 'hatch', 'cross'], pattern: ['spots', 'zigzag', 'checker', 'chevrons', 'stripes', 'bands'], wingPattern: ['none', 'tint'],
    palettes: ['ladybird', 'jewel', 'neon', 'candy', 'forest'],
  },
  fly: {
    head: ['round', 'wide'], eyes: ['holoptic', 'huge', 'stalked'], mouth: ['sponge', 'beak'], horn: ['none'], antenna: ['aristate'], pronotum: ['collar', 'hairy'], thorax: ['hairy', 'smooth', 'plated'],
    waist: ['none'], abdomen: ['oval', 'round', 'cone', 'teardrop'], forewing: ['membrane', 'clear'], hindwing: ['halteres'], legs: ['hairy', 'spiny', 'walking', 'long'], frontLegs: N_, hindLegs: ['normal', 'long'],
    tail: ['none', 'ovipositor', 'stinger'], texture: ['fur', 'glossy', 'hatch'], pattern: ['bands', 'none', 'checker', 'chevrons'], wingPattern: ['none', 'spots', 'tint', 'bands'],
    palettes: ['ocean', 'jewel', 'neon', 'bronze'],
  },
  cockroach: {
    head: ['hidden', 'round'], eyes: ['medium', 'small'], mouth: ['palps', 'mandibles'], horn: ['none'], antenna: ['whip'], pronotum: ['hood'], thorax: ['smooth'], waist: ['none'],
    abdomen: ['flat'], forewing: ['tegmina'], hindwing: ['none', 'fan'], legs: ['spiny', 'walking'], frontLegs: N_, hindLegs: ['normal', 'long'], tail: ['cerci'],
    texture: ['glossy', 'contour', 'hatch', 'rings'], pattern: ['none', 'marbled', 'bands'], wingPattern: ['none', 'tint', 'marbled'], palettes: ['bronze', 'desert', 'moth', 'rust'],
  },
};
const ARCH_WEIGHTS = {beetle: 2.5, weevil: 1, earwig: 0.8, butterfly: 2, moth: 2, dragonfly: 1.5, lacewing: 1, mayfly: 1, wasp: 1.5, bee: 1, ant: 1.2,
  mantis: 1.3, stick: 1, grasshopper: 1.3, cicada: 1.2, shieldbug: 1.2, fly: 1.2, cockroach: 1};

// colour pens (plus black, which is always pen 0)
const PALETTES = {
  ladybird: [['#d62828', 'red'], ['#f77f00', 'orange'], ['#fcbf49', 'yellow']],
  jewel: [['#2a9d8f', 'teal'], ['#1d4e89', 'blue'], ['#8ab17d', 'sage']],
  monarch: [['#f3722c', 'orange'], ['#90323d', 'maroon'], ['#f9c74f', 'gold']],
  morpho: [['#277da1', 'blue'], ['#4cc9f0', 'sky'], ['#7209b7', 'violet']],
  moth: [['#a47148', 'umber'], ['#c9a66b', 'tan'], ['#6b705c', 'olive']],
  dragonfly: [['#0077b6', 'blue'], ['#00b4d8', 'cyan'], ['#e63946', 'red']],
  lacewing: [['#55a630', 'green'], ['#aacc00', 'lime'], ['#d4a373', 'sand']],
  wasp: [['#ffb703', 'yellow'], ['#fb8500', 'orange'], ['#8d5524', 'brown']],
  orchid: [['#e5989b', 'pink'], ['#b5838d', 'mauve'], ['#6d6875', 'grey']],
  tropical: [['#06d6a0', 'green'], ['#ef476f', 'pink'], ['#118ab2', 'blue']],
  rust: [['#bc4b51', 'brick'], ['#f4a259', 'apricot'], ['#5b8e7d', 'green']],
  sunset: [['#f94144', 'scarlet'], ['#f8961e', 'tangerine'], ['#577590', 'slate']],
  ocean: [['#023e8a', 'navy'], ['#48cae4', 'aqua'], ['#90be6d', 'kelp']],
  forest: [['#2d6a4f', 'pine'], ['#95d5b2', 'mint'], ['#bc6c25', 'bark']],
  neon: [['#ff006e', 'magenta'], ['#3a86ff', 'azure'], ['#8338ec', 'purple']],
  bronze: [['#9c6644', 'bronze'], ['#386641', 'moss'], ['#d4a017', 'brass']],
  plum: [['#6a4c93', 'plum'], ['#c08497', 'rose'], ['#7f9172', 'sage']],
  candy: [['#ff8fab', 'bubblegum'], ['#7bdff2', 'ice'], ['#ffd166', 'lemon']],
  arctic: [['#457b9d', 'steel'], ['#a8dadc', 'frost'], ['#e76f51', 'coral']],
  desert: [['#c08552', 'ochre'], ['#895737', 'sienna'], ['#5e6472', 'shale']],
  berry: [['#9d0208', 'crimson'], ['#3c096c', 'indigo'], ['#f48c06', 'amber']],
};

function slotPick(arch, slot, weird) { return chance(weird) ? choice(SLOTS[slot]) : choice(ARCHETYPES[arch][slot]); }

function genParams(opt = {}) {
  const P = {};
  P.arch = opt.arch && ARCHETYPES[opt.arch] ? opt.arch : choice(Object.keys(ARCH_WEIGHTS), Object.values(ARCH_WEIGHTS));
  P.weird = opt.weird != null ? clamp(+opt.weird, 0, 1) : (chance(0.35) ? rndtri(0, 0.05, 0.2) : rndtri(0.1, 0.35, 1));
  for (const s of Object.keys(SLOTS)) P[s] = slotPick(P.arch, s, P.weird);
  const foldable = ['tegmina', 'hemelytra', 'leaf'];
  // a few anatomical guard rails (everything else may combine freely)
  if (P.forewing === 'elytra' && P.hindwing === 'net') P.hindwing = choice(['membrane', 'fan']);
  if (P.abdomen === 'sinuous' && (P.forewing === 'elytra' || foldable.includes(P.forewing))) P.abdomen = 'long';
  if (P.pronotum === 'neck' && P.thorax === 'long') P.thorax = 'smooth';
  P.ocelli = chance(['cicada', 'fly', 'wasp', 'bee', 'mayfly'].includes(P.arch) ? 0.7 : 0.12);

  // ---------- body dimensions (nominal body length ~100 units)
  const H = {round: [rnd(9, 13), rnd(7, 10)], wide: [rnd(7, 10), rnd(11, 14)], triangular: [rnd(9, 12), rnd(9, 12)], small: [rnd(6, 8), rnd(5, 7.5)], big: [rnd(14, 19), rnd(9, 13)],
    mantis: [rnd(8, 11), rnd(10, 14)], elongate: [rnd(13, 20), rnd(4, 6.5)], square: [rnd(10, 14), rnd(8, 11)], hidden: [rnd(7, 10), rnd(6, 8.5)]}[P.head];
  P.H = {l: H[0], w: H[1]};
  P.E = {r: {small: P.H.w * rnd(0.22, 0.32), medium: P.H.w * rnd(0.32, 0.45), huge: P.H.w * rnd(0.55, 0.68), stalked: P.H.w * rnd(0.25, 0.38), holoptic: P.H.w * rnd(0.5, 0.6),
    corner: P.H.w * rnd(0.26, 0.38), tiny: P.H.w * rnd(0.12, 0.18)}[P.eyes], stalk: rnd(1.2, 2.6), stalkAng: rnd(-25, 10) * D2R};
  P.T = {l: rnd(12, 20), w: rnd(8, 13)};
  if (P.thorax === 'hairy') P.T.w *= 1.15;
  if (P.thorax === 'long') { P.T.l = rnd(35, 60); P.T.w = rnd(3, 5); }
  if (P.thorax === 'humped') { P.T.w *= 1.2; P.T.l *= 1.1; }
  const AB = {oval: [rnd(30, 42), rnd(11, 16)], teardrop: [rnd(26, 38), rnd(9, 13)], long: [rnd(55, 80), rnd(3.2, 5.5)], round: [rnd(22, 32), rnd(12, 17)],
    stick: [rnd(70, 110), rnd(2, 3.4)], flat: [rnd(30, 45), rnd(14, 20)], sinuous: [rnd(40, 62), rnd(4, 7)], swollen: [rnd(34, 48), rnd(17, 25)], cone: [rnd(26, 38), rnd(12, 17)]}[P.abdomen];
  P.A = {l: AB[0], w: AB[1], segs: ['long', 'stick', 'sinuous'].includes(P.abdomen) ? rint(8, 10) : P.abdomen === 'flat' ? rint(7, 9) : rint(5, 7), bend: rnd(5, 14) * choice([-1, 1]), bendK: rnd(0.7, 1.6)};
  if (P.thorax === 'long' && P.abdomen !== 'stick') P.A.w = min(P.A.w, rnd(4, 7));
  P.W = {l: {petiole: rnd(6, 14), stalk: rnd(14, 24), node: rnd(6, 10), beads: rnd(8, 12), none: 0}[P.waist], w: P.waist === 'stalk' ? rnd(0.7, 1.0) : rnd(1.1, 2), nodes: P.waist === 'beads' ? rint(3, 4) : rint(1, 2)};
  const PR = {
    shield: {l: rnd(12, 20), wf: P.H.w * rnd(1.0, 1.3)},
    spiky: {l: rnd(12, 18), wf: P.H.w * rnd(1.0, 1.25), spike: rnd(4, 9)},
    collar: {l: rnd(3, 5.5), wf: P.H.w * rnd(0.55, 0.8)},
    hairy: {l: rnd(5, 8), wf: P.H.w * rnd(0.8, 1.05)},
    saddle: {l: rnd(14, 22), wf: P.H.w * rnd(0.9, 1.15)},
    hood: {l: rnd(13, 19), wf: P.H.w * rnd(1.6, 2.2)},
    neck: {l: rnd(20, 38), wf: rnd(2.2, 3.5)},
    shoulders: {l: rnd(10, 15), wf: P.H.w * rnd(0.85, 1.1), spike: rnd(0, 6)},
    leafy: {l: rnd(10, 16), wf: P.H.w * rnd(0.9, 1.2), wave: rnd(0.5, 1.5)},
  }[P.pronotum];
  P.PR = PR;
  P.ely = {open: false, angle: rnd(18, 38) * D2R, tipPow: rnd(2, 3.5), striae: rint(3, 6), bulge: rnd(0, 0.12),
    cover: (P.arch === 'earwig' || chance(0.08 + P.weird * 0.15)) ? rnd(0.3, 0.5) : rnd(1.0, 1.05)};
  if (P.forewing === 'elytra') {
    P.ely.W = max(P.A.w, P.T.w) * rnd(1.02, 1.2);
    P.ely.open = P.hindwing !== 'none' && P.hindwing !== 'halteres' ? true : chance(0.06);
    if (!P.ely.open && P.ely.cover > 0.9) P.A.w = min(P.A.w, P.ely.W * 0.78); // closed elytra must hide the abdomen
  }
  PR.wb = {
    hood: PR.wf * rnd(0.95, 1.1), neck: PR.wf * rnd(0.9, 1.2), shoulders: max(P.A.w, P.T.w) * rnd(1.15, 1.45),
    saddle: P.T.w * rnd(1.0, 1.2),
  }[P.pronotum] || ((PR.l > 8) ? (P.forewing === 'elytra' ? P.ely.W * rnd(0.8, 1.0) : P.T.w * rnd(1.0, 1.25)) : P.T.w * rnd(0.6, 0.85));

  // ---------- head furniture
  P.M = {
    mandibles: {len: rnd(4, 9), w: rnd(1.0, 1.8)}, stag: {len: rnd(16, 32), w: rnd(1.8, 3.2), teeth: rint(1, 4)},
    rostrum: {len: rnd(10, 24), w: P.H.w * rnd(0.22, 0.32)}, proboscis: {r: rnd(2.5, 5), turns: rnd(1.8, 3)}, none: {},
    palps: {len: rnd(6, 12), w: rnd(0.6, 1.0), a: rnd(-50, -20) * D2R}, tusks: {len: rnd(8, 16), w: rnd(1.2, 2.0), splay: rnd(-6, 8) * D2R},
    sponge: {len: rnd(2.5, 5), r: rnd(1.4, 2.4)}, beak: {len: rnd(8, 20), w: rnd(0.6, 1.0), curve: rnd(-0.3, 0.3)},
  }[P.mouth];
  P.HO = {lenH: rnd(10, 28), lenP: rnd(14, 32), w: rnd(1.6, 3.2), fork: chance(0.35), curl: rnd(-0.4, 0.4), branches: rint(1, 3), splay: rnd(15, 40) * D2R};
  const ALEN = {filiform: [25, 50], moniliform: [18, 32], clubbed: [30, 48], capitate: [14, 24], lamellate: [9, 15], pectinate: [18, 30], plumose: [18, 28],
    geniculate: [24, 38], setaceous: [4, 8], serrate: [20, 34], longhorn: [65, 105], aristate: [5, 9], flabellate: [14, 26], whip: [70, 130], clavate: [16, 30], hooked: [26, 42]};
  const antP = (type, a0r = [-100, -55]) => {
    const A = {len: rnd(...ALEN[type]), a0: rnd(...a0r) * D2R, bend: rnd(-15, 40) * D2R, segs: rint(9, 14), w: rnd(0.55, 1.0), elbow: rnd(55, 95) * D2R, wave: chance(0.3) ? rnd(0.05, 0.2) : 0};
    if (type === 'longhorn') { A.a0 = rnd(-85, -55) * D2R; A.bend = rnd(70, 140) * D2R; A.segs = rint(9, 11); }
    if (type === 'whip') { A.a0 = rnd(-95, -60) * D2R; A.bend = rnd(30, 120) * D2R; }
    if (type === 'clubbed' || type === 'hooked') A.bend = rnd(-5, 15) * D2R;
    if (type === 'aristate') A.a0 = rnd(-70, -20) * D2R;
    return A;
  };
  P.AN = antP(P.antenna);

  // ---------- legs, tail
  P.L = {type: P.legs, k: {long: rnd(1.5, 2.0), walking: rnd(0.85, 1.1), hairy: rnd(0.85, 1.05), spiny: rnd(0.95, 1.2), stick: rnd(1.8, 2.4), leafy: rnd(0.9, 1.2)}[P.legs],
    thick: P.legs === 'stick' ? rnd(0.45, 0.65) : rnd(0.8, 1.3), tars: rint(3, 5),
    pose: [
      {fem: rnd(-60, -30), tib: rnd(-55, -15), tar: rnd(-20, 10)},
      {fem: rnd(-15, 20), tib: rnd(25, 55), tar: rnd(0, 25)},
      {fem: rnd(25, 50), tib: rnd(20, 45), tar: rnd(0, 20)},
      {fem: rnd(50, 70), tib: rnd(15, 35), tar: rnd(0, 15)},
    ]};
  P.TL = {len: {stinger: rnd(3, 6), ovipositor: rnd(30, 110), cerci: rnd(6, 45), forceps: rnd(8, 18), scorpion: rnd(6, 10), filaments: rnd(40, 90), tuft: rnd(4, 8), none: 0}[P.tail],
    spread: rnd(10, 35) * D2R, three: chance(0.4)};

  // ---------- wings
  const wing = (type, fore) => {
    const W = {type};
    if (type === 'scaled' || type === 'tailed') {
      W.S = fore ? rnd(55, 85) : rnd(42, 62); W.C = W.S * (fore ? rnd(0.5, 0.66) : rnd(0.78, 1.0));
      W.theta = (fore ? rnd(-32, -12) : rnd(8, 30)) * D2R; W.scallop = chance(0.4) ? rnd(0.6, 1.6) : 0; W.k = rint(7, 13);
      W.shape = fore ? choice(['classic', 'classic', 'falcate', 'triangular', 'narrow', 'round']) : choice(['classic', 'classic', 'round', 'narrow']);
      if (W.shape === 'narrow') W.C *= 0.7;
    } else if (type === 'net') {
      W.S = rnd(52, 72); W.lace = P.arch === 'lacewing' ? chance(0.85) : chance(0.2);
      W.C = W.S * (W.lace ? rnd(0.33, 0.42) : rnd(0.19, 0.25)); W.stalk = !W.lace && chance(0.2);
      W.theta = (fore ? rnd(-14, 0) : rnd(2, 18)) * D2R; W.broad = fore ? 0 : rnd(0.2, 0.7);
      if (P.arch === 'mayfly' && !fore) { W.S *= 0.35; W.C = W.S * 0.5; }
      if (P.arch === 'mayfly' && fore) { W.C = W.S * rnd(0.32, 0.4); W.lace = false; W.broad = rnd(0.3, 0.6); }
    } else if (type === 'membrane') {
      W.S = fore ? rnd(36, 55) : rnd(26, 38); W.C = W.S * rnd(0.3, 0.38);
      W.theta = (fore ? rnd(-12, 18) : rnd(18, 38)) * D2R; W.cells = fore ? rint(6, 10) : rint(3, 5);
    } else if (type === 'clear') {
      W.S = fore ? rnd(55, 80) : rnd(32, 46); W.C = W.S * (fore ? rnd(0.28, 0.34) : rnd(0.38, 0.46));
      W.theta = (fore ? rnd(-14, 4) : rnd(14, 30)) * D2R; W.veins = rint(6, 8);
    } else if (type === 'tegmina' || type === 'hemelytra' || type === 'leaf') {
      W.S = type === 'leaf' ? rnd(45, 70) : rnd(40, 62); W.C = W.S * {tegmina: rnd(0.26, 0.34), hemelytra: rnd(0.36, 0.42), leaf: rnd(0.38, 0.48)}[type];
      W.theta = (fore ? rnd(-20, 0) : rnd(10, 30)) * D2R;
      W.fold = fore && (P.hindwing === 'none' || P.hindwing === 'halteres' || chance(0.35));
      W.foldLen = type === 'hemelytra' ? rnd(0.95, 1.08) : rnd(0.95, 1.2); W.foldW = rnd(1.3, 1.8);
      W.foldAng = (type === 'hemelytra' ? rnd(8, 14) : rnd(2, 8)) * D2R;
    } else if (type === 'fan') {
      W.S = rnd(45, 72); W.theta = rnd(0, 28) * D2R; W.pleats = rint(12, 20); W.band = chance(0.6);
    } else if (type === 'halteres') {
      W.S = rnd(4, 7); W.theta = rnd(30, 60) * D2R;
    }
    return W;
  };
  P.FW = P.forewing === 'elytra' || P.forewing === 'none' ? {type: P.forewing} : wing(P.forewing, true);
  P.HW = P.hindwing === 'none' ? {type: 'none'} : wing(P.hindwing, false);
  if (P.HW.S && P.FW.S && P.HW.type !== P.FW.type && P.HW.type !== 'fan' && P.HW.type !== 'halteres') P.HW.S = min(P.HW.S, P.FW.S * rnd(0.8, 1.1));

  // ---------- surreal mutations
  P.mut = {
    extraLegs: chance(P.weird * 0.18), extraEyes: chance(P.weird * 0.2), extraWings: chance(P.weird * 0.15) && !!P.HW.S && P.HW.type !== 'halteres',
    twinAntennae: chance(P.weird * 0.15),
  };
  if (P.mut.twinAntennae) { P.antenna2 = choice(SLOTS.antenna.filter(a => a !== P.antenna)); P.AN2 = antP(P.antenna2, [-40, -10]); P.AN2.len = min(P.AN2.len, 45); }

  // ---------- per-part textures (weird insects may mix several surfaces)
  P.tex = {};
  for (const k of ['head', 'pron', 'thor', 'abd', 'ely']) P.tex[k] = chance(P.weird * 0.45) ? choice(SLOTS.texture) : P.texture;

  // ---------- colour
  const npens = opt.pens ? clamp(+opt.pens, 1, 3) : choice([2, 3, 3]);
  let pal;
  if (opt.palette && PALETTES[opt.palette]) pal = PALETTES[opt.palette];
  else if (chance(P.weird * 0.4)) { const all = Object.values(PALETTES).flat(); pal = []; while (pal.length < 3) { const c = choice(all); if (!pal.includes(c)) pal.push(c); } }
  else pal = PALETTES[chance(P.weird) ? choice(Object.keys(PALETTES)) : choice(ARCHETYPES[P.arch].palettes)];
  P.colors = [['#1a1a1a', 'black'], ...pal.slice(0, npens)];
  const c = i => 1 + ((i - 1) % npens), anyPen = () => choice([0, c(1), c(2), c(3)]);
  P.pen = {
    body: choice([c(1), c(1), c(2), 0]), accent: c(2), wing: c(choice([1, 1, 2, 3])), wing2: c(choice([2, 3])), eye: anyPen(),
    leg: choice([0, 0, c(1), c(2)]), ant: choice([0, 0, c(2)]),
  };
  if (P.pen.wing === P.pen.wing2) P.pen.wing2 = npens > 1 ? c(P.pen.wing + 1) : 0;
  if (P.pen.body === P.pen.accent) P.pen.accent = 0;
  P.pen.part = {};
  for (const k of ['head', 'pron', 'thor', 'abd', 'ely']) P.pen.part[k] = chance(P.weird * 0.35) ? anyPen() : P.pen.body;
  return P;
}

// ============================================================ names
function binomen() {
  const g0 = ['Cara', 'Dyti', 'Lepto', 'Chryso', 'Melo', 'Pyro', 'Xylo', 'Antho', 'Calo', 'Cteno', 'Dory', 'Gono', 'Lyco', 'Necro', 'Odo', 'Platy', 'Rhyn', 'Sphe', 'Theri',
    'Zygo', 'Agri', 'Cicin', 'Luca', 'Scara', 'Ceto', 'Papi', 'Dana', 'Morpho', 'Satu', 'Noctu', 'Aesh', 'Libel', 'Vespu', 'Poli', 'Bombo', 'Myrme', 'Formi', 'Acro', 'Helio', 'Ortho', 'Pseudo', 'Micro', 'Mega', 'Ptero',
    'Manti', 'Phasma', 'Cicada', 'Penta', 'Musca', 'Blatta', 'Ephe', 'Curcu', 'Forfi', 'Locu', 'Tetti', 'Empu', 'Phyllo', 'Diapo', 'Syrphi'];
  const g1 = ['', '', '', 'ce', 'phi', 'no', 'to', 'lo', 'mo', 'ri', 'di', 'ta', 'sto', 'gna'];
  const g2 = ['us', 'a', 'ella', 'ides', 'ops', 'ia', 'ra', 'is', 'ptera', 'phila', 'cera', 'gaster', 'myia', 'odes', 'ion', 'ax', 'tes', 'mera', 'soma'];
  const s0 = ['auro', 'nigro', 'flavi', 'rubro', 'macul', 'sex', 'quadri', 'viri', 'fusc', 'punct', 'longi', 'orn', 'splend', 'gigant', 'cyane', 'stell', 'margin', 'versi', 'tri', 'albo', 'mira', 'somni', 'nebul', 'umbr',
    'folii', 'spini', 'cornu', 'pecti', 'zebr', 'lune', 'crist'];
  const s1 = ['ata', 'atus', 'ensis', 'ii', 'ipes', 'icornis', 'ipennis', 'ella', 'osa', 'ina', 'ulata', 'ica', 'alis', 'oides', 'ifera', 'ifolia', 'iformis'];
  return choice(g0) + choice(g1) + choice(g2) + ' ' + choice(s0) + choice(s1);
}

// ============================================================ body layout (dorsal view, head at top, midline x=0)
function headWfn(P) {
  const w = P.H.w;
  return {
    round: t => w * pow(sin(PI * t), 0.55), small: t => w * pow(sin(PI * t), 0.55), hidden: t => w * pow(sin(PI * t), 0.55), wide: t => w * pow(sin(PI * t), 0.35),
    triangular: t => w * pow(sin(PI * t), 0.5) * lerp(0.55, 1, smooth(0, 0.75, t)), big: t => w * pow(sin(PI * t), 0.3) * (0.88 + 0.12 * t),
    mantis: t => { if (t < 0.82) return w * (0.18 + 0.82 * pow(t / 0.82, 0.75)); const q = (t - 0.82) / 0.18; return w * sqrt(max(0, 1 - q * q)); },
    elongate: t => w * pow(sin(PI * t), 0.45), square: t => w * pow(sin(PI * t), 0.16),
  }[P.head];
}
function pronWfn(P) {
  const {wf, wb} = P.PR;
  return {
    shield: t => lerp(wf, wb, pow(t, 0.8)) * (1 - 0.22 * pow(abs(2 * t - 1), 5)), spiky: t => lerp(wf, wb, pow(t, 0.8)) * (1 - 0.22 * pow(abs(2 * t - 1), 5)),
    collar: t => lerp(wf, wb, t) * pow(sin(PI * (0.1 + 0.8 * t)), 0.3), hairy: t => lerp(wf, wb, t) * pow(sin(PI * (0.05 + 0.9 * t)), 0.5),
    saddle: t => lerp(wf, wb, pow(t, 0.6)) * (1 - 0.12 * pow(abs(2 * t - 1), 4)),
    hood: t => max(wf, wb) * pow(sin(PI * (0.03 + 0.94 * t)), 0.5) * (0.88 + 0.12 * t),
    neck: t => lerp(wf * 0.75, wb, t) * (1 + 0.55 * exp(-(((t - 0.13) / 0.09) ** 2))),
    shoulders: t => { const b = lerp(wf, wb, pow(t, 0.65)); return t > 0.8 ? b * lerp(1, 0.78, (t - 0.8) / 0.2) : b; },
    leafy: t => lerp(wf, wb, t) * (1 + 0.4 * sin(PI * t)) + P.PR.wave * sin(t * PI * 7) * sin(PI * t),
  }[P.pronotum];
}
function abdWfn(P) {
  const w = P.A.w, n = P.A.segs;
  return {
    oval: t => w * pow(sin(PI * t), 0.6), teardrop: t => w * pow(sin(PI * pow(t, 0.6)), 0.75), round: t => w * pow(sin(PI * t), 0.45),
    long: t => w * (0.72 + 0.4 * exp(-(((t - 0.06) / 0.07) ** 2)) + 0.18 * exp(-(((t - 0.93) / 0.08) ** 2))) * pow(sin(PI * (0.02 + 0.96 * t)), 0.25),
    stick: t => w * (0.9 + 0.1 * sin(PI * t)) * pow(sin(PI * (0.01 + 0.98 * t)), 0.15),
    flat: t => w * pow(sin(PI * t), 0.5) * (1 - 0.07 * ((t * n) % 1)),
    sinuous: t => w * (0.8 + 0.35 * exp(-(((t - 0.05) / 0.1) ** 2))) * pow(sin(PI * (0.02 + 0.96 * t)), 0.3),
    swollen: t => w * pow(sin(PI * t), 0.42),
    cone: t => w * pow(sin(PI * 0.5 * min(1, (t + 0.06) / 0.2)), 0.6) * pow(1 - t, 0.7),
  }[P.abdomen];
}
const SHIELDISH = ['shield', 'spiky', 'hood', 'shoulders'];
function layout(P) {
  const B = {};
  B.head = {y0: 0, l: P.H.l, w: P.H.w, wfn: headWfn(P)};
  let tuck = 0.82;
  if (P.head === 'small' && P.PR.l > 8) tuck = 0.45;
  if (P.head === 'hidden') tuck = 0.3;
  if (P.pronotum === 'hood') tuck = 0.22;
  let y = P.H.l * tuck;
  B.pron = {y0: y, l: P.PR.l, wfn: pronWfn(P)}; y += P.PR.l * 0.9;
  B.thor = {y0: y, l: P.T.l, w: P.T.w, wfn: t => P.T.w * pow(sin(PI * (0.06 + 0.88 * t)), P.thorax === 'long' ? 0.12 : 0.45)}; y += P.T.l * 0.88;
  if (P.waist !== 'none') { B.waist = {y0: y, l: P.W.l}; y += P.W.l * 0.92; }
  B.abd = {y0: y, l: P.A.l, w: P.A.w, wfn: abdWfn(P)};
  B.len = y + P.A.l;
  if (P.forewing === 'elytra') B.ely = {y0: B.thor.y0 - 0.6, l: (B.len - B.thor.y0) * P.ely.cover, W: P.ely.W};
  const h = B.head;
  B.antAnchor = [h.wfn(0.15) * 0.75, h.y0 + h.l * 0.13];
  // sinuous abdomen: a smooth sideways shear applied to the abdomen and everything attached behind it
  const A = B.abd;
  B.bendPt = P.abdomen === 'sinuous'
    ? p => { const t = (p[1] - A.y0) / A.l; return t <= 0 ? p : [p[0] + P.A.bend * sin(PI * P.A.bendK * t) * t, p[1]]; }
    : p => p;
  return B;
}
const bendPart = (B, pt) => ({strokes: pt.strokes.map(s => St(s.pts.map(B.bendPt), s.pen)), sils: pt.sils.map(q => q.map(B.bendPt))});

// ============================================================ surface patterns
function makePattern(P, B) {
  const acc = P.pen.accent, pp = P.pen.part;
  let mk = base => () => base;
  const sym = x => abs(x);
  if (P.pattern === 'spots' || P.pattern === 'ocelli') {
    const oc = P.pattern === 'ocelli', r0 = oc ? rnd(3, 5.5) : rnd(2.0, 4.2), xm = max(B.ely ? B.ely.W : B.abd.w, P.T.w);
    const spots = poissonVar({x0: 0.3, y0: B.pron.y0, x1: xm, y1: B.len}, () => r0 * rnd(oc ? 3 : 2.3, oc ? 4 : 3.2), 500).map(p => [p[0], p[1], r0 * rnd(0.7, 1.25)]);
    mk = base => (x, y) => {
      const ax = sym(x);
      for (const s of spots) { const d = sqrt((ax - s[0]) ** 2 + (y - s[1]) ** 2) / s[2]; if (d < 1) return oc ? (d < 0.4 ? acc : d < 0.68 ? (base === acc ? 0 : base) : 0) : acc; }
      return base;
    };
  } else if (P.pattern === 'stripes') { const sw = rnd(1.5, 3.5); mk = base => x => (floor(sym(x) / sw + 0.5) % 2) ? acc : base; }
  else if (P.pattern === 'bands') { const bw = rnd(3, 7); mk = base => (x, y) => (floor(y / bw) % 2) ? acc : base; }
  else if (P.pattern === 'marbled') { const th = rnd(0.52, 0.6); mk = base => (x, y) => noise(sym(x) * 0.13, y * 0.13, 4) > th ? acc : base; }
  else if (P.pattern === 'chevrons') { const bw = rnd(3, 6), k = rnd(0.5, 1.4) * choice([-1, 1]); mk = base => (x, y) => (floor((y + k * sym(x)) / bw + 100) % 2) ? acc : base; }
  else if (P.pattern === 'checker') { const c = rnd(2.5, 5); mk = base => (x, y) => ((floor(sym(x) / c + 0.5) + floor(y / c)) % 2) ? acc : base; }
  else if (P.pattern === 'zigzag') { const bw = rnd(3, 6), per = rnd(1.5, 3.5), amp = rnd(1, 2.5); mk = base => (x, y) => { const q = (sym(x) / per) % 2; return (floor((y + amp * abs(q - 1)) / bw) % 2) ? acc : base; }; }
  const A = B.abd, nseg = P.A.segs, bow = A.l / nseg * 0.25;
  const segOf = (x, y) => { const t = clamp((y - A.y0) / A.l, 0, 1), w = A.wfn(t) || 1; const tt = (y - A.y0 - bow * (1 - (x / w) ** 2)) / A.l; return clamp(tt, 0, 0.9999) * nseg; };
  let abd = mk(pp.abd);
  if (P.pattern === 'bands') { const f = rnd(0.3, 0.6), b = pp.abd; abd = (x, y) => (segOf(x, y) % 1) > 1 - f ? acc : b; }
  if (P.pattern === 'spots' && ['long', 'stick', 'sinuous'].includes(P.abdomen)) { const b = pp.abd; abd = (x, y) => { const s = segOf(x, y), q = s % 1, ax = abs(x) / (A.wfn(clamp((y - A.y0) / A.l, 0, 1)) || 1); return (q > 0.25 && q < 0.7 && ax > 0.2 && ax < 0.75) ? acc : b; }; }
  return {head: P.pattern === 'spots' ? () => pp.head : mk(pp.head), pron: mk(pp.pron), thor: mk(pp.thor), ely: mk(pp.ely), abd, segOf};
}

// extra texture generators (deterministic: no rand())
function scaleArcs(poly, r) { // scallop / fish-scale tessellation
  if (!FILLS) return [];
  const bb = bbox(poly), out = [];
  for (let row = 0, y = bb.y0 - r; y < bb.y1 + r; y += r * 0.95, row++) for (let x = bb.x0 - 2 * r + (row % 2) * r; x < bb.x1 + 2 * r; x += 2 * r) {
    const a = []; for (let k = 0; k <= 8; k++) { const t = k / 8 * PI; a.push([x + r * cos(t), y + r * sin(t)]); } out.push(St(a));
  }
  return clipS(out, poly, true);
}
function flowLines(poly, sp) { // flow field, mirrored across the midline
  if (!FILLS) return [];
  const bb = bbox(poly), g = sp * 2.3, out = [];
  for (let y = bb.y0; y < bb.y1; y += g) for (let x = bb.x0; x < bb.x1; x += g) {
    let px = x + (hash2(x, y) - 0.5) * g, py = y + (hash2(y, x) - 0.5) * g; const l = [[px, py]];
    for (let k = 0; k < 9; k++) { const a = noise(abs(px) * 0.07, py * 0.07, 21) * 4 * PI; const ax = px < 0 ? PI - a : a; px += cos(ax) * sp * 0.9; py += sin(ax) * sp * 0.9; l.push([px, py]); }
    out.push(St(l));
  }
  return clipS(out, poly, true);
}
function ringLines(poly, sp) { // concentric "contour map" rings
  if (!FILLS) return [];
  const c = centroid(poly), bb = bbox(poly), half = min(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2, n = floor(half / sp), out = [];
  for (let i = 1; i <= n; i++) { const k = 1 - i / (n + 1); out.push(St(closed(scl(poly, k, k, c[0], c[1])))); }
  return clipS(out, poly, true);
}
function dotPits(poly, sp) { // punctures: tiny circles on a hex grid
  if (!FILLS) return [];
  const bb = bbox(poly), out = [], r = SP * 0.38;
  for (let row = 0, y = bb.y0; y < bb.y1; y += sp * 1.7, row++) for (let x = bb.x0 + (row % 2) * sp; x < bb.x1; x += sp * 2) {
    if (!pip(x, y, poly)) continue; const c = []; for (let k = 0; k <= 8; k++) c.push([x + r * cos(k / 8 * PI * 2), y + r * sin(k / 8 * PI * 2)]); out.push(St(c));
  }
  return out;
}

// body texture + colour + shading for one part. Returns strokes (outline not included).
function surface(P, poly, opt = {}) {
  const tex = opt.tex || P.texture, penFn = opt.penFn || (() => P.pen.body), sp = SP * 1.35;
  const gen = sp => {
    if (tex === 'hatch') return hatch(poly, PI / 4, sp);
    if (tex === 'contour' || tex === 'glossy') return opt.contour ? opt.contour(tex === 'glossy' ? sp * 0.9 : sp) : crossContour(poly, sp);
    if (tex === 'cross') return hatch(poly, PI / 4, sp * 1.25).concat(hatch(poly, -PI / 4, sp * 1.25));
    if (tex === 'stipple') return stipple(poly, sp * 1.25);
    if (tex === 'scales') return scaleArcs(poly, sp * 2.1);
    if (tex === 'flow') return flowLines(poly, sp);
    if (tex === 'rings') return ringLines(poly, sp * 1.1);
    if (tex === 'dots') return dotPits(poly, sp);
    return [];
  };
  // colour pens at normal density, black at a sparser density so dark areas stay mid-grey
  let out = penSplit(gen(sp), (x, y) => { const v = penFn(x, y); return v === 0 ? -1 : v; }).concat(penSplit(gen(sp * 1.9), (x, y) => penFn(x, y) === 0 ? 0 : -1));
  if (tex === 'glossy' && FILLS) {
    const bb = bbox(poly), c = centroid(poly), wd = bb.x1 - bb.x0, ht = bb.y1 - bb.y0;
    const hl = ellipse(c[0] + wd * 0.2, c[1] - ht * 0.12, wd * 0.07, ht * 0.25, -0.25, 24);
    out = clipS(clipS(out, hl, false), opt.single ? hl : mirX(hl), false);
  }
  if (tex === 'fur' || opt.fur) out.push(...fur(poly, opt.furLen || 1.6, tex === 'fur' ? penFn(...centroid(poly)) : 0, PI / 2));
  if (opt.shade !== false) out.push(...rimShade(poly));
  return out;
}
const outline = (poly, pen = 0) => St(closed(poly), pen);
function solidPart(poly, pen = 0, dense = 1, shade = true) { // small dark parts (claws, clubs, mandibles)
  const st = [outline(poly)];
  st.push(...hatch(poly, PI / 4, SP * dense, pen));
  if (shade && pen !== 0) st.push(...rimShade(poly));
  return part(st, poly);
}
const tubePart = (path, wfn, pen = 0, dense = 0.8) => solidPart(tube(path, wfn), pen, dense);

// ============================================================ head & friends
function drawHead(S, P, B, pat) {
  const h = B.head, poly = profilePoly(h.y0, h.l, h.wfn, {front: P.head === 'big' || P.head === 'square' ? h.l * 0.06 : 0});
  const st = [outline(poly)];
  const cw = h.wfn(0.25) * 0.75, cl = [];
  for (let k = 0; k <= 16; k++) { const x = lerp(-cw, cw, k / 16); cl.push([x, h.y0 + h.l * 0.2 + h.l * 0.07 * (1 - (x / cw) ** 2)]); }
  st.push(...clipS([St(cl)], poly, true));
  if (['big', 'triangular', 'elongate', 'square'].includes(P.head)) st.push(St([[0, h.y0 + h.l * 0.35], [0, h.y0 + h.l * 0.75]]));
  if (P.head === 'mantis') { const y = h.y0 + h.l * 0.55, w = h.wfn(0.55) * 0.5; st.push(...clipS([St([[-w, y], [0, y + h.l * 0.12], [w, y]])], poly, true)); }
  st.push(...surface(P, poly, {penFn: pat.head, tex: P.tex.head, contour: sp => longContour(h.y0, h.l, h.wfn, sp)}));
  S.add(st, poly);
}
function eyeParts(P, B) {
  const h = B.head, r = P.E.r, pair = [], centre = [];
  const mk = (cx, cy, rx, ry, a = 0) => {
    const poly = ellipse(cx, cy, rx, ry, a, 36), st = [outline(poly)];
    const hl = ellipse(cx - rx * 0.25, cy - ry * 0.35, rx * 0.28, ry * 0.2, 0, 16);
    let fill = (rx > SP * 5) ? hexFacets(poly, max(SP * 1.3, rx * 0.13), P.pen.eye) : hatch(poly, PI / 4, SP * 0.8, P.pen.eye).concat(hatch(poly, -PI / 4, SP * 1.1, 0));
    st.push(...clipS(fill.concat(rimShade(poly, SP * 0.9, 0.7)), hl, false));
    return part(st, poly);
  };
  const cy = h.y0 + h.l * 0.42;
  if (P.eyes === 'huge') pair.push(mk(h.w * 0.48, h.y0 + h.l * 0.42, r, h.l * 0.62, -0.15));
  else if (P.eyes === 'holoptic') pair.push(mk(r * 0.98, h.y0 + h.l * 0.5, r, h.l * 0.52, -0.1));
  else if (P.eyes === 'corner') pair.push(mk(h.wfn(0.78) + r * 0.1, h.y0 + h.l * 0.72, r, r * 1.1, 0.3));
  else if (P.eyes === 'stalked') {
    const x0 = h.wfn(0.45) * 0.8, path = arcPath(x0, cy, P.E.stalkAng, P.E.stalkAng - 0.2, h.w * P.E.stalk, 10), e = path[path.length - 1];
    pair.push(mk(e[0] + r * 0.6, e[1], r, r * 1.1));
    const sp = tube(path, t => lerp(r * 0.35, r * 0.22, t), false);
    pair.push(part([outline(sp), ...hatch(sp, 0.3, SP * 1.2, 0)], sp));
  } else pair.push(mk(h.wfn(0.42) - r * 0.4, cy, r, r * 1.18));
  if (P.mut.extraEyes) pair.push(mk(h.wfn(0.2) * 0.55, h.y0 + h.l * 0.16, r * 0.55, r * 0.6));
  if (P.ocelli) { const oy = h.y0 + h.l * (P.eyes === 'holoptic' ? 0.85 : 0.5), orr = max(0.45, h.w * 0.06); for (const [ox, dy] of [[0, -orr * 1.6], [-orr * 1.7, 0], [orr * 1.7, 0]]) { const o = ellipse(ox, oy + dy, orr, orr, 0, 12); centre.push(part([outline(o), ...hatch(o, PI / 4, SP * 0.7, 0)], o)); } }
  return {pair, centre};
}
function mouthParts(P, B) {
  const h = B.head, M = P.M, pair = [], centre = [];
  if (P.mouth === 'mandibles' || P.mouth === 'stag') {
    const base = [h.wfn(0.12) * 0.5, h.y0 + h.l * 0.12];
    const a0 = (P.mouth === 'stag' ? rnd(-80, -65) : -75) * D2R, a1 = (P.mouth === 'stag' ? rnd(-170, -140) : -175) * D2R;
    const path = arcPath(base[0], base[1], a0, a1, M.len, 16), poly = tube(path, t => M.w * (1 - 0.85 * t));
    pair.push(solidPart(poly, P.pen.leg === 0 ? 0 : P.pen.leg, 0.75));
    if (P.mouth === 'stag') for (let i = 0; i < M.teeth; i++) {
      const t = lerp(0.3, 0.75, i / max(1, M.teeth - 1) || 0.5), p = pathAt(path, t), d = pathDir(path, t) - PI / 2;
      pair.push(tubePart(arcPath(p[0], p[1], d, d + 0.3, M.w * rnd(1.4, 2.2), 5), q => M.w * 0.45 * (1 - q), 0, 0.75));
    }
  } else if (P.mouth === 'tusks') {
    const base = [h.wfn(0.1) * 0.42, h.y0 + h.l * 0.1];
    pair.push(tubePart(arcPath(base[0], base[1], -PI / 2 + M.splay, -PI / 2 + M.splay * 1.4, M.len, 12), t => M.w * (1 - 0.92 * t), P.pen.leg, 0.75));
  } else if (P.mouth === 'palps') {
    const base = [h.wfn(0.15) * 0.6, h.y0 + h.l * 0.13], path = arcPath(base[0], base[1], M.a, M.a - 0.5, M.len, 18);
    [[0, 0.32, 1], [0.34, 0.64, 0.9], [0.66, 1, 1.25]].forEach(([t0, t1, k], i) => { const poly = tube(subPath(path, t0, t1), t => M.w * k * (0.75 + 0.25 * sin(PI * t))); pair.push(part([outline(poly), ...(i === 2 ? hatch(poly, PI / 4, SP * 0.9, P.pen.ant) : [])], poly)); });
  } else if (P.mouth === 'rostrum') {
    const path = [[0, h.y0 + h.l * 0.3], [0, h.y0 - M.len * 0.5], [0, h.y0 - M.len]];
    const poly = tube(resample(path, 1), t => M.w * (1 - 0.3 * t));
    centre.push(part([outline(poly), ...surface(P, poly, {single: true, tex: P.tex.head, penFn: () => P.pen.part.head})], poly));
    B.antAnchor = [M.w * 0.85, h.y0 - M.len * 0.45];
  } else if (P.mouth === 'proboscis') {
    const r = M.r, cy = h.y0 - r - 0.6, pts = [[0, h.y0 + 0.5]], N = 90;
    for (let i = 0; i <= N; i++) { const th = i / N * M.turns * 2 * PI, rr = r * (1 - 0.85 * i / N); pts.push([sin(th) * rr, cy + cos(th) * rr]); }
    const poly = tube(resample(pts, 0.5), () => 0.3);
    centre.push(part([outline(poly)], poly));
  } else if (P.mouth === 'sponge') {
    const tipY = h.y0 - M.len, r = M.r;
    for (const s of [-1, 1]) { const pad = ellipse(s * r * 0.62, tipY - r * 0.25, r * 0.75, r * 0.55, s * 0.35, 18), st = [outline(pad)]; for (let k = 0; k < 4; k++) { const a = -PI / 2 + s * (0.3 + k * 0.35); st.push(St([[s * r * 0.15, tipY], [s * r * 0.15 + cos(a) * r * 0.9, tipY + sin(a) * r * 0.7]])); } centre.push(part(clipS(st.slice(1), pad, true).concat([st[0]]), pad)); }
    centre.push(tubePart(resample([[0, h.y0 + h.l * 0.25], [0, tipY]], 0.5), () => r * 0.32, P.pen.leg, 1.0));
  } else if (P.mouth === 'beak') {
    centre.push(tubePart(arcPath(0, h.y0 + h.l * 0.35, -PI / 2, -PI / 2 + M.curve, M.len + h.l * 0.35, 14), t => M.w * (1 - 0.55 * t), 0, 0.9));
  }
  return {pair, centre};
}
function hornParts(P, B) {
  const centre = [], pair = [], HO = P.HO;
  const horn = (x, y, a0, a1, len, w, list) => {
    const path = arcPath(x, y, a0, a1, len, 16), poly = tube(path, t => w * (1 - 0.8 * pow(t, 1.5)));
    list.push(part([outline(poly), ...surface(P, poly, {single: true, tex: P.tex.pron, penFn: () => P.pen.part.pron})], poly));
    return path;
  };
  const fork = (path, list) => { const e = path[path.length - 3], d = pathDir(path, 0.9); for (const s of [-1, 1]) list.push(tubePart(arcPath(e[0], e[1], d + s * 0.6, d + s * 0.3, HO.w * 2.5, 6), t => HO.w * 0.4 * (1 - t))); };
  const up = -PI / 2;
  if (['pronotum', 'both', 'trident'].includes(P.horn)) { const p = horn(0, B.pron.y0 + B.pron.l * 0.35, up + HO.curl * 0.3, up + HO.curl, HO.lenP, HO.w, centre); if (HO.fork) fork(p, centre); }
  if (P.horn === 'head' || P.horn === 'both') { const p = horn(0, B.head.y0 + B.head.l * 0.45, up + HO.curl * 0.3, up + HO.curl, HO.lenH, HO.w, centre); if (HO.fork) fork(p, centre); }
  if (P.horn === 'trident') horn(B.pron.wfn(0.35) * 0.55, B.pron.y0 + B.pron.l * 0.35, up + HO.splay, up + HO.splay * 0.4, HO.lenP * 0.7, HO.w * 0.8, pair);
  if (P.horn === 'pair') horn(B.head.wfn(0.45) * 0.75, B.head.y0 + B.head.l * 0.45, up + 0.35, up - 0.35, HO.lenH * 0.7, HO.w * 0.8, pair);
  if (P.horn === 'antlers') {
    const path = horn(B.head.wfn(0.35) * 0.45, B.head.y0 + B.head.l * 0.35, up + HO.splay, up + HO.splay * 1.5, HO.lenH, HO.w * 0.85, pair);
    for (let i = 0; i < HO.branches; i++) { const t = lerp(0.4, 0.8, (i + 0.5) / HO.branches), p = pathAt(path, t), d = pathDir(path, t) + (i % 2 ? 0.75 : -0.75); pair.push(tubePart(arcPath(p[0], p[1], d, d - 0.2, HO.lenH * 0.3, 8), q => HO.w * 0.45 * (1 - 0.8 * q), P.pen.part.pron)); }
  }
  return {centre, pair};
}

// ============================================================ antennae
function antennaParts(type, A, anchor, P) {
  const [x, y] = anchor, parts = [], pen = P.pen.ant, w = A.w;
  const wavy = (x, y, a0, a1, len, n) => { // arc path with an optional wobble
    const pts = [[x, y]], step = len / (n - 1);
    for (let i = 1; i < n; i++) { const t = (i - 0.5) / (n - 1), a = lerp(a0, a1, t) + A.wave * sin(t * PI * 4); x += cos(a) * step; y += sin(a) * step; pts.push([x, y]); }
    return pts;
  };
  let path;
  if (type === 'geniculate') {
    const sc = arcPath(x, y, A.a0, A.a0, A.len * 0.35, 8), e = sc[sc.length - 1];
    path = sc.concat(arcPath(e[0], e[1], A.a0 + A.elbow, A.a0 + A.elbow + A.bend * 0.4, A.len * 0.65, 24).slice(1));
  } else if (type === 'hooked') {
    const m = arcPath(x, y, A.a0, A.a0 + A.bend, A.len * 0.82, 40), e = m[m.length - 1], d = A.a0 + A.bend;
    path = m.concat(arcPath(e[0], e[1], d, d + 1.8, A.len * 0.18, 10).slice(1));
  } else path = wavy(x, y, A.a0, A.a0 + A.bend, A.len, 48);
  const n = A.segs;
  const seg = (t0, t1, wd, fill = -1) => {
    const sp = subPath(path, t0, t1), poly = tube(sp.length > 2 ? sp : resample(sp, 0.3), t => wd * (0.7 + 0.3 * sin(PI * t)));
    const st = [outline(poly)]; if (fill >= 0) st.push(...hatch(poly, PI / 4, SP * 0.9, fill));
    parts.push(part(st, poly));
  };
  const bead = (t, rx, ry, fill = -1) => {
    const c = pathAt(path, t), poly = ellipse(c[0], c[1], rx, ry, pathDir(path, t), 18), st = [outline(poly)];
    if (fill >= 0) st.push(...hatch(poly, PI / 4, SP * 0.9, fill)); parts.push(part(st, poly));
  };
  const shaft = (t0, t1, wd) => seg(t0, t1, wd);
  if (type === 'filiform') for (let i = 0; i < n; i++) seg(i / n, (i + 0.94) / n, w * (i === 0 ? 1.3 : 1 - 0.45 * i / n));
  else if (type === 'moniliform') for (let i = 0; i < n; i++) bead((i + 0.5) / n, A.len / n * 0.52, w * 1.2 * (1 - 0.3 * i / n), i % 3 === 0 ? pen : -1);
  else if (type === 'clubbed' || type === 'hooked') {
    const c0 = type === 'hooked' ? 0.68 : 0.78; shaft(0, c0 + 0.02, w * 0.42);
    const sp = subPath(path, c0, 1), poly = tube(sp, t => w * (0.45 + (type === 'hooked' ? 1.0 : 1.4) * pow(sin(PI * min(1, t * 0.75 + 0.15)), 1.5))); parts.unshift(solidPart(poly, pen, 0.8));
  } else if (type === 'capitate') for (let i = 0; i < n; i++) seg(i / n, (i + 0.92) / n, w * (i >= n - 3 ? 2.1 : 0.8), i >= n - 3 ? pen : -1);
  else if (type === 'clavate') for (let i = 0; i < n; i++) { const k = pow(i / (n - 1), 1.6); seg(i / n, (i + 0.92) / n, w * (0.6 + 1.4 * k), k > 0.45 ? pen : -1); }
  else if (type === 'lamellate') {
    for (let i = 0; i < 6; i++) seg(i / 6 * 0.65, (i + 0.9) / 6 * 0.65, w * 0.8);
    const e = pathAt(path, 0.65), d = pathDir(path, 0.6);
    for (const s of [-0.55, 0, 0.55]) { const pl = ellipse(e[0] + cos(d + s) * A.len * 0.18, e[1] + sin(d + s) * A.len * 0.18, A.len * 0.2, w * 1.5, d + s, 20); parts.unshift(solidPart(pl, pen, 1.0)); }
  } else if (type === 'flabellate') {
    shaft(0, 1, w * 0.45);
    for (let i = 1; i < n; i++) {
      const t = i / n, p = pathAt(path, t), d = pathDir(path, t) + 1.25, bl = A.len * 0.32 * pow(sin(PI * min(1, t * 0.9 + 0.1)), 0.5) + 1;
      const pl = ellipse(p[0] + cos(d) * bl / 2, p[1] + sin(d) * bl / 2, bl / 2, w * 0.55, d, 16);
      parts.push(part([outline(pl), ...hatch(pl, d + PI / 2, SP * 0.9, i % 2 ? pen : 0)], pl));
    }
  } else if (type === 'pectinate' || type === 'plumose') {
    shaft(0, 1, w * 0.4);
    const st = [], m = n * (type === 'plumose' ? 3 : 2);
    for (let i = 0; i < m; i++) {
      const t = lerp(0.06, 0.97, i / (m - 1)), p = pathAt(path, t), d = pathDir(path, t), bl = A.len * 0.2 * pow(sin(PI * t), 0.6) + 0.5;
      for (const s of [-1, 1]) {
        const a = d + s * 1.05, q = [p[0] + cos(a) * bl, p[1] + sin(a) * bl]; st.push(St(quadPath(p, lerp2(p, q, 0.5).map((v, k) => v + (k ? cos(a) : -sin(a)) * s * 0.3), q, 5), pen));
        if (type === 'plumose') for (let k = 1; k <= 3; k++) { const b = lerp2(p, q, k / 4), ba = a + s * 0.7; st.push(St([b, [b[0] + cos(ba) * bl * 0.25, b[1] + sin(ba) * bl * 0.25]], pen)); }
      }
    }
    parts.push(part(st, null));
  } else if (type === 'geniculate') {
    seg(0, 0.34, w * 1.1, pen);
    const m = n - 1; for (let i = 0; i < m; i++) { const t0 = lerp(0.36, 1, i / m), t1 = lerp(0.36, 1, (i + 0.9) / m); seg(t0, t1, w * (i >= m - 4 ? 1.35 : 0.85), i >= m - 4 ? 0 : -1); }
  } else if (type === 'setaceous') { parts.push(solidPart(tube(path, t => w * (1 - 0.9 * t)), 0, 1)); }
  else if (type === 'aristate') {
    seg(0, 0.12, w * 0.9); seg(0.13, 0.26, w * 1.1);
    bead(0.36, A.len * 0.11, w * 2.0, pen);
    const ar = subPath(path, 0.45, 1), st = [St(ar)];
    if (chance(0.5)) for (let k = 1; k < 10; k++) { const t = k / 10, p = pathAt(ar, t), d = pathDir(ar, t); for (const s of [-1, 1]) st.push(St([p, [p[0] + cos(d + s * 0.9) * 0.9, p[1] + sin(d + s * 0.9) * 0.9]])); }
    parts.push(part(st, null));
  } else if (type === 'whip') {
    const poly = tube(path, t => w * 0.55 * (1 - 0.85 * t)), st = [outline(poly)], L = polyLen(path), k = max(6, floor(L / 1.8));
    for (let i = 1; i < k; i++) { const t = i / k, p = pathAt(path, t), d = pathDir(path, t) + PI / 2, ww = w * 0.55 * (1 - 0.85 * t); st.push(St([[p[0] - cos(d) * ww, p[1] - sin(d) * ww], [p[0] + cos(d) * ww, p[1] + sin(d) * ww]])); }
    parts.push(part(st, poly));
  } else if (type === 'serrate') for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 0.95) / n, a = pathAt(path, t0), b = pathAt(path, t1), d = pathDir(path, (t0 + t1) / 2), nx = -sin(d), ny = cos(d), ww = w * (1.1 - 0.4 * i / n);
    const poly = [[a[0] + nx * ww * 0.5, a[1] + ny * ww * 0.5], [b[0] - nx * ww * 1.6 + (b[0] - a[0]) * 0.1, b[1] - ny * ww * 1.6 + (b[1] - a[1]) * 0.1], [b[0] + nx * ww * 0.5, b[1] + ny * ww * 0.5]];
    const pp = [poly[0], [a[0] - nx * ww * 0.6, a[1] - ny * ww * 0.6], poly[1], poly[2]];
    parts.push(part([outline(pp), ...hatch(pp, PI / 4, SP * (i % 2 ? 0.9 : 1.6), i % 2 ? pen : 0)], pp));
  } else if (type === 'longhorn') for (let i = 0; i < n; i++) seg(i / n, (i + 0.96) / n, w * 1.25 * (1 - 0.45 * i / n), i % 2 ? P.pen.accent : 0);
  return parts;
}

// ============================================================ thorax, abdomen, elytra
function pronotumParts(P, B, pat) {
  const pr = B.pron, spikes = [], kind = P.pronotum, shield = kind === 'shield' || kind === 'spiky';
  const spike = (t, len, a) => { const y = pr.y0 + pr.l * t, x = pr.wfn(t) * 0.92; spikes.push(tubePart(arcPath(x, y, a, a + 0.2, len, 6), q => 1.2 * (1 - 0.9 * q))); };
  if (kind === 'spiky') for (const t of [0.35, 0.65]) spike(t, P.PR.spike, rnd(-25, 15) * D2R);
  if (kind === 'shoulders' && P.PR.spike > 2) spike(0.84, P.PR.spike, rnd(-20, 5) * D2R);
  const opt = {shield: {front: pr.l * 0.12, back: pr.l * 0.05}, spiky: {front: pr.l * 0.12, back: pr.l * 0.05}, saddle: {front: pr.l * 0.05, back: pr.l * 0.16},
    shoulders: {front: pr.l * 0.1}, leafy: {front: pr.l * 0.06, back: pr.l * 0.06}}[kind] || {};
  const poly = profilePoly(pr.y0, pr.l, pr.wfn, opt), st = [outline(poly)];
  const sideLine = (k, t0, t1) => { const s = []; for (let i = 0; i <= 20; i++) { const t = lerp(t0, t1, i / 20); s.push([pr.wfn(t) * k, pr.y0 + t * pr.l + pr.l * 0.04]); } return s; };
  if (shield) { const s = sideLine(0.86, 0.12, 0.9); st.push(St(s), St(mirX(s)), St([[0, pr.y0 + pr.l * 0.2], [0, pr.y0 + pr.l * 0.85]])); }
  if (kind === 'saddle') {
    const s = sideLine(0.6, 0.05, 1.0); st.push(...clipS([St(s), St(mirX(s)), St([[0, pr.y0], [0, pr.y0 + pr.l * 1.1]])], poly, true));
    for (const t of [0.35, 0.62]) { const y = pr.y0 + pr.l * t, w = pr.wfn(t) * 0.6, l = []; for (let k = 0; k <= 10; k++) { const x = lerp(-w, w, k / 10); l.push([x, y + pr.l * 0.05 * (1 - (x / w) ** 2)]); } st.push(St(l)); }
  }
  if (kind === 'hood') { const c = [0, pr.y0 + pr.l * 0.5]; st.push(St(closed(scl(poly, 0.84, 0.84, c[0], c[1])))); }
  if (kind === 'neck' || kind === 'leafy') st.push(St([[0, pr.y0 + pr.l * 0.08], [0, pr.y0 + pr.l * 0.92]]));
  if (kind === 'leafy') for (let i = 1; i <= 4; i++) { const t = i / 5, y = pr.y0 + pr.l * t; for (const s of [-1, 1]) st.push(...clipS([St([[0, y], [s * pr.wfn(t + 0.12) * 0.9, y + pr.l * 0.12]])], poly, true)); }
  st.push(...surface(P, poly, {penFn: pat.pron, tex: P.tex.pron, fur: kind === 'hairy' && P.tex.pron !== 'fur', contour: sp => longContour(pr.y0, pr.l, pr.wfn, sp, 0)}));
  return {spikes, body: part(st, poly)};
}
function drawThorax(S, P, B, pat) {
  const T = B.thor, poly = profilePoly(T.y0, T.l, T.wfn), st = [outline(poly)];
  if (P.thorax === 'plated') for (const t of [0.35, 0.68]) { const y = T.y0 + T.l * t, w = T.wfn(t), l = []; for (let k = 0; k <= 16; k++) { const x = lerp(-w, w, k / 16); l.push([x, y + T.l * 0.1 * (1 - (x / w) ** 2)]); } st.push(...clipS([St(l)], poly, true)); }
  if (P.thorax === 'humped') { const w = T.w, y0 = T.y0, l = T.l; st.push(...clipS([St([[-0.6 * w, y0 + 0.25 * l], [-0.28 * w, y0 + 0.62 * l], [0, y0 + 0.4 * l], [0.28 * w, y0 + 0.62 * l], [0.6 * w, y0 + 0.25 * l]]), St([[-0.3 * w, y0 + 0.95 * l], [0, y0 + 0.75 * l], [0.3 * w, y0 + 0.95 * l]])], poly, true)); }
  if (P.thorax === 'long') for (let i = 1; i < 4; i++) { const y = T.y0 + T.l * i / 4, w = T.wfn(i / 4); st.push(St([[-w, y], [w, y]])); }
  if (P.thorax !== 'hairy') st.push(St([[0, T.y0 + T.l * 0.12], [0, T.y0 + T.l * 0.85]]));
  if (P.forewing === 'elytra' && !P.ely.open) { const y = T.y0 + T.l * 0.25; st.push(St([[-2, y], [0, y + 4], [2, y], [-2, y]])); }
  st.push(...surface(P, poly, {penFn: pat.thor, tex: P.tex.thor, fur: P.thorax === 'hairy' && P.tex.thor !== 'fur', furLen: 2, contour: sp => longContour(T.y0, T.l, T.wfn, sp)}));
  S.add(st, poly);
}
function scutellumPart(P, B, pat) { // shield bug: big triangular plate over the abdomen
  const T = B.thor, y0 = T.y0 + T.l * 0.72, len = B.abd.y0 + B.abd.l * rnd(0.45, 0.68) - y0, wb = T.wfn(0.8) * 0.9;
  const wfn = t => wb * pow(max(0, 1 - pow(t, 1.4)), 0.65) * (1 - 0.25 * t);
  const poly = profilePoly(y0, len, wfn), st = [outline(poly), St([[0, y0 + len * 0.1], [0, y0 + len * 0.7]])];
  st.push(...surface(P, poly, {penFn: pat.thor, tex: P.tex.thor, contour: sp => longContour(y0, len, wfn, sp)}));
  return part(st, poly);
}
function drawWaist(S, P, B) {
  if (!B.waist) return;
  const Wt = B.waist, w = P.W.w, pen = P.pen.part.abd;
  if (P.waist === 'petiole' || P.waist === 'stalk') {
    const poly = tube(resample([[0, Wt.y0 - 0.5], [0, Wt.y0 + Wt.l + 0.5]], 0.5), t => w * (1 + 0.9 * smooth(0.55, 1, t)));
    S.add([outline(poly), ...hatch(poly, PI / 4, SP, pen), ...rimShade(poly)], poly);
  } else {
    const n = P.W.nodes, k = P.waist === 'beads' ? 1.5 : 2.2;
    for (let i = 0; i < n; i++) { const ry = Wt.l / n * 0.55, poly = ellipse(0, Wt.y0 + (i + 0.5) / n * Wt.l, w * k, ry, 0, 24); S.add([outline(poly), ...hatch(poly, PI / 4, SP * 1.2, pen), ...rimShade(poly)], poly); }
  }
}
function drawAbdomen(S, P, B, pat) {
  const A = B.abd, poly = profilePoly(A.y0, A.l, A.wfn, {n: 72}), st = [outline(poly)];
  const nseg = P.A.segs, bow = A.l / nseg * 0.25;
  for (let i = 1; i < nseg; i++) {
    const t = i / nseg, y = A.y0 + t * A.l, w = A.wfn(t) * 1.05, l = [];
    for (let k = 0; k <= 20; k++) { const x = lerp(-w, w, k / 20); l.push([x, y + bow * (1 - (x / w) ** 2)]); }
    st.push(...clipS([St(l)], poly, true));
  }
  st.push(...surface(P, poly, {penFn: pat.abd, tex: P.tex.abd, contour: sp => crossContour(poly, sp, bow)}));
  S.addPart(bendPart(B, part(st, poly)));
}
function elytronPart(P, B, pat) {
  const E = B.ely, g = 0.15, tp = P.ely.cover < 0.6 ? 9 : P.ely.tipPow;
  const wfn = t => max(g + 0.01, E.W * pow(min(1, (t + 0.05) / 0.13), 0.4) * pow(1 - pow(t, tp), 0.6) * (1 + P.ely.bulge * sin(PI * t)));
  const outer = [], sut = [];
  for (let i = 0; i <= 50; i++) { const t = i / 50; outer.push([wfn(t), E.y0 + t * E.l]); sut.push([g, E.y0 + t * E.l]); }
  const poly = outer.concat(sut.reverse()), st = [outline(poly)];
  const lineAt = f => { const l = []; for (let i = 0; i <= 40; i++) { const t = lerp(0.03, 0.96, i / 40); l.push([g + f * (wfn(t) - g), E.y0 + t * E.l]); } return l; };
  const k = P.ely.striae; for (let i = 1; i <= k; i++) st.push(St(lineAt(i / (k + 1))));
  const contour = sp => { if (!FILLS) return []; const n = floor(E.W / sp), o = []; for (let i = 1; i < n; i++) o.push(St(lineAt(i / n))); return o; };
  st.push(...surface(P, poly, {penFn: pat.ely, tex: P.tex.ely, contour, single: true}));
  let pt = part(st, poly);
  if (P.ely.open) pt = xformPart(xformPart(pt, 0, -wfn(0) * 0.4, -E.y0), -P.ely.angle, wfn(0) * 0.4, E.y0);
  return pt;
}

// ============================================================ wings
function wingPatternFn(P, W, outlinePoly, fore) {
  const base = chance(0.25) && P.wingPattern !== 'none' ? -1 : P.pen.wing, w2 = P.pen.wing2, S = W.S, C = W.C, pt = P.wingPattern;
  const R = max(...outlinePoly.map(p => hypot(p[0], p[1])));
  if (pt === 'eyespots') {
    const spots = fore ? (chance(0.7) ? [[0.72 * S, 0.12 * C, 0.08 * S]] : []) : [[0.58 * S, 0.55 * C, 0.13 * S]].concat(chance(0.4) ? [[0.4 * S, 0.75 * C, 0.08 * S]] : []);
    return (x, y) => { for (const [cx, cy, r] of spots) { const d = hypot(x - cx, y - cy) / r; if (d < 1) return d < 0.3 ? -1 : d < 0.55 ? 0 : d < 0.85 ? w2 : 0; } return base; };
  }
  if (pt === 'bands') {
    const a = [rnd(0.45, 0.65) * S, -0.2 * C], b = [rnd(0.25, 0.45) * S, 1.1 * C], bw = rnd(0.05, 0.1) * S, dark = fore && chance(0.6);
    return (x, y) => { const d = segDist([x, y], a, b) + (noise(x * 0.1, y * 0.1, 11) - 0.5) * bw; if (d < bw) return w2; if (dark && hypot(x, y) > 0.82 * R) return 0; return base; };
  }
  if (pt === 'border') {
    const bw = rnd(0.07, 0.12) * S, spots = chance(0.7), sr = bw * 0.28;
    return (x, y) => { const d = polyDist([x, y], outlinePoly); if (d < bw) { if (spots && d > bw * 0.3 && d < bw * 0.75 && (floor(atan2(y, x) * 14 / (PI / 2)) % 2) && abs((d - bw * 0.52)) < sr) return -1; return 0; } return base; };
  }
  if (pt === 'patches') { const z = fore ? 3 : 13, th = rnd(0.53, 0.6); return (x, y) => { const v = noise(x * 0.07, y * 0.07, z); return v > th + 0.12 ? 0 : v > th ? w2 : base; }; }
  if (pt === 'tint') { const e = R * rnd(0.3, 0.45); return (x, y) => hypot(x, y) < e ? w2 : base; }
  if (pt === 'spots') { const sp = poissonVar({x0: 0, y0: -C * 0.2, x1: S, y1: C * 1.1}, () => rnd(4, 8), 300).filter(() => chance(0.5)).map(p => [...p, rnd(1.2, 3)]); return (x, y) => { for (const s of sp) if ((x - s[0]) ** 2 + (y - s[1]) ** 2 < s[2] * s[2]) return 0; return base; }; }
  if (pt === 'crosslines') return (x, y) => hypot(x, y) > 0.82 * R ? w2 : base;
  if (pt === 'stripes') { const k = rint(5, 11) / (PI / 2), dark = chance(0.5) ? 0 : w2; return (x, y) => (floor(atan2(y, x) * k + 50) % 2) && hypot(x, y) > R * 0.18 ? dark : base; }
  if (pt === 'windows') { const sp = poissonVar({x0: 0.15 * S, y0: 0, x1: 0.9 * S, y1: C}, () => rnd(6, 11), 200).map(p => [...p, rnd(2, 4.5)]), dark = chance(0.6) ? 0 : w2; return (x, y) => { for (const s of sp) if ((x - s[0]) ** 2 + (y - s[1]) ** 2 < s[2] * s[2]) return base === -1 ? P.pen.wing : -1; return dark; }; }
  if (pt === 'marbled') { const z = fore ? 31 : 37, th = rnd(0.45, 0.52); return (x, y) => { const v = noise(x * 0.05, y * 0.05, z) + 0.25 * noise(x * 0.2, y * 0.2, z + 1); return v > th + 0.45 ? 0 : v > th + 0.18 ? w2 : base; }; }
  if (pt === 'gradient') { const mid = rnd(0.45, 0.65); return (x, y) => (hypot(x, y) / R + (hash2(x * 3.1, y * 2.7) - 0.5) * 0.3 < mid) ? (base === -1 ? P.pen.wing : base) : w2; }
  return () => base;
}
const SCALED_SHAPES = {
  fore: {
    classic: (S, C, j) => [[0, 0], [0.3 * S, -0.12 * C], [0.65 * S, (-0.17 + j()) * C], [(0.97 + j()) * S, (-0.13 + j()) * C], [(0.92 + j()) * S, 0.25 * C], [(0.75 + j()) * S, 0.72 * C], [0.55 * S, (0.95 + j()) * C], [0.3 * S, 0.85 * C], [0.08 * S, 0.35 * C]],
    falcate: (S, C, j) => [[0, 0], [0.3 * S, -0.12 * C], [0.7 * S, -0.18 * C], [(1.0 + j()) * S, -0.05 * C], [0.88 * S, 0.12 * C], [0.86 * S, 0.35 * C], [(0.72 + j()) * S, 0.75 * C], [0.5 * S, 0.95 * C], [0.25 * S, 0.8 * C], [0.06 * S, 0.35 * C]],
    triangular: (S, C, j) => [[0, 0], [0.4 * S, -0.1 * C], [(0.95 + j()) * S, -0.08 * C], [1.0 * S, 0.15 * C], [(0.8 + j()) * S, 0.85 * C], [0.45 * S, 1.0 * C], [0.15 * S, 0.6 * C]],
    narrow: (S, C, j) => [[0, 0], [0.4 * S, -0.12 * C], [0.9 * S, (-0.1 + j()) * C], [1 * S, 0.15 * C], [(0.9 + j()) * S, 0.5 * C], [0.55 * S, 0.85 * C], [0.2 * S, 0.7 * C], [0.05 * S, 0.3 * C]],
    round: (S, C, j) => [[0, 0], [0.35 * S, -0.2 * C], [0.8 * S, (-0.15 + j()) * C], [1 * S, 0.3 * C], [(0.85 + j()) * S, 0.8 * C], [0.45 * S, 1 * C], [0.1 * S, 0.55 * C]],
  },
  hind: {
    classic: (S, C, j) => [[0, 0], [0.45 * S, -0.12 * C], [(0.85 + j()) * S, 0.05 * C], [(1 + j()) * S, 0.35 * C], [0.85 * S, (0.75 + j()) * C], [0.5 * S, (1 + j()) * C], [0.2 * S, 0.85 * C], [0.02 * S, 0.3 * C]],
    round: (S, C, j) => [[0, 0], [0.5 * S, -0.1 * C], [(0.95 + j()) * S, 0.2 * C], [0.95 * S, 0.65 * C], [0.6 * S, (1.0 + j()) * C], [0.25 * S, 0.95 * C], [0.02 * S, 0.35 * C]],
    narrow: (S, C, j) => [[0, 0], [0.5 * S, -0.05 * C], [(1 + j()) * S, 0.25 * C], [0.8 * S, 0.6 * C], [0.35 * S, 0.7 * C], [0.05 * S, 0.3 * C]],
  },
};
function scaledWing(P, W, fore) {
  const S = W.S, C = W.C, j = () => rnd(-0.03, 0.03);
  const fam = SCALED_SHAPES[fore ? 'fore' : 'hind'], shape = fam[W.shape] ? W.shape : 'classic';
  let cp = fam[shape](S, C, j);
  if (W.type === 'tailed') { const at = shape === 'classic' ? 5 : cp.length - 2; cp.splice(at, 0, [0.82 * S, 0.88 * C], [0.86 * S, (1.35 + rnd(0, 0.35)) * C], [0.79 * S, 1.42 * C], [0.73 * S, 0.97 * C]); }
  let poly = resample(closed(catmull(cp, true, 12)), 0.8).slice(0, -1);
  const R = max(...poly.map(p => hypot(p[0], p[1])));
  if (W.scallop) poly = poly.map(p => { const r = hypot(p[0], p[1]), a = atan2(p[1], p[0]); if (r < 1e-3) return p; const k = W.scallop * smooth(0.6, 0.85, r / R) * pow(1 - abs(sin(a * W.k * 1.6)), 3); return [p[0] * (1 - k / r), p[1] * (1 - k / r)]; });
  const st = [outline(poly)];
  // venation: discal cell + veins radiating to the margin
  const cell = catmull(fore ? [[0.05 * S, 0.12 * C], [0.22 * S, 0.1 * C], [0.42 * S, 0.17 * C], [0.44 * S, 0.3 * C], [0.26 * S, 0.33 * C], [0.08 * S, 0.24 * C]]
    : [[0.05 * S, 0.14 * C], [0.25 * S, 0.17 * C], [0.38 * S, 0.33 * C], [0.32 * S, 0.45 * C], [0.12 * S, 0.36 * C]], true, 8);
  st.push(St(closed(cell)));
  const marg = poly.filter(p => hypot(p[0], p[1]) > 0.55 * R), nv = fore ? 9 : 7;
  const cr = max(...cell.map(c => hypot(c[0], c[1]))), rim = cell.filter(c => hypot(c[0], c[1]) > cr * 0.55).sort((a, b) => atan2(a[1], a[0]) - atan2(b[1], b[0]));
  for (let i = 0; i < nv; i++) {
    const tgt = marg[floor((i + 0.5) / nv * marg.length)], o = rim[floor((i + 0.5) / nv * rim.length)];
    const m = lerp2(o, tgt, 0.5), d = dist(o, tgt), n = (noise(i, fore ? 1 : 2) - 0.5) * d * 0.15;
    st.push(...clipS([St(quadPath(o, [m[0] - (tgt[1] - o[1]) / d * n, m[1] + (tgt[0] - o[0]) / d * n], tgt, 12))], poly, true));
  }
  const an = poly.reduce((a, p) => (hypot(p[0], p[1]) > 0.4 * R && atan2(p[1], p[0]) > atan2(a[1], a[0])) ? p : a, poly[floor(poly.length / 2)]);
  st.push(St(quadPath([0.02 * S, 0.05 * C], [an[0] * 0.5, an[1] * 0.45], an, 12)));
  if (P.wingPattern === 'crosslines') for (const f of [0.38, 0.66]) {
    const l = []; for (let k = 0; k <= 60; k++) { const a = lerp(-PI / 2, PI, k / 60), r = R * (f + 0.035 * sin(k * 1.7) + (noise(k * 0.2, f * 9) - 0.5) * 0.08); l.push([cos(a) * r, sin(a) * r]); }
    st.push(...clipS([St(l)], poly, true));
  }
  const fn = wingPatternFn(P, W, poly, fore);
  st.push(...penSplit(radialFill(poly, -0.04 * S, 0.02 * C, SP * 1.3), fn));
  st.push(...penSplit(radialFill(poly, -0.04 * S, 0.02 * C, SP * 1.3, 0.5), (x, y) => fn(x, y) === 0 ? 0 : -1));
  return part(st, poly);
}
// shared shape for strip-like wings: centreline + half-width along span u in [0,1]
function stripWing(W, lead, h, N = 70) {
  const S = W.S, top = [], bot = [];
  for (let i = 0; i <= N; i++) { const u = i / N; top.push([u * S, lead(u)]); bot.push([u * S, lead(u) + 2 * h(u)]); }
  return top.concat(bot.reverse().slice(1, -1));
}
function wingTint(P, poly, W, uOf) { // light colour washes for clear wings
  const p = P.wingPattern, b = P.pen.wing, b2 = P.pen.wing2;
  let fn = null;
  if (p === 'tint' || p === 'patches') { const e = rnd(0.18, 0.35); fn = (x, y) => uOf(x) < e ? b : -1; }
  else if (p === 'spots' || p === 'eyespots') fn = (x, y) => uOf(x) > 0.82 ? b2 : -1;
  else if (p === 'bands' || p === 'crosslines') { const c = rnd(0.4, 0.6); fn = (x, y) => abs(uOf(x) - c) < 0.08 ? b : -1; }
  else if (p === 'border') fn = () => b;
  else if (p === 'stripes') { const k = rint(4, 7); fn = (x, y) => floor(uOf(x) * k * 2) % 2 ? b : -1; }
  else if (p === 'windows') { const c = rnd(0.35, 0.6); fn = (x, y) => abs(uOf(x) - c) < 0.12 ? -1 : b; }
  else if (p === 'marbled') { const z = rnd(40, 60); fn = (x, y) => noise(x * 0.08, y * 0.08, z) > 0.56 ? b : -1; }
  else if (p === 'gradient') fn = (x, y) => uOf(x) + (hash2(x * 2.3, y * 1.9) - 0.5) * 0.25 < 0.45 ? b : -1;
  return fn ? penSplit(hatch(poly, 0.15, SP * 1.6), fn) : [];
}
function netWing(P, W) {
  const S = W.S, C = W.C, lace = W.lace;
  const h = u => C * 0.5 * pow(max(0, 1 - pow(u, lace ? 2.4 : 5)), 0.5) * (W.stalk ? 0.12 + 0.88 * smooth(0.04, 0.3, u) : 0.3 + 0.7 * smooth(0, 0.1, u)) * (1 + W.broad * exp(-(((u - 0.2) / 0.16) ** 2)));
  const lead = lace ? (u => -h(u) + C * 0.05) : (u => -C * 0.42 + C * 0.1 * u * u + (W.stalk ? (C * 0.42 - h(u)) * (1 - smooth(0.04, 0.3, u)) : 0));
  const poly = stripWing(W, lead, h), st = [outline(poly)];
  const yAt = (u, f) => lead(u) + 2 * h(u) * f, uOf = x => clamp(x / S, 0, 1);
  const f0 = lace ? [0.05, 0.14, 0.3, 0.5, 0.7, 0.88] : [0.06, 0.15, 0.28, 0.44, 0.62, 0.8];
  f0.forEach((f, i) => {
    const ue = i < 2 ? 1 : lerp(0.98, 0.5, f), l = [];
    for (let k = 0; k <= 50; k++) { const u = lerp(0.01, ue, k / 50); l.push([u * S, yAt(u, f + (1 - f) * smooth(ue - 0.35, ue, u))]); }
    st.push(St(l));
  });
  const ladder = [], du = 1.4 / S, strip = stripWing(W, lead, u => h(u) * 0.15);
  for (let u = 0.04; u < 0.95; u += du) if (!(u > 0.8 && u < 0.88)) ladder.push(St([[u * S, yAt(u, 0)], [u * S, yAt(u, 0.15)]]));
  st.push(...ladder);
  const cell = S * (lace ? 0.05 : 0.036) * (S < 30 ? 1.6 : 1), bb = bbox(poly);
  const seeds = poissonVar({x0: bb.x0 - 3, y0: bb.y0 - 3, x1: bb.x1 + 3, y1: bb.y1 + 3}, p => { const u = uOf(p[0]), hh = h(u) || 1; const f = clamp((p[1] - lead(u)) / (2 * hh), 0, 1); return max(1.2, cell * (0.7 + 0.8 * f) * (0.8 + 0.5 * (1 - smooth(0, 0.3, u)))); }, 3500);
  let cells = voronoiEdges(seeds).map(e => St(e));
  cells = clipS(clipS(cells, poly, true), strip, false);
  st.push(...cells);
  if (!lace) { const ps = [], pe = []; for (let k = 0; k <= 6; k++) { const u = lerp(0.8, 0.88, k / 6); ps.push([u * S, yAt(u, 0)]); pe.push([u * S, yAt(u, 0.15)]); } const pt = ps.concat(pe.reverse()); st.push(outline(pt), ...hatch(pt, 0.5, SP * 0.7, P.pen.wing2 || 0)); }
  st.push(...wingTint(P, poly, W, uOf));
  return part(st, poly);
}
function membraneWing(P, W, fore) {
  const S = W.S, C = W.C;
  const h = u => C * 0.5 * pow(max(0, 1 - pow(u, 3)), 0.5) * (0.3 + 0.7 * smooth(0, 0.25, u));
  const lead = u => -C * 0.3 + C * 0.06 * u - (C * 0.5 - h(u)) * 0.15;
  const poly = stripWing(W, lead, h), st = [outline(poly)], yAt = (u, f) => lead(u) + 2 * h(u) * f, uOf = x => clamp(x / S, 0, 1);
  const vein = (f, u0, u1) => { const l = []; for (let k = 0; k <= 30; k++) { const u = lerp(u0, u1, k / 30); l.push([u * S, yAt(u, f)]); } return St(l); };
  st.push(vein(0.07, 0.01, fore ? 0.5 : 0.4), vein(0.16, 0.02, fore ? 0.52 : 0.4), vein(0.45, 0.02, 0.6), vein(0.72, 0.02, 0.5));
  if (fore) { const ps = [], pe = []; for (let k = 0; k <= 6; k++) { const u = lerp(0.5, 0.62, k / 6); ps.push([u * S, yAt(u, 0)]); pe.push([u * S, yAt(u, 0.15)]); } const sp = ps.concat(pe.reverse()); st.push(outline(sp), ...hatch(sp, 0.5, SP * 0.7, 0)); }
  const ulim = fore ? 0.68 : 0.5, seeds = [];
  for (let i = 0; i < W.cells; i++) { const u = lerp(0.15, ulim - 0.06, (i + rnd(0.2, 0.8)) / W.cells), f = (i % 2 ? rnd(0.15, 0.45) : rnd(0.5, 0.85)); seeds.push([u * S, yAt(u, f)]); }
  for (let i = 0; i < 8; i++) seeds.push([rnd(-0.3, 1.3) * S, rnd(-1, 2) * C]); // far guard seeds keep cells closed
  const region = stripWing({S: S * ulim}, u => lead(u * ulim), u => h(u * ulim), 40);
  st.push(...clipS(clipS(voronoiEdges(seeds).map(e => St(e)), poly, true), region, true));
  const rb = []; for (let k = 0; k <= 20; k++) { const f = k / 20; rb.push([ulim * S - (1 - sin(PI * f)) * S * 0.04, yAt(ulim, f)]); }
  st.push(...clipS([St(rb)], poly, true));
  st.push(...wingTint(P, poly, W, uOf));
  return part(st, poly);
}
function clearWing(P, W, fore) { // cicada-style: strong veins, marginal ring of apical cells
  const S = W.S, C = W.C, vpen = chance(0.4) ? P.pen.wing2 : 0;
  const h = u => C * 0.5 * pow(max(0, 1 - pow(u, 3.2)), 0.5) * (0.3 + 0.7 * smooth(0, 0.22, u));
  const lead = u => -C * 0.32 + C * 0.07 * u;
  const poly = stripWing(W, lead, h), st = [outline(poly)], yAt = (u, f) => lead(u) + 2 * h(u) * f, uOf = x => clamp(x / S, 0, 1);
  const vline = (ff, u0, u1) => { const l = []; for (let k = 0; k <= 40; k++) { const u = lerp(u0, u1, k / 40); l.push([u * S, yAt(u, ff(u))]); } return l; };
  st.push(St(vline(() => 0.05, 0, 0.92), vpen));
  const n = W.veins, veins = [];
  for (let i = 0; i < n; i++) { const f0 = lerp(0.04, 0.98, i / (n - 1)), l = vline(u => lerp(0.42, f0, pow(smooth(0, 1, u), 0.7)), 0.01, 0.99); veins.push(l); }
  st.push(...clipS(veins.map(l => St(l, vpen)), poly, true));
  st.push(...clipS([St(closed(scl(poly, 0.88, 0.88, 0, lead(0) + h(0))), vpen)], poly, true));
  for (let i = 0; i + 1 < n; i++) { const u = rnd(0.35, 0.65), a = veins[i][floor(u * 40)], b = veins[i + 1][floor(u * 40)]; if (a && b) st.push(St([a, b], vpen)); }
  const bc = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * PI * 2; bc.push([S * (0.14 + 0.06 * cos(a)), yAt(0.14, 0.42) + C * 0.12 * sin(a)]); }
  st.push(St(closed(bc), vpen));
  st.push(...wingTint(P, poly, W, uOf));
  return part(st, poly);
}
function opaqueWingFn(P, uOf, fOf) { // tegmina / hemelytra / leaf wings are coloured all over
  const base = P.pen.wing, w2 = P.pen.wing2, pt = P.wingPattern;
  if (pt === 'spots' || pt === 'windows') { const sp = poissonVar({x0: 0, y0: 0, x1: 1, y1: 1}, () => rnd(0.12, 0.2), 200).map(p => [...p, rnd(0.04, 0.08)]); const v = pt === 'spots' ? 0 : -1; return (x, y) => { const u = uOf(x), f = fOf(x, y); for (const s of sp) if (((u - s[0]) * 3) ** 2 + (f - s[1]) ** 2 < (s[2] * 3) ** 2) return v; return base; }; }
  if (pt === 'bands' || pt === 'crosslines') { const k = rint(2, 4); return (x, y) => (floor(uOf(x) * k * 2 + 0.3 * sin(fOf(x, y) * 6)) % 2) ? w2 : base; }
  if (pt === 'stripes') { const k = rint(3, 6); return (x, y) => (floor(fOf(x, y) * k * 2) % 2) ? w2 : base; }
  if (pt === 'marbled' || pt === 'patches') { const z = rnd(60, 80); return (x, y) => noise(x * 0.09, y * 0.09, z) > 0.57 ? w2 : base; }
  if (pt === 'eyespots') return (x, y) => { const d = hypot((uOf(x) - 0.72) * 3.2, fOf(x, y) - 0.5) / 0.3; return d < 0.35 ? -1 : d < 0.6 ? 0 : d < 1 ? w2 : base; };
  if (pt === 'gradient' || pt === 'tint') return (x, y) => uOf(x) + (hash2(x * 2.3, y * 1.9) - 0.5) * 0.25 < 0.55 ? base : w2;
  if (pt === 'border') return (x, y) => { const f = fOf(x, y); return f < 0.12 || f > 0.88 ? 0 : base; };
  return () => base;
}
function opaqueWing(P, W) { // tegmina (leathery), hemelytra (half leathery, half membrane), leaf
  const S = W.S, C = W.C, t = W.type;
  let h, lead;
  if (t === 'leaf') { h = u => C * 0.5 * pow(max(0, sin(PI * pow(u, 0.8))), 0.75) * (0.3 + 0.7 * smooth(0, 0.15, u)); lead = u => -h(u); }
  else { h = u => C * 0.5 * (0.45 + 0.55 * smooth(0, 0.2, u)) * pow(max(0, 1 - pow(u, t === 'hemelytra' ? 3 : 4)), 0.5); lead = u => -h(u) * 0.9 + C * 0.04 * u; }
  const poly = stripWing(W, lead, h), st = [outline(poly)], yAt = (u, f) => lead(u) + 2 * h(u) * f, uOf = x => clamp(x / S, 0, 1);
  const fOf = (x, y) => { const u = uOf(x), hh = h(u) || 1; return clamp((y - lead(u)) / (2 * hh), 0, 1); };
  const vline = (ff, u0, u1) => { const l = []; for (let k = 0; k <= 40; k++) { const u = lerp(u0, u1, k / 40); l.push([u * S, yAt(u, ff(u))]); } return St(l); };
  const fn = opaqueWingFn(P, uOf, fOf);
  if (t === 'leaf') {
    st.push(vline(() => 0.5, 0.01, 0.97));
    const n = rint(7, 10);
    for (let i = 1; i <= n; i++) { const u = 0.04 + i * 0.85 / (n + 1); for (const f of [0.05, 0.95]) { const a = [u * S, yAt(u, 0.5)], b = [(u + 0.12) * S, yAt(min(1, u + 0.12), f)]; st.push(...clipS([St(quadPath(a, [(u + 0.03) * S, yAt(u + 0.03, lerp(0.5, f, 0.7))], b, 8))], poly, true)); } }
    st.push(...penSplit(hatch(poly, -0.5, SP * 1.4), fn));
  } else if (t === 'tegmina') {
    for (const f of [0.12, 0.3, 0.5, 0.72]) st.push(vline(u => f * (1 - 0.3 * smooth(0.6, 1, u)) + 0.15 * smooth(0.6, 1, u), 0.02, 0.95));
    const bb = bbox(poly), cs = S * 0.05, seeds = poissonVar({x0: bb.x0 - 2, y0: bb.y0 - 2, x1: bb.x1 + 2, y1: bb.y1 + 2}, () => cs, 2500);
    st.push(...clipS(voronoiEdges(seeds).map(e => St(e)), poly, true));
    st.push(...penSplit(hatch(poly, 0.6, SP * 1.5), fn));
  } else { // hemelytra
    const uM = rnd(0.58, 0.68), cor = [];
    for (let k = 0; k <= 30; k++) { const u = uM * k / 30; cor.push([u * S, yAt(u, 0)]); }
    for (let k = 0; k <= 12; k++) { const f = k / 12, u = uM - 0.08 + 0.14 * f; cor.push([u * S, yAt(u, f)]); }
    for (let k = 30; k >= 0; k--) { const u = (uM + 0.06) * k / 30; cor.push([u * S, yAt(u, 1)]); }
    st.push(St(closed(cor)), vline(() => 0.78, 0.02, uM * 0.85));
    st.push(...clipS(penSplit(hatch(cor, 0.6, SP * 1.15), fn), poly, true));
    for (let i = 0; i < 5; i++) { const f = 0.15 + i * 0.17; st.push(...clipS([vline(() => f, uM - 0.05 + 0.14 * f, 0.97)], poly, true)); }
  }
  return part(st, poly);
}
function fanWing(P, W) { // pleated fan hindwing (grasshopper / mantis / cockroach)
  const S = W.S, a0 = -0.25, a1 = 1.85, n = 90;
  const R = a => S * (0.72 + 0.28 * sin(PI * (a - a0) / (a1 - a0))) * (1 - 0.025 * (1 - abs(cos((a - a0) / (a1 - a0) * PI * W.pleats))));
  const poly = [[0, 0]]; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); poly.push([cos(a) * R(a), sin(a) * R(a)]); }
  const st = [outline(poly)];
  for (let k = 1; k < W.pleats; k++) { const a = lerp(a0, a1, k / W.pleats); st.push(St([[cos(a) * S * 0.05, sin(a) * S * 0.05], [cos(a) * R(a) * 0.995, sin(a) * R(a) * 0.995]])); }
  const b1 = rnd(0.45, 0.65), b2 = b1 + rnd(0.12, 0.22), w = P.pen.wing, w2 = P.pen.wing2;
  const fn = (x, y) => { const a = atan2(y, x), r = hypot(x, y) / R(a); if (W.band) return r < b1 ? w : r < b2 ? 0 : (P.wingPattern === 'none' ? -1 : w2); return r + (hash2(x * 3, y * 2) - 0.5) * 0.3 < b2 ? w : -1; };
  st.push(...penSplit(radialFill(poly, -S * 0.02, 0, SP * 1.3), fn));
  return part(st, poly);
}
function haltere(P, W) {
  const stalk = tube(arcPath(0, 0, 0, 0.3, W.S, 8), () => 0.35), e = [W.S * 0.98, W.S * 0.15], knob = ellipse(e[0], e[1], 1.4, 1.1, 0.3, 14);
  return part([outline(stalk), outline(knob), ...hatch(knob, PI / 4, SP * 0.8, P.pen.wing2)], [stalk, knob]);
}
function wingPart(P, W, fore) {
  if (W.type === 'scaled' || W.type === 'tailed') return scaledWing(P, W, fore);
  if (W.type === 'net') return netWing(P, W);
  if (W.type === 'membrane') return membraneWing(P, W, fore);
  if (W.type === 'clear') return clearWing(P, W, fore);
  if (W.type === 'tegmina' || W.type === 'hemelytra' || W.type === 'leaf') return opaqueWing(P, W);
  if (W.type === 'fan') return fanWing(P, W);
  if (W.type === 'halteres') return haltere(P, W);
  return null;
}

// ============================================================ legs & tail
function legParts(P, B, anchor, idx) {
  const L = P.L, style = P.legs, front = idx === 0 ? P.frontLegs : 'normal', hind = idx === 2 ? P.hindLegs : 'normal';
  const len = min(B.len, 140) * 0.9, kk = L.k * [0.85, 1, 1.2, 1.1][idx], pose = L.pose[idx], parts = [];
  let fl = 0.2 * len * kk, tl = 0.2 * len * kk, sl = 0.15 * len * kk, fw = 0.028 * len * L.thick, tw = 0.019 * len * L.thick, sw = 0.011 * len * min(1, L.thick * 1.3);
  let af = pose.fem * D2R, at = af + pose.tib * D2R, as = at + pose.tar * D2R;
  if (hind === 'jumping') { fl *= 1.35; fw *= 2.1; tl *= 1.1; }
  if (hind === 'paddle') { tw *= 2.2; sw *= 1.9; af = rnd(40, 60) * D2R; at = af + rnd(10, 25) * D2R; as = at + 0.1; }
  if (hind === 'long' || front === 'long') { fl *= 1.5; tl *= 1.6; sl *= 1.3; }
  if (front === 'raptorial') { fl *= 1.4; fw *= 1.6; af = rnd(-80, -60) * D2R; at = af + rnd(150, 165) * D2R; as = at + 0.6; tl *= 0.9; }
  if (front === 'fossorial') { tw *= 2.3; tl *= 0.8; }
  const fem = arcPath(anchor[0], anchor[1], af - 0.1, af + 0.1, fl, 10), knee = fem[fem.length - 1];
  const tib = arcPath(knee[0], knee[1], at - 0.06, at + 0.08, tl, 10), ankle = tib[tib.length - 1];
  const legFill = (poly, dense) => P.pen.leg === 0 ? hatch(poly, PI / 4, SP * dense, 0) : hatch(poly, PI / 4, SP * 1.3, P.pen.leg).concat(rimShade(poly, SP));
  const segPart = (path, wfn, dense = 1.1) => { const poly = tube(path, wfn); const st = [outline(poly), ...legFill(poly, dense)]; if (style === 'hairy') st.push(...fur(poly, 1.2, 0, PI / 2, false)); return part(st, poly); };
  const spines = (pt, path, w, count, sides, lenK = 2.2) => { for (let k = 0; k < count; k++) { const t = lerp(0.15, 0.92, k / max(1, count - 1)), p = pathAt(path, t), d = pathDir(path, t); for (const s of sides) { const o = [p[0] + cos(d + s * PI / 2) * w, p[1] + sin(d + s * PI / 2) * w]; pt.strokes.push(St([o, [o[0] + cos(d + s * 2.3) * w * lenK, o[1] + sin(d + s * 2.3) * w * lenK]])); } } };
  const leaf = (path, w, k) => { // leafy flange around a leg segment
    const poly = tube(path, t => w * (1 + k * pow(sin(PI * t), 1.2)) + 0.4 * sin(t * PI * 6) * sin(PI * t));
    const st = [outline(poly), St(path), ...penSplit(hatch(poly, -0.6, SP * 1.4), () => P.pen.wing)];
    for (let i = 1; i < 5; i++) { const t = i / 5, p = pathAt(path, t), d = pathDir(path, t); for (const s of [-1, 1]) st.push(...clipS([St([p, [p[0] + cos(d + s * 0.8) * w * k, p[1] + sin(d + s * 0.8) * w * k]])], poly, true)); }
    return part(st, poly);
  };
  parts.push(part([outline(ellipse(anchor[0], anchor[1], fw * 1.5, fw * 1.2, af, 16))], ellipse(anchor[0], anchor[1], fw * 1.5, fw * 1.2, af, 16)));
  parts.push(style === 'leafy' ? leaf(fem, fw, 1.6) : segPart(fem, t => fw * (0.75 + 0.35 * sin(PI * t)), 1.0));
  const tp = style === 'leafy' && idx !== 0 ? leaf(tib, tw, 0.9) : segPart(tib, t => tw * (0.7 + 0.4 * t), 1.15);
  if (style === 'walking' || style === 'long') spines(tp, tib, tw, 5, [front === 'raptorial' ? 1 : -1]);
  if (style === 'spiny' || hind === 'jumping') { spines(tp, tib, tw, 8, [-1, 1], 2.6); spines(parts[parts.length - 1], fem, fw * 0.9, 4, [1], 1.6); }
  if (front === 'raptorial' && style !== 'walking' && style !== 'long') spines(tp, tib, tw, 5, [1]);
  if (front === 'fossorial') for (let k = 0; k < 3; k++) { const t = lerp(0.45, 0.95, k / 2), p = pathAt(tib, t), d = pathDir(tib, t) - PI / 2; parts.push(tubePart(arcPath(p[0] + cos(d) * tw * 0.8, p[1] + sin(d) * tw * 0.8, d, d - 0.3, tw * 1.4, 5), q => tw * 0.45 * (1 - q))); }
  if (style === 'hairy' && idx === 2) { const c = pathAt(tib, 0.65), bp = ellipse(c[0], c[1], tl * 0.28, tw * 1.7, pathDir(tib, 0.65), 20); parts.push(part([outline(bp), ...hatch(bp, PI / 4, SP, P.pen.accent || P.pen.wing)], bp)); }
  parts.push(tp);
  // tarsus: chain of tarsomeres + claws
  const tar = arcPath(ankle[0], ankle[1], as - 0.1, as + 0.15, sl, 16), n = L.tars;
  for (let i = 0; i < n; i++) { const sp = subPath(tar, i / n, (i + 0.9) / n), poly = tube(sp, t => sw * (0.65 + 0.35 * sin(PI * t)) * (i === n - 1 ? 0.8 : 1)); parts.push(part([outline(poly), ...legFill(poly, 1.2)], poly)); }
  if (hind === 'paddle') { // swimming fringe
    const st = []; for (const path of [tib, tar]) for (let k = 0; k < 14; k++) { const t = k / 13, p = pathAt(path, t), d = pathDir(path, t) + PI / 2; st.push(St([p, [p[0] + cos(d + 0.3) * tw * 2.4, p[1] + sin(d + 0.3) * tw * 2.4]])); }
    parts.push(part(st, null));
  }
  const tip = tar[tar.length - 1], d = pathDir(tar, 0.98), cl = [];
  for (const s of [-1, 1]) cl.push(St(arcPath(tip[0], tip[1], d + s * 0.5, d + s * 1.8, sw * 2.2, 5)));
  parts.push(part(cl, null));
  return parts;
}
function tailParts(P, B) {
  const A = B.abd, end = A.y0 + A.l - 0.3, T = P.TL, parts = [], bp = P.pen.part.abd;
  if (P.tail === 'stinger') parts.push(tubePart(arcPath(0, end - 1, PI / 2, PI / 2, T.len + 1, 6), t => 0.8 * (1 - t), 0, 0.7));
  else if (P.tail === 'ovipositor') { const c = rnd(-0.25, 0.25), path = arcPath(0, end - 1, PI / 2, PI / 2 + c, T.len, 40); for (const o of [-0.5, 0, 0.5]) parts.push(part([St(path.map((p, i) => [p[0] + o * (1 - i / path.length * 0.6), p[1]]))], null)); }
  else if (P.tail === 'cerci') { const angs = T.three ? [-T.spread, 0, T.spread] : [-T.spread / 2, T.spread / 2]; for (const a of angs) { const path = arcPath(0, end - 0.5, PI / 2 + a, PI / 2 + a * 1.3, T.len, 20), poly = tube(path, t => 0.45 * (1 - 0.8 * t)); parts.push(part([outline(poly)], poly)); } }
  else if (P.tail === 'forceps') for (const s of [-1, 1]) { const path = arcPath(s * 1.6, end - 1, PI / 2 - s * 0.3, PI / 2 + s * 1.2, T.len, 16); parts.push(tubePart(path, t => 1.3 * (1 - 0.75 * t), P.pen.leg === 0 ? 0 : P.pen.leg)); }
  else if (P.tail === 'filaments') { const angs = T.three ? [-T.spread * 0.3, 0, T.spread * 0.3] : [-T.spread * 0.2, T.spread * 0.2]; for (const a of angs) { const pts = [], n = 60; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([sin(a) * T.len * t + sin(t * 9 + a * 5) * 0.6 * t, end + cos(a) * T.len * t]); } parts.push(part([St(pts)], null)); } }
  else if (P.tail === 'tuft') { const st = []; for (let i = 0; i < 26; i++) { const a = PI / 2 + lerp(-0.9, 0.9, i / 25) + (hash2(i, 3) - 0.5) * 0.2, l = T.len * (0.6 + 0.4 * hash2(i, 7)), s = [sin(a - PI / 2) * 1.2, end - 1]; st.push(St(quadPath(s, [s[0] + cos(a) * l * 0.5, s[1] + sin(a) * l * 0.5], [s[0] + cos(a + 0.25) * l, s[1] + sin(a + 0.25) * l], 5), bp)); } parts.push(part(st, null)); }
  else if (P.tail === 'scorpion') {
    let y = end; [1.7, 1.4, 1.15].forEach(r => { const e = ellipse(0, y + r * 1.1, r, r * 1.3, 0, 16); parts.push(part([outline(e), ...hatch(e, PI / 4, SP * 1.2, bp)], e)); y += r * 2.2; });
    const bulb = ellipse(0, y + T.len * 0.3, 2.6, T.len * 0.32, 0, 24); parts.push(part([outline(bulb), ...surface(P, bulb, {single: true, tex: 'hatch', penFn: () => bp})], bulb));
    parts.push(tubePart(arcPath(0, y + T.len * 0.6, PI / 2, PI / 2 + 2.6, T.len * 0.7, 12), t => 0.8 * (1 - 0.85 * t)));
  }
  return parts.map(p => bendPart(B, p));
}

// ============================================================ assembly (front-to-back)
function build(P) {
  srand(P.seed ^ 0x9E3779B9); initNoise();
  const S = new Scene(), B = layout(P), pat = makePattern(P, B);
  const centre = parts => { for (const p of parts) S.addPart(p); };
  const mouth = mouthParts(P, B); // may move the antenna anchor (rostrum)
  addPair(S, antennaParts(P.antenna, P.AN, B.antAnchor, P));
  if (P.mut.twinAntennae) addPair(S, antennaParts(P.antenna2, P.AN2, [B.head.wfn(0.3) * 0.9, B.head.y0 + B.head.l * 0.3], P));
  const horns = hornParts(P, B); centre(horns.centre); addPair(S, horns.pair);
  const pron = pronotumParts(P, B, pat), eyes = eyeParts(P, B);
  const headStuff = () => { addPair(S, eyes.pair); centre(eyes.centre); drawHead(S, P, B, pat); };
  if (SHIELDISH.includes(P.pronotum)) { addPair(S, pron.spikes); S.addPart(pron.body); headStuff(); } else { headStuff(); addPair(S, pron.spikes); S.addPart(pron.body); }
  addPair(S, mouth.pair); centre(mouth.centre);
  const T = B.thor, hinge = t => [T.wfn(t) * 0.5, T.y0 + T.l * t];
  if (P.thorax === 'scutellum') S.addPart(scutellumPart(P, B, pat));
  if (P.forewing === 'elytra') addPair(S, [elytronPart(P, B, pat)]);
  if (P.FW.fold) { // folded leathery forewings lie over the body
    const hy = T.y0 + T.l * 0.2, W = Object.assign({}, P.FW);
    W.S = (B.len - hy) * W.foldLen; W.C = max(P.A.w, P.T.w) * W.foldW;
    const wp = wingPart(P, W, true); if (wp) addPair(S, [xformPart(wp, PI / 2 + W.foldAng, T.wfn(0.2) * 0.45, hy)]);
  }
  drawThorax(S, P, B, pat); drawWaist(S, P, B); drawAbdomen(S, P, B, pat);
  centre(tailParts(P, B));
  const wings = [];
  if (P.FW.S && !P.FW.fold) wings.push([P.FW, true, hinge(0.3)]);
  if (P.HW.S) wings.push([P.HW, false, hinge(0.75)]);
  if (P.mut.extraWings) { const W = Object.assign({}, P.HW, {S: P.HW.S * 0.7, C: (P.HW.C || 0) * 0.7, theta: P.HW.theta + 0.45}); wings.push([W, false, B.bendPt([B.abd.wfn(0.25) * 0.5, B.abd.y0 + B.abd.l * 0.25])]); }
  for (const [W, fore, hg] of wings) { const wp = wingPart(P, W, fore); if (wp) addPair(S, [xformPart(wp, W.theta, hg[0], hg[1])]); }
  const frontT = P.pronotum === 'neck' ? 0.15 : 0.6, longT = P.thorax === 'long';
  const anchors = [[B.pron.wfn(frontT) * 0.6, B.pron.y0 + B.pron.l * frontT], [T.wfn(longT ? 0.72 : 0.4) * 0.65, T.y0 + T.l * (longT ? 0.72 : 0.4)], [T.wfn(0.92) * 0.65, T.y0 + T.l * 0.92]];
  if (P.mut.extraLegs) anchors.push(B.bendPt([B.abd.wfn(0.3) * 0.45, B.abd.y0 + B.abd.l * 0.3]));
  anchors.forEach((a, i) => addPair(S, legParts(P, B, a, i)));
  return S.strokes;
}

// ============================================================ Hershey font data (from fishdraw)
var hershey_raw = {
"501":"  9I[RFJ[ RRFZ[ RMTWT",
"502":" 24G\\KFK[ RKFTFWGXHYJYLXNWOTP RKPTPWQXRYTYWXYWZT[K[",
"503":" 19H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZV",
"504":" 16G\\KFK[ RKFRFUGWIXKYNYSXVWXUZR[K[",
"505":" 12H[LFL[ RLFYF RLPTP RL[Y[",
"506":"  9HZLFL[ RLFYF RLPTP",
"507":" 23H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZVZS RUSZS",
"508":"  9G]KFK[ RYFY[ RKPYP",
"509":"  3NVRFR[",
"510":" 11JZVFVVUYTZR[P[NZMYLVLT",
"511":"  9G\\KFK[ RYFKT RPOY[",
"512":"  6HYLFL[ RL[X[",
"513":" 12F^JFJ[ RJFR[ RZFR[ RZFZ[",
"514":"  9G]KFK[ RKFY[ RYFY[",
"515":" 22G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF",
"516":" 14G\\KFK[ RKFTFWGXHYJYMXOWPTQKQ",
"517":" 25G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF RSWY]",
"518":" 17G\\KFK[ RKFTFWGXHYJYLXNWOTPKP RRPY[",
"519":" 21H\\YIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX",
"520":"  6JZRFR[ RKFYF",
"521":" 11G]KFKULXNZQ[S[VZXXYUYF",
"522":"  6I[JFR[ RZFR[",
"523":" 12F^HFM[ RRFM[ RRFW[ R\\FW[",
"524":"  6H\\KFY[ RYFK[",
"525":"  7I[JFRPR[ RZFRP",
"526":"  9H\\YFK[ RKFYF RK[Y[",
"601":" 18I\\XMX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
"602":" 18H[LFL[ RLPNNPMSMUNWPXSXUWXUZS[P[NZLX",
"603":" 15I[XPVNTMQMONMPLSLUMXOZQ[T[VZXX",
"604":" 18I\\XFX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
"605":" 18I[LSXSXQWOVNTMQMONMPLSLUMXOZQ[T[VZXX",
"606":"  9MYWFUFSGRJR[ ROMVM",
"607":" 23I\\XMX]W`VaTbQbOa RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
"608":" 11I\\MFM[ RMQPNRMUMWNXQX[",
"609":"  9NVQFRGSFREQF RRMR[",
"610":" 12MWRFSGTFSERF RSMS^RaPbNb",
"611":"  9IZMFM[ RWMMW RQSX[",
"612":"  3NVRFR[",
"613":" 19CaGMG[ RGQJNLMOMQNRQR[ RRQUNWMZM\\N]Q][",
"614":" 11I\\MMM[ RMQPNRMUMWNXQX[",
"615":" 18I\\QMONMPLSLUMXOZQ[T[VZXXYUYSXPVNTMQM",
"616":" 18H[LMLb RLPNNPMSMUNWPXSXUWXUZS[P[NZLX",
"617":" 18I\\XMXb RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
"618":"  9KXOMO[ ROSPPRNTMWM",
"619":" 18J[XPWNTMQMNNMPNRPSUTWUXWXXWZT[Q[NZMX",
"620":"  9MYRFRWSZU[W[ ROMVM",
"621":" 11I\\MMMWNZP[S[UZXW RXMX[",
"622":"  6JZLMR[ RXMR[",
"623":" 12G]JMN[ RRMN[ RRMV[ RZMV[",
"624":"  6J[MMX[ RXMM[",
"625":" 10JZLMR[ RXMR[P_NaLbKb",
"626":"  9J[XMM[ RMMXM RM[X[",
"710":"  6MWRYQZR[SZRY",
};

// ============================================================ text (Hershey single-stroke font, via fishdraw)
const hershey_cache = {};
function compileHershey(i) {
  if (hershey_cache[i]) return hershey_cache[i];
  const e = hershey_raw[i]; if (e == null) return null;
  const R = 82, xmin = e.charCodeAt(3) - R, xmax = e.charCodeAt(4) - R, c = e.substring(5), pl = [[]];
  for (let j = 0; j < c.length; j += 2) { const d = c.substring(j, j + 2); if (d === ' R') pl.push([]); else pl[pl.length - 1].push([d.charCodeAt(0) - R, d.charCodeAt(1) - R]); }
  return (hershey_cache[i] = {xmin, xmax, polylines: pl.filter(p => p.length > 1)});
}
function putText(txt) { // returns [width, polylines] in font units (~21 units cap height)
  let x = 0; const o = [];
  for (const ch of txt) {
    const ord = ch.charCodeAt(0); let idx;
    if (ord >= 65 && ord <= 90) idx = 501 + ord - 65; else if (ord >= 97 && ord <= 122) idx = 601 + ord - 97; else if (ord === 46) idx = 710;
    else { x += 10; continue; }
    const g = compileHershey(idx); if (!g) { x += 10; continue; }
    o.push(...g.polylines.map(p => tr(p, x - g.xmin, 0))); x += g.xmax - g.xmin;
  }
  return [x, o];
}

// ============================================================ page layout, cleanup, plot order
const PAPER = {a5: [148, 210], a4: [210, 297], a3: [297, 420], letter: [215.9, 279.4], square: [250, 250]};
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dm = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b); if (d > dm) { dm = d; idx = i; } }
  if (dm <= eps) return [a, b];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}
function sortStrokes(strokes) { // greedy nearest-neighbour with reversal, per pen, using a spatial grid
  const out = [], G = 4;
  for (const pen of [...new Set(strokes.map(s => s.pen))]) {
    const pool = strokes.filter(s => s.pen === pen), n = pool.length, used = new Uint8Array(n), grid = new Map();
    const key = (i, j) => i * 73856093 ^ j * 19349663;
    pool.forEach((s, idx) => { for (let e = 0; e < 2; e++) { const p = e ? s.pts[s.pts.length - 1] : s.pts[0], k = key(floor(p[0] / G), floor(p[1] / G)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx * 2 + e); } });
    let cur = [0, 0], left = n, scan = 0;
    while (left) {
      let best = -1, bd = Infinity; const ci = floor(cur[0] / G), cj = floor(cur[1] / G);
      for (let r = 0; r < 300; r++) {
        for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
          if (max(abs(i - ci), abs(j - cj)) !== r) continue;
          const cell = grid.get(key(i, j)); if (!cell) continue;
          for (const code of cell) { const idx = code >> 1; if (used[idx]) continue; const s = pool[idx], p = (code & 1) ? s.pts[s.pts.length - 1] : s.pts[0], d = dist(cur, p); if (d < bd) { bd = d; best = code; } }
        }
        if (best >= 0 && bd <= r * G) break;
      }
      if (best < 0) { while (used[scan]) scan++; best = scan * 2; }
      const idx = best >> 1, s = pool[idx]; used[idx] = 1; left--;
      if (best & 1) s.pts.reverse();
      out.push(s); cur = s.pts[s.pts.length - 1];
    }
  }
  return out;
}

// ============================================================ main entry
function generate(opt = {}) {
  const name = opt.seed || (() => { srand((Math.random() * 4294967295) >>> 0); return binomen(); })();
  const seed = hashStr(name);
  srand(seed);
  const P = genParams(opt); P.seed = seed; P.name = name;
  // pass 1: measure. pass 2: rebuild with hatch spacing tuned so it is constant on paper.
  const target = opt.spacing || 0.55; // mm between hatch lines
  SP = 1; FILLS = false;
  let strokes = build(P);
  let bb = bbox(strokes.flatMap(s => s.pts));
  let [pw, ph] = PAPER[opt.paper || 'a4'] || PAPER.a4;
  if ((opt.orient === 'landscape') || (opt.orient !== 'portrait' && (bb.x1 - bb.x0) > (bb.y1 - bb.y0) * 1.1)) [pw, ph] = [max(pw, ph), min(pw, ph)];
  const margin = opt.margin != null ? +opt.margin : 18, label = opt.label !== false, lh = label ? 14 : 0;
  const s = min((pw - margin * 2) / (bb.x1 - bb.x0), (ph - margin * 2 - lh) / (bb.y1 - bb.y0));
  SP = target / s; FILLS = true;
  strokes = build(P);
  bb = bbox(strokes.flatMap(st => st.pts));
  const ox = (pw - (bb.x1 - bb.x0) * s) / 2 - bb.x0 * s, oy = margin + (ph - margin * 2 - lh - (bb.y1 - bb.y0) * s) / 2 - bb.y0 * s;
  strokes = strokes.map(st => St(st.pts.map(p => [p[0] * s + ox, p[1] * s + oy]), st.pen));
  if (label) {
    const [tw, tp] = putText(name), ts = 0.16, y = ph - margin - lh * 0.35;
    for (const p of tp) strokes.push(St(tr(scl(p.map(q => [q[0] - q[1] * 0.25, q[1]]), ts), pw / 2 - tw * ts / 2, y), 0));
  }
  strokes = strokes.map(st => St(rdp(st.pts, 0.03).map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]), st.pen)).filter(st => st.pts.length > 1 && polyLen(st.pts) > 0.15);
  if (opt.sort !== false) strokes = sortStrokes(strokes);
  return {name, params: P, strokes, width: pw, height: ph, colors: P.colors};
}

function luminance(hex) { const v = parseInt(hex.slice(1), 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255); }
// pen layers, light colours first, black last (Inkscape layers; vpype reads each as its own layer)
function penOrder(R) { const used = [...new Set(R.strokes.map(s => s.pen))]; return used.sort((a, b) => (a === 0) - (b === 0) || luminance(R.colors[b][0]) - luminance(R.colors[a][0])); }
function toSVG(R, opt = {}) {
  const sw = opt.strokeWidth || 0.3, order = penOrder(R);
  let o = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${R.width}mm" height="${R.height}mm" viewBox="0 0 ${R.width} ${R.height}">\n`;
  o += `<title>${R.name}</title>\n`;
  if (opt.background) o += `<rect width="${R.width}" height="${R.height}" fill="${opt.background}"/>\n`;
  order.forEach((pen, i) => {
    const [col, nm] = R.colors[pen];
    o += `<g inkscape:groupmode="layer" inkscape:label="${i + 1} - ${nm}" id="layer${i + 1}" stroke="${col}" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">\n`;
    for (const s of R.strokes) if (s.pen === pen) o += `<path d="M${s.pts.map(p => p[0] + ' ' + p[1]).join(' L')}"/>\n`;
    o += `</g>\n`;
  });
  return o + `</svg>\n`;
}
function toJSON(R) { return JSON.stringify({name: R.name, width: R.width, height: R.height, pens: penOrder(R).map(p => ({pen: p, color: R.colors[p][0], name: R.colors[p][1]})), strokes: R.strokes.map(s => ({pen: s.pen, pts: s.pts}))}); }

if (typeof module !== 'undefined') {
  module.exports = {generate, toSVG, toJSON, genParams, binomen, SLOTS, ARCHETYPES, PALETTES, _dbg: {scaledWing, catmull, resample, closed, radialFill, clipPts, bbox, pip, srand, initNoise, setFills: (f, s) => { FILLS = f; SP = s; }}};
  if (require.main === module) {
    const opt = {}, a = process.argv.slice(2);
    for (let i = 0; i < a.length; i++) {
      const k = a[i].replace(/^--/, ''), v = a[i + 1];
      if (k === 'no-label') opt.label = false; else if (k === 'no-sort') opt.sort = false; else if (k === 'help') opt.help = true; else { opt[k] = v; i++; }
    }
    if (opt.help) {
      console.log(`usage: node insectdraw.js [options] > out.svg
  --seed "Genus species"   name = seed (random if omitted)
  --arch ${Object.keys(ARCHETYPES).join("|")}
  --weird 0..1             0 = faithful archetype, 1 = every part from the full parts bin
  --pens 1|2|3             number of colour pens (plus black)
  --palette ${Object.keys(PALETTES).join('|')}
  --paper a5|a4|a3|letter|square   --orient portrait|landscape   --margin mm
  --spacing mm             hatch spacing on paper (default 0.55)
  --format svg|json        --no-label   --no-sort`);
      process.exit(0);
    }
    if (opt.spacing) opt.spacing = +opt.spacing;
    const R = generate(opt);
    console.log(opt.format === 'json' ? toJSON(R) : toSVG(R));
  }
}
if (typeof window !== 'undefined') window.insectdraw = {generate, toSVG, toJSON, SLOTS, ARCHETYPES, PALETTES};

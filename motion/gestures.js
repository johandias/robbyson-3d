import * as T from 'three';

export const GESTURES = ['explain_right', 'explain_left', 'explain_dual', 'compare', 'emphasis', 'palms', 'stacked'];
export const CONTACTS = new Set(['palms', 'stacked']);
export const smooth = t => { t = T.MathUtils.clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export function seededRandom(seed = 417) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function pose() {
  return { name: 'rest', left: new T.Vector3(), right: new T.Vector3(), leftQ: new T.Quaternion(), rightQ: new T.Quaternion(), open: 0.15, restWeight: 1 };
}
export function copyPose(to, from) {
  to.name = from.name; to.left.copy(from.left); to.right.copy(from.right);
  to.leftQ.copy(from.leftQ); to.rightQ.copy(from.rightQ); to.open = from.open; to.restWeight = from.restWeight;
  return to;
}
export function makePose(rig, name) {
  const p = pose(); p.name = name;
  const h = rig.height, y = rig.hips.y, z = rig.chest.z;
  const direction = new T.Vector3(), normal = new T.Vector3();
  const set = (side, x, rise, reach, dx, dy, dz, nx, ny, nz) => {
    p[side].set(x * h, y + rise * h, z + reach * h);
    rig.orientation(side, direction.set(dx, dy, dz), normal.set(nx, ny, nz), p[side + 'Q']);
  };
  // Use the original model-specific idle arm directions as the rest pose.
  for (const side of ['left', 'right']) {
    p[side].copy(rig.restArms[side].palm);
    p[side + 'Q'].copy(rig.restArms[side].rotation);
  }
  if (name === 'rest') return p;
  p.open = 0.83; p.restWeight = 0;
  set('left', 0.12, 0.035, 0.125, -0.15, 0.05, 1, 0, 1, -0.05);
  set('right', -0.12, 0.035, 0.125, 0.15, 0.05, 1, 0, 1, -0.05);
  if (name === 'explain_right' || name === 'emphasis') {
    set('right', -0.14, name === 'emphasis' ? 0.13 : 0.095, 0.145, -0.2, 0.35, 1, 0, 1, -0.35);
  } else if (name === 'explain_left') {
    set('left', 0.14, 0.095, 0.145, 0.2, 0.35, 1, 0, 1, -0.35);
  } else if (name === 'explain_dual') {
    set('left', 0.145, 0.085, 0.145, 0.3, 0.2, 1, 0, 1, -0.2);
    set('right', -0.145, 0.085, 0.145, -0.3, 0.2, 1, 0, 1, -0.2);
  } else if (name === 'compare') {
    set('left', 0.15, 0.12, 0.14, 0.3, 0.2, 1, 0, 1, -0.2);
    set('right', -0.135, 0.035, 0.14, -0.2, 0.15, 1, 0, 1, -0.15);
  } else if (name === 'palms') {
    p.open = 1;
    set('left', 0, 0.11, 0.15, 0, 1, 0.12, -1, 0, 0);
    set('right', 0, 0.11, 0.15, 0, 1, 0.12, 1, 0, 0);
    p.left.x = rig.hands.left.half.z + rig.margin / 2;
    p.right.x = -rig.hands.right.half.z - rig.margin / 2;
  } else if (name === 'stacked') {
    p.open = 1;
    set('left', 0, 0.065, 0.15, -1, 0, 0.14, 0, 1, 0);
    set('right', 0, 0.065, 0.15, 1, 0, 0.14, 0, -1, 0);
    p.left.y -= rig.hands.left.half.z + rig.margin / 2;
    p.right.y += rig.hands.right.half.z + rig.margin / 2;
  }
  return p;
}

// All changes, including interruption, begin at the actual current target pose.
export class GestureDirector {
  constructor(rig, random = seededRandom()) {
    this.rig = rig; this.random = random;
    this.current = makePose(rig, 'rest'); this.from = pose(); this.to = pose();
    this.library = new Map(['rest', ...GESTURES].map(name => [name, makePose(rig, name)]));
    this.name = 'rest'; this.phase = 'hold'; this.elapsed = 0; this.duration = 1;
    this.queue = []; this.hold = 0; this.time = 0; this.lastContact = -100;
    this.count = 0; this.restAfter = 2; this.wasSpeaking = false; this.pending = null;
    this.forced = null; this.forceRevision = false; this.changes = 0;
  }
  force(name) { this.forced = this.library.has(name) ? name : null; this.forceRevision = true; }
  start(name) {
    const target = this.library.get(name);
    this.queue.length = 0;
    if (CONTACTS.has(this.name) && this.current.left.distanceTo(this.current.right) < this.rig.height * 0.25) {
      const away = copyPose(pose(), this.current);
      away.left.x = Math.max(away.left.x, this.rig.height * 0.09);
      away.right.x = Math.min(away.right.x, -this.rig.height * 0.09);
      this.queue.push({ target: away, duration: 0.7, phase: 'release' });
    }
    if (CONTACTS.has(name)) {
      const align = copyPose(pose(), target);
      align.left.x += this.rig.height * 0.07; align.right.x -= this.rig.height * 0.07;
      this.queue.push({ target: align, duration: 1.0, phase: 'prepare' });
      this.queue.push({ target, duration: 0.85, phase: 'approach' });
      this.hold = 2 + this.random() * 2; this.lastContact = this.time;
    } else {
      this.queue.push({ target, duration: name === 'rest' ? 0.9 : 0.85, phase: name === 'rest' ? 'recover' : 'prepare' });
      this.hold = name === 'rest' ? 1 + this.random() : 3.2 + this.random() * 2.5;
    }
    this.name = name; this.changes++;
    this.next();
  }
  next() {
    const segment = this.queue.shift();
    if (!segment) { this.phase = 'hold'; this.elapsed = 0; return; }
    copyPose(this.from, this.current); copyPose(this.to, segment.target);
    // Quintic interpolation has bounded velocity/acceleration; stretch large turns.
    const angle = Math.max(this.from.leftQ.angleTo(this.to.leftQ), this.from.rightQ.angleTo(this.to.rightQ));
    const distance = Math.max(this.from.left.distanceTo(this.to.left), this.from.right.distanceTo(this.to.right));
    this.duration = Math.max(segment.duration, angle * 1.875 / 2.8, Math.sqrt(angle * 5.8 / 12), distance * 1.875 / (this.rig.height * 0.55));
    this.elapsed = 0; this.phase = segment.phase;
  }
  choose() {
    if (this.pending && this.time - this.pending.time < 8 && (!CONTACTS.has(this.pending.type) || this.time - this.lastContact >= 15)) {
      const type = this.pending.type; this.pending = null; return type;
    }
    const pool = GESTURES.filter(type => type !== this.name && (!CONTACTS.has(type) || this.time - this.lastContact >= 15));
    return pool[Math.floor(this.random() * pool.length)];
  }
  update(dt, input) {
    this.time += dt;
    if (input.cue && this.library.has(input.cue)) this.pending = { type: input.cue, time: this.time };
    if (!input.speaking) this.pending = null;
    if (this.forceRevision) { this.start(this.forced || 'rest'); this.forceRevision = false; }
    if (!this.forced) {
      if (!input.speaking && this.wasSpeaking) { this.start('rest'); this.count = 0; }
      if (input.speaking && !this.wasSpeaking && this.name === 'rest' && input.audible) this.start(this.choose());
      if (input.speaking && input.audible && this.phase === 'hold' && this.hold <= 0) {
        if (this.count >= this.restAfter && this.name !== 'rest') {
          this.start('rest'); this.count = 0; this.restAfter = this.random() < 0.5 ? 2 : 3;
        } else { this.start(this.choose()); this.count++; }
      }
    }
    this.wasSpeaking = input.speaking;
    if (this.phase === 'hold') { if (input.audible) this.hold -= dt; return this.current; }
    this.elapsed += dt;
    const t = smooth(this.elapsed / this.duration);
    this.current.left.lerpVectors(this.from.left, this.to.left, t);
    this.current.right.lerpVectors(this.from.right, this.to.right, t);
    this.current.leftQ.slerpQuaternions(this.from.leftQ, this.to.leftQ, t);
    this.current.rightQ.slerpQuaternions(this.from.rightQ, this.to.rightQ, t);
    this.current.open = T.MathUtils.lerp(this.from.open, this.to.open, t);
    this.current.restWeight = T.MathUtils.lerp(this.from.restWeight, this.to.restWeight, t);
    this.current.name = this.name;
    if (this.elapsed >= this.duration) this.next();
    return this.current;
  }
}

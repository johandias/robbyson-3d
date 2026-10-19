import * as T from 'three';
import { smooth } from './gestures.js';

export class Footwork {
  constructor(rig, random) {
    this.rig = rig; this.random = random;
    this.home = {}; this.positions = {}; this.from = new T.Vector3(); this.landing = new T.Vector3();
    for (const side of ['left', 'right']) {
      this.home[side] = rig.rest.get(side + 'Foot').world.clone();
      this.positions[side] = this.home[side].clone();
    }
    this.phase = 'planted'; this.elapsed = 0; this.wait = 25 + random() * 15;
    this.side = 'right'; this.length = rig.legs.left.first + rig.legs.left.second;
    this.support = 0; this.steps = 0;
  }
  request() {
    if (this.phase !== 'planted') return;
    this.side = this.side === 'left' ? 'right' : 'left';
    this.phase = 'shift'; this.elapsed = 0; this.from.copy(this.positions[this.side]); this.steps++;
  }
  update(dt, speaking) {
    if (this.phase === 'planted') {
      this.support = T.MathUtils.damp(this.support, 0, 4, dt);
      if (speaking) this.wait -= dt;
      if (this.wait <= 0 && speaking) this.request();
      return;
    }
    const foot = this.positions[this.side];
    if (!speaking && !['landing', 'settle'].includes(this.phase)) {
      this.from.copy(foot); this.landing.copy(foot); this.landing.y = this.home[this.side].y;
      this.phase = 'landing'; this.elapsed = 0;
    }
    this.elapsed += dt;
    const sign = this.side === 'left' ? -1 : 1;
    this.support = T.MathUtils.damp(this.support, sign, 5, dt);
    if (this.phase === 'shift' && this.elapsed >= 0.65) { this.phase = 'advance'; this.elapsed = 0; }
    else if (this.phase === 'advance') {
      const t = Math.min(1, this.elapsed / 1.15);
      this.landing.copy(this.home[this.side]); this.landing.z += this.length * 0.08;
      foot.lerpVectors(this.from, this.landing, smooth(t));
      foot.y += Math.sin(Math.PI * t) ** 2 * this.length * 0.025;
      if (t === 1) { this.phase = 'hold'; this.elapsed = 0; }
    } else if (this.phase === 'hold' && this.elapsed >= 0.8) {
      this.phase = 'return'; this.elapsed = 0; this.from.copy(foot);
    } else if (this.phase === 'return') {
      const t = Math.min(1, this.elapsed / 1.15);
      foot.lerpVectors(this.from, this.home[this.side], smooth(t));
      foot.y += Math.sin(Math.PI * t) ** 2 * this.length * 0.025;
      if (t === 1) { this.phase = 'settle'; this.elapsed = 0; }
    } else if (this.phase === 'landing') {
      const t = Math.min(1, this.elapsed / 0.4);
      foot.lerpVectors(this.from, this.landing, smooth(t));
      if (t === 1) { this.phase = 'settle'; this.elapsed = 0; }
    } else if (this.phase === 'settle' && this.elapsed >= 0.6) {
      this.phase = 'planted'; this.elapsed = 0; this.wait = 25 + this.random() * 15;
    }
  }
}

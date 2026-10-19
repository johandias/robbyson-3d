import * as T from 'three';
import { BodyRig } from './rig.js';
import { GestureDirector, CONTACTS, seededRandom } from './gestures.js';
import { HandContacts } from './constraints.js';
import { Footwork } from './feet.js';

export function createMotionController(model, bones, { seed = 417 } = {}) {
  return new MotionController(model, bones, seed);
}

class MotionController {
  constructor(model, bones, seed) {
    this.rig = new BodyRig(model, bones);
    this.seed = seed; this.random = seededRandom(seed);
    this.director = new GestureDirector(this.rig, this.random);
    this.contacts = new HandContacts(this.rig);
    this.feet = new Footwork(this.rig, this.random);
    this.time = 0; this.level = 0; this.activity = 0; this.shift = 0;
    this.shiftTarget = 0.4; this.shiftWait = 14; this.nod = 0; this.nodWait = 5;
    this.positions = { left: new T.Vector3(), right: new T.Vector3() };
    this.pelvis = new T.Vector3(); this.chest = new T.Vector3(); this.offset = new T.Vector3(); this.rootOffset = new T.Vector3();
    this.normal = new T.Vector3(); this.actual = new T.Vector3();
    this.debug = null; this.metrics = { separation: 0, footDrift: 0, reachError: 0 };
    this.lastInput = { mode: 'idle', speaking: false, audible: false, level: 0 };
    this.update(1 / 60, this.lastInput);
  }
  forceGesture(name) { this.director.force(name); }
  requestStep() { this.feet.request(); }
  reset() {
    this.director.pending = null; this.director.forced = null; this.director.start('rest');
    this.director.wasSpeaking = false; this.level = 0; this.activity = 0;
    this.feet.update(0, false);
  }
  update(delta, input) {
    // Substeps preserve dynamics under frame drops; a background tab never fast-forwards a gesture.
    const total = Math.min(Math.max(delta, 0), 0.1);
    const count = Math.max(1, Math.ceil(total / (1 / 60)));
    this.lastInput = input;
    for (let i = 0; i < count; i++) this.tick(total / count, input);
    if (this.debug) this.updateDebug();
    return this.metrics;
  }
  tick(dt, input) {
    const r = this.rig, h = r.height;
    this.time += dt;
    this.level = T.MathUtils.damp(this.level, input.level || 0, 5, dt);
    this.activity = T.MathUtils.damp(this.activity, input.speaking && !input.paused ? 1 : 0, 4, dt);
    const p = this.director.update(dt, input);
    const contact = CONTACTS.has(this.director.name);
    this.feet.update(dt, input.speaking || !!this.director.forced);
    this.shiftWait -= dt;
    if (this.shiftWait <= 0) {
      this.shiftTarget = (this.random() - 0.5) * 1.5;
      this.shiftWait = input.speaking ? 10 + this.random() * 6 : 12 + this.random() * 8;
    }
    this.shift = T.MathUtils.damp(this.shift, this.feet.phase === 'planted' ? this.shiftTarget : this.feet.support, 1.2, dt);
    const breath = Math.sin(this.time * 1.18);
    const lean = input.mode === 'listening' ? 0.022 : 0.009 + this.activity * 0.014;
    const lead = this.director.name === 'explain_left' ? -1 : this.director.name === 'explain_right' || this.director.name === 'emphasis' ? 1 : 0;
    this.pelvis.copy(r.hips);
    this.pelvis.x += this.shift * h * 0.009;
    this.pelvis.y -= h * (0.001 + Math.abs(this.shift) * 0.0015);
    r.offset('hips', 0, 0, -this.shift * 0.012);
    r.pelvis(this.pelvis);
    r.offset('spine', lean * 0.3, lead * this.activity * 0.010, this.shift * 0.008);
    r.offset('spine1', lean * 0.4, lead * this.activity * 0.014, 0);
    r.offset('spine2', lean * 0.3 + breath * 0.004, lead * this.activity * 0.016, 0);
    this.nodWait -= dt;
    if (this.nodWait <= 0) {
      this.nod = input.audible || input.mode === 'listening' ? 1 : 0.2;
      this.nodWait = 5 + this.random() * 5;
    }
    this.nod = T.MathUtils.damp(this.nod, 0, 2.4, dt);
    r.offset('neck', 0.006 + this.nod * 0.009, 0, 0);
    r.offset('head', this.nod * 0.026, Math.sin(this.time * 0.29) * 0.012, Math.sin(this.time * 0.37) * 0.008);
    r.bones.spine2.getWorldPosition(this.chest);
    this.offset.subVectors(this.chest, r.chest);
    const idle = this.director.name === 'rest' ? 1 : 0;
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? 1 : -1;
      r.offset(side + 'Shoulder', 0, sign * this.activity * 0.006, -sign * this.activity * 0.012);
      r.bones[side + 'Arm'].getWorldPosition(this.rootOffset);
      this.rootOffset.sub(r.rest.get(side + 'Arm').world);
      const pos = this.positions[side].copy(p[side])
        .addScaledVector(this.rootOffset, p.restWeight)
        .addScaledVector(this.offset, 1 - p.restWeight);
      // One shared contact frame: no independent wrist noise when hands meet.
      if (!contact) {
        const quiet = input.mode === 'listening' ? 0.45 : 1;
        pos.z += idle * quiet * h * 0.0004 * Math.sin(this.time * 0.7 + sign * 0.5);
        pos.y += idle * quiet * h * 0.00025 * Math.sin(this.time * 0.95 + sign);
        pos.y += (1 - idle) * this.activity * this.level * h * 0.008;
      }
      this.contacts.protectTorso(pos, this.chest);
    }
    r.metrics.reachError = 0; r.metrics.footDrift = 0;
    this.contacts.project(this.positions.left, p.leftQ, this.positions.right, p.rightQ);
    for (const side of ['left', 'right']) {
      r.arm(side, this.positions[side], p[side + 'Q'], p.restWeight);
      r.fingers(side, p.open);
      r.leg(side, this.feet.positions[side]);
    }
    r.model.updateMatrixWorld(true);
    // Check the achieved pose, not only the requested wrist targets.
    for (const side of ['left', 'right']) {
      r.bones[side + 'Hand'].getWorldPosition(this.positions[side]);
      this.actual.copy(r.hands[side].center).applyQuaternion(p[side + 'Q']);
      this.positions[side].add(this.actual);
    }
    this.metrics.separation = this.contacts.inspect(this.positions.left, p.leftQ, this.positions.right, p.rightQ);
    this.metrics.footDrift = r.metrics.footDrift;
    this.metrics.reachError = r.metrics.reachError;
  }
  diagnostics() {
    return {
      gesture: this.director.name, phase: this.director.phase, step: this.feet.phase,
      mode: this.lastInput.mode, changes: this.director.changes, steps: this.feet.steps,
      separation: this.metrics.separation, footDrift: this.metrics.footDrift, reachError: this.metrics.reachError,
      height: this.rig.height,
      elbow: [this.rig.arms.left.flex, this.rig.arms.right.flex],
      knee: [this.rig.legs.left.flex, this.rig.legs.right.flex],
    };
  }
  setDebug(scene, visible) {
    if (!this.debug) {
      this.debug = new T.Group(); this.debug.name = 'Motion constraints';
      this.debugHands = {}; this.debugFeet = {};
      for (const side of ['left', 'right']) {
        const material = new T.MeshBasicMaterial({ color: side === 'left' ? 0x54e1f5 : 0xffc766, wireframe: true, depthTest: false });
        const box = new T.Mesh(new T.BoxGeometry(1, 1, 1), material);
        box.scale.copy(this.rig.hands[side].half).multiplyScalar(2);
        this.debug.add(box); this.debugHands[side] = box;
        const foot = new T.Mesh(new T.SphereGeometry(this.rig.height * 0.008, 12, 8), material);
        this.debug.add(foot); this.debugFeet[side] = foot;
      }
      scene.add(this.debug);
    }
    this.debug.visible = visible;
  }
  updateDebug() {
    if (!this.debug.visible) return;
    for (const side of ['left', 'right']) {
      this.debugHands[side].position.copy(this.positions[side]);
      this.debugHands[side].quaternion.copy(this.director.current[side + 'Q']).multiply(this.rig.hands[side].frame);
      this.debugFeet[side].position.copy(this.feet.positions[side]);
    }
  }
}

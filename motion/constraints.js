import * as T from 'three';

// Oriented palm boxes. SAT is cheap enough to run after every interpolation.
export class HandContacts {
  constructor(rig) {
    this.rig = rig;
    this.axes = Array.from({ length: 15 }, () => new T.Vector3());
    this.delta = new T.Vector3(); this.normal = new T.Vector3(); this.q = new T.Quaternion();
    this.separation = 0;
  }
  inspect(left, leftQ, right, rightQ) {
    this.delta.subVectors(left, right);
    for (const [offset, side, rotation] of [[0, 'left', leftQ], [3, 'right', rightQ]]) {
      this.q.copy(rotation).multiply(this.rig.hands[side].frame);
      this.axes[offset].set(1, 0, 0).applyQuaternion(this.q);
      this.axes[offset + 1].set(0, 1, 0).applyQuaternion(this.q);
      this.axes[offset + 2].set(0, 0, 1).applyQuaternion(this.q);
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.axes[6 + i * 3 + j].crossVectors(this.axes[i], this.axes[j + 3]);
    let best = -Infinity;
    const l = this.rig.hands.left.half, r = this.rig.hands.right.half;
    for (const axis of this.axes) {
      if (axis.lengthSq() < 1e-8) continue;
      axis.normalize();
      const radius = Math.abs(axis.dot(this.axes[0])) * l.x + Math.abs(axis.dot(this.axes[1])) * l.y + Math.abs(axis.dot(this.axes[2])) * l.z
        + Math.abs(axis.dot(this.axes[3])) * r.x + Math.abs(axis.dot(this.axes[4])) * r.y + Math.abs(axis.dot(this.axes[5])) * r.z;
      const distance = Math.abs(this.delta.dot(axis)) - radius;
      if (distance > best) { best = distance; this.normal.copy(axis).multiplyScalar(this.delta.dot(axis) >= 0 ? 1 : -1); }
    }
    this.separation = best;
    return best;
  }
  project(left, leftQ, right, rightQ) {
    const gap = this.inspect(left, leftQ, right, rightQ);
    if (gap < this.rig.margin) {
      const correction = (this.rig.margin - gap) / 2;
      left.addScaledVector(this.normal, correction); right.addScaledVector(this.normal, -correction);
    }
  }
  protectTorso(position, chest) {
    // Elliptical vertical capsule; includes clothing and hand thickness.
    const h = this.rig.height;
    const nearY = T.MathUtils.clamp(position.y, this.rig.hips.y - h * 0.07, chest.y);
    const dx = position.x - chest.x, dy = position.y - nearY, dz = position.z - chest.z;
    const rx = h * 0.115, ry = h * 0.09, rz = h * 0.105;
    const distance = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2);
    if (distance < 1) {
      const factor = 1 / Math.max(distance, 0.01);
      position.x = chest.x + dx * factor;
      position.y = nearY + dy * factor;
      position.z = chest.z + Math.max(dz, 0.001) * factor;
    }
  }
}

import * as T from 'three';

const Y = new T.Vector3(0, 1, 0);
const Z = new T.Vector3(0, 0, 1);
const clamp = T.MathUtils.clamp;

// Frames are measured in scene units, never in the GLB's centimetres/local axes.
export class BodyRig {
  constructor(model, bones) {
    this.model = model;
    this.bones = bones;
    this.rest = new Map();
    this.v = Array.from({ length: 12 }, () => new T.Vector3());
    this.q = Array.from({ length: 5 }, () => new T.Quaternion());
    this.m = new T.Matrix4();
    this.euler = new T.Euler();
    model.updateMatrixWorld(true);
    this.height = new T.Box3().setFromObject(model).getSize(this.v[0]).y;
    for (const [name, bone] of Object.entries(bones)) {
      this.rest.set(name, {
        position: bone.position.clone(), rotation: bone.quaternion.clone(),
        world: bone.getWorldPosition(new T.Vector3()),
        worldRotation: bone.getWorldQuaternion(new T.Quaternion()),
      });
    }
    this.hips = this.rest.get('hips').world.clone();
    this.chest = this.rest.get('spine2').world.clone();
    this.hands = {};
    this.arms = {}; this.legs = {}; this.restArms = {};
    for (const side of ['left', 'right']) {
      this.hands[side] = this.measureHand(side);
      this.arms[side] = this.chain(side + 'Arm', side + 'ForeArm', side + 'Hand', 3, 145);
      this.legs[side] = this.chain(side + 'UpLeg', side + 'Leg', side + 'Foot', 3, 65);
      this.restArms[side] = this.measureRestArm(side);
    }
    this.torsoRadius = this.height * 0.092;
    this.margin = this.height * 0.0015;
    this.metrics = { footDrift: 0, reachError: 0, minElbow: 180, maxElbow: 0, minKnee: 180, maxKnee: 0 };
  }

  chain(root, middle, end, minFlex, maxFlex) {
    const a = this.rest.get(root), b = this.rest.get(middle), c = this.rest.get(end);
    const first = a.world.distanceTo(b.world), second = b.world.distanceTo(c.world);
    const distance = angle => Math.sqrt(first * first + second * second + 2 * first * second * Math.cos(angle * Math.PI / 180));
    return {
      root, middle, end, first, second, min: distance(maxFlex), max: distance(minFlex),
      rootAxis: this.bones[middle].position.clone().normalize(),
      middleAxis: this.bones[end].position.clone().normalize(),
      rootRestAxis: b.world.clone().sub(a.world).normalize(),
      middleRestAxis: c.world.clone().sub(b.world).normalize(),
      elbow: new T.Vector3(), target: new T.Vector3(), actual: new T.Vector3(), flex: 0,
    };
  }

  // Let the upper arms hang beside the torso. Keep a small forward elbow
  // bend, rather than opening the elbows sideways to make room for the hands.
  measureRestArm(side) {
    const sign = side === 'left' ? 1 : -1;
    const chain = this.arms[side];
    const upper = new T.Vector3(sign * 0.12, -0.99, 0.02).normalize();
    const lower = new T.Vector3(sign * 0.10, -0.99, 0.12).normalize();
    const root = this.rest.get(chain.root).world;
    const elbow = root.clone().addScaledVector(upper, chain.first);
    const wrist = elbow.clone().addScaledVector(lower, chain.second);
    const rotation = new T.Quaternion().setFromUnitVectors(chain.middleRestAxis, lower)
      .multiply(this.rest.get(chain.middle).worldRotation)
      .multiply(this.rest.get(chain.end).rotation);
    const palm = this.hands[side].center.clone().applyQuaternion(rotation).add(wrist);
    const axis = wrist.clone().sub(root).normalize();
    chain.restPole = upper.clone().addScaledVector(axis, -upper.dot(axis)).normalize();
    return { palm, rotation, upper, lower };
  }

  measureHand(side) {
    const bone = this.bones[side + 'Hand'];
    const world = this.rest.get(side + 'Hand');
    const inverse = world.worldRotation.clone().invert();
    const finger = this.bones[side + 'Index1'].getWorldPosition(new T.Vector3()).sub(world.world).applyQuaternion(inverse);
    const fingerLength = finger.length();
    const thumb = this.bones[side + 'Thumb1'].getWorldPosition(new T.Vector3()).sub(world.world).applyQuaternion(inverse);
    const direction = finger.clone().normalize();
    const normal = direction.clone().cross(thumb).normalize().multiplyScalar(side === 'left' ? 1 : -1);
    const across = direction.clone().cross(normal).normalize();
    const points = [];
    let xx = 0, zz = 0, xz = 0, sx = 0, sz = 0, count = 0;
    const bounds = new T.Box3();
    const point = new T.Vector3();
    this.model.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const joint = mesh.skeleton.bones.indexOf(bone);
      const indexJoint = mesh.skeleton.bones.indexOf(this.bones[side + 'Index1']);
      if (joint < 0) return;
      const weights = mesh.geometry.attributes.skinWeight;
      const indices = mesh.geometry.attributes.skinIndex;
      mesh.skeleton.update();
      for (let i = 0; i < weights.count; i++) {
        let weight = 0, indexWeight = 0;
        for (let k = 0; k < 4; k++) {
          if (indices.array[i * 4 + k] === joint) weight += weights.array[i * 4 + k];
          if (indices.array[i * 4 + k] === indexJoint) indexWeight += weights.array[i * 4 + k];
        }
        if (weight + indexWeight < 0.35) continue;
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).sub(world.world).applyQuaternion(inverse);
        const y = point.dot(direction);
        if (weight > 0.35 && y > fingerLength * 0.18 && y < fingerLength * 1.05) points.push(point.clone());
        if (y > fingerLength * 0.35 && y < fingerLength * 1.55) {
          const x = point.dot(across), z = point.dot(normal);
          xx += x*x; zz += z*z; xz += x*z; sx += x; sz += z; count++;
        }
      }
    });
    // The exported hand bone's roll is not the visual palm's roll. Fit the
    // narrow axis of the actual palm/knuckle skin in its transverse plane.
    if (count > 20) {
      xx = xx/count - (sx/count)**2; zz = zz/count - (sz/count)**2; xz = xz/count - sx*sz/(count*count);
      const angle = 0.5 * Math.atan2(2*xz, xx-zz);
      normal.multiplyScalar(Math.cos(angle)).addScaledVector(across, -Math.sin(angle)).normalize();
      across.crossVectors(direction, normal).normalize();
    }
    const frame = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(across, direction, normal));
    const inverseFrame = frame.clone().invert();
    for (const sample of points) bounds.expandByPoint(sample.applyQuaternion(inverseFrame));
    if (bounds.isEmpty()) throw new Error('Não foi possível medir a palma: ' + side);
    const center = bounds.getCenter(new T.Vector3());
    const half = bounds.getSize(new T.Vector3()).multiplyScalar(0.5);
    // Retain the measured skin envelope, including the back of the hand.
    return {
      frame, inverseFrame, center: center.applyQuaternion(frame), half,
      fingerLength, direction, normal,
      wrist: new T.Vector3(), position: new T.Vector3(), rotation: new T.Quaternion(),
    };
  }

  orientation(side, direction, normal, result) {
    const [x, y, z] = this.v;
    y.copy(direction).normalize();
    z.copy(normal).addScaledVector(y, -normal.dot(y)).normalize();
    x.crossVectors(y, z).normalize();
    z.crossVectors(x, y).normalize();
    result.setFromRotationMatrix(this.m.makeBasis(x, y, z)).multiply(this.hands[side].inverseFrame);
    return result;
  }

  worldRotation(name, quaternion) {
    const bone = this.bones[name];
    bone.parent.getWorldQuaternion(this.q[4]).invert();
    bone.quaternion.copy(this.q[4]).multiply(quaternion).normalize();
    bone.updateWorldMatrix(false, false);
  }

  offset(name, x, y, z) {
    const bone = this.bones[name];
    if (!bone) return;
    this.q[3].setFromEuler(this.euler.set(x, y, z));
    bone.quaternion.copy(this.rest.get(name).rotation).multiply(this.q[3]);
    bone.updateWorldMatrix(false, false);
  }

  pelvis(position) {
    const bone = this.bones.hips;
    this.v[11].copy(position);
    bone.parent.worldToLocal(this.v[11]);
    bone.position.copy(this.v[11]);
    bone.updateWorldMatrix(false, true);
  }

  // Analytic two-link IK; the pole fixes the bend plane even near extension.
  solve(chain, target, pole, palmNormal = null, twistWeight = 1) {
    const [a, direction, bend, elbow, lower, axis, secondary, cross, localSecondary] = this.v;
    this.bones[chain.root].getWorldPosition(a);
    direction.copy(target).sub(a);
    const length = direction.length();
    direction.divideScalar(Math.max(length, 1e-8));
    const d = clamp(length, chain.min, chain.max);
    chain.target.copy(a).addScaledVector(direction, d);
    bend.copy(pole).addScaledVector(direction, -pole.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.copy(Z).addScaledVector(direction, -direction.z);
    bend.normalize();
    const along = (chain.first ** 2 - chain.second ** 2 + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, chain.first ** 2 - along ** 2));
    elbow.copy(a).addScaledVector(direction, along).addScaledVector(bend, out);
    chain.elbow.copy(elbow);
    axis.copy(elbow).sub(a).normalize();
    this.q[0].setFromUnitVectors(chain.rootRestAxis, axis).multiply(this.rest.get(chain.root).worldRotation);
    this.worldRotation(chain.root, this.q[0]);
    lower.copy(chain.target).sub(elbow).normalize();
    this.q[0].setFromUnitVectors(chain.middleRestAxis, lower).multiply(this.rest.get(chain.middle).worldRotation);
    if (palmNormal && twistWeight > 0) {
      // Distribute pronation to the forearm, instead of twisting only the wrist.
      const side = chain.end.startsWith('left') ? 'left' : 'right';
      localSecondary.copy(this.hands[side].normal).applyQuaternion(this.rest.get(chain.end).worldRotation)
        .applyQuaternion(this.q[1].copy(this.rest.get(chain.middle).worldRotation).invert());
      secondary.copy(localSecondary).applyQuaternion(this.q[0]);
      secondary.addScaledVector(lower, -secondary.dot(lower)).normalize();
      cross.copy(palmNormal).addScaledVector(lower, -palmNormal.dot(lower)).normalize();
      if (cross.lengthSq() > 0.5 && secondary.lengthSq() > 0.5) {
        this.q[1].setFromUnitVectors(secondary, cross);
        this.q[2].identity().slerp(this.q[1], twistWeight);
        this.q[0].premultiply(this.q[2]);
      }
    }
    this.worldRotation(chain.middle, this.q[0]);
    this.bones[chain.end].getWorldPosition(chain.actual);
    chain.flex = Math.acos(clamp((d * d - chain.first ** 2 - chain.second ** 2) / (2 * chain.first * chain.second), -1, 1)) * 180 / Math.PI;
    this.metrics.reachError = Math.max(this.metrics.reachError, chain.actual.distanceTo(target));
  }

  arm(side, position, rotation, restWeight = 0) {
    const hand = this.hands[side];
    hand.position.copy(position); hand.rotation.copy(rotation);
    hand.wrist.copy(hand.center).applyQuaternion(rotation).negate().add(position);
    const normal = this.v[10].copy(hand.normal).applyQuaternion(rotation);
    // Keep elbows close to the body in gestures, and recover the resting bend plane at rest.
    const sign = side === 'left' ? 1 : -1;
    const gesturePole = this.v[9].set(sign * 0.22, -0.45, -0.86).normalize();
    const pole = gesturePole.lerp(this.arms[side].restPole, restWeight);
    this.solve(this.arms[side], hand.wrist, pole, normal, 1 - restWeight);
    this.worldRotation(side + 'Hand', rotation);
    const flex = this.arms[side].flex;
    this.metrics.minElbow = Math.min(this.metrics.minElbow, flex);
    this.metrics.maxElbow = Math.max(this.metrics.maxElbow, flex);
  }

  leg(side, ankle) {
    this.solve(this.legs[side], ankle, Z);
    this.worldRotation(side + 'Foot', this.rest.get(side + 'Foot').worldRotation);
    const flex = this.legs[side].flex;
    this.metrics.minKnee = Math.min(this.metrics.minKnee, flex);
    this.metrics.maxKnee = Math.max(this.metrics.maxKnee, flex);
    this.metrics.footDrift = Math.max(this.metrics.footDrift, this.legs[side].actual.distanceTo(ankle));
  }

  fingers(side, openness) {
    for (let i = 1; i <= 3; i++) {
      const curls = [0, 0.08, 0.12, 0.08];
      const extensions = [0, 0.06, 0.30, 0.08];
      this.offset(side + 'Index' + i, curls[i] * (1 - openness) - extensions[i] * openness, 0, 0);
      this.offset(side + 'Thumb' + i, i === 1 ? 0 : -0.10 * openness, 0,
        i === 1 ? (side === 'left' ? 1 : -1) * 0.10 * openness : 0);
    }
  }
}

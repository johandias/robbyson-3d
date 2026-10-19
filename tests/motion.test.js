import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { loadAvatar } from './load-avatar.js';
import { createMotionController } from '../motion/controller.js';
import { GESTURES } from '../motion/gestures.js';
import { ConversationMotion } from '../motion/conversation.js';

const speaking = { mode: 'speaking', speaking: true, audible: true, level: 0.12 };
const listening = { mode: 'listening', speaking: false, audible: false, level: 0 };
const idle = { mode: 'idle', speaking: false, audible: false, level: 0 };
async function controller() { const { model, rig } = await loadAvatar(); return createMotionController(model, rig); }
function check(c) {
  const d = c.diagnostics(), h = d.height;
  assert.ok(d.separation >= -h * 0.00001, 'Palm volumes penetrate: ' + JSON.stringify(d));
  assert.ok(d.footDrift < h * 0.001, 'Foot anchor drift: ' + JSON.stringify(d));
  assert.ok(d.reachError < h * 0.001, 'Unreachable target: ' + JSON.stringify(d));
  for (const flex of d.elbow) assert.ok(flex >= 7.99 && flex <= 145.01);
  for (const flex of d.knee) assert.ok(flex >= 2.99 && flex <= 65.01);
  for (const bone of Object.values(c.rig.bones)) assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-5);
}
function run(c, duration, fps, input = speaking) {
  for (let i = 0; i < duration * fps; i++) { c.update(1 / fps, typeof input === 'function' ? input(i / fps) : input); check(c); }
}

test('the real GLB supports the required chains and measured palm envelopes', async () => {
  const c = await controller();
  assert.equal(Object.keys(c.rig.bones).length, 41);
  for (const side of ['left', 'right']) {
    assert.ok(c.rig.hands[side].half.z > 0);
    assert.ok(c.rig.hands[side].half.x > c.rig.hands[side].half.z);
    assert.ok(c.rig.arms[side].first > 0);
  }
});

test('every directed pose transition preserves contact clearance, reach and foot anchors', async () => {
  const c = await controller();
  for (const from of ['rest', ...GESTURES]) for (const to of ['rest', ...GESTURES]) {
    if (from === to) continue;
    c.forceGesture(from); run(c, 6, 60);
    c.forceGesture(to); run(c, 6, 60);
  }
});

test('short, 30-second and 2-minute speech, listening and idle at 30 and 60 FPS', async () => {
  for (const fps of [30, 60]) {
    const c = await controller();
    for (const length of [8, 30, 120]) {
      run(c, length, fps, t => ({ ...speaking, audible: t % 4.8 < 4.1, paused: t % 4.8 >= 4.1 }));
      run(c, 4, fps, idle);
      assert.equal(c.director.name, 'rest');
    }
    const changes = c.director.changes;
    run(c, 60, fps, listening); run(c, 60, fps, idle);
    assert.equal(c.director.changes, changes, 'Idle must not start explanatory gestures');
    assert.ok(c.feet.steps >= 3 && c.feet.steps <= 7, 'Steps must stay infrequent');
  }
});

test('30 and 60 FPS produce equivalent poses with the same seed and inputs', async () => {
  const a = await controller(), b = await controller();
  run(a, 40, 30); run(b, 40, 60);
  assert.equal(a.director.name, b.director.name);
  for (const name of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head']) {
    const av = a.rig.bones[name].getWorldPosition(new T.Vector3());
    const bv = b.rig.bones[name].getWorldPosition(new T.Vector3());
    assert.ok(av.distanceTo(bv) < a.rig.height * 0.001, name + ' differs with FPS');
  }
});

test('interruption releases contact and lands a raised foot without a teleport', async () => {
  for (const name of ['palms', 'stacked']) for (const at of [0.4, 1.8, 4]) {
    const c = await controller(); c.forceGesture(name); run(c, at, 60);
    c.director.forced = null; c.director.wasSpeaking = true;
    run(c, 5, 60, listening); assert.equal(c.director.name, 'rest');
  }
  const c = await controller(); c.requestStep(); run(c, 1.25, 60);
  const side = c.feet.side;
  let previous = c.feet.positions[side].clone();
  for (let i = 0; i < 150; i++) {
    c.update(1 / 60, listening); check(c);
    assert.ok(previous.distanceTo(c.feet.positions[side]) < 0.008, 'Foot teleported on interruption');
    previous.copy(c.feet.positions[side]);
  }
  assert.equal(c.feet.phase, 'planted');
  assert.ok(Math.abs(c.feet.positions[side].y - c.feet.home[side].y) < 1e-8);
});

test('a suspended tab resumes with a bounded movement', async () => {
  const c = await controller(); run(c, 2, 60);
  const before = c.rig.bones.leftHand.getWorldPosition(new T.Vector3());
  c.update(30, speaking); check(c);
  const after = c.rig.bones.leftHand.getWorldPosition(new T.Vector3());
  assert.ok(before.distanceTo(after) < c.rig.height * 0.04);
});

test('transcript arrives early, split words accumulate, and only local playback activates gestures', () => {
  const c = new ConversationMotion();
  c.event({ type: 'response.created', response: { id: 'a' } });
  c.event({ type: 'response.output_audio_transcript.delta', response_id: 'a', delta: 'É impor' });
  c.event({ type: 'response.output_audio_transcript.delta', response_id: 'a', delta: 'tante comparar.' });
  assert.equal(c.update(0.1, 0, true).speaking, false);
  c.event({ type: 'output_audio_buffer.started', response_id: 'a' });
  assert.equal(c.update(0.1, 0.2, false).speaking, false, 'Blocked player must stay still');
  assert.equal(c.update(0.1, 0, true).speaking, false, 'Server streaming alone is not audible speech');
  assert.equal(c.update(0.1, 0.2, true).speaking, true);
  assert.equal(c.state.cue, 'compare');
  assert.equal(c.update(0.1, 0.2, true).cue, 'emphasis');
});

test('response.done is not playback completion; pauses and drained tails recover gradually', () => {
  const c = new ConversationMotion();
  c.event({ type: 'response.created', response: { id: 'a' } });
  c.event({ type: 'output_audio_buffer.started', response_id: 'a' });
  c.update(0.1, 0.1, true);
  c.event({ type: 'response.done', response: { id: 'a', status: 'completed' } });
  assert.equal(c.update(0.1, 0.1, true).speaking, true);
  assert.equal(c.update(0.35, 0, true).paused, true);
  c.event({ type: 'output_audio_buffer.stopped', response_id: 'a' });
  assert.equal(c.update(0.1, 0.1, true).speaking, true, 'Consume local audio tail');
  assert.equal(c.update(0.7, 0, true).mode, 'idle');
});

test('interruption discards old cues and ignores late buffers from a cancelled response', () => {
  const c = new ConversationMotion();
  c.event({ type: 'response.created', response: { id: 'a' } });
  c.event({ type: 'output_audio_buffer.started', response_id: 'a' });
  c.text('a', 'É importante comparar'); c.update(0.1, 0.1, true);
  c.event({ type: 'input_audio_buffer.speech_started' });
  assert.equal(c.update(0.1, 0.2, true).mode, 'listening');
  c.event({ type: 'input_audio_buffer.speech_stopped' });
  c.event({ type: 'output_audio_buffer.started', response_id: 'a' });
  assert.equal(c.update(0.1, 0.2, true).speaking, false);
  c.event({ type: 'response.created', response: { id: 'b' } });
  assert.equal(c.update(0.1, 0.2, true).speaking, false);
  c.event({ type: 'output_audio_buffer.started', response_id: 'b' });
  assert.equal(c.update(0.1, 0.2, true).cue, null);
  c.event({ type: 'output_audio_buffer.cleared', response_id: 'b' });
  assert.equal(c.update(0.1, 0.2, true).speaking, false);
  c.reset(); assert.equal(c.update(0.1, 0.2, true).mode, 'idle');
});

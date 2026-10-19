// Audio generation, transport and local playback are deliberately separate.
export class ConversationMotion {
  constructor() { this.time = 0; this.reset(); }
  reset() {
    this.responseId = null; this.playbackId = null; this.generating = false;
    this.userSpeaking = false; this.interrupted = false; this.transport = 'idle'; this.hasTransportEvents = false;
    this.lastAudible = -Infinity; this.responses = new Map(); this.cancelled = new Set();
    this.state = { mode: 'idle', speaking: false, audible: false, paused: false, level: 0, cue: null };
  }
  response(id) {
    if (!id || this.cancelled.has(id)) return null;
    if (!this.responses.has(id)) {
      this.responses.set(id, { text: '', seen: new Set(), cues: [] });
      if (this.responses.size > 4) this.responses.delete(this.responses.keys().next().value);
    }
    return this.responses.get(id);
  }
  interrupt(id = this.playbackId || this.responseId) {
    if (id) this.cancelled.add(id);
    if (this.cancelled.size > 32) this.cancelled.delete(this.cancelled.values().next().value);
    for (const response of this.responses.values()) response.cues.length = 0;
    this.lastAudible = -Infinity; this.playbackId = null;
    this.transport = 'idle'; this.interrupted = true;
  }
  event(event) {
    const id = event.response_id || event.response?.id || this.responseId;
    switch (event.type) {
      case 'response.created':
        if (this.cancelled.has(id)) break;
        this.responseId = id; this.response(id); this.generating = true; break;
      case 'response.done':
        if (id === this.responseId) this.generating = false;
        if (['cancelled', 'failed', 'incomplete'].includes(event.response?.status)) this.interrupt(id);
        break;
      case 'output_audio_buffer.started':
        this.hasTransportEvents = true;
        if (!this.cancelled.has(id) && !this.userSpeaking) {
          this.playbackId = id; this.transport = 'streaming'; this.interrupted = false;
        }
        break;
      case 'output_audio_buffer.stopped':
        if (id === this.playbackId) this.transport = 'draining';
        break;
      case 'output_audio_buffer.cleared':
        if (id === this.playbackId || id === this.responseId) this.interrupt(id);
        break;
      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true; this.generating = false; this.interrupt(); break;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false; this.generating = true; break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
        this.text(id, event.delta || ''); break;
      case 'error': this.generating = false; this.interrupt(); break;
    }
  }
  text(id, delta) {
    const response = this.response(id);
    if (!response) return;
    response.text = (response.text + delta).slice(-4000);
    const text = response.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const patterns = [
      ['compare', /\b(comparar|diferenca|por outro lado|alternativas)\b/],
      ['emphasis', /\b(importante|fundamental|essencial|atencao)\b/],
      ['palms', /\b(juntos|acolhimento|compreendo|palmas juntas)\b/],
      ['stacked', /\b(tranquilidade|com calma|concluindo|resumindo)\b/],
    ];
    for (const [type, pattern] of patterns) if (!response.seen.has(type) && pattern.test(text)) {
      response.seen.add(type); response.cues.push({ type, time: this.time });
    }
  }
  update(dt, level, canPlay) {
    this.time += dt;
    const id = this.hasTransportEvents ? this.playbackId : this.responseId;
    const allowed = canPlay && !!id && !this.userSpeaking && !this.cancelled.has(id);
    const audible = allowed && level > 0.018;
    if (audible) { this.lastAudible = this.time; this.interrupted = false; }
    const since = this.time - this.lastAudible;
    const speaking = allowed && since < 0.65;
    const s = this.state;
    s.audible = audible; s.speaking = speaking; s.level = audible ? level : 0;
    s.paused = speaking && since > 0.28;
    s.mode = this.userSpeaking ? 'listening' : speaking ? 'speaking' : this.generating ? 'thinking' : 'idle';
    s.cue = null;
    if (audible) {
      const response = this.responses.get(id);
      while (response?.cues.length) {
        const cue = response.cues.shift();
        if (this.time - cue.time <= 8) { s.cue = cue.type; break; }
      }
    }
    return s;
  }
}

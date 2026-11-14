/* Browser-only audio helpers. Audio starts only after an explicit user gesture. */
(() => {
  class TuneAudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.deckNodes = new Map();
      this.mediaSources = new WeakMap();
      this.previewTimers = new Map();
      this.media = new Map();
      this.crossfade = 0.5;
    }
    async ensure() {
      if (!this.context) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.context.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context;
    }
    node(deck) {
      if (!this.deckNodes.has(deck)) {
        const gain = this.context.createGain();
        const fade = this.context.createGain();
        gain.gain.value = deck === 'A' ? 0.82 : 0.76;
        fade.gain.value = deck === 'A' ? 1 - this.crossfade : this.crossfade;
        gain.connect(fade).connect(this.master);
        this.deckNodes.set(deck, { gain, fade });
      }
      return this.deckNodes.get(deck);
    }
    async play(deck, track, volume = 0.8, pitch = 0) {
      await this.ensure();
      this.stop(deck);
      const nodes = this.node(deck);
      nodes.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
      if (track?.audioUrl) {
        const audio = new Audio(track.audioUrl);
        audio.preload = 'auto';
        audio.playbackRate = Math.max(0.5, Math.min(1.5, 1 + pitch / 100));
        const source = this.context.createMediaElementSource(audio);
        source.connect(nodes.gain);
        this.media.set(deck, audio);
        await audio.play();
        return 'file';
      }
      this.startPreview(deck, track?.bpm || 120);
      return 'synth';
    }
    startPreview(deck, bpm) {
      const context = this.context;
      const interval = 60 / Math.max(50, Math.min(220, bpm));
      const nodes = this.node(deck);
      const tick = () => {
        const now = context.currentTime;
        const osc = context.createOscillator();
        const env = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115, now);
        osc.frequency.exponentialRampToValueAtTime(43, now + 0.09);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(0.3, now + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
        osc.connect(env).connect(nodes.gain);
        osc.start(now);
        osc.stop(now + 0.14);
      };
      tick();
      const timer = window.setInterval(tick, interval * 1000);
      this.previewTimers.set(deck, timer);
    }
    stop(deck) {
      const timer = this.previewTimers.get(deck);
      if (timer) window.clearInterval(timer);
      this.previewTimers.delete(deck);
      const media = this.media.get(deck);
      if (media) { media.pause(); media.currentTime = 0; this.media.delete(deck); }
    }
    async setVolume(deck, value) {
      await this.ensure();
      this.node(deck).gain.gain.setTargetAtTime(Number(value), this.context.currentTime, 0.02);
    }
    async setMaster(value) {
      await this.ensure();
      this.master.gain.setTargetAtTime(Number(value), this.context.currentTime, 0.02);
    }
    async setPitch(deck, pitch) {
      const media = this.media.get(deck);
      if (media) media.playbackRate = Math.max(0.5, Math.min(1.5, 1 + Number(pitch) / 100));
    }
    setCrossfade(value) {
      this.crossfade = Number(value);
      if (!this.context) return;
      const left = this.deckNodes.get('A')?.fade;
      const right = this.deckNodes.get('B')?.fade;
      if (left) left.gain.setTargetAtTime(1 - this.crossfade, this.context.currentTime, 0.025);
      if (right) right.gain.setTargetAtTime(this.crossfade, this.context.currentTime, 0.025);
    }
    async recordMicrophone(seconds = 12) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const recorder = new MediaRecorder(stream);
      const finished = new Promise((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(recorder.error || new Error('Recording failed.'));
        recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })); };
      });
      recorder.start();
      window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, seconds * 1000);
      return finished;
    }
    async renderWav(clips, maxSeconds = 180) {
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx) throw new Error('Offline audio rendering is not available in this browser.');
      const playable = clips.filter((clip) => clip.trackId && clip.track?.audioUrl);
      if (!playable.length) throw new Error('Import audio files before exporting a rendered WAV.');
      const duration = Math.min(maxSeconds, Math.max(8, ...playable.map((clip) => (Number(clip.at) || 0) + (Number(clip.track.duration_seconds || clip.track.duration) || 30))));
      const context = new Ctx(2, Math.ceil(duration * 44100), 44100);
      for (const clip of playable) {
        const response = await fetch(clip.track.audioUrl);
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes.slice(0));
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = Math.max(0, Math.min(1, Number(clip.volume ?? 0.8)));
        source.connect(gain).connect(context.destination);
        source.start(Math.max(0, Number(clip.at) || 0));
      }
      return this.wav(await context.startRendering());
    }
    wav(buffer) {
      const channels = buffer.numberOfChannels;
      const frames = buffer.length;
      const bytes = new ArrayBuffer(44 + frames * channels * 2);
      const view = new DataView(bytes);
      const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      write(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true); write(8, 'WAVE');
      write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
      view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
      write(36, 'data'); view.setUint32(40, frames * channels * 2, true);
      let offset = 44;
      const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
      for (let i = 0; i < frames; i++) for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
      }
      return new Blob([bytes], { type: 'audio/wav' });
    }
  }
  window.TuneAudioEngine = TuneAudioEngine;
})();

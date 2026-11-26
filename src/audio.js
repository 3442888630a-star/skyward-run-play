// Procedural WebAudio sound engine: propeller hum, wind rush, ring chimes, stall/fuel alerts,
// touchdown thump, crash impact, and mission victory fanfare. Zero external audio files.

import { clamp } from './math.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineGain = null;
  let engineOsc1 = null;
  let engineOsc2 = null;
  let engineFilter = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;
  let unlocked = false;

  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.45;
      master.connect(ctx.destination);

      // Continuous engine hum (dual detuned saw/triangle + warm low-pass)
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 180;
      engineFilter.Q.value = 1.4;

      engineGain = ctx.createGain();
      engineGain.gain.value = 0;

      engineOsc1 = ctx.createOscillator();
      engineOsc1.type = 'sawtooth';
      engineOsc1.frequency.value = 54;

      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'triangle';
      engineOsc2.frequency.value = 108.5;

      engineOsc1.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc1.start();
      engineOsc2.start();

      // Continuous wind rush (filtered noise buffer)
      const bufSize = ctx.sampleRate * 2;
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.8;

      windGain = ctx.createGain();
      windGain.gain.value = 0;

      noiseSrc.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      noiseSrc.start();

      unlocked = true;
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function unlock() {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function setMuted(next) {
    muted = Boolean(next);
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : 0.45, ctx.currentTime, 0.04);
    }
  }

  function isMuted() {
    return muted;
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  function updateFlight(active, throttle, speed, hasFuel, isStalling) {
    if (!unlocked || !ctx || muted) return;
    const now = ctx.currentTime;
    if (!active) {
      engineGain.gain.setTargetAtTime(0, now, 0.08);
      windGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }
    const power = hasFuel ? throttle : 0;
    const rpm = clamp(0.18 + power * 0.72 + (speed / 70) * 0.18, 0.15, 1.15);
    const baseFreq = hasFuel ? 42 + rpm * 58 : 24 + (speed / 70) * 20;
    engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.06);
    engineOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.06);
    engineFilter.frequency.setTargetAtTime(140 + rpm * 340, now, 0.08);
    engineGain.gain.setTargetAtTime(hasFuel ? 0.08 + power * 0.13 : 0.015, now, 0.08);

    const windNorm = clamp((speed - 14) / 55, 0, 1);
    windFilter.frequency.setTargetAtTime(300 + windNorm * 950 + (isStalling ? 180 : 0), now, 0.08);
    windGain.gain.setTargetAtTime(0.015 + windNorm * 0.09 + (isStalling ? 0.05 : 0), now, 0.08);
  }

  function playTone(freq, duration, type = 'sine', vol = 0.2, delay = 0) {
    if (!unlocked || !ctx || muted) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playRing(ringIndex) {
    // Ascending pentatonic chime per ring
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77, 1046.5, 1174.66];
    const root = scale[clamp(ringIndex - 1, 0, scale.length - 1)];
    playTone(root, 0.32, 'triangle', 0.24, 0);
    playTone(root * 1.5, 0.42, 'sine', 0.18, 0.06);
  }

  function playStall() {
    playTone(720, 0.11, 'square', 0.09, 0);
    playTone(720, 0.11, 'square', 0.09, 0.15);
  }

  function playLowFuel() {
    playTone(440, 0.16, 'triangle', 0.14, 0);
    playTone(349.23, 0.22, 'triangle', 0.14, 0.18);
  }

  function playTouchdown() {
    playTone(110, 0.18, 'triangle', 0.24, 0);
    playTone(78, 0.22, 'sine', 0.22, 0.04);
  }

  function playCrash() {
    if (!unlocked || !ctx || muted) return;
    playTone(95, 0.45, 'sawtooth', 0.28, 0);
    playTone(62, 0.55, 'triangle', 0.32, 0.02);
  }

  function playWin() {
    playTone(523.25, 0.25, 'triangle', 0.2, 0);
    playTone(659.25, 0.25, 'triangle', 0.2, 0.12);
    playTone(783.99, 0.3, 'triangle', 0.22, 0.24);
    playTone(1046.5, 0.65, 'sine', 0.26, 0.36);
  }

  return {
    unlock,
    setMuted,
    isMuted,
    toggleMute,
    updateFlight,
    playRing,
    playStall,
    playLowFuel,
    playTouchdown,
    playCrash,
    playWin,
  };
}

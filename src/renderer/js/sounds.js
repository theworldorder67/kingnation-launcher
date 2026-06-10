/* KingNation Launcher - polished Web Audio SFX, no external assets */
(function () {
  const PRESETS = {
    hover: {
      kind: 'tick',
      freq: 1320,
      decay: 0.045,
      volume: 0.035,
      cooldownMs: 72
    },
    click: {
      kind: 'press',
      freq: 520,
      overtone: 980,
      decay: 0.075,
      volume: 0.075,
      cooldownMs: 42
    },
    pop: {
      kind: 'sequence',
      notes: [587.33, 783.99],
      stepMs: 42,
      decay: 0.12,
      volume: 0.075,
      waveform: 'sine',
      cooldownMs: 90
    },
    page: {
      kind: 'sweep',
      from: 360,
      to: 760,
      decay: 0.16,
      volume: 0.06,
      cooldownMs: 120
    },
    info: {
      kind: 'sequence',
      notes: [493.88, 587.33],
      stepMs: 54,
      decay: 0.16,
      volume: 0.07,
      waveform: 'sine',
      cooldownMs: 130
    },
    success: {
      kind: 'sequence',
      notes: [523.25, 659.25, 783.99],
      stepMs: 58,
      decay: 0.2,
      volume: 0.085,
      waveform: 'triangle',
      cooldownMs: 180
    },
    error: {
      kind: 'sequence',
      notes: [392.0, 311.13],
      stepMs: 82,
      decay: 0.28,
      volume: 0.095,
      waveform: 'triangle',
      lowpass: 950,
      cooldownMs: 220
    },
    launch: {
      kind: 'launch',
      notes: [196.0, 293.66, 392.0, 587.33],
      stepMs: 74,
      decay: 0.42,
      volume: 0.11,
      cooldownMs: 800
    },
    preview: {
      kind: 'preview',
      cooldownMs: 650
    }
  };

  let ctx = null;
  let master = null;
  let compressor = null;
  let muted = false;
  let volume = 0.45;
  let unlocked = false;
  const lastPlayedAt = new Map();

  function ensureCtx() {
    if (ctx) return ctx;

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;

    try {
      ctx = new AudioCtor();

      master = ctx.createGain();
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;

      master.connect(compressor).connect(ctx.destination);
      applyMasterGain();
    } catch {
      ctx = null;
      master = null;
      compressor = null;
    }

    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
  }

  function shapedVolume(value) {
    const v = Math.max(0, Math.min(1, value));
    return Math.pow(v, 1.35);
  }

  function applyMasterGain() {
    if (!master) return;
    const target = muted ? 0 : shapedVolume(volume);
    const now = ctx ? ctx.currentTime : 0;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(target, now, 0.015);
  }

  function setVolume(value) {
    const next = Number(value);
    volume = Math.max(0, Math.min(1, Number.isFinite(next) ? next : 0));
    applyMasterGain();
  }

  function setMuted(value) {
    muted = !!value;
    applyMasterGain();
  }

  function getVolume() {
    return volume;
  }

  function getMuted() {
    return muted;
  }

  function canPlay(name, now) {
    const preset = PRESETS[name];
    const cooldown = (preset?.cooldownMs || 35) / 1000;
    const previous = lastPlayedAt.get(name) || 0;
    if (now - previous < cooldown) return false;
    lastPlayedAt.set(name, now);
    return true;
  }

  function noiseBuffer(c, durationSec) {
    const length = Math.max(1, Math.floor(c.sampleRate * durationSec));
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  }

  function envelope(t0, attack, decay, peak) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return gain;
  }

  function toneNode(freq, type, t0, duration, glideTo) {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, glideTo), t0 + duration);
    }
    return osc;
  }

  function maybeFilter(preset) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = preset.lowpass || 3800;
    filter.Q.value = 0.55;
    return filter;
  }

  function startSource(source, t0, duration) {
    source.start(t0);
    source.stop(t0 + duration + 0.035);
  }

  function playTick(preset, t0) {
    const osc = toneNode(preset.freq, 'sine', t0, preset.decay, preset.freq * 0.94);
    const gain = envelope(t0, 0.003, preset.decay, preset.volume);
    const filter = maybeFilter({ lowpass: 2600 });
    osc.connect(filter).connect(gain).connect(master);
    startSource(osc, t0, preset.decay);
  }

  function playPress(preset, t0) {
    const main = toneNode(preset.freq * 1.08, 'triangle', t0, preset.decay, preset.freq);
    const overtone = toneNode(preset.overtone, 'sine', t0, preset.decay * 0.65, preset.overtone * 0.88);
    const click = ctx.createBufferSource();
    click.buffer = noiseBuffer(ctx, 0.025);

    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = 2200;
    clickFilter.Q.value = 3.2;

    const tonalGain = envelope(t0, 0.004, preset.decay, preset.volume);
    const overtoneGain = envelope(t0, 0.003, preset.decay * 0.55, preset.volume * 0.34);
    const noiseGain = envelope(t0, 0.001, 0.024, preset.volume * 0.24);
    const filter = maybeFilter({ lowpass: 2600 });

    main.connect(filter).connect(tonalGain).connect(master);
    overtone.connect(overtoneGain).connect(master);
    click.connect(clickFilter).connect(noiseGain).connect(master);

    startSource(main, t0, preset.decay);
    startSource(overtone, t0, preset.decay * 0.65);
    startSource(click, t0, 0.025);
  }

  function playSweep(preset, t0) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, preset.decay);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(preset.from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, preset.to), t0 + preset.decay);
    filter.Q.value = 4.5;

    const gain = envelope(t0, 0.006, preset.decay, preset.volume);
    source.connect(filter).connect(gain).connect(master);
    startSource(source, t0, preset.decay);
  }

  function playNote(preset, t0, freq, volumeScale = 1) {
    const duration = preset.decay || 0.18;
    const osc = toneNode(freq, preset.waveform || 'sine', t0, duration, freq * 0.985);
    const filter = maybeFilter(preset);
    const gain = envelope(t0, 0.008, duration, (preset.volume || 0.07) * volumeScale);

    osc.connect(filter).connect(gain).connect(master);
    startSource(osc, t0, duration);
  }

  function playSequence(preset, t0) {
    preset.notes.forEach((freq, index) => {
      playNote(preset, t0 + index * ((preset.stepMs || 60) / 1000), freq);
    });
  }

  function playLaunch(preset, t0) {
    const bass = {
      waveform: 'triangle',
      decay: 0.32,
      volume: preset.volume * 0.62,
      lowpass: 700
    };
    playNote(bass, t0, 130.81);

    preset.notes.forEach((freq, index) => {
      playNote(
        {
          waveform: 'sine',
          decay: Math.max(0.12, preset.decay - index * 0.045),
          volume: preset.volume,
          lowpass: 3200
        },
        t0 + 0.045 + index * ((preset.stepMs || 70) / 1000),
        freq,
        1 - index * 0.08
      );
    });

    playSweep({ from: 520, to: 1800, decay: 0.28, volume: preset.volume * 0.36 }, t0 + 0.08);
  }

  function playPreview(t0) {
    playTick(PRESETS.hover, t0);
    playPress(PRESETS.click, t0 + 0.12);
    playSweep(PRESETS.page, t0 + 0.24);
    playSequence(PRESETS.success, t0 + 0.42);
  }

  function play(name) {
    if (muted || volume <= 0) return;

    const c = ensureCtx();
    if (!c || !master) return;
    if (c.state === 'suspended') c.resume();

    const preset = PRESETS[name];
    if (!preset) return;

    const now = c.currentTime;
    if (!canPlay(name, now)) return;

    const t0 = now + 0.004;
    if (preset.kind === 'tick') return playTick(preset, t0);
    if (preset.kind === 'press') return playPress(preset, t0);
    if (preset.kind === 'sweep') return playSweep(preset, t0);
    if (preset.kind === 'sequence') return playSequence(preset, t0);
    if (preset.kind === 'launch') return playLaunch(preset, t0);
    if (preset.kind === 'preview') return playPreview(t0);
  }

  function unlockOnce() {
    unlock();
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  }

  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);

  window.sfx = { play, setVolume, setMuted, getVolume, getMuted, unlock };
})();

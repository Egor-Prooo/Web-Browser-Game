/**
 * audio.js — Web Audio API sound effects module (unchanged).
 */
let _ctx   = null;
let _muted = false;

function _ensure() {
    if (_ctx) return;
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { console.warn('Web Audio API not available.'); }
}

function resume() {
    _ensure();
    if (_ctx?.state === 'suspended') _ctx.resume();
}

function _noise(dur, gain = 0.25, decay = 2) {
    if (!_ctx || _muted) return;
    const len = Math.ceil(_ctx.sampleRate * dur);
    const buf = _ctx.createBuffer(1, len, _ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    const src = _ctx.createBufferSource();
    const g   = _ctx.createGain();
    src.buffer   = buf;
    g.gain.value = gain;
    src.connect(g);
    g.connect(_ctx.destination);
    src.start();
}

function _tone(freq, dur, gain = 0.15, type = 'sine') {
    if (!_ctx || _muted) return;
    const osc = _ctx.createOscillator();
    const g   = _ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, _ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, _ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, _ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, _ctx.currentTime + dur);
    osc.connect(g);
    g.connect(_ctx.destination);
    osc.start();
    osc.stop(_ctx.currentTime + dur + 0.01);
}

export const Audio = {
    resume,
    shot:      () => _noise(0.06, 0.28, 2.5),
    hit:       () => _noise(0.07, 0.12, 1.8),
    death:     () => { _noise(0.2, 0.18, 0.9); _tone(80, 0.25, 0.12, 'sawtooth'); },
    hurt:      () => { _noise(0.1, 0.22, 1.2); _tone(220, 0.12, 0.10, 'square'); },
    reload:    () => { _tone(330, 0.06, 0.08); setTimeout(() => _tone(550, 0.12, 0.08), 120); },
    waveUp:    () => { _tone(440, 0.10, 0.15); setTimeout(() => _tone(660, 0.15, 0.15), 120); },
    waveClear: () => { [440, 550, 660, 880].forEach((f, i) => setTimeout(() => _tone(f, 0.12, 0.12), i * 80)); },
    gameOver:  () => { _tone(220, 0.3, 0.18, 'sawtooth'); setTimeout(() => _tone(110, 0.6, 0.18, 'sawtooth'), 150); },
    dash:      () => _noise(0.04, 0.10, 3),
    toggleMute() { _muted = !_muted; return _muted; },
    isMuted()    { return _muted; },
};
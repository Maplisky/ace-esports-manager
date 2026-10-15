/**
 * 音效（v1.4-2 外围包，§10.4 版权口径）：WebAudio 振荡器自产合成——零素材零版权。
 * 默认关闭，localStorage 'ace-audio' 记忆开关；开启后在首次用户手势时惰性建 AudioContext。
 */
const KEY = "ace-audio";

export function audioEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAudioEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch { /* 隐私模式忽略 */ }
  if (on) ensureCtx();
}

let ctx: AudioContext | null = null;
function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
  return ctx;
}

function tone(freq: number, dur: number, at: number, type: OscillatorType, gainV: number): void {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gainV, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type SfxKind = "round" | "kill" | "plant" | "matchpoint" | "win";

export function sfx(kind: SfxKind): void {
  if (!audioEnabled()) return;
  switch (kind) {
    case "round": tone(660, 0.07, 0, "square", 0.04); break;
    case "kill": tone(330, 0.05, 0, "triangle", 0.05); tone(220, 0.06, 0.04, "triangle", 0.04); break;
    case "plant": tone(110, 0.3, 0, "sawtooth", 0.05); break;
    case "matchpoint": tone(660, 0.09, 0, "square", 0.05); tone(660, 0.09, 0.14, "square", 0.05); break;
    case "win": tone(523, 0.1, 0, "triangle", 0.06); tone(659, 0.1, 0.1, "triangle", 0.06); tone(784, 0.16, 0.2, "triangle", 0.06); break;
  }
}

// scanner.js — thin wrapper around html5-qrcode with vibration + beep
// html5-qrcode is loaded globally via <script defer> in the HTML.

let instance = null;
let lastCode = null;
let lastTs = 0;
let audioCtx = null;

/** Short success beep via Web Audio (no audio file to download). */
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch { /* ignore */ }
}

/**
 * Start scanning. Calls onDetected(code) once per unique scan (300ms debounce).
 * Returns a promise that resolves when the camera is running.
 */
export async function startScanner(elementId, onDetected) {
  if (!window.Html5Qrcode) {
    throw new Error("html5-qrcode library not loaded yet");
  }
  if (!instance) instance = new window.Html5Qrcode(elementId, { verbose: false });

  const config = {
    fps: 10,
    qrbox: (vw, vh) => {
      const s = Math.floor(Math.min(vw, vh) * 0.75);
      return { width: s, height: s };
    },
    aspectRatio: 1.0,
  };

  await instance.start(
    { facingMode: "environment" },
    config,
    (decoded) => {
      const now = Date.now();
      // Debounce identical rapid scans
      if (decoded === lastCode && now - lastTs < 1500) return;
      lastCode = decoded;
      lastTs = now;

      if (navigator.vibrate) navigator.vibrate(80);
      beep();
      onDetected(decoded);
    },
    () => { /* per-frame decode errors are silent */ }
  );
}

export async function stopScanner() {
  if (!instance) return;
  try {
    if (instance.isScanning) await instance.stop();
    instance.clear();
  } catch { /* ignore */ }
}

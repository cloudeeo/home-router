// Records one spoken request in the browser and returns it as a 16 kHz mono WAV, the format /api/voice expects.
// Recording stops by itself after a pause in speech (or after maxMs), or when stop() is called.
// The browser's own echo cancellation, noise suppression and automatic gain help with quiet or distant voices.

export async function recordUtterance({ onLevel, silenceMs = 1100, maxMs = 12000, startTimeoutMs = 6000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const chunks = []
  let stopResolve
  const stopped = new Promise((r) => (stopResolve = r))

  // Simple voice activity: an RMS level above an adaptive noise floor counts as speech
  let noise = 0.01
  let heard = false
  let quietFor = 0
  const started = performance.now()

  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)
    onLevel?.(Math.min(1, rms * 8))
    const blockMs = (input.length / ctx.sampleRate) * 1000
    if (rms > Math.max(0.02, noise * 3)) {
      heard = true
      quietFor = 0
    } else {
      noise = noise * 0.95 + rms * 0.05
      quietFor += blockMs
    }
    const elapsed = performance.now() - started
    if ((heard && quietFor >= silenceMs) || elapsed >= maxMs || (!heard && elapsed >= startTimeoutMs)) stopResolve()
  }
  source.connect(node)
  node.connect(ctx.destination)

  const done = stopped.then(async () => {
    node.disconnect()
    source.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    const rate = ctx.sampleRate
    await ctx.close()
    if (!heard) return null
    return toWav16k(chunks, rate)
  })
  return { stop: () => stopResolve(), done }
}

function toWav16k(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const all = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.length
  }
  // Downsample by averaging the input samples that fall into each 16 kHz sample
  const ratio = rate / 16000
  const out = new Int16Array(Math.floor(all.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.min(all.length, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = a; j < b; j++) s += all[j]
    const v = s / Math.max(1, b - a)
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  }
  const header = new ArrayBuffer(44)
  const h = new DataView(header)
  const str = (o, s) => [...s].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF'); h.setUint32(4, 36 + out.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, 16000, true)
  h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); str(36, 'data'); h.setUint32(40, out.length * 2, true)
  return new Blob([header, out.buffer], { type: 'audio/wav' })
}

// Mobile browsers only let a page play sound it started from a tap: play a silent clip on the tap,
// then reuse the same element for the reply.
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
let player = null
export function unlockAudio() {
  if (!player) player = new Audio()
  player.src = SILENT
  return player.play().catch(() => {})
}
export function playBase64Wav(b64) {
  if (!player) player = new Audio()
  player.src = `data:audio/wav;base64,${b64}`
  return new Promise((resolve) => {
    player.onended = resolve
    player.onerror = resolve
    player.play().catch(resolve)
  })
}

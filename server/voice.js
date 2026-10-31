// Voice in and out for the router: Whisper turns the recorded question into text, the router answers,
// and Supertonic reads the answer aloud in the language of the question (Italian, French or English).
//   POST /api/voice  (body: 16 kHz mono WAV)  ->  { transcript, lang, route, reply, audio: base64 WAV, timings }
// A web search still needs the user's OK: the assistant asks out loud, and the next request answers it
// ("sì" / "oui" / "yes" allows one search, "no" / "non" keeps it at home).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'
import { handleRequest, handleSearchDecision } from './router.js'

let sdk = null
let sttId = null
const ttsIds = {} // lang -> modelId

export async function initVoice(log = console.log) {
  if (!config.voice) return
  if (config.mock) {
    log('Voice: MOCK mode (fixed transcript, silent audio)')
    return
  }
  sdk = await import('@qvac/sdk')
  let t = performance.now()
  // A local file path or URL is loaded directly; a registry constant goes through the registry
  const sttSrc = sdk[config.sttModel] || config.sttModel
  sttId = await sdk.loadModel({
    modelSrc: sttSrc,
    ...(sdk[config.sttModel] ? {} : { modelType: 'whispercpp-transcription' }),
    modelConfig: { language: config.sttLanguage, strategy: 'greedy', n_threads: config.sttThreads, temperature: 0, translate: false, no_timestamps: true },
  })
  log(`Voice: speech recognition ${path.basename(String(config.sttModel))} loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`)
  for (const lang of config.voiceLangs) {
    t = performance.now()
    const v = config.voices[lang] || { voice: 'F1', speed: 1.15 }
    ttsIds[lang] = await sdk.loadModel({
      modelSrc: sdk[config.ttsModel],
      modelConfig: { ttsEngine: 'supertonic', language: lang, voice: v.voice, ttsSpeed: v.speed, ttsNumInferenceSteps: 5 },
    })
    log(`Voice: ${lang} voice ${v.voice} (speed ${v.speed}) loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`)
  }
}

export async function closeVoice() {
  if (!sdk) return
  for (const id of [sttId, ...Object.values(ttsIds)]) if (id) await sdk.unloadModel({ modelId: id })
}

// ---- language -------------------------------------------------------------

// Whisper is run with language "auto"; the transcript's own words tell us which voice to answer with.
const MARKERS = {
  it: /\b(il|lo|la|gli|che|di|per|non|sono|accendi|spegni|cosa|quanto|come|dove|perch[eé]|ricordami|aiutami|della|nella|questo|grazie|si|sì)\b/g,
  fr: /\b(le|les|des|une|est|pas|que|qui|pour|dans|allume|[ée]teins|combien|comment|quoi|pourquoi|rappelle|merci|oui|je|tu|vous|du|au)\b/g,
  en: /\b(the|is|are|what|how|turn|please|remind|my|you|and|of|to|yes|thanks)\b/g,
}
export function detectLang(text) {
  const lower = text.toLowerCase()
  let best = config.voiceLangs[0]
  let bestCount = 0
  for (const lang of config.voiceLangs) {
    const count = (lower.match(MARKERS[lang] || /$^/g) || []).length
    if (count > bestCount) {
      best = lang
      bestCount = count
    }
  }
  return best
}

// ---- spoken phrases for actions and permission -------------------------------

const ROOM_NAMES = {
  it: { 'living room': 'in soggiorno', kitchen: 'in cucina', bedroom: 'in camera', bathroom: 'in bagno', office: 'nello studio', hall: "nell'ingresso" },
  fr: { 'living room': 'du salon', kitchen: 'de la cuisine', bedroom: 'de la chambre', bathroom: 'de la salle de bain', office: 'du bureau', hall: "de l'entrée" },
  en: { 'living room': 'in the living room', kitchen: 'in the kitchen', bedroom: 'in the bedroom', bathroom: 'in the bathroom', office: 'in the office', hall: 'in the hall' },
}
function actionPhrase(f, lang) {
  const room = f.room ? ROOM_NAMES[lang][f.room] : ''
  const it = {
    lights: () => (f.on ? `Fatto, luce ${room} al ${f.level} per cento.` : `Fatto, luce ${room} spenta.`),
    heating: () => (f.on ? `Fatto, riscaldamento ${room} a ${f.target} gradi.` : `Fatto, riscaldamento ${room} spento.`),
    garage: () => (f.open ? 'Garage aperto.' : 'Garage chiuso.'),
    door: () => (f.locked ? 'Porta chiusa a chiave.' : 'Porta aperta.'),
    vacuum: () => (f.running ? 'Aspirapolvere avviato.' : 'Aspirapolvere fermato.'),
    reminder: () => `Va bene, te lo ricordo: ${f.label}.`,
  }
  const fr = {
    lights: () => (f.on ? `C'est fait, lumière ${room} à ${f.level} pour cent.` : `C'est fait, lumière ${room} éteinte.`),
    heating: () => (f.on ? `C'est fait, chauffage ${room} à ${f.target} degrés.` : `C'est fait, chauffage ${room} éteint.`),
    garage: () => (f.open ? 'Garage ouvert.' : 'Garage fermé.'),
    door: () => (f.locked ? 'Porte verrouillée.' : 'Porte déverrouillée.'),
    vacuum: () => (f.running ? 'Aspirateur démarré.' : 'Aspirateur arrêté.'),
    reminder: () => `D'accord, je te le rappellerai : ${f.label}.`,
  }
  const en = {
    lights: () => (f.on ? `Done, lights ${room} at ${f.level} percent.` : `Done, lights ${room} off.`),
    heating: () => (f.on ? `Done, heating ${room} set to ${f.target} degrees.` : `Done, heating ${room} off.`),
    garage: () => (f.open ? 'Garage open.' : 'Garage closed.'),
    door: () => (f.locked ? 'Front door locked.' : 'Front door unlocked.'),
    vacuum: () => (f.running ? 'Vacuum started.' : 'Vacuum stopped.'),
    reminder: () => `OK, I'll remind you: ${f.label}.`,
  }
  const table = { it, fr, en }[lang] || en
  return (table[f.kind] || (() => ''))()
}
const PHRASES = {
  askSearch: { it: 'Per questo devo cercare su internet. Vuoi che lo faccia?', fr: 'Pour cela je dois chercher sur internet. Tu veux que je le fasse ?', en: 'I need to search the web for this. Shall I?' },
  denied: { it: "D'accordo, resta tutto in casa.", fr: "D'accord, tout reste à la maison.", en: 'OK, nothing leaves the house.' },
  notUnderstood: { it: 'Scusa, non ho capito.', fr: "Pardon, je n'ai pas compris.", en: "Sorry, I didn't catch that." },
  error: { it: 'Scusa, qualcosa non ha funzionato.', fr: "Pardon, quelque chose n'a pas marché.", en: 'Sorry, something went wrong.' },
}
const YES = /^\s*(s[iì]|certo|va bene|ok|okay|oui|d'accord|vas-y|yes|sure|go ahead)(?=[\s,.!?]|$)/i
const NO = /^\s*(no|non|lascia stare|pas besoin|nope)(?=[\s,.!?]|$)/i

// The one web search waiting for a spoken yes or no (single household, so one at a time)
let pendingSearch = null // { id, lang, at }

// ---- audio ----------------------------------------------------------------

function wavFromInt16(samples, rate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

async function transcribeWav(wav, mockText) {
  if (config.mock) return mockText || config.mockTranscript
  // The SDK reads audio from a file path
  const file = path.join(os.tmpdir(), `home-router-${crypto.randomUUID()}.wav`)
  fs.writeFileSync(file, wav)
  try {
    const out = await sdk.transcribe({ modelId: sttId, audioChunk: file })
    return (Array.isArray(out) ? out.map((s) => s.text ?? s).join('') : String(out)).trim()
  } finally {
    fs.rmSync(file, { force: true })
  }
}

// Markdown and symbols read badly aloud
const speakable = (text) =>
  text
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

async function speak(text, lang) {
  if (config.mock) return wavFromInt16(new Int16Array(8000), 16000)
  const r = sdk.textToSpeech({ modelId: ttsIds[lang] || Object.values(ttsIds)[0], text: speakable(text), inputType: 'text', stream: false })
  const samples = await r.buffer
  const rate = (await r.sampleRate) ?? 44100
  return wavFromInt16(samples, rate)
}

// ---- the request ------------------------------------------------------------

// opts.mockText (MOCK mode only): the transcript to pretend Whisper heard, for tests
export async function handleVoice(wav, opts = {}) {
  const t0 = performance.now()
  const timings = {}

  let t = performance.now()
  const transcript = await transcribeWav(wav, opts.mockText)
  timings.sttMs = Math.round(performance.now() - t)
  const lang = transcript ? detectLang(transcript) : config.voiceLangs[0]

  // Collect what the router emits
  const events = { reply: '', route: null, decision: null, action: null, permission: null, sources: [], error: null }
  const emit = (event, data) => {
    if (event === 'token') events.reply += data.text
    else if (event === 'route') events.route = events.route || data.route
    else if (event === 'decision') events.decision = data
    else if (event === 'action') events.action = data
    else if (event === 'permission') events.permission = data
    else if (event === 'sources') events.sources = data
    else if (event === 'error') events.error = data.message
  }

  t = performance.now()
  let reply
  if (!transcript) {
    reply = PHRASES.notUnderstood[lang]
  } else if (pendingSearch && Date.now() - pendingSearch.at < 60_000 && (YES.test(transcript) || NO.test(transcript))) {
    // The answer to "shall I search the web?"
    const allow = YES.test(transcript)
    const { id, lang: askedIn } = pendingSearch
    pendingSearch = null
    if (allow) {
      await handleSearchDecision(id, true, emit)
      reply = events.reply || PHRASES.error[askedIn]
    } else {
      await handleSearchDecision(id, false, () => {})
      reply = PHRASES.denied[askedIn]
    }
  } else {
    pendingSearch = null
    try {
      await handleRequest(transcript, emit, { voice: true })
    } catch (err) {
      events.error = err.message
    }
    if (events.permission) {
      pendingSearch = { id: events.permission.id, lang, at: Date.now() }
      reply = PHRASES.askSearch[lang]
    } else if (events.action) {
      reply = events.action.ok && events.action.facts ? actionPhrase(events.action.facts, lang) : PHRASES.notUnderstood[lang]
    } else {
      reply = events.reply.trim() || PHRASES.error[lang]
    }
  }
  timings.routerMs = Math.round(performance.now() - t)

  t = performance.now()
  const audio = await speak(reply, lang)
  timings.ttsMs = Math.round(performance.now() - t)
  timings.totalMs = Math.round(performance.now() - t0)

  return {
    transcript,
    lang,
    route: events.route,
    decision: events.decision,
    waitingForYesNo: Boolean(pendingSearch),
    reply,
    sources: events.sources.map((s) => s.title),
    error: events.error,
    timings,
    audio: audio.toString('base64'),
  }
}

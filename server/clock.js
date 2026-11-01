// Direct answers for "what time is it (in <city>)?" and "what day is it?", in Italian, French or English.
// A 4B LLM is slow for these (about 2.5 s) and gets time zones wrong, while the server clock is exact and instant.
// Returns the reply text, or null when the request is not a plain time or date question.
import { config } from './config.js'

const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ')

// City (and a few country) names in Italian, French and English -> IANA time zone
const PLACES = [
  [['new york', 'nueva york'], 'America/New_York', 'New York'],
  [['washington', 'boston', 'miami', 'atlanta'], 'America/New_York', null],
  [['chicago', 'houston', 'dallas'], 'America/Chicago', null],
  [['denver'], 'America/Denver', null],
  [['los angeles', 'san francisco', 'seattle', 'las vegas', 'california', 'californie'], 'America/Los_Angeles', null],
  [['honolulu', 'hawaii'], 'Pacific/Honolulu', null],
  [['toronto', 'montreal', 'quebec'], 'America/Toronto', null],
  [['vancouver'], 'America/Vancouver', null],
  [['citta del messico', 'mexico city', 'mexico'], 'America/Mexico_City', 'Mexico City'],
  [['caracas', 'venezuela'], 'America/Caracas', 'Caracas'],
  [['bogota', 'colombia', 'colombie'], 'America/Bogota', 'Bogotá'],
  [['lima', 'peru', 'perou'], 'America/Lima', 'Lima'],
  [['santiago', 'cile', 'chili', 'chile'], 'America/Santiago', 'Santiago'],
  [['buenos aires', 'argentina', 'argentine'], 'America/Argentina/Buenos_Aires', 'Buenos Aires'],
  [['san paolo', 'sao paulo', 'rio de janeiro', 'rio', 'brasile', 'bresil', 'brazil'], 'America/Sao_Paulo', null],
  [['londra', 'londres', 'london', 'inghilterra', 'angleterre', 'england'], 'Europe/London', null],
  [['dublino', 'dublin', 'irlanda', 'irlande', 'ireland'], 'Europe/Dublin', null],
  [['lisbona', 'lisbonne', 'lisbon', 'portogallo', 'portugal'], 'Europe/Lisbon', null],
  [['madrid', 'barcellona', 'barcelone', 'barcelona', 'valencia', 'valence', 'spagna', 'espagne', 'spain'], 'Europe/Madrid', null],
  [['parigi', 'paris', 'francia', 'france'], 'Europe/Paris', null],
  [['roma', 'rome', 'milano', 'milan', 'napoli', 'naples', 'italia', 'italie', 'italy'], 'Europe/Rome', null],
  [['berlino', 'berlin', 'germania', 'allemagne', 'germany'], 'Europe/Berlin', null],
  [['atene', 'athenes', 'athens', 'grecia', 'grece', 'greece'], 'Europe/Athens', null],
  [['istanbul', 'turchia', 'turquie', 'turkey'], 'Europe/Istanbul', null],
  [['mosca', 'moscou', 'moscow', 'russia', 'russie'], 'Europe/Moscow', null],
  [['il cairo', 'le caire', 'cairo', 'egitto', 'egypte', 'egypt'], 'Africa/Cairo', null],
  [['johannesburg', 'citta del capo', 'le cap', 'cape town', 'sudafrica'], 'Africa/Johannesburg', null],
  [['dubai', 'abu dhabi', 'emirati', 'emirats'], 'Asia/Dubai', null],
  [['mumbai', 'bombay', 'delhi', 'bangalore', 'india', 'inde'], 'Asia/Kolkata', null],
  [['bangkok', 'thailandia', 'thailande', 'thailand'], 'Asia/Bangkok', null],
  [['singapore', 'singapour'], 'Asia/Singapore', 'Singapore'],
  [['hong kong'], 'Asia/Hong_Kong', 'Hong Kong'],
  [['pechino', 'pekin', 'beijing', 'shanghai', 'cina', 'chine', 'china'], 'Asia/Shanghai', null],
  [['tokyo', 'tokio', 'osaka', 'giappone', 'japon', 'japan'], 'Asia/Tokyo', null],
  [['seoul', 'corea', 'coree', 'korea'], 'Asia/Seoul', null],
  [['sydney', 'melbourne', 'australia', 'australie'], 'Australia/Sydney', null],
  [['auckland', 'nuova zelanda', 'nouvelle zelande', 'new zealand'], 'Pacific/Auckland', null],
  [['ginevra', 'geneve', 'geneva', 'zurigo', 'zurich', 'losanna', 'lausanne', 'svizzera', 'suisse', 'switzerland'], 'Europe/Zurich', null],
]

const TIME = [
  // "che le sono": how Whisper small often hears "che ore sono"
  ['it', /\bche or[ae]\b|\bche le sono\b|\bche ore\b|\bl ora esatta\b|\bdimmi l ora\b/],
  ['fr', /\bquelle heure\b|\bl heure qu il est\b/],
  ['en', /\bwhat time\b|\bwhat s the time\b|\bthe time now\b|\btell me the time\b/],
]
const DATE = [
  ['it', /\bche giorno\b|\bche data\b|\bquanti ne abbiamo\b/],
  ['fr', /\bquel jour\b|\bquelle date\b|\bon est le combien\b|\bquel est la date\b/],
  ['en', /\bwhat day\b|\bwhat date\b|\bwhat s the date\b|\btoday s date\b/],
]
// A place the table does not know ("che ore sono a Kathmandu?"): leave it to the LLM rather than give local time
const ELSEWHERE = /\b(?:a|ad|in|en|au|aux|at)\s+(?!casa|questo|quest|moment|ce moment|the moment|home|maison|qui|ici|here|adesso)[a-z]{3,}/

const LOCALE = { it: 'it-IT', fr: 'fr-FR', en: 'en-GB' }

function findPlace(q) {
  for (const [names, tz, label] of PLACES) {
    for (const n of names) {
      if (new RegExp(`\\b${n}\\b`).test(q)) return { tz, label: label || n.replace(/\b\w/g, (c) => c.toUpperCase()) }
    }
  }
  return null
}

function sentence(lang, kind, { time, day, place, otherDay }) {
  if (kind === 'date') {
    if (lang === 'fr') return place ? `À ${place}, nous sommes ${day}.` : `Nous sommes ${day}.`
    if (lang === 'en') return place ? `In ${place} it is ${day}.` : `Today is ${day}.`
    return place ? `A ${place} è ${day}.` : `Oggi è ${day}.`
  }
  const when = otherDay ? { it: `, ${day}`, fr: `, ${day}`, en: `, ${day}` }[lang] : ''
  if (lang === 'fr') return place ? `À ${place}, il est ${time}${when}.` : `Il est ${time}.`
  if (lang === 'en') return place ? `In ${place} it is ${time}${when}.` : `It is ${time}.`
  const ore = time.startsWith('01:') ? "è l'una" : `sono le ${time}`
  return place ? `A ${place} ${ore}${when}.` : `${ore[0].toUpperCase()}${ore.slice(1)}.`
}

export function clockAnswer(text, now = new Date()) {
  const q = plain(text)
  if (q.length > 80) return null
  const time = TIME.find(([, re]) => re.test(q))
  const date = time ? null : DATE.find(([, re]) => re.test(q))
  const hit = time || date
  if (!hit) return null
  const lang = hit[0]
  const place = findPlace(q)
  if (!place && ELSEWHERE.test(q)) return null
  const home = config.timeZone
  const tz = place?.tz || home
  const loc = LOCALE[lang]
  const fmtDay = (zone) => now.toLocaleDateString(loc, { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' })
  const parts = {
    time: now.toLocaleTimeString(loc, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }),
    day: fmtDay(tz),
    // Only name the other city's date when it differs from the date here
    otherDay: place && fmtDay(tz) !== fmtDay(home),
    place: place && place.tz !== home ? place.label : null,
  }
  return sentence(lang, time ? 'time' : 'date', parts)
}

// A simulated smart home. Laya picks the device; simple rules read the operation and the numbers.
// Nothing here talks to real hardware: in a real setup this is where Home Assistant would be called.

const ROOMS = ['living room', 'kitchen', 'bedroom', 'bathroom', 'office', 'hall']

export const home = {
  lights: Object.fromEntries(ROOMS.map((r) => [r, { on: r === 'living room', level: r === 'living room' ? 80 : 0 }])),
  heating: Object.fromEntries(ROOMS.map((r) => [r, { on: true, target: 20 }])),
  garage: { open: false },
  door: { locked: true },
  vacuum: { running: false },
  reminders: [],
}

// Room names in English, Italian and French (voice requests arrive in all three)
const ROOM_WORDS = {
  'living room': /\b(living room|lounge|soggiorno|salotto|salone|salon|s[ée]jour)\b/,
  kitchen: /\b(kitchen|cucina|cuisine)\b/,
  bedroom: /\b(bedroom|camera da letto|camera|chambre)\b/,
  bathroom: /\b(bathroom|bagno|salle de bains?)\b/,
  office: /\b(office|study|studio|ufficio|bureau)\b/,
  hall: /\b(hall|hallway|ingresso|corridoio|entr[ée]e|couloir)\b/,
}

// Lower case without accents, so "éteins" and "più" match plain \b word boundaries
const plain = (text) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function room(text, fallback = 'living room') {
  const lower = plain(text)
  return ROOMS.find((r) => ROOM_WORDS[r].test(lower)) || fallback
}

const has = (text, re) => re.test(plain(text))

// Returns { ok, summary } and updates the home state
export function applyCommand(device, text) {
  const lower = plain(text)
  const pctMatch = lower.match(/(\d{1,3})\s*(%|percent|per ?cento|pour ?cent)/)
  const degMatch = lower.match(/(\d{1,2}(?:[.,]\d)?)\s*(°|degrees?|gradi|degr[ée]s?)/)

  switch (device) {
    case 'lights': {
      const r = room(text)
      const light = home.lights[r]
      if (pctMatch) {
        light.level = Math.max(0, Math.min(100, Number(pctMatch[1])))
        light.on = light.level > 0
      } else if (has(lower, /\b(off|out|spegni|spento|spenta|[ée]teins|[ée]teindre)\b/)) {
        light.on = false
        light.level = 0
      } else {
        light.on = true
        light.level = light.level || 100
      }
      return { ok: true, facts: { kind: 'lights', room: r, on: light.on, level: light.level }, summary: light.on ? `${cap(r)} lights at ${light.level}%` : `${cap(r)} lights off` }
    }
    case 'heating': {
      const r = room(text, 'living room')
      const h = home.heating[r]
      if (degMatch) {
        h.on = true
        h.target = Number(degMatch[1].replace(',', '.'))
      } else if (has(lower, /\b(off|spegni|spento|[ée]teins|[ée]teindre|coupe)\b/)) {
        h.on = false
      } else if (has(lower, /\b(up|warmer|alza|aumenta|pi[uù] caldo|monte|augmente)\b/)) {
        h.on = true
        h.target += 1
      } else if (has(lower, /\b(down|cooler|abbassa|diminuisci|baisse|diminue)\b/)) {
        h.target -= 1
      } else {
        h.on = true
      }
      return { ok: true, facts: { kind: 'heating', room: r, on: h.on, target: h.target }, summary: h.on ? `${cap(r)} heating set to ${h.target}°C` : `${cap(r)} heating off` }
    }
    case 'garage':
      home.garage.open = !has(lower, /\b(close|chiudi|ferme)\b/)
      return { ok: true, facts: { kind: 'garage', open: home.garage.open }, summary: home.garage.open ? 'Garage door open' : 'Garage door closed' }
    case 'door':
      home.door.locked = !has(lower, /\b(unlock|sblocca|apri|d[ée]verrouille|ouvre)\b/)
      return { ok: true, facts: { kind: 'door', locked: home.door.locked }, summary: home.door.locked ? 'Front door locked' : 'Front door unlocked' }
    case 'vacuum':
      home.vacuum.running = !has(lower, /\b(stop|pause|ferma|arr[êe]te)\b/)
      return { ok: true, facts: { kind: 'vacuum', running: home.vacuum.running }, summary: home.vacuum.running ? 'Robot vacuum started' : 'Robot vacuum stopped' }
    case 'reminder': {
      const timer = lower.match(/(\d+)\s*(minutes?|mins?|hours?|minuti|ore|heures?)/)
      const label = timer && /timer/.test(lower) ? `Timer: ${timer[1]} ${timer[2]}` : text.replace(/^(please\s+)?(remind me to|set a reminder to|ricordami di|rappelle-moi d[e']\s*)\s*/i, '')
      home.reminders.unshift({ label: cap(label), created: new Date().toISOString() })
      home.reminders = home.reminders.slice(0, 5)
      return { ok: true, facts: { kind: 'reminder', label }, summary: `Saved: ${cap(label)}` }
    }
    default:
      return { ok: false, summary: 'I could not tell which device you meant' }
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

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

function room(text, fallback = 'living room') {
  const lower = text.toLowerCase()
  return ROOMS.find((r) => lower.includes(r)) || fallback
}

const has = (text, re) => re.test(text.toLowerCase())

// Returns { ok, summary } and updates the home state
export function applyCommand(device, text) {
  const lower = text.toLowerCase()
  const pctMatch = lower.match(/(\d{1,3})\s*(%|percent)/)
  const degMatch = lower.match(/(\d{1,2}(?:[.,]\d)?)\s*(°|degrees?)/)

  switch (device) {
    case 'lights': {
      const r = room(text)
      const light = home.lights[r]
      if (pctMatch) {
        light.level = Math.max(0, Math.min(100, Number(pctMatch[1])))
        light.on = light.level > 0
      } else if (has(lower, /\b(off|out)\b/)) {
        light.on = false
        light.level = 0
      } else {
        light.on = true
        light.level = light.level || 100
      }
      return { ok: true, summary: light.on ? `${cap(r)} lights at ${light.level}%` : `${cap(r)} lights off` }
    }
    case 'heating': {
      const r = room(text, 'living room')
      const h = home.heating[r]
      if (degMatch) {
        h.on = true
        h.target = Number(degMatch[1].replace(',', '.'))
      } else if (has(lower, /\b(off)\b/)) {
        h.on = false
      } else if (has(lower, /\b(up|warmer)\b/)) {
        h.on = true
        h.target += 1
      } else if (has(lower, /\b(down|cooler)\b/)) {
        h.target -= 1
      } else {
        h.on = true
      }
      return { ok: true, summary: h.on ? `${cap(r)} heating set to ${h.target}°C` : `${cap(r)} heating off` }
    }
    case 'garage':
      home.garage.open = !has(lower, /\bclose\b/)
      return { ok: true, summary: home.garage.open ? 'Garage door open' : 'Garage door closed' }
    case 'door':
      home.door.locked = !has(lower, /\bunlock\b/)
      return { ok: true, summary: home.door.locked ? 'Front door locked' : 'Front door unlocked' }
    case 'vacuum':
      home.vacuum.running = !has(lower, /\b(stop|pause)\b/)
      return { ok: true, summary: home.vacuum.running ? 'Robot vacuum started' : 'Robot vacuum stopped' }
    case 'reminder': {
      const timer = lower.match(/(\d+)\s*(minutes?|mins?|hours?)/)
      const label = timer && /timer/.test(lower) ? `Timer: ${timer[1]} ${timer[2]}` : text.replace(/^(please\s+)?(remind me to|set a reminder to)\s*/i, '')
      home.reminders.unshift({ label: cap(label), created: new Date().toISOString() })
      home.reminders = home.reminders.slice(0, 5)
      return { ok: true, summary: `Saved: ${cap(label)}` }
    }
    default:
      return { ok: false, summary: 'I could not tell which device you meant' }
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

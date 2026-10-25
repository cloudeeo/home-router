import { useState } from 'react'

export default function HomePanel({ home }) {
  const [open, setOpen] = useState(true)
  if (!home) return null
  const lightsOn = Object.entries(home.lights).filter(([, l]) => l.on)
  return (
    <section className={`home ${open ? 'open' : ''}`}>
      <button type="button" className="home-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        The house {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="home-grid">
          <div className="tile">
            <span className="tile-label">Lights on</span>
            <span className="tile-value">
              {lightsOn.length ? lightsOn.map(([room, l]) => `${room} ${l.level}%`).join(', ') : 'none'}
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">Heating</span>
            <span className="tile-value">
              {Object.entries(home.heating)
                .filter(([room]) => ['living room', 'bedroom', 'kitchen'].includes(room))
                .map(([room, h]) => `${room} ${h.on ? `${h.target}°` : 'off'}`)
                .join(', ')}
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">Garage · door · vacuum</span>
            <span className="tile-value">
              {home.garage.open ? 'open' : 'closed'} · {home.door.locked ? 'locked' : 'unlocked'} · {home.vacuum.running ? 'running' : 'docked'}
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">Reminders</span>
            <span className="tile-value">{home.reminders.length ? home.reminders.map((r) => r.label).join(' · ') : 'none'}</span>
          </div>
        </div>
      )}
    </section>
  )
}

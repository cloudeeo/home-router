import { useEffect, useRef, useState } from 'react'
import { fetchState, streamEvents } from './api.js'
import Turn from './Turn.jsx'
import HomePanel from './HomePanel.jsx'

const EXAMPLES = [
  'Dim the kitchen lights to 30 percent',
  'What does my car insurance say about windscreen damage?',
  'Is my 8:12 train to Zurich on time?',
  'Write me a short poem about autumn',
]

let nextId = 1

export default function App() {
  const [turns, setTurns] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const listEnd = useRef(null)

  useEffect(() => {
    fetchState().then(setState).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    listEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  const update = (id, fn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)))

  function handle(id, event, data) {
    switch (event) {
      case 'decision':
        return update(id, (t) => ({ ...t, decision: data }))
      case 'route':
        return update(id, (t) => ({ ...t, routes: [...t.routes, data] }))
      case 'action':
        return update(id, (t) => ({ ...t, action: data }))
      case 'home':
        return setState((s) => (s ? { ...s, home: data } : s))
      case 'permission':
        return update(id, (t) => ({ ...t, permission: { ...data, status: 'asking' } }))
      case 'sources':
        return update(id, (t) => ({ ...t, sources: data }))
      case 'token':
        return update(id, (t) => ({ ...t, answer: t.answer + data.text, firstTokenAt: t.firstTokenAt ?? performance.now() }))
      case 'done':
        return update(id, (t) => ({ ...t, done: !data.waiting, waiting: Boolean(data.waiting), stats: { ...t.stats, ...data } }))
      case 'error':
        return update(id, (t) => ({ ...t, error: data.message, done: true }))
      default:
    }
  }

  async function ask(text) {
    const q = text.trim()
    if (!q || busy) return
    const id = nextId++
    setTurns((all) => [
      ...all,
      { id, question: q, startedAt: performance.now(), routes: [], answer: '', sources: null, decision: null, action: null, permission: null, stats: {}, done: false },
    ])
    setInput('')
    setBusy(true)
    try {
      await streamEvents('/api/ask', { text: q }, (event, data) => handle(id, event, data))
    } catch (e) {
      update(id, (t) => ({ ...t, error: e.message, done: true }))
    } finally {
      setBusy(false)
    }
  }

  async function answerPermission(id, allow) {
    const turn = turns.find((t) => t.id === id)
    if (!turn?.permission) return
    update(id, (t) => ({ ...t, permission: { ...t.permission, status: allow ? 'allowed' : 'denied' }, waiting: false, startedAt: performance.now(), firstTokenAt: null }))
    setBusy(true)
    try {
      await streamEvents('/api/search', { id: turn.permission.id, allow }, (event, data) => handle(id, event, data))
    } catch (e) {
      update(id, (t) => ({ ...t, error: e.message, done: true }))
    } finally {
      setBusy(false)
    }
  }

  const settings = state?.settings

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--ink)" />
            <path d="M8 16l8-7 8 7v8h-5v-5h-6v5H8z" fill="var(--accent)" />
          </svg>
          <div>
            <h1>Home Router</h1>
            <p className="sub">Runs on a home server. Nothing leaves the house without asking.</p>
          </div>
        </div>
        {settings && (
          <div className="pills">
            <span className="pill">{settings.routerModel.replace(/_Q8_0$/, '').replaceAll('_', ' ').toLowerCase()}</span>
            <span className="pill">threshold {Math.round(settings.threshold * 100)}%</span>
            <span className="pill">{settings.llmModel}</span>
            {settings.mock && <span className="pill warn">mock mode</span>}
          </div>
        )}
      </header>

      {state && <HomePanel home={state.home} />}
      {error && <p className="error">Cannot reach the router: {error}</p>}

      <main className="turns">
        {turns.length === 0 && (
          <div className="empty">
            <p>Ask something. A small decision model picks the route first:</p>
            <ul className="legend">
              <li><span className="tag action">action</span> runs a home command, no LLM</li>
              <li><span className="tag document">document</span> searches your files on this server</li>
              <li><span className="tag search">search</span> asks before going online</li>
              <li><span className="tag chat">chat</span> answered by the local LLM</li>
            </ul>
          </div>
        )}
        {turns.map((t) => (
          <Turn key={t.id} turn={t} onPermission={(allow) => answerPermission(t.id, allow)} />
        ))}
        <div ref={listEnd} />
      </main>

      <footer className="composer">
        {turns.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => ask(e)} disabled={busy}>
                {e}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the house…" maxLength={500} aria-label="Your request" />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      </footer>
    </div>
  )
}

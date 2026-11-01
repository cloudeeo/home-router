import { useEffect, useRef, useState } from 'react'
import { fetchState, streamEvents, postVoice } from './api.js'
import { recordUtterance, unlockAudio, playBase64Wav } from './recorder.js'
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
  const [mic, setMic] = useState('idle') // idle | listening | thinking | speaking
  const [level, setLevel] = useState(0)
  const recording = useRef(null)

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

  // Voice: tap the microphone, speak, and the recording stops by itself after a pause
  async function talk(followUp = false) {
    if (mic === 'listening') return recording.current?.stop()
    if (mic !== 'idle' || busy) return
    if (!followUp) unlockAudio()
    const id = nextId++
    try {
      setMic('listening')
      recording.current = await recordUtterance({ onLevel: setLevel })
      const wav = await recording.current.done
      setLevel(0)
      if (!wav) return setMic('idle')
      setMic('thinking')
      setTurns((all) => [
        ...all,
        { id, voice: true, question: '…', startedAt: performance.now(), routes: [], answer: '', sources: null, decision: null, action: null, permission: null, stats: {}, done: false },
      ])
      const out = await postVoice(wav)
      const t = out.timings || {}
      update(id, (turn) => ({
        ...turn,
        question: out.transcript || '(nothing understood)',
        decision: out.decision,
        routes: [{ route: out.route || 'voice', reason: `Voice · ${out.lang} · heard in ${t.sttMs} ms, answered in ${t.routerMs} ms, spoken in ${t.ttsMs} ms` }],
        answer: out.reply,
        sources: out.sources?.length ? out.sources.map((title) => ({ title })) : null,
        error: out.error,
        done: true,
        stats: { totalMs: t.totalMs },
      }))
      fetchState().then(setState).catch(() => {})
      setMic('speaking')
      await playBase64Wav(out.audio)
      setMic('idle')
      // "Shall I search the web?" waits for a spoken yes or no: listen again straight away
      if (out.waitingForYesNo) setTimeout(() => talk(true), 300)
    } catch (e) {
      setMic('idle')
      setLevel(0)
      update(id, (turn) => ({ ...turn, error: e.message, done: true }))
      if (!turns.some((x) => x.id === id)) setError(`Microphone: ${e.message}`)
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
          <button
            type="button"
            className={`mic ${mic}`}
            onClick={() => talk()}
            disabled={busy || mic === 'thinking' || mic === 'speaking'}
            aria-label={mic === 'listening' ? 'Stop listening' : 'Speak'}
            title={mic === 'listening' ? 'Listening… tap to stop' : 'Tap and speak (Italian, French or English)'}
            style={{ '--level': level }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12z" fill="currentColor" />
            </svg>
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={mic === 'listening' ? 'Listening…' : mic === 'thinking' ? 'Thinking…' : mic === 'speaking' ? 'Speaking…' : 'Ask the house…'} maxLength={500} aria-label="Your request" />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      </footer>
    </div>
  )
}

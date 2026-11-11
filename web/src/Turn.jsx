const ORDER = ['action', 'search', 'document', 'chat']

function DecisionCard({ decision, routes }) {
  if (!decision) return routes.length ? <div className="decision">{routes.map((r, i) => <p key={i} className="reason">{r.reason}</p>)}</div> : <div className="decision pending">Deciding…</div>
  const route = routes[0]?.route
  const fallback = route === 'llm'
  // Laya was unsure and the second router (BotPsy) picked the route
  const second = decision.second
  const intent = second ? second.intent : decision.intent
  return (
    <div className={`decision ${fallback ? 'fallback' : intent}`}>
      <div className="decision-head">
        <span className={`tag ${fallback ? 'llm' : intent}`}>{fallback ? 'unsure → LLM' : second ? `unsure → ${second.model}: ${intent}` : intent}</span>
        <span className="conf">{second ? 'Laya ' : ''}{Math.round(decision.p * 100)}% sure</span>
        <span className="ms">{decision.ms}{second ? ` + ${second.ms}` : ''} ms</span>
      </div>
      <div className="bars" aria-label="Probability per intent">
        {ORDER.map((k) => (
          <div key={k} className="bar">
            <span className="bar-label">{k}</span>
            <span className="bar-track">
              <span className={`bar-fill ${k}`} style={{ width: `${Math.round((decision.probabilities?.[k] ?? 0) * 100)}%` }} />
            </span>
            <span className="bar-value">{Math.round((decision.probabilities?.[k] ?? 0) * 100)}%</span>
          </div>
        ))}
      </div>
      {routes.map((r, i) => (
        <p key={i} className="reason">{r.reason}</p>
      ))}
    </div>
  )
}

function Sources({ sources }) {
  if (!sources?.length) return null
  const [first, ...others] = sources
  const rest = [...new Set(others.map((s) => s.title))].filter((t) => t !== first.title)
  return (
    <div className="sources">
      <div className="source">
        {first.url ? (
          <a href={first.url} target="_blank" rel="noreferrer"><strong>{first.title}</strong></a>
        ) : (
          <strong>{first.title}</strong>
        )}
        <span>{first.snippet}</span>
      </div>
      {rest.length > 0 && <p className="more-sources">Also checked: {rest.join(', ')}</p>}
    </div>
  )
}

function Permission({ permission, onAnswer }) {
  if (!permission) return null
  if (permission.status === 'asking') {
    return (
      <div className="permission">
        <p>{permission.message}</p>
        <p className="query">Only this text would be sent: “{permission.query}”</p>
        <div className="buttons">
          <button type="button" className="allow" onClick={() => onAnswer(true)}>Allow once</button>
          <button type="button" className="deny" onClick={() => onAnswer(false)}>Keep it at home</button>
        </div>
      </div>
    )
  }
  return <p className={`permission-done ${permission.status}`}>{permission.status === 'allowed' ? 'Web search allowed once' : 'Kept at home'}</p>
}

export default function Turn({ turn, onPermission }) {
  const firstWord = turn.firstTokenAt ? ((turn.firstTokenAt - turn.startedAt) / 1000).toFixed(1) : null
  return (
    <section className="turn">
      <p className="question">{turn.voice && <span className="voice-mark" aria-label="spoken">🎙 </span>}{turn.question}</p>
      <div className="reply">
        <DecisionCard decision={turn.decision} routes={turn.routes} />
        {turn.action && <p className={`action-done ${turn.action.ok ? 'ok' : 'ko'}`}>{turn.action.summary}</p>}
        <Permission permission={turn.permission} onAnswer={onPermission} />
        <Sources sources={turn.sources} />
        {turn.answer && <p className="answer">{turn.answer}</p>}
        {!turn.done && !turn.waiting && turn.decision && !turn.action && !turn.answer && <p className="typing">Thinking…</p>}
        {turn.error && <p className="error">{turn.error}</p>}
        {turn.done && (
          <p className="stats">
            {turn.decision && `decided in ${turn.decision.ms + (turn.decision.second?.ms ?? 0)} ms`}
            {firstWord && ` · first word after ${firstWord} s`}
            {turn.stats?.totalMs != null && ` · done in ${(turn.stats.totalMs / 1000).toFixed(1)} s`}
          </p>
        )}
      </div>
    </section>
  )
}

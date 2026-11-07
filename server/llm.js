// Streams a chat completion from the OpenAI-compatible qvac serve endpoint.
// Qwen3 models get "/no_think" and any <think> block is stripped before it reaches the user.
import { config } from './config.js'

const SYSTEM = 'You are a home assistant that runs entirely on a home server. Answer in at most four short sentences. You have no internet access: never invent weather, news, prices, scores or other live data.'
// Spoken replies: same language as the question, short, no markdown or lists, numbers written so they read well aloud
export const VOICE_SYSTEM =
  'You are a home assistant that runs entirely on a home server and answers by voice. ' +
  'Always reply in the language of the question (Italian, French or English). ' +
  'Answer the question directly; never repeat or rephrase it, and do not ask it back. ' +
  'You have no internet access: never invent weather, news, prices, scores or other live data; say you would need to search the web for that. ' +
  'Use at most three short sentences, plain text only: no markdown, no lists, no emoji.'

// The model has no clock: give it the local date and time with every request
function now() {
  const tz = config.timeZone
  const d = new Date()
  const date = d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  return `Current local date and time (${tz}): ${date}, ${time}. Use it for any question about the date or time; never guess them.`
}

export async function streamChat({ messages, onToken, system = SYSTEM }) {
  if (config.mock) return mockStream(messages, onToken)

  const t0 = performance.now()
  const res = await fetch(`${config.llmUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.llmKey ? { Authorization: `Bearer ${config.llmKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.llmModel,
      stream: true,
      messages: [{ role: 'system', content: `${system}\n${now()}` }, ...withNoThink(messages)],
    }),
  })
  if (!res.ok) throw new Error(`LLM server returned ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const decoder = new TextDecoder()
  let buffer = ''
  let raw = ''
  let sent = 0
  let ttftMs = null
  let tokens = 0
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let delta = ''
      try {
        delta = JSON.parse(data).choices?.[0]?.delta?.content || ''
      } catch {
        continue
      }
      if (!delta) continue
      tokens++
      raw += delta
      // Hide reasoning: only emit text after a closed </think>, or everything if no <think> was opened
      const visible = stripThink(raw)
      if (visible.length > sent) {
        if (ttftMs === null) ttftMs = Math.round(performance.now() - t0)
        onToken(visible.slice(sent))
        sent = visible.length
      }
    }
  }
  // A stream that closes without a single token is a failure, not an empty answer
  if (tokens === 0) throw new Error('LLM returned an empty reply')
  return { ttftMs, tokens, totalMs: Math.round(performance.now() - t0) }
}

function withNoThink(messages) {
  if (!/qwen/i.test(config.llmModel)) return messages
  return messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { ...m, content: `${m.content} /no_think` } : m))
}

function stripThink(text) {
  const open = text.indexOf('<think>')
  if (open === -1) return text.trimStart()
  const close = text.indexOf('</think>')
  if (close === -1) return text.slice(0, open).trimStart()
  return (text.slice(0, open) + text.slice(close + '</think>'.length)).trimStart()
}

async function mockStream(messages, onToken) {
  const last = messages[messages.length - 1].content
  const answer = /excerpts/i.test(last)
    ? 'According to your Alpine Shield policy, windscreen repairs are covered with no excess, and a full replacement has an excess of CHF 200 (Car insurance policy, section 4).'
    : /search results/i.test(last)
      ? 'Demo mode: this answer would summarise the web results you allowed.'
      : 'Crisp leaves drift down,\nthe lake holds a copper sky,\nthe house hums, warm, still.'
  const t0 = performance.now()
  let ttftMs = null
  const words = answer.split(/(\s+)/)
  for (const w of words) {
    await new Promise((r) => setTimeout(r, 25))
    if (ttftMs === null) ttftMs = Math.round(performance.now() - t0)
    onToken(w)
  }
  return { ttftMs, tokens: words.length, totalMs: Math.round(performance.now() - t0) }
}

// The first request through a fresh connection and prompt path is slow (seen: ~8 s instead of ~1 s),
// so send one tiny request at startup. Failures are only logged: the LLM may still be starting.
export async function warmUpLlm(log = console.log) {
  if (config.mock) return
  const t = performance.now()
  try {
    await streamChat({ messages: [{ role: 'user', content: 'Ok' }], system: VOICE_SYSTEM, onToken: () => {} })
    log(`LLM: warm-up done in ${((performance.now() - t) / 1000).toFixed(1)} s`)
  } catch (err) {
    log(`LLM: warm-up failed (${err.message}); the first question will be slower`)
  }
}

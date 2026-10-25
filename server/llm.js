// Streams a chat completion from the OpenAI-compatible qvac serve endpoint.
// Qwen3 models get "/no_think" and any <think> block is stripped before it reaches the user.
import { config } from './config.js'

const SYSTEM = 'You are a home assistant that runs entirely on a home server. Answer in at most four short sentences.'

export async function streamChat({ messages, onToken }) {
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
      messages: [{ role: 'system', content: SYSTEM }, ...withNoThink(messages)],
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

// The routing logic. Every request is classified by Laya first:
//   action   -> run the command on the (simulated) home, no LLM call
//   search   -> ask the user before anything leaves the house
//   document -> search the local documents, answer with sources
//   chat     -> answer with the local LLM
// Below the confidence threshold the request goes to the local LLM, and nothing is switched or sent online.
import crypto from 'node:crypto'
import { classify, pickDevice } from './intents.js'
import { applyCommand, home } from './home.js'
import { searchDocs } from './docs.js'
import { webSearch } from './search.js'
import { streamChat } from './llm.js'

const pending = new Map() // search id -> { query, created }

export async function handleRequest(text, emit) {
  const t0 = performance.now()
  const decision = await classify(text)
  emit('decision', decision)

  if (!decision.confident) {
    const pct = (decision.p * 100).toFixed(0)
    // Below the threshold, the fallback depends on what acting wrongly would cost:
    // - search: the permission prompt already asks the user, so it doubles as the confirmation
    // - document: searching local files is harmless and nothing leaves the house, so search them anyway
    // - action or chat: nothing is switched; the local LLM answers
    if (decision.intent === 'search') {
      return askSearchPermission(text, emit, t0, `Probably needs the web (${pct}%, below the threshold): asking first`)
    }
    if (decision.intent === 'document') {
      return answerFromDocs(text, emit, t0, `Probably about your documents (${pct}%, below the threshold): searching them on this server`, true)
    }
    emit('route', { route: 'llm', reason: `Confidence ${pct}% is below the threshold: answered by the local LLM, nothing switched or sent online` })
    return answerWithLlm(text, emit, t0)
  }

  switch (decision.intent) {
    case 'action': {
      const device = decision.device || (await pickDevice(text))
      const result = applyCommand(device.device, text)
      const how = decision.device ? 'same decision' : `${device.ms} ms`
      emit('route', { route: 'action', reason: `Command for: ${device.device} (${(device.p * 100).toFixed(0)}%, ${how})` })
      emit('action', { device: device.device, ok: result.ok, summary: result.summary })
      emit('home', home)
      emit('done', { totalMs: Math.round(performance.now() - t0) })
      return
    }
    case 'search':
      return askSearchPermission(text, emit, t0, 'Needs live information from the internet')
    case 'document':
      return answerFromDocs(text, emit, t0, 'Searching your documents on this server', false)
    default:
      emit('route', { route: 'chat', reason: 'General question: answered by the local LLM' })
      return answerWithLlm(text, emit, t0)
  }
}

function askSearchPermission(text, emit, t0, reason) {
  const id = crypto.randomUUID()
  pending.set(id, { query: text, created: Date.now() })
  emit('route', { route: 'search', reason })
  emit('permission', { id, query: text, message: 'This request would leave your home network. Allow one web search?' })
  emit('done', { totalMs: Math.round(performance.now() - t0), waiting: true })
}

async function answerFromDocs(text, emit, t0, reason, unsure) {
  emit('route', { route: 'document', reason })
  const hits = await searchDocs(text)
  emit('sources', hits.map((h) => ({ title: h.title, doc: h.doc, score: Number(h.score.toFixed(3)), snippet: h.text.replace(/^#+\s.*$/gm, '').trim().slice(0, 220) })))
  const context = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.text}`).join('\n\n')
  const rule = unsure
    ? 'If the excerpts answer the question, answer from them and name the document. If they are not relevant, ignore them and answer normally.'
    : 'Answer using only these excerpts. Name the document you used. If the answer is not there, say so.'
  const prompt = `The user asked a home assistant a question. These are excerpts from the user's own documents. ${rule}\n\nExcerpts:\n${context}\n\nQuestion: ${text}`
  return answerWithLlm(prompt, emit, t0)
}

export async function handleSearchDecision(id, allow, emit) {
  const item = pending.get(id)
  pending.delete(id)
  const t0 = performance.now()
  if (!item) {
    emit('error', { message: 'This search request has expired. Ask again.' })
    return
  }
  if (!allow) {
    emit('route', { route: 'search-denied', reason: 'Search not allowed: nothing left the house' })
    emit('token', { text: 'OK, I will not go online for this.' })
    emit('done', { totalMs: Math.round(performance.now() - t0) })
    return
  }
  emit('route', { route: 'search', reason: 'Searching the web with your permission (only the question is sent)' })
  let results
  try {
    results = await webSearch(item.query)
  } catch (err) {
    emit('error', { message: `Web search failed: ${err.message}` })
    emit('done', { totalMs: Math.round(performance.now() - t0) })
    return
  }
  emit('sources', results.map((r) => ({ title: r.title, url: r.url, snippet: r.text.slice(0, 220) })))
  const context = results.map((r, i) => `[${i + 1}] ${r.title}: ${r.text}`).join('\n')
  const prompt = `Answer the question using these web search results. Say which source you used. If they do not answer it, say so: do not guess live information such as times, scores or prices.\n\nSearch results:\n${context}\n\nQuestion: ${item.query}`
  return answerWithLlm(prompt, emit, t0)
}

async function answerWithLlm(prompt, emit, t0) {
  const stats = await streamChat({
    messages: [{ role: 'user', content: prompt }],
    onToken: (text) => emit('token', { text }),
  })
  emit('done', { totalMs: Math.round(performance.now() - t0), llm: stats })
}

// Drop permission requests nobody answered within 10 minutes
setInterval(() => {
  const limit = Date.now() - 10 * 60 * 1000
  for (const [id, item] of pending) if (item.created < limit) pending.delete(id)
}, 60 * 1000).unref()

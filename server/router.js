// The routing logic. Every request is classified by Laya first:
//   action   -> run the command on the (simulated) home, no LLM call
//   search   -> ask the user before anything leaves the house
//   document -> search the local documents, answer with sources
//   chat     -> answer with the local LLM
// Below the confidence threshold a second router (BotPsy, a tool-calling model) picks the route; without it,
// the request goes to the local LLM, and nothing is switched or sent online.
import crypto from 'node:crypto'
import { classify, pickDevice } from './intents.js'
import { applyCommand, home } from './home.js'
import { searchDocs } from './docs.js'
import { webSearch } from './search.js'
import { streamChat, VOICE_SYSTEM } from './llm.js'
import { config } from './config.js'
import { clockAnswer } from './clock.js'
import { needsLiveInfo } from './live.js'
import { secondOpinion } from './second.js'

const pending = new Map() // search id -> { query, created }

// opts.voice: the reply will be spoken, so the LLM answers short, in the language of the question
export async function handleRequest(text, emit, opts = {}) {
  const t0 = performance.now()
  // Time and date questions are answered from the server clock: exact, instant, no model call
  const clock = clockAnswer(text)
  if (clock) {
    emit('route', { route: 'clock', reason: 'Time or date question: answered from the server clock, no model call' })
    emit('token', { text: clock })
    emit('done', { totalMs: Math.round(performance.now() - t0) })
    return
  }
  // Weather, news, prices, scores: only the web knows, so ask before searching instead of letting the LLM guess
  if (needsLiveInfo(text)) {
    return askSearchPermission(text, emit, t0, 'Needs live information (weather, news, prices): asking before searching the web', opts)
  }
  const decision = await classify(text)
  emit('decision', decision)

  if (!decision.confident) {
    const pct = (decision.p * 100).toFixed(0)
    const second = await secondOpinion(text)
    if (second) {
      decision.second = second
      emit('decision', decision)
      return routeSecond(text, emit, t0, decision, second, opts)
    }
    // Below the threshold, the fallback depends on what acting wrongly would cost:
    // - search: the permission prompt already asks the user, so it doubles as the confirmation
    // - document: searching local files is harmless and nothing leaves the house, so search them anyway
    // - action or chat: nothing is switched; the local LLM answers
    if (decision.intent === 'search') {
      return askSearchPermission(text, emit, t0, `Probably needs the web (${pct}%, below the threshold): asking first`, opts)
    }
    // Searching the local documents is cheap and stays in the house, so an unsure request is checked against
    // them too: if a passage is close enough (DOC_SCORE), the answer uses it, whatever Laya's top guess was.
    const hits = await searchDocs(text)
    const best = hits[0]?.score ?? 0
    console.log(`[router] unsure (${decision.intent} ${pct}%), best document match ${best.toFixed(3)} ("${hits[0]?.title}")`)
    if (decision.intent === 'document' || best >= config.docScore) {
      return answerFromDocs(text, emit, t0, `Unsure (${pct}%), but a document matches (${best.toFixed(2)}): answering from your files on this server`, true, hits, opts)
    }
    emit('route', { route: 'llm', reason: `Confidence ${pct}% is below the threshold: answered by the local LLM, nothing switched or sent online` })
    return answerWithLlm(text, emit, t0, opts)
  }

  switch (decision.intent) {
    case 'action': {
      const device = decision.device || (await pickDevice(text))
      const how = decision.device ? 'same decision' : `${device.ms} ms`
      return runAction(text, emit, t0, device.device, `Command for: ${device.device} (${(device.p * 100).toFixed(0)}%, ${how})`)
    }
    case 'search':
      return askSearchPermission(text, emit, t0, 'Needs live information from the internet', opts)
    case 'document':
      return answerFromDocs(text, emit, t0, 'Searching your documents on this server', false, null, opts)
    default:
      emit('route', { route: 'chat', reason: 'General question: answered by the local LLM' })
      return answerWithLlm(text, emit, t0, opts)
  }
}

// The device comes from the router; the operation (on/off, a level, a temperature) is read from the words by home.js
function runAction(text, emit, t0, device, reason) {
  const result = applyCommand(device, text)
  emit('route', { route: 'action', reason })
  emit('action', { device, ok: result.ok, summary: result.summary, facts: result.facts })
  emit('home', home)
  emit('done', { totalMs: Math.round(performance.now() - t0) })
}

// Laya was unsure and the second router answered. Its usual mistake (qvac-lab MEASUREMENTS.md, section 11) is sending
// a question about the user's own files, or a plain question, to the web, so for search and chat a close document
// passage still wins, as in Laya's unsure path. Search always asks before anything leaves the house.
async function routeSecond(text, emit, t0, decision, second, opts) {
  const who = `Laya unsure (${decision.intent} ${(decision.p * 100).toFixed(0)}%), ${second.model} decided in ${second.ms} ms`
  console.log(`[router] ${who}: ${second.intent}${second.device ? ` (${second.device})` : ''}`)
  if (second.intent === 'action') {
    const device = second.device ? { device: second.device } : await pickDevice(text)
    return runAction(text, emit, t0, device.device, `${who}: command for ${device.device}`)
  }
  if (second.intent === 'document') {
    return answerFromDocs(text, emit, t0, `${who}: searching your documents on this server`, false, null, opts)
  }
  const hits = await searchDocs(text)
  const best = hits[0]?.score ?? 0
  if (best >= config.docScore) {
    return answerFromDocs(text, emit, t0, `${who}: ${second.intent}, but a document matches (${best.toFixed(2)}): answering from your files on this server`, true, hits, opts)
  }
  if (second.intent === 'search') {
    return askSearchPermission(text, emit, t0, `${who}: needs live information, asking before searching the web`, opts)
  }
  emit('route', { route: 'chat', reason: `${who}: general question, answered by the local LLM` })
  return answerWithLlm(text, emit, t0, opts)
}

function askSearchPermission(text, emit, t0, reason, opts = {}) {
  const id = crypto.randomUUID()
  pending.set(id, { query: text, created: Date.now(), voice: Boolean(opts.voice) })
  emit('route', { route: 'search', reason })
  emit('permission', { id, query: text, message: 'This request would leave your home network. Allow one web search?' })
  emit('done', { totalMs: Math.round(performance.now() - t0), waiting: true })
}

async function answerFromDocs(text, emit, t0, reason, unsure, found, opts = {}) {
  const hits = found || (await searchDocs(text))
  if (!hits.length) {
    // Degraded mode: document search is off, so the local LLM answers without excerpts
    emit('route', { route: 'llm', reason: 'Document search is unavailable: answered by the local LLM' })
    return answerWithLlm(text, emit, t0, opts)
  }
  emit('route', { route: 'document', reason })
  emit('sources', hits.map((h) => ({ title: h.title, doc: h.doc, url: `/api/docs/${encodeURIComponent(h.doc)}`, score: Number(h.score.toFixed(3)), snippet: h.text.replace(/^#+\s.*$/gm, '').trim().slice(0, 220) })))
  const context = hits.map((h) => `Document: ${h.title}\n${h.text}`).join('\n\n')
  const cite = 'Name the document by its title, for example "according to your Car insurance policy"; never cite by number.'
  const rule = unsure
    ? `If the excerpts answer the question, answer from them. ${cite} If they are not relevant, ignore them and answer normally.`
    : `Answer using only these excerpts. ${cite} If the answer is not there, say so.`
  const prompt = `The user asked a home assistant a question. These are excerpts from the user's own documents. ${rule}\n\nExcerpts:\n${context}\n\nQuestion: ${text}`
  return answerWithLlm(prompt, emit, t0, opts)
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
  const context = results.map((r) => `Source: ${r.title}\n${r.text}`).join('\n\n')
  const prompt = `Answer the question using these web search results. Name the source you used by its title; never cite by number. If they do not answer it, say so: do not guess live information such as times, scores or prices. Use metric units (°C, km/h).\n\nSearch results:\n${context}\n\nQuestion: ${item.query}`
  return answerWithLlm(prompt, emit, t0, { voice: item.voice })
}

async function answerWithLlm(prompt, emit, t0, opts = {}) {
  let stats
  try {
    stats = await streamChat({
      messages: [{ role: 'user', content: prompt }],
      ...(opts.voice ? { system: VOICE_SYSTEM } : {}),
      onToken: (text) => emit('token', { text }),
    })
  } catch (err) {
    // Tag the error so callers can tell an LLM failure from other failures
    console.error(`[router] LLM failed: ${err.message}`)
    err.llm = true
    throw err
  }
  emit('done', { totalMs: Math.round(performance.now() - t0), llm: stats })
}

// Drop permission requests nobody answered within 10 minutes
setInterval(() => {
  const limit = Date.now() - 10 * 60 * 1000
  for (const [id, item] of pending) if (item.created < limit) pending.delete(id)
}, 60 * 1000).unref()

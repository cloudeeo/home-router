// Second opinion for the requests Laya is unsure about: BotPsy-0.8B, Tether's tool-calling model, through the same
// qvac serve as the LLM. Each route is a tool (control_device, web_search, search_documents); no tool call means chat.
//
// Why: Laya is accurate when it is sure, but in Italian it is unsure on most requests (5 of 40 above the 0.45
// threshold, 19/40 right), while BotPsy with thinking got 34/40 in Italian and 38/40 in English on the same cases,
// at about 1 s per request on the GPU (qvac-lab MEASUREMENTS.md, section 11). So Laya answers first (~0.25 s) and
// BotPsy only decides when Laya is below the threshold.
//
// Only the route and the device are used. The operation (on/off, up/down, a percentage) is still read from the
// user's words by home.js: BotPsy sometimes returned "on" for "Spegni le luci", and the text never lies about that.
import { config } from './config.js'
import { authHeaders } from './llm.js'

export const DEVICES = ['lights', 'heating', 'garage', 'door', 'vacuum', 'reminder']

const SYSTEM =
  'You are a home assistant. Requests may be in Italian, French or English. ' +
  'Call a tool when one fits the request; otherwise answer directly. ' +
  'Questions about the user\'s own documents, bills, contracts, letters, notes or warranties use search_documents, never web_search. ' +
  'General knowledge, explanations, recipes, jokes and writing help need no tool.'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'control_device',
      description: 'Control a smart home device or set a reminder, timer or alarm.',
      parameters: {
        type: 'object',
        properties: {
          device: {
            type: 'string',
            enum: DEVICES,
            description:
              'lights: lights or lamps (luci, lumières). heating: heating, radiators, thermostat (riscaldamento, termostato, chauffage). ' +
              'garage: the garage door (porta del garage, porte du garage). door: the front door lock (porta d\'ingresso, porte d\'entrée). ' +
              'vacuum: the robot vacuum (aspirapolvere, aspirateur). reminder: a reminder, alarm or timer (promemoria, sveglia, timer, rappel, réveil).',
          },
          action: { type: 'string', description: 'What to do, e.g. on, off, open, close, lock, unlock, set, start, stop.' },
          room: { type: 'string' },
          value: { type: 'string', description: 'Optional value, e.g. a temperature, a percentage, a time or a reminder text.' },
        },
        required: ['device', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for live or public information that changes: weather, news, prices, scores, traffic, timetables, opening hours.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: "Search the user's own files and notes: insurance policies, contracts, bills, warranties, manuals, letters, PDFs, meeting notes.",
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
]

const TOOL_TO_INTENT = { control_device: 'action', web_search: 'search', search_documents: 'document' }

// Sampling recommended on the BotPsy model card; thinking on unless SECOND_THINK=0 (faster, clearly worse:
// 25/40 in Italian, 29/40 in English, and "Dim the lights to 30%" came back as "off")
function body(text) {
  return {
    model: config.secondModel,
    stream: false,
    max_tokens: 2048,
    temperature: 0.3,
    top_p: 0.95,
    top_k: 20,
    presence_penalty: 1.5,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ],
    tools: TOOLS,
    ...(config.secondThink
      ? { reasoning_budget: -1, chat_template_kwargs: { enable_thinking: true } }
      : { reasoning_budget: 0, chat_template_kwargs: { enable_thinking: false } }),
  }
}

function parseArgs(raw) {
  if (raw == null) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// In Italian BotPsy returned "door" for "Apri la porta del garage": acted on, that unlocks the front door.
// A request that names the garage is about the garage door.
const GARAGE = /\bgarage\b/i

// Turns a chat completion message into a route. Exported for tests.
export function readDecision(message, text = '') {
  const call = message?.tool_calls?.[0]
  const name = call?.function?.name
  const intent = TOOL_TO_INTENT[name] || 'chat'
  const args = call ? parseArgs(call.function?.arguments) : {}
  const out = { intent, tool: name || null, args }
  if (intent === 'action') {
    out.device = DEVICES.includes(args.device) ? args.device : null
    if (out.device === 'door' && GARAGE.test(text)) out.device = 'garage'
  }
  return out
}

// Returns { intent, device?, tool, args, ms, model } or null when the second router is off or fails
// (HTTP error, timeout, model not loaded): the caller then keeps Laya's unsure fallback.
export async function secondOpinion(text) {
  if (!config.secondRouter) return null
  const t0 = performance.now()
  try {
    const res = await fetch(`${config.llmUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body(text)),
      signal: AbortSignal.timeout(config.secondTimeoutMs),
    })
    if (!res.ok) {
      console.log(`[second] ${config.secondModel}: HTTP ${res.status}, keeping Laya's fallback`)
      return null
    }
    const json = await res.json()
    const decision = readDecision(json?.choices?.[0]?.message, text)
    return { ...decision, ms: Math.round(performance.now() - t0), model: config.secondModel }
  } catch (err) {
    console.log(`[second] ${config.secondModel}: ${err?.name === 'TimeoutError' ? `no answer in ${config.secondTimeoutMs} ms` : err?.message || err}, keeping Laya's fallback`)
    return null
  }
}

// Warm-up at start, so the first unsure request does not pay for loading the KV cache
export async function warmUpSecond() {
  if (!config.secondRouter) return
  const t = performance.now()
  const d = await secondOpinion('Accendi la luce in cucina')
  console.log(d ? `Second router ${config.secondModel}: warm-up in ${((performance.now() - t) / 1000).toFixed(1)} s` : `Second router ${config.secondModel}: not reachable, Laya's fallback is used`)
}

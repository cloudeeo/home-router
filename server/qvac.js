// Thin wrapper around the QVAC SDK: one decision model (Laya) and one embedding model, loaded once.
// In MOCK mode, keyword rules and bag-of-words vectors stand in for both, so the app runs without the SDK.
import { config } from './config.js'

let sdk = null
let decisionId = null
let embedId = null

export async function initModels(log = console.log) {
  if (config.mock) {
    log('MOCK mode: no models loaded')
    return
  }
  sdk = await import('@qvac/sdk')
  const routerSrc = sdk[config.routerModel]
  const embedSrc = sdk[config.embedModel]
  if (!routerSrc) throw new Error(`Unknown router model ${config.routerModel}`)
  if (!embedSrc) throw new Error(`Unknown embedding model ${config.embedModel}`)

  let t = performance.now()
  decisionId = await sdk.loadModel({
    modelSrc: routerSrc,
    modelType: 'llamacpp-decision',
    modelConfig: { device: config.routerDevice },
  })
  log(`Router model ${config.routerModel} loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`)

  t = performance.now()
  embedId = await sdk.loadModel({ modelSrc: embedSrc, modelConfig: { device: config.embedDevice } })
  log(`Embedding model ${config.embedModel} loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`)
}

export async function closeModels() {
  if (!sdk) return
  if (decisionId) await sdk.unloadModel({ modelId: decisionId })
  if (embedId) await sdk.unloadModel({ modelId: embedId })
  await sdk.close()
}

// ---- decisions ----------------------------------------------------------

export async function decide(state, questions) {
  if (config.mock) return mockDecide(state, questions)
  return sdk.decide({ modelId: decisionId, state, questions })
}

const MOCK_RULES = {
  action: /\b(turn|switch|dim|set|open|close|lock|unlock|start|stop|remind|wake|timer)\b/i,
  document: /\b(insurance|policy|contract|bill|notes|manual|lease|uploaded|pdf|minutes|warranty|letter)\b/i,
  search: /\b(weather|news|won|score|right now|today|tonight|price|open now|on time|traffic|exchange rate|warnings?)\b/i,
  heating: /\b(heating|thermostat|radiators?|degrees)\b/i,
  garage: /\bgarage\b/i,
  door: /\b(front door|lock|unlock)\b/i,
  vacuum: /\bvacuum\b/i,
  reminder: /\b(remind|wake|timer|alarm)\b/i,
}
// Order in which the mock tries labels (more specific first)
const MOCK_ORDER = ['document', 'search', 'reminder', 'heating', 'garage', 'door', 'vacuum', 'action']

function mockDecide(state, questions) {
  const answers = {}
  for (const [id, q] of Object.entries(questions)) {
    const labels = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria || {})
    let choice = labels[labels.length - 1]
    let p = 0.4
    const ordered = [...MOCK_ORDER.filter((l) => labels.includes(l)), ...labels.filter((l) => !MOCK_ORDER.includes(l))]
    for (const label of ordered) {
      const rule = MOCK_RULES[label] || new RegExp(`\\b${label}\\b`, 'i')
      if (rule.test(state)) {
        choice = label
        p = 0.8
        break
      }
    }
    const probabilities = Object.fromEntries(labels.map((l) => [l, l === choice ? p : (1 - p) / (labels.length - 1)]))
    answers[id] = { type: 'choice', choice, probabilities, confidence: p }
  }
  return { answers, usage: { mock: true } }
}

// ---- embeddings ---------------------------------------------------------

// EmbeddingGemma expects task prefixes on queries and documents.
export const asQuery = (text) => `task: search result | query: ${text}`
export const asDocument = (title, text) => `title: ${title} | text: ${text}`

export async function embed(texts) {
  if (config.mock) return texts.map(mockVector)
  const { embedding } = await sdk.embed({ modelId: embedId, text: texts })
  return embedding
}

function mockVector(text) {
  const v = new Array(256).fill(0)
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) || []) {
    let h = 0
    for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0
    v[h % 256] += 1
  }
  return v
}

export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

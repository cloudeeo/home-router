// All settings come from environment variables, with defaults for the omen01 setup.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const env = process.env

function readKey() {
  if (env.LLM_KEY) return env.LLM_KEY
  const file = env.LLM_KEY_FILE || path.join(os.homedir(), 'qvac-lab', 'api-key.txt')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

export const config = {
  // MOCK=1 replaces Laya, the LLM and the embedding model with simple fakes, to test the app anywhere
  mock: env.MOCK === '1',
  host: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 8090),

  // Router model and thresholds (see laya-bench results: typed decisions 421M with detailed criteria)
  routerModel: env.ROUTER_MODEL || 'LAYA_TYPED_DECISIONS_421M_Q8_0',
  routerDevice: env.ROUTER_DEVICE || 'cpu',
  threshold: Number(env.THRESHOLD || 0.45), // below this, the request goes to the LLM and nothing is acted on
  // ONE_CALL=1 asks intent and device in one decide() call. Measured on omen01: ~373 ms for a command either way,
  // so the default asks the device only for commands, and other requests skip that question.
  oneCall: env.ONE_CALL === '1',

  // Embedding model for the document search
  embedModel: env.EMBED_MODEL || 'EMBEDDINGGEMMA_300M_Q8_0',
  embedDevice: env.EMBED_DEVICE || 'cpu',
  docsDir: env.DOCS_DIR || new URL('../docs/', import.meta.url).pathname,
  // When Laya is unsure, a document passage at least this similar to the question (cosine) is used to answer.
  // The [router] log line prints the best match for each unsure request, to calibrate it.
  docScore: Number(env.DOC_SCORE || 0.5),

  // The LLM is the qvac serve instance already running on the same machine (OpenAI-compatible API)
  llmUrl: (env.LLM_URL || 'http://127.0.0.1:11434/v1').replace(/\/$/, ''),
  llmKey: readKey(),
  llmModel: env.LLM_MODEL || 'qwen4b',

  // Web search: 'mock' (labelled placeholder), 'searxng' (self-hosted SearXNG) or 'ddg' (DuckDuckGo Instant Answer API)
  search: env.SEARCH || 'mock',
  searxngUrl: (env.SEARXNG_URL || 'http://127.0.0.1:8888').replace(/\/$/, ''),
}

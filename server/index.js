// HTTP server: a small JSON/SSE API plus the built web app.
//   GET  /api/state            home state and settings
//   POST /api/ask      {text}  streams events: decision, route, action, home, permission, sources, token, done, error
//   POST /api/search   {id, allow}  answers a pending permission request, streams the same events
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { initModels, closeModels } from './qvac.js'
import { indexDocs, docList } from './docs.js'
import { handleRequest, handleSearchDecision } from './router.js'
import { home } from './home.js'

const WEB_DIR = new URL('../web/dist/', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1e5) reject(new Error('Body too large'))
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.normalize(path.join(WEB_DIR, urlPath))
  if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'Forbidden' })
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html')
  if (!fs.existsSync(file)) return json(res, 404, { error: 'Web app not built. Run: npm run web:build' })
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

async function stream(res, run) {
  const emit = sse(res)
  try {
    await run(emit)
  } catch (err) {
    console.error(err)
    emit('error', { message: err.message })
  } finally {
    res.end()
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/state') {
      return json(res, 200, {
        home,
        settings: { mock: config.mock, routerModel: config.routerModel, threshold: config.threshold, llmModel: config.llmModel, search: config.search },
        documents: docList(),
      })
    }
    if (req.method === 'POST' && req.url === '/api/ask') {
      const { text } = await readBody(req)
      if (!text || typeof text !== 'string' || text.length > 500) return json(res, 400, { error: 'Send {"text": "..."} (max 500 characters)' })
      console.log(`ask: ${text}`)
      return stream(res, (emit) => handleRequest(text.trim(), emit))
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      const { id, allow } = await readBody(req)
      return stream(res, (emit) => handleSearchDecision(id, Boolean(allow), emit))
    }
    if (req.method === 'GET') return serveStatic(req, res)
    json(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error(err)
    if (!res.headersSent) json(res, 500, { error: err.message })
  }
})

await initModels()
await indexDocs()
server.listen(config.port, config.host, () => {
  console.log(`home-router listening on http://${config.host}:${config.port} | router ${config.routerModel} | threshold ${config.threshold} | LLM ${config.llmModel} at ${config.llmUrl} | search ${config.search}${config.mock ? ' | MOCK' : ''}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close()
    await closeModels()
    process.exit(0)
  })
}

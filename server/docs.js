// Document search over a folder of Markdown files: split into passages, embed once at startup, cosine search.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { embed, asQuery, asDocument, cosine } from './qvac.js'

let passages = [] // { doc, title, text, vector }

function split(text, max = 600) {
  const parts = []
  let current = ''
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    if ((current + '\n\n' + p).length > max && current) {
      parts.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) parts.push(current)
  return parts
}

export async function indexDocs(log = console.log) {
  const files = fs.readdirSync(config.docsDir).filter((f) => f.endsWith('.md')).sort()
  const items = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(config.docsDir, file), 'utf8')
    const title = (raw.match(/^#\s+(.+)$/m) || [null, file])[1].trim()
    for (const text of split(raw)) items.push({ doc: file, title, text })
  }
  const t = performance.now()
  const vectors = await embed(items.map((i) => asDocument(i.title, i.text)))
  passages = items.map((item, i) => ({ ...item, vector: vectors[i] }))
  log(`Indexed ${passages.length} passages from ${files.length} documents in ${Math.round(performance.now() - t)} ms`)
}

export async function searchDocs(query, k = 3) {
  const [q] = await embed([asQuery(query)])
  return passages
    .map((p) => ({ doc: p.doc, title: p.title, text: p.text, score: cosine(q, p.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export function docList() {
  return [...new Set(passages.map((p) => p.title))]
}

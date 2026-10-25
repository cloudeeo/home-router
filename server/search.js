// Web search runs only after the user allows it. Providers:
//   SEARCH=mock     a clearly labelled placeholder (default)
//   SEARCH=searxng  a self-hosted SearXNG instance (SEARXNG_URL), JSON API, no key, several engines at once
//   SEARCH=ddg      DuckDuckGo Instant Answer API: no key, good for facts and definitions, weak for news and live data
import { config } from './config.js'

export async function webSearch(query) {
  if (config.search === 'searxng') return searxng(query)
  if (config.search === 'ddg') return duckDuckGo(query)
  return [
    {
      title: 'Demo mode',
      text: `Web search is not connected in this demo. A real setup would send only this query: "${query}".`,
      url: null,
    },
  ]
}

async function searxng(query) {
  const url = `${config.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&language=en&safesearch=1`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  if (res.status === 403) throw new Error('SearXNG refused JSON output: add "json" to search.formats in its settings.yml')
  if (!res.ok) throw new Error(`SearXNG returned ${res.status}`)
  const data = await res.json()
  const results = []
  for (const answer of data.answers || []) {
    const text = typeof answer === 'string' ? answer : answer.answer
    if (text) results.push({ title: 'Direct answer', text, url: answer.url || null })
  }
  for (const box of data.infoboxes || []) {
    if (box.content) results.push({ title: box.infobox || 'Infobox', text: box.content, url: box.id || null })
  }
  for (const r of data.results || []) {
    if (results.length >= 5) break
    if (r.content) results.push({ title: r.title || r.url, text: r.content, url: r.url || null })
  }
  return results.length ? results : [{ title: 'No results', text: 'The search returned nothing useful for this query.', url: null }]
}

async function duckDuckGo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url, { headers: { 'User-Agent': 'home-router-demo' }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Search returned ${res.status}`)
  const data = await res.json()
  const results = []
  if (data.AbstractText) results.push({ title: data.Heading || 'DuckDuckGo', text: data.AbstractText, url: data.AbstractURL || null })
  for (const topic of data.RelatedTopics || []) {
    if (results.length >= 3) break
    if (topic.Text) results.push({ title: topic.Text.split(' - ')[0].slice(0, 60), text: topic.Text, url: topic.FirstURL || null })
  }
  return results.length ? results : [{ title: 'No results', text: 'The search returned nothing useful for this query.', url: null }]
}

// POSTs JSON and reads the server-sent events from the response body.
export async function streamEvents(url, body, onEvent) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    onEvent('error', { message: `Server returned ${res.status}` })
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      try {
        onEvent(event, data ? JSON.parse(data) : null)
      } catch {
        // ignore malformed events
      }
    }
  }
}

export async function fetchState() {
  const res = await fetch('/api/state')
  if (!res.ok) throw new Error(`Server returned ${res.status}`)
  return res.json()
}

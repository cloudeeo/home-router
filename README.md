# Home Router

A home assistant that decides before it writes. Every request first goes through **Laya**, a small decision model from Tether's [QVAC SDK](https://github.com/tetherto/qvac) 0.22, which picks a route in about a quarter of a second on a desktop CPU:

| Route | What happens | LLM call |
| --- | --- | --- |
| **action** | Runs a home command (lights, heating, garage, door, vacuum, reminders) | none |
| **document** | Searches the user's documents on the same server and answers with the source | local |
| **search** | Asks the user before anything leaves the house, then searches once | local |
| **chat** | Answered by the local LLM | local |
| *unsure* | Below the confidence threshold: answered by the local LLM, nothing switched, nothing sent online | local |

Everything runs on one home server. The phone only opens a web page.

This is a personal demo, not affiliated with Tether. The home is simulated and the documents are fictional samples.

## Why a router

On a home server, the LLM is the slow part: Qwen3 4B on an i7-10700K takes about 0.35 s before its first word, larger models more. Many requests do not need it at all ("dim the kitchen lights"), and some should never leave the house. A decision model answers "what kind of request is this?" in 150–250 ms and returns a probability for each answer, so the app can act fast when it is sure and fall back to the LLM when it is not.

The router settings come from a benchmark of three Laya models and three phrasings on 40 labelled requests ([qvac-lab](https://github.com/cloudeeo/qvac-lab), `laya-bench.js`): Laya typed decisions 421M with detailed criteria got 34/40 right, and every wrong answer had a confidence of 45% or less. With a 0.45 threshold, about half the requests are routed immediately with no errors; the rest go to the LLM.

Measured on the router itself (`npm run eval`, i7-10700K, CPU only):

| Metric | Result |
| --- | --- |
| Correct intent | 34/40 |
| Routed directly | 20/40, 0 wrong |
| Sent to the LLM (confidence below 0.45) | 20/40 |
| Average decision time | 243 ms |
| A home command, question to state change | ~373 ms, no LLM call |

## Architecture

```
Phone (browser, over Tailscale)
        │  HTTPS
        ▼
home-router (Node, this repo)  ── on the home server ──────────────────────────
  ├─ Laya typed decisions 421M      decide(): intent + confidence, then the device for commands
  ├─ EmbeddingGemma 300M            embeds the documents at startup and each question
  ├─ simulated home                 state shown in the app
  └─ qvac serve (already running)   OpenAI-compatible API, Qwen3 4B, streams the answers
```

- `server/intents.js`: the questions Laya answers (intent, then device).
- `server/router.js`: the routing rules and the permission step for web search.
- `server/docs.js`: passage splitting, embeddings and cosine search over `docs/`.
- `server/llm.js`: streaming client for the OpenAI-compatible endpoint, strips `<think>` blocks.
- `server/home.js`: the simulated home; this is where a real setup would call Home Assistant.
- `web/`: the React app (Vite). `web/dist/` is the built version served by the router.
- `scripts/route-eval.js`: checks the router on the 40 labelled requests.

## Run it

Requirements: Node `^22.21.0 || >=24.9.0`, a running `qvac serve --openai` with a Qwen3 4B model (named `qwen4b` here), about 1–1.5 GB of free RAM for Laya and the embedding model.

```bash
npm install                 # installs @qvac/sdk 0.22
npm run eval                # first run downloads Laya and EmbeddingGemma from the QVAC registry
npm start                   # http://127.0.0.1:8090
```

To open it from a phone over Tailscale, publish the port inside the tailnet only:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8090
# then open https://<server>.<tailnet>.ts.net:8443 on the phone
```

### Real web search with SearXNG

[SearXNG](https://github.com/searxng/searxng) is an open-source metasearch engine you host yourself: it queries several engines and returns JSON, with no API key. Run it with Docker on any machine of the home network:

```bash
mkdir -p ~/searxng
docker run -d --name searxng --restart unless-stopped -p 8888:8080 -v ~/searxng:/etc/searxng searxng/searxng
# wait a few seconds, then enable JSON output and restart
sed -i 's/^  formats:$/  formats:\n    - json/' ~/searxng/settings.yml
docker restart searxng
curl -s 'http://127.0.0.1:8888/search?q=geneva+weather&format=json' | head -c 300
```

Then start the router with `SEARCH=searxng SEARXNG_URL=http://<that-machine>:8888 npm start`. Only the question is sent to the search engines, and only after the user allows it.

Try it without any model (keyword rules and fake answers stand in for Laya and the LLM):

```bash
npm run mock
```

Rebuild the web app after changing it: `npm run web:build`.

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `THRESHOLD` | `0.45` | Minimum confidence to act on a route |
| `ONE_CALL` | `0` | `1` asks intent and device in one `decide()` call; measured at the same ~373 ms per command as two calls |
| `ROUTER_MODEL` | `LAYA_TYPED_DECISIONS_421M_Q8_0` | Laya checkpoint |
| `EMBED_MODEL` | `EMBEDDINGGEMMA_300M_Q8_0` | Embedding model for documents |
| `LLM_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible endpoint |
| `LLM_MODEL` | `qwen4b` | Model name on that endpoint |
| `LLM_KEY` / `LLM_KEY_FILE` | `~/qvac-lab/api-key.txt` | API key for the endpoint |
| `SEARCH` | `mock` | `mock` (labelled placeholder), `searxng` (self-hosted SearXNG) or `ddg` (DuckDuckGo Instant Answer API, facts only) |
| `SEARXNG_URL` | `http://127.0.0.1:8888` | SearXNG instance used when `SEARCH=searxng` |
| `DOCS_DIR` | `./docs` | Folder of Markdown documents |
| `PORT` / `HOST` | `8090` / `127.0.0.1` | Where the router listens |

## Limits

- The router was tuned on 40 hand-written English requests: an indication, not a guarantee.
- Thresholds depend on the Laya checkpoint: the multilingual 322M was often confidently wrong in the benchmark, so it needs a different strategy.
- The home is simulated. Web search is a placeholder unless `SEARCH=searxng` or `SEARCH=ddg`; live data such as train delays depends on what the search engines return.
- Single user, no authentication: publish it only inside a private network such as a tailnet.

## Licence

MIT

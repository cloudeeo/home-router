// Checks the router on the same 40 labelled requests used in qvac-lab/laya-bench.js.
// Prints accuracy, what the threshold would do, and the slowest decisions.
// Usage: node scripts/route-eval.js        (MOCK=1 to test without models)
import { initModels, closeModels } from '../server/qvac.js'
import { classify } from '../server/intents.js'
import { config } from '../server/config.js'

const CASES = [
  ['Turn off the lights in the living room', 'action'],
  ['Switch off the heating in the bedroom', 'action'],
  ['Remind me to buy milk tomorrow at 8', 'action'],
  ['Set a timer for 12 minutes', 'action'],
  ['Turn the thermostat up to 21 degrees', 'action'],
  ['Open the garage door', 'action'],
  ['Wake me up at 6:30 tomorrow', 'action'],
  ['Lock the front door', 'action'],
  ['Dim the kitchen lights to 30 percent', 'action'],
  ['Start the robot vacuum', 'action'],
  ["What's the weather in Geneva tomorrow?", 'search'],
  ['Who won the Servette match last night?', 'search'],
  ['Is the A1 motorway open right now near Lausanne?', 'search'],
  ["What's the price of bitcoin right now?", 'search'],
  ['What time does the supermarket in Carouge close today?', 'search'],
  ['What is the latest news about the Swiss elections?', 'search'],
  ['Is my 8:12 train to Zurich on time?', 'search'],
  ['Which films are showing at the cinema tonight?', 'search'],
  ["What's today's euro to Swiss franc exchange rate?", 'search'],
  ['Are there storm warnings for Geneva this weekend?', 'search'],
  ['What does my car insurance policy say about windscreen damage?', 'document'],
  ['When does the rental contract I uploaded expire?', 'document'],
  ["Summarise the PDF from yesterday's meeting", 'document'],
  ['How much was my last electricity bill?', 'document'],
  ['Find the warranty for my washing machine', 'document'],
  ['What did the school letter say about the trip date?', 'document'],
  ["List the action items from my notes of Monday's call", 'document'],
  ["What's the notice period in my gym membership contract?", 'document'],
  ['Which page of my boiler manual explains the reset?', 'document'],
  ['What did I write in my notes about the garden fence?', 'document'],
  ['Explain the difference between a mortgage and a loan', 'chat'],
  ['Write me a short poem about autumn', 'chat'],
  ["What's 17% of 240?", 'chat'],
  ['Explain how a heat pump works', 'chat'],
  ['Suggest a name for a black cat', 'chat'],
  ['Translate "good morning" into Spanish', 'chat'],
  ['Give me a recipe for mushroom risotto', 'chat'],
  ['What is the capital of Australia?', 'chat'],
  ['Help me write a polite email declining an invitation', 'chat'],
  ['Tell me a joke about programmers', 'chat'],
]

await initModels()
const rows = []
let correct = 0
let routed = 0
let routedWrong = 0
let totalMs = 0
for (const [text, expected] of CASES) {
  const d = await classify(text)
  totalMs += d.ms
  if (d.intent === expected) correct++
  if (d.confident) {
    routed++
    if (d.intent !== expected) routedWrong++
  }
  rows.push({ request: text.slice(0, 44), expected, predicted: d.intent, p: d.p.toFixed(2), route: d.confident ? d.intent : 'LLM', ok: d.intent === expected ? 'yes' : 'NO', ms: d.ms })
}
console.table(rows)
console.log(`Threshold ${config.threshold}: correct intent ${correct}/${CASES.length}, routed directly ${routed}/${CASES.length} (${routedWrong} wrong), sent to the LLM ${CASES.length - routed}`)
console.log(`Average decision time: ${Math.round(totalMs / CASES.length)} ms`)
await closeModels()

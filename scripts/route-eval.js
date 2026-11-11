// Checks the router on the same 40 labelled requests used in qvac-lab/laya-bench.js.
// Prints accuracy per intent and what the threshold would do. With the second router on (the default outside MOCK
// mode), every request below the threshold is also sent to it, and the hybrid score is printed.
// Usage: node scripts/route-eval.js                              (MOCK=1 to test without models)
//        CASES_FILE=scripts/cases-it.json node scripts/route-eval.js   (the same 40 requests in Italian)
//        SECOND_ROUTER=0 ...                                       (Laya alone)
import fs from 'node:fs'
import { initModels, closeModels } from '../server/qvac.js'
import { classify } from '../server/intents.js'
import { secondOpinion } from '../server/second.js'
import { config } from '../server/config.js'

const CASES_EN = [
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
const CASES = process.env.CASES_FILE ? JSON.parse(fs.readFileSync(process.env.CASES_FILE, 'utf8')) : CASES_EN
const INTENTS = ['action', 'search', 'document', 'chat']

await initModels()
const rows = []
let correct = 0
let routed = 0
let routedWrong = 0
let totalMs = 0
let hybridRight = 0
let secondCalls = 0
let secondFailed = 0
let secondMs = 0
const perIntent = Object.fromEntries(INTENTS.map((k) => [k, { n: 0, laya: 0, hybrid: 0 }]))
for (const [text, expected] of CASES) {
  const d = await classify(text)
  totalMs += d.ms
  if (d.intent === expected) correct++
  if (d.confident) {
    routed++
    if (d.intent !== expected) routedWrong++
  }
  // Hybrid: Laya's route when it is sure, otherwise the second router's (Laya's guess if that fails)
  let final = d.intent
  let second = null
  if (!d.confident && config.secondRouter) {
    secondCalls++
    second = await secondOpinion(text)
    if (second) {
      secondMs += second.ms
      final = second.intent
    } else secondFailed++
  }
  if (final === expected) hybridRight++
  const s = perIntent[expected]
  if (s) {
    s.n++
    if (d.intent === expected) s.laya++
    if (final === expected) s.hybrid++
  }
  rows.push({
    request: text.slice(0, 44),
    expected,
    laya: d.intent,
    p: d.p.toFixed(2),
    ...(config.secondRouter && { second: second ? `${second.intent}${second.device ? ` ${second.device}` : ''}` : d.confident ? '' : 'failed' }),
    final: config.secondRouter ? final : d.confident ? d.intent : 'LLM',
    ok: (config.secondRouter ? final : d.intent) === expected ? 'yes' : 'NO',
    ms: d.ms + (second?.ms ?? 0),
  })
}
console.table(rows)
const per = (key) => INTENTS.map((k) => `${k} ${perIntent[k][key]}/${perIntent[k].n}`).join(', ')
console.log(`Cases: ${CASES.length} from ${process.env.CASES_FILE || 'the built-in English cases'}`)
console.log(`Laya, threshold ${config.threshold}: correct intent ${correct}/${CASES.length} (${per('laya')}), routed directly ${routed}/${CASES.length} (${routedWrong} wrong), unsure ${CASES.length - routed}`)
console.log(`Average Laya decision time: ${Math.round(totalMs / CASES.length)} ms`)
if (config.secondRouter) {
  console.log(`Hybrid (Laya, then ${config.secondModel}${config.secondThink ? ' with thinking' : ''} when unsure): ${hybridRight}/${CASES.length} (${per('hybrid')})`)
  console.log(`Second router: ${secondCalls} calls, ${secondFailed} failed, ${secondCalls - secondFailed ? Math.round(secondMs / (secondCalls - secondFailed)) : 0} ms mean`)
}
await closeModels()

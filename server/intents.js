// The questions Laya answers. INTENT uses the "v2" phrasing that scored best in laya-bench
// (typed decisions 421M: 34/40, no wrong answer above 46% confidence).
import { decide } from './qvac.js'
import { config } from './config.js'

export const INTENT = {
  intent: {
    type: 'choice',
    instructions: 'Classify what the user is asking a home assistant to do.',
    criteria: {
      action: 'a command for the home: switch a device on or off, or set a reminder, timer or alarm',
      search: 'needs live or recent information from the internet: weather, news, sports results, traffic, prices',
      document: "a question about the user's own files: their insurance policy, contract, bills, PDFs, notes or meeting minutes",
      chat: 'anything the assistant can answer by itself: explanations, writing, maths, advice, conversation',
    },
  },
}

export const DEVICE = {
  device: {
    type: 'choice',
    instructions: 'Which part of the home does this command control?',
    criteria: {
      lights: 'lights or lamps',
      heating: 'heating, radiators or the thermostat',
      garage: 'the garage door',
      door: 'the front door lock',
      vacuum: 'the robot vacuum cleaner',
      reminder: 'a reminder, alarm or timer',
    },
  },
}

function top(answer) {
  const probs = answer?.probabilities || {}
  const choice = answer?.choice ?? Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0]
  return { choice, p: probs[choice] ?? 0, probabilities: probs }
}

// Returns { intent, p, probabilities, confident, ms, device? }
// With ONE_CALL=1 the device question is asked in the same decide() call as the intent. On omen01 this cost the
// same as two separate calls for a command (~373 ms), and added the device question to every other request,
// so by default the device is asked separately, only for commands.
export async function classify(text) {
  const t = performance.now()
  const questions = config.oneCall ? { ...INTENT, ...DEVICE } : INTENT
  const result = await decide(text, questions)
  const ms = Math.round(performance.now() - t)
  const { choice, p, probabilities } = top(result.answers.intent)
  const decision = { intent: choice, p, probabilities, confident: p >= config.threshold, ms }
  if (config.oneCall && result.answers.device) {
    const d = top(result.answers.device)
    decision.device = { device: d.choice, p: d.p, ms: 0 }
  }
  return decision
}

export async function pickDevice(text) {
  const t = performance.now()
  const result = await decide(text, DEVICE)
  const { choice, p } = top(result.answers.device)
  return { device: choice, p, ms: Math.round(performance.now() - t) }
}

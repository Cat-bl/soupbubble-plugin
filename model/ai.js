import Config from './config.js'

const historyByGroup = new Map()
const HISTORY_LIMIT = 20

function buildAvoidText(groupId) {
  const list = historyByGroup.get(String(groupId)) || []
  if (!list.length) return ''
  const items = list.map((p, i) =>
    `${i + 1}. 汤面：${p.soup}\n   汤底：${p.bottom}`
  ).join('\n')
  return `\n\n本群最近出过的谜题（严格避免重复或过于相似，汤面和汤底都不能相同或类似）：\n${items}`
}

function recordPuzzle(groupId, puzzle) {
  if (!puzzle || !groupId) return
  const key = String(groupId)
  if (!historyByGroup.has(key)) historyByGroup.set(key, [])
  const list = historyByGroup.get(key)
  list.push(puzzle)
  if (list.length > HISTORY_LIMIT) list.shift()
}

function parsePuzzle(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*?\}/)
    if (!m) throw new Error(`AI 返回无法解析为 JSON: ${text.slice(0, 100)}`)
    obj = JSON.parse(m[0])
  }
  const soup = String(obj.soup || '').trim()
  const bottom = String(obj.bottom || '').trim()
  if (!soup || !bottom) throw new Error(`AI 返回缺少 soup/bottom 字段: ${text.slice(0, 100)}`)
  return { soup, bottom, difficulty: String(obj.difficulty || '') }
}

function parseJudge(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*?\}/)
    if (!m) throw new Error(`AI 裁判返回无法解析为 JSON: ${text.slice(0, 100)}`)
    obj = JSON.parse(m[0])
  }
  const answer = String(obj.answer || '').trim()
  if (!['是', '不是', '无关'].includes(answer))
    throw new Error(`AI 裁判返回无效答案: ${answer}`)
  return { answer, hint: String(obj.hint || '').trim() }
}

function parseGuessJudge(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*?\}/)
    if (!m) throw new Error(`AI 猜底判断返回无法解析为 JSON: ${text.slice(0, 100)}`)
    obj = JSON.parse(m[0])
  }
  return {
    correct: Boolean(obj.correct),
    comment: String(obj.comment || '').trim(),
  }
}

async function callAI(systemPrompt, userContent, timeoutSec) {
  const cfg = Config.get().ai || {}
  if (!cfg.apiUrl || !cfg.apiKey) {
    throw new Error('AI apiUrl 或 apiKey 未配置')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), (timeoutSec || cfg.timeout || 30) * 1000)

  const body = {
    model: cfg.model,
    temperature: cfg.temperature ?? 1.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    stream: false,
  }

  try {
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`)
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回为空')
    return content
  } finally {
    clearTimeout(timer)
  }
}

async function callAiWithRetry(systemPrompt, userContent, parser) {
  const cfg = Config.get().ai || {}
  const retries = Math.max(1, Number(cfg.retryCount ?? 3))
  let lastErr
  for (let i = 1; i <= retries; i++) {
    try {
      const text = await callAI(systemPrompt, userContent)
      return parser(text)
    } catch (err) {
      lastErr = err
      logger?.warn(`[海龟汤] AI 调用第 ${i}/${retries} 次失败：${err?.message || err}`)
    }
  }
  throw lastErr
}

export async function generatePuzzle(groupId, category) {
  const cfg = Config.get()
  const systemPrompt = cfg.ai?.puzzleSystemPrompt || ''
  let userPrompt = cfg.ai?.puzzleUserPrompt || ''
  if (category) {
    userPrompt += `\n\n本局指定谜题类型/范围为「${category}」，请围绕此类型生成谜题。`
  }
  const avoid = buildAvoidText(groupId)
  if (avoid) userPrompt += avoid
  userPrompt += '\n\n重要：请确保生成的谜题与上述已有谜题完全不同，汤面情境和汤底真相都要有本质区别，不能换个说法就算新题。'

  const puzzle = await callAiWithRetry(systemPrompt, userPrompt, parsePuzzle)
  recordPuzzle(groupId, puzzle)
  return puzzle
}

export async function judgeQuestion(bottom, soup, question) {
  const cfg = Config.get()
  const systemPrompt = cfg.ai?.judgeSystemPrompt || ''

  const userContent = `汤面：${soup}\n\n汤底：${bottom}\n\n玩家提问：${question}\n\n请判断这个问题的答案是"是"、"不是"还是"无关"。请直接返回 JSON。`

  return callAiWithRetry(systemPrompt, userContent, parseJudge)
}

export async function judgeGuess(bottom, guess) {
  const cfg = Config.get()
  const systemPrompt = cfg.ai?.guessSystemPrompt || ''

  const userContent = `汤底（真相）：${bottom}\n\n玩家的猜测：${guess}\n\n请判断这个猜测是否正确。请直接返回 JSON。`

  return callAiWithRetry(systemPrompt, userContent, parseGuessJudge)
}

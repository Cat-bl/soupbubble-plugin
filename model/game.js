import Config from './config.js'
import { generatePuzzle, judgeQuestion, judgeGuess } from './ai.js'

const games = {}

export const STATE = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  ENDED: 'ended',
}

let externalTick = null
export function setExternalTick(fn) {
  externalTick = fn
}

function notify(game, type, extra) {
  try {
    externalTick?.(game, type, extra)
  } catch (err) {
    logger?.error(`[海龟汤] tick 回调异常`, err)
  }
}

function clearTimer(game) {
  if (game?._timer) {
    clearTimeout(game._timer)
    game._timer = null
  }
  if (game?._warnTimer) {
    clearTimeout(game._warnTimer)
    game._warnTimer = null
  }
}

function getWarnBefore() {
  return Math.max(0, Number(Config.get().game?.warnBefore ?? 30))
}

function scheduleWaitTimeout(game) {
  clearTimer(game)
  const sec = Math.max(30, Number(Config.get().game?.waitTimeout ?? 300))
  game._timer = setTimeout(() => onWaitTimeout(game), sec * 1000)
}

function scheduleGameTimeout(game) {
  clearTimer(game)
  const sec = Math.max(60, Number(Config.get().game?.gameTimeout ?? 600))
  const warn = getWarnBefore()
  game._timer = setTimeout(() => onGameTimeout(game), sec * 1000)
  if (warn > 0 && sec > warn) {
    game._warnTimer = setTimeout(() => {
      game._warnTimer = null
      if (game.state === STATE.PLAYING) notify(game, 'game-warn', { secondsLeft: warn })
    }, (sec - warn) * 1000)
  }
}

function onWaitTimeout(game) {
  if (game.state !== STATE.WAITING) return
  clearTimer(game)
  delete games[game.groupId]
  notify(game, 'wait-timeout')
}

function onGameTimeout(game) {
  if (game.state !== STATE.PLAYING) return
  clearTimer(game)
  game.state = STATE.ENDED
  game.messages.push({
    type: 'system',
    content: `游戏超时，汤底揭晓：${game.bottom}`,
  })
  notify(game, 'game-timeout')
}

// ======== CRUD ========

export function getGame(groupId) {
  return games[groupId]
}

export function createGame(groupId, initiatorId, nickname) {
  if (games[groupId] && games[groupId].state !== STATE.ENDED)
    return { error: '本群已有游戏进行中，请先 #海龟汤结束' }
  if (games[groupId]) clearTimer(games[groupId])
  const gameCfg = Config.get().game || {}
  games[groupId] = {
    groupId,
    state: STATE.WAITING,
    initiator: initiatorId,
    players: [],
    soup: null,
    bottom: null,
    difficulty: null,
    qaHistory: [],
    guessHistory: [],
    messages: [],
    solvedBy: null,
    config: {
      minPlayers: gameCfg.minPlayers ?? 2,
      maxPlayers: gameCfg.maxPlayers ?? 20,
      solveScore: gameCfg.solveScore ?? 5,
      maxQuestionsPerPlayer: gameCfg.maxQuestionsPerPlayer ?? 0,
    },
    createdAt: Date.now(),
  }
  const r = addPlayer(groupId, initiatorId, nickname)
  if (r.ok) scheduleWaitTimeout(games[groupId])
  return r
}

export function addPlayer(groupId, userId, nickname) {
  const game = games[groupId]
  if (!game || game.state === STATE.ENDED)
    return { error: '本群还未发起游戏，请先 #海龟汤' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始，无法加入' }
  if (game.players.find(p => p.userId == userId)) return { error: '你已经在游戏中' }
  if (game.players.length >= game.config.maxPlayers)
    return { error: `人数已达上限 ${game.config.maxPlayers} 人` }
  game.players.push({
    userId: String(userId),
    nickname: nickname || String(userId),
    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=100`,
    score: 0,
    questionsAsked: 0,
  })
  scheduleWaitTimeout(game)
  return { ok: true, game }
}

export function removePlayer(groupId, userId) {
  const game = games[groupId]
  if (!game || game.state === STATE.ENDED) return { error: '本群还未发起游戏' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始，无法退出' }
  const idx = game.players.findIndex(p => p.userId == userId)
  if (idx < 0) return { error: '你不在游戏中' }
  game.players.splice(idx, 1)
  if (game.players.length === 0 || userId == game.initiator) {
    clearTimer(game)
    delete games[groupId]
    return { ok: true, dismissed: true }
  }
  return { ok: true, game }
}

export function endGame(groupId) {
  if (!games[groupId]) return { error: '本群没有进行中的游戏' }
  clearTimer(games[groupId])
  delete games[groupId]
  return { ok: true }
}

// ======== 游戏流程 ========

export async function startGame(groupId, operatorId, category) {
  const game = games[groupId]
  if (!game) return { error: '本群还未发起游戏' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始' }
  if (operatorId != game.initiator) return { error: '只有发起人可以开始游戏' }
  if (game.players.length < game.config.minPlayers)
    return { error: `人数不足，至少需要 ${game.config.minPlayers} 人` }

  const puzzle = await generatePuzzle(groupId, category)
  if (!puzzle) return { error: '生成谜题失败，请重试' }

  game.soup = puzzle.soup
  game.bottom = puzzle.bottom
  game.difficulty = puzzle.difficulty
  game.state = STATE.PLAYING
  game.qaHistory = []
  game.guessHistory = []
  game.solvedBy = null
  game.messages = []

  game.messages.push({
    type: 'system',
    content: `汤面：${game.soup}`,
  })
  if (game.difficulty) {
    game.messages.push({
      type: 'system',
      content: `难度：${game.difficulty}`,
    })
  }
  game.messages.push({
    type: 'system',
    content: `游戏开始！发送 #提问 你的问题 来推理，发送 #猜汤底 你的答案 来揭晓`,
  })

  scheduleGameTimeout(game)
  return { ok: true, game }
}

export async function askQuestion(groupId, userId, question) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.PLAYING) return { error: '游戏未在进行中' }

  const player = game.players.find(p => p.userId == userId)
  if (!player) return { error: '你不在本局游戏中' }

  if (game.config.maxQuestionsPerPlayer > 0 && player.questionsAsked >= game.config.maxQuestionsPerPlayer)
    return { error: `你已达到提问上限 ${game.config.maxQuestionsPerPlayer} 次` }

  const q = question.trim()
  if (!q || q.length < 2) return { error: '问题内容太短' }
  if (q.length > 200) return { error: '问题太长，请控制在 200 字以内' }

  const result = await judgeQuestion(game.bottom, game.soup, q)
  if (!result) return { error: 'AI 裁判响应失败，请重试' }

  player.questionsAsked++

  game.qaHistory.push({
    userId: player.userId,
    nickname: player.nickname,
    avatar: player.avatar,
    question: q,
    answer: result.answer,
    hint: result.hint || null,
    timestamp: Date.now(),
  })

  game.messages.push({
    type: 'qa',
    userId: player.userId,
    nickname: player.nickname,
    avatar: player.avatar,
    question: q,
    answer: result.answer,
    hint: result.hint || null,
  })

  return { ok: true, game, answer: result }
}

export async function submitGuess(groupId, userId, guess) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.PLAYING) return { error: '游戏未在进行中' }

  const player = game.players.find(p => p.userId == userId)
  if (!player) return { error: '你不在本局游戏中' }

  const g = guess.trim()
  if (!g || g.length < 2) return { error: '猜测内容太短' }
  if (g.length > 500) return { error: '猜测内容太长，请控制在 500 字以内' }

  const result = await judgeGuess(game.bottom, g)
  if (!result) return { error: 'AI 裁判响应失败，请重试' }

  game.guessHistory.push({
    userId: player.userId,
    nickname: player.nickname,
    avatar: player.avatar,
    guess: g,
    correct: result.correct,
    comment: result.comment || null,
    timestamp: Date.now(),
  })

  game.messages.push({
    type: 'guess',
    userId: player.userId,
    nickname: player.nickname,
    avatar: player.avatar,
    guess: g,
    correct: result.correct,
    comment: result.comment || null,
  })

  if (result.correct) {
    clearTimer(game)
    game.state = STATE.ENDED
    game.solvedBy = player.userId
    player.score += game.config.solveScore
    game.messages.push({
      type: 'win',
      content: `${player.nickname} 猜出了汤底！\n完整汤底：${game.bottom}`,
    })
    return { ok: true, game, solved: true, solver: player }
  }

  return { ok: true, game, solved: false }
}

export async function revealAnswer(groupId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.PLAYING) return { error: '游戏未在进行中' }
  clearTimer(game)
  game.state = STATE.ENDED
  game.messages.push({
    type: 'system',
    content: `无人猜出，汤底揭晓：${game.bottom}`,
  })
  return { ok: true, game }
}

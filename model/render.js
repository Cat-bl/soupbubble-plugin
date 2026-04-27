import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import Config from './config.js'
import { STATE } from './game.js'

export async function renderGame(game) {
  const data = buildRenderData(game)
  return puppeteer.screenshot('soupbubble-plugin', {
    saveId: `chat-${game.groupId}`,
    imgType: 'png',
    tplFile: './plugins/soupbubble-plugin/resources/html/chat.html',
    _data: data,
  })
}

function buildRenderData(game) {
  const ended = game.state === STATE.ENDED
  const stateLabel = buildStateLabel(game)

  const players = [...game.players].sort((a, b) => b.score - a.score).map((p, i) => ({
    rank: i + 1,
    nickname: p.nickname,
    avatar: p.avatar,
    score: p.score,
    questionsAsked: p.questionsAsked,
    isSolver: game.solvedBy === p.userId,
  }))

  const allMessages = game.messages || []
  const maxMessages = Math.max(1, Number(Config.get().game?.maxMessages ?? 40))
  const truncated = allMessages.length > maxMessages
  const messages = truncated ? allMessages.slice(-maxMessages) : allMessages

  return {
    stateLabel,
    statusText: buildStatusText(game),
    ended,
    players,
    messages,
    truncated,
    omittedCount: truncated ? allMessages.length - maxMessages : 0,
    soup: game.soup || '',
    bottom: game.bottom || '',
    difficulty: game.difficulty || '',
    qaCount: game.qaHistory?.length || 0,
    guessCount: game.guessHistory?.length || 0,
  }
}

function buildStateLabel(game) {
  switch (game.state) {
    case STATE.WAITING:
      return `等待玩家加入 (${game.players.length})`
    case STATE.PLAYING:
      return '推理中'
    case STATE.ENDED:
      return game.solvedBy ? '谜题已破' : '游戏结束'
    default:
      return ''
  }
}

function buildStatusText(game) {
  if (game.state === STATE.WAITING) {
    const n = game.players.length
    const need = game.config.minPlayers
    if (n < need) return `还需 ${need - n} 人，发送 #加入海龟汤 参与`
    return `人数已就绪（${n}人），发起人可发送 #开始海龟汤`
  }
  if (game.state === STATE.PLAYING) {
    const parts = [`提问 ${game.qaHistory?.length || 0} 次`]
    if (game.guessHistory?.length) parts.push(`猜测 ${game.guessHistory.length} 次`)
    parts.push(`发送 #提问 你的问题 来推理`)
    parts.push(`发送 #猜汤底 你的答案 来揭晓`)
    return parts.join(' · ')
  }
  if (game.state === STATE.ENDED) {
    if (game.solvedBy) {
      const solver = game.players.find(p => p.userId === game.solvedBy)
      return `恭喜 ${solver?.nickname || '未知'} 猜出汤底！(+${game.config.solveScore}分)`
    }
    return '无人猜出正确答案'
  }
  return ''
}

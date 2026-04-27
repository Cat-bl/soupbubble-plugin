import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import * as Game from '../model/game.js'
import { renderGame } from '../model/render.js'

export class Soupbubble extends plugin {
  constructor() {
    super({
      name: '海龟汤',
      dsc: '海龟汤（情境猜谜）游戏',
      event: 'message',
      priority: 500,
      rule: [
        { reg: /^#?(海龟汤|发起海龟汤)$/, fnc: 'create' },
        { reg: /^#?加入海龟汤$/, fnc: 'join' },
        { reg: /^#?退出海龟汤$/, fnc: 'quit' },
        { reg: /^#?开始海龟汤(\s+.+)?$/, fnc: 'start' },
        { reg: /^#?海龟汤结束$/, fnc: 'end' },
        { reg: /^#?海龟汤状态$/, fnc: 'status' },
        { reg: /^#?海龟汤帮助$/, fnc: 'help' },
        { reg: /^#?提问\s*[\s\S]+$/, fnc: 'ask' },
        { reg: /^#?猜汤底\s*[\s\S]+$/, fnc: 'guess' },
      ],
    })
  }

  async create(e) {
    if (!e.isGroup) return e.reply('请在群聊中发起游戏', true)
    const nickname = e.sender?.card || e.sender?.nickname || String(e.user_id)
    const r = Game.createGame(e.group_id, String(e.user_id), nickname)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async join(e) {
    if (!e.isGroup) return e.reply('请在群聊中加入游戏', true)
    const nickname = e.sender?.card || e.sender?.nickname || String(e.user_id)
    const r = Game.addPlayer(e.group_id, String(e.user_id), nickname)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async quit(e) {
    if (!e.isGroup) return false
    const r = Game.removePlayer(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    if (r.dismissed) return e.reply('发起人退出，游戏已取消')
    await this.render(e, r.game)
    return true
  }

  async start(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game || game.state === 'ended') return e.reply('本群还未发起游戏', true)
    if (String(e.user_id) != game.initiator) return e.reply('只有发起人可以开始游戏', true)
    if (game.players.length < game.config.minPlayers)
      return e.reply(`人数不足，至少需要 ${game.config.minPlayers} 人`, true)

    let category = null
    const argMatch = e.msg.match(/^#?开始海龟汤\s+(.+)$/)
    if (argMatch) {
      const arg = argMatch[1].trim()
      if (arg && !isSkipWord(arg)) category = arg.slice(0, 30)
    }

    if (!category) {
      await e.reply(
        '请在 15 秒内回复谜题类型（如「悬疑」「校园」「日常」），或回复「跳过」使用默认。\n期间请勿发送其他命令',
      )
      const reply = await this.awaitContext(false, 15)
      if (reply && reply !== false) {
        const msg = (reply.msg || '').trim()
        if (
          msg &&
          !msg.startsWith('#') &&
          !isSkipWord(msg) &&
          msg.length <= 30 &&
          String(reply.group_id) === String(e.group_id)
        ) {
          category = msg
        }
      }
    }

    await runStart(e.group_id, String(e.user_id), category, async m => e.reply(m, true))
    return true
  }

  async end(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return e.reply('本群没有进行中的游戏', true)
    if (String(e.user_id) != game.initiator && !e.isMaster)
      return e.reply('只有发起人或主人可以强制结束', true)
    Game.endGame(e.group_id)
    return e.reply('游戏已结束')
  }

  async status(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return e.reply('本群没有进行中的游戏', true)
    await this.render(e, game)
    return true
  }

  async ask(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const question = buildContent(e).replace(/^#?提问\s*/, '').trim()
    if (!question) return e.reply('请输入问题，例如 #提问 死者是自杀的吗？', true)
    // const thinkingMsg = await e.reply('正在思考...', true)
    // const recallTimer = setTimeout(async () => {
    //   try {
    //     const g = Bot.pickGroup?.(e.group_id)
    //     if (g && thinkingMsg?.message_id) await g.recallMsg(thinkingMsg.message_id)
    //   } catch {}
    // }, 15000)
    const r = await Game.askQuestion(e.group_id, String(e.user_id), question)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async guess(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const guess = buildContent(e).replace(/^#?猜汤底\s*/, '').trim()
    if (!guess) return e.reply('请输入你的猜测，例如 #猜汤底 死者其实是被误杀的', true)
    const judgingMsg = await e.reply('正在评判...', true)
    setTimeout(async () => {
      try {
        const g = Bot.pickGroup?.(e.group_id)
        if (g && judgingMsg?.message_id) await g.recallMsg(judgingMsg.message_id)
      } catch {}
    }, 15000)
    const r = await Game.submitGuess(e.group_id, String(e.user_id), guess)
    if (r.error) return e.reply(r.error, true)
    if (r.solved) {
      await e.reply(`🎉 ${r.solver.nickname} 猜对了！汤底揭晓：\n${r.game.bottom}`, true)
    } else {
      await e.reply(`猜测不准确，继续推理！`, true)
    }
    await this.render(e, r.game)
    return true
  }

  async help(e) {
    try {
      const img = await puppeteer.screenshot('soupbubble-plugin', {
        saveId: 'help',
        imgType: 'png',
        tplFile: './plugins/soupbubble-plugin/resources/html/help.html',
      })
      if (img) return e.reply(img)
      return e.reply('帮助图片渲染失败', true)
    } catch (err) {
      logger?.error(`[海龟汤] 帮助渲染失败`, err)
      return e.reply('帮助图片渲染失败：' + (err?.message || err), true)
    }
  }

  async render(e, game) {
    try {
      const img = await renderGame(game)
      if (img) await e.reply(img)
    } catch (err) {
      logger?.error(`[海龟汤] 渲染失败`, err)
      await e.reply('图片渲染失败：' + (err?.message || err), true)
    }
  }
}

// ======== External Tick ========

Game.setExternalTick(async (game, type, extra) => {
  try {
    if (!game.groupId) return
    const g = Bot.pickGroup?.(game.groupId)
    if (!g?.sendMsg) return

    if (type === 'wait-timeout') {
      await g.sendMsg('等待超时，本局海龟汤已自动结束。发 #海龟汤 重新发起')
      return
    }

    if (type === 'game-warn') {
      await g.sendMsg(
        `还有 ${extra?.secondsLeft ?? 30} 秒本局海龟汤即将结束，汤底将揭晓！`,
      )
      return
    }

    if (type === 'game-timeout') {
      await g.sendMsg(`游戏超时！汤底揭晓：\n${game.bottom}`)
    }

    const img = await renderGame(game)
    if (img) await g.sendMsg(img)
  } catch (err) {
    logger?.error(`[海龟汤] 超时自动推进发送失败`, err)
  }
})

// ======== Utilities ========

async function runStart(groupId, initiatorId, category, reply) {
  const game = Game.getGame(groupId)
  if (!game || game.state !== 'waiting') return reply('本群状态异常，无法开始')
  if (game.players.length < game.config.minPlayers)
    return reply(`人数不足，至少需要 ${game.config.minPlayers} 人`)

  await reply(`正在${category ? `以「${category}」类型` : ''}生成谜题，大概需要 1 分钟，请稍后...`)

  const r = await Game.startGame(groupId, initiatorId, category)
  if (r.error) return reply(r.error)

  await reply(`谜题已生成！游戏开始，发送 #提问 来推理，发送 #猜汤底 来揭晓`)
  try {
    const img = await renderGame(r.game)
    if (img) await reply(img)
  } catch (err) {
    logger?.error(`[海龟汤] 渲染失败`, err)
  }
}

function isSkipWord(s) {
  const lower = String(s).toLowerCase()
  return ['跳过', '默认', '不指定', 'skip', 'no', '无'].includes(lower)
}

function buildContent(e) {
  if (!Array.isArray(e.message)) return e.msg || ''
  let text = ''
  for (const seg of e.message) {
    if (seg.type === 'text') text += seg.text || ''
    else if (seg.type === 'at') text += seg.text || `@${seg.qq}`
  }
  return text || e.msg || ''
}

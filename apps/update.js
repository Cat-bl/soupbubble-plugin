import { update as Update } from '../../other/update.js'

export class SoupbubbleUpdate extends plugin {
  constructor() {
    super({
      name: '海龟汤更新',
      dsc: '#海龟汤更新 #海龟汤强制更新',
      event: 'message',
      priority: 1000,
      rule: [
        { reg: /^#?海龟汤(强制)?更新$/, fnc: 'update', permission: 'master' },
      ],
    })
  }

  async update(e = this.e) {
    e.isMaster = true
    e.msg = `#${e.msg.includes('强制') ? '强制' : ''}更新soupbubble-plugin`
    const up = new Update(e)
    up.e = e
    return up.update()
  }
}

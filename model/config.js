import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'
import _ from 'lodash'

const PLUGIN_ROOT = path.join(process.cwd(), 'plugins/soupbubble-plugin')
const DEFAULT_DIR = path.join(PLUGIN_ROOT, 'config_default')
const USER_DIR = path.join(PLUGIN_ROOT, 'config')

function ensureUserConfig() {
  if (!fs.existsSync(USER_DIR)) fs.mkdirSync(USER_DIR, { recursive: true })
  for (const name of fs.readdirSync(DEFAULT_DIR)) {
    const userFile = path.join(USER_DIR, name)
    if (!fs.existsSync(userFile)) {
      fs.copyFileSync(path.join(DEFAULT_DIR, name), userFile)
      logger?.mark(`[海龟汤] 创建默认配置 config/${name}`)
    }
  }
}

function readYaml(file) {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch (err) {
    logger?.error(`[海龟汤] 解析配置失败 ${file}:`, err?.message || err)
    return {}
  }
}

class Config {
  constructor() {
    ensureUserConfig()
    this.cache = {}
    this.watchers = {}
    this.load('config')
  }

  load(name) {
    const userFile = path.join(USER_DIR, `${name}.yaml`)
    const defaultFile = path.join(DEFAULT_DIR, `${name}.yaml`)
    const defaults = readYaml(defaultFile)
    const user = readYaml(userFile)
    this.cache[name] = _.merge({}, defaults, user)
    this.watch(name, userFile)
    return this.cache[name]
  }

  watch(name, file) {
    if (this.watchers[name]) return
    const watcher = chokidar.watch(file, { ignoreInitial: true })
    watcher.on('change', () => {
      logger?.mark(`[海龟汤] 配置文件变更，热更新 config/${name}.yaml`)
      const defaults = readYaml(path.join(DEFAULT_DIR, `${name}.yaml`))
      const user = readYaml(file)
      this.cache[name] = _.merge({}, defaults, user)
    })
    this.watchers[name] = watcher
  }

  get(name = 'config') {
    if (!this.cache[name]) this.load(name)
    return this.cache[name]
  }
}

export default new Config()

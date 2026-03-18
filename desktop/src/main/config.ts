import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'

export interface DesktopConfig {
  proqPath: string
  port: number
  wsPort: number
  devMode: boolean
  setupComplete: boolean
  claudeBinPath: string
  lastUpdated: string
  windowBounds: { x: number; y: number; width: number; height: number } | null
}

const defaults: DesktopConfig = {
  proqPath: path.join(os.homedir(), 'proq'),
  port: 7331,
  wsPort: 42067,
  devMode: false,
  setupComplete: false,
  claudeBinPath: '',
  lastUpdated: '',
  windowBounds: null
}

function getConfigPath(): string {
  try {
    return path.join(app.getPath('userData'), 'config.json')
  } catch {
    return path.join(os.homedir(), '.proq-desktop', 'config.json')
  }
}

function readStore(): DesktopConfig {
  const configPath = getConfigPath()
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

function writeStore(config: DesktopConfig): void {
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

export function getConfig(): DesktopConfig {
  return readStore()
}

export function setConfig(partial: Partial<DesktopConfig>): DesktopConfig {
  const current = readStore()
  const updated = { ...current, ...partial }
  writeStore(updated)
  return updated
}

export function resetConfig(): void {
  writeStore({ ...defaults })
}

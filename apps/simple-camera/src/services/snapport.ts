import { useSyncExternalStore } from 'react'
import { bridge } from 'snapport-native'
import type { StorageConnection } from '../storage/StorageProvider'
import { validateConnection, WebDAVProvider } from '../storage/WebDAVProvider'
import { UploadManager } from '../upload/UploadManager'
import { nativeTransport } from './transport'

export interface Settings {
  connections: StorageConnection[]
  defaultId?: string
  language: 'system' | 'zh' | 'en'
  allowVideo: boolean
  gps: boolean
  loaded: boolean
  loadError: boolean
}
let settings: Settings = {
  connections: [],
  language: 'system',
  allowVideo: false,
  gps: false,
  loaded: false,
  loadError: false,
}
const listeners = new Set<() => void>()
const subscribe = (callback: () => void) => {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}
const getSnapshot = () => settings
export const useSettings = () => useSyncExternalStore(subscribe, getSnapshot)
export const uploads = new UploadManager()
export const useUploads = () =>
  useSyncExternalStore(uploads.subscribe, uploads.getSnapshot)
const emit = () =>
  listeners.forEach((callback) => {
    callback()
  })
export async function loadSettings() {
  try {
    const raw = await bridge.readVault()
    if (raw) {
      const value = JSON.parse(raw) as Settings
      if (
        !Array.isArray(value.connections) ||
        !['system', 'zh', 'en'].includes(value.language)
      )
        throw new Error('invalid vault')
      value.connections.forEach(validateConnection)
      settings = { ...settings, ...value }
    }
    settings = { ...settings, loaded: true, loadError: false }
  } catch {
    settings = { ...settings, loaded: true, loadError: true }
  }
  emit()
}
// Serialize writes so a slow secure-store operation cannot overwrite newer settings.
let saving = Promise.resolve()
export function updateSettings(change: Partial<Settings>): Promise<void> {
  const operation = saving.then(async () => {
    if (!settings.loaded || settings.loadError)
      throw new Error('vault unavailable')
    const next = { ...settings, ...change }
    await bridge.writeVault(JSON.stringify(next))
    settings = next
    emit()
  })
  saving = operation.catch(() => {})
  return operation
}
export function defaultProvider() {
  const connection = settings.connections.find(
    (connection) => connection.id === settings.defaultId,
  )
  return connection ? providerFor(connection, true) : undefined
}
export const providerFor = (
  connection: StorageConnection,
  refreshCredentials = false,
) =>
  new WebDAVProvider(connection, nativeTransport, () => {
    // Draft connection tests use the draft. Captured jobs may refresh credentials
    // only when both the saved connection ID and original DAV address still match.
    return refreshCredentials
      ? (settings.connections.find(
          (item) => item.id === connection.id && item.url === connection.url,
        ) ?? connection)
      : connection
  })
const systemLanguage = bridge.locale().toLowerCase().startsWith('zh')
  ? 'zh'
  : 'en'
export function text(zh: string, en: string) {
  return (settings.language === 'system'
    ? systemLanguage
    : settings.language) === 'zh'
    ? zh
    : en
}
export function errorText(code: string) {
  const errors: Record<string, [string, string]> = {
    auth: [
      '认证失败，请检查用户名和应用密码。',
      'Authentication failed. Check your username and app password.',
    ],
    forbidden: [
      '没有目录访问或写入权限。',
      'Access or write permission denied.',
    ],
    space: [
      '内存队列或服务器空间不足，请先处理待上传照片。',
      'Memory queue or server storage is full. Resolve pending uploads first.',
    ],
    timeout: [
      '连接超时，请检查网络后重试。',
      'Connection timed out. Check the network and retry.',
    ],
    network: [
      '连接中断或证书无效，请检查网络和 HTTPS 证书。',
      'Connection interrupted or invalid TLS certificate. Check your network and HTTPS certificate.',
    ],
    conflict: [
      '远端文件已存在且内容不同。未覆盖，请人工核对。',
      'A different file exists at this path. Nothing was overwritten. Check the server.',
    ],
    invalid: [
      '请使用有效的 HTTPS WebDAV 地址、账号和目录。重定向不被允许。',
      'Use a valid HTTPS WebDAV URL, credentials and directory. Redirects are not allowed.',
    ],
    unsupported: [
      '当前照片格式不支持内存上传，请使用 JPEG 模式。',
      'This photo format does not support memory upload. Use JPEG mode.',
    ],
    server: [
      '服务器未确认成功，请检查 WebDAV 服务。',
      'The server did not confirm success. Check the WebDAV service.',
    ],
  }
  const pair = errors[code] ?? errors.server
  return pair ? text(...pair) : code
}

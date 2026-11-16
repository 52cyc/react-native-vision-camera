import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { URL } from 'react-native-url-polyfill'
import {
  checkStatus,
  type RemoteFile,
  type StorageConnection,
  StorageError,
  type StorageProvider,
  type Transport,
  type UploadInput,
} from './StorageProvider'

function segments(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  if (
    parts.some(
      (p) =>
        p === '.' ||
        p === '..' ||
        p.includes('\\') ||
        Array.from(p).some((char) => char.charCodeAt(0) < 32),
    )
  )
    throw new StorageError('invalid')
  return parts
}
export function validateConnection(config: StorageConnection) {
  let url: URL
  try {
    url = new URL(config.url)
  } catch {
    throw new StorageError('invalid')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !config.name.trim() ||
    !config.username ||
    !config.password ||
    config.username.includes(':') ||
    /[\r\n]/.test(config.username + config.password)
  )
    throw new StorageError('invalid')
  segments(config.directory)
  return url
}

// UTF-8 Basic credentials. Base64 is used ONLY for the HTTP authentication header.
export function basicAuth(username: string, password: string) {
  const bytes = Array.from(
    encodeURIComponent(`${username}:${password}`).matchAll(
      /%([0-9A-F]{2})|([^%])/g,
    ),
    (m) => (m[1] ? Number.parseInt(m[1], 16) : (m[2] ?? '').charCodeAt(0)),
  )
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    output +=
      alphabet[(n >>> 18) & 63] +
      (alphabet[(n >>> 12) & 63] ?? '') +
      (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[n & 63] : '=')
  }
  return `Basic ${output}`
}

const array = <T>(value: T | T[] | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value]
type Prop = {
  getlastmodified?: string
  getcontentlength?: string
  resourcetype?: { collection?: unknown }
}
type DavResponse = {
  href?: string
  propstat?:
    | { status?: string; prop?: Prop }
    | { status?: string; prop?: Prop }[]
}

export function captureDateFromName(name: string): number | undefined {
  const match =
    /^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})_/.exec(name)
  if (!match) return undefined
  const [, y, m, d, h, min, sec, ms] = match
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(h),
    Number(min),
    Number(sec),
    Number(ms),
  )
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === Number(y) &&
    date.getMonth() + 1 === Number(m) &&
    date.getDate() === Number(d)
    ? date.getTime()
    : undefined
}

export class WebDAVProvider implements StorageProvider {
  private readonly base: URL
  constructor(
    readonly config: StorageConnection,
    private readonly transport: Transport,
    private readonly credentials: () => Pick<
      StorageConnection,
      'username' | 'password'
    > = () => config,
  ) {
    const base = validateConnection(config)
    this.base = new URL(`${base.origin}${base.pathname.replace(/\/+$/, '')}/`)
  }
  getCapabilities() {
    return { list: true, preview: true, delete: true, directories: true }
  }
  private url(path: string) {
    const encoded = segments(path).map(encodeURIComponent).join('/')
    return new URL(
      encoded + (path.endsWith('/') && encoded ? '/' : ''),
      this.base,
    ).href
  }
  private request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: ArrayBuffer,
    progress?: (sent: number, total: number) => void,
  ) {
    const credentials = this.credentials()
    return this.transport(
      method,
      this.url(path),
      {
        Authorization: basicAuth(credentials.username, credentials.password),
        ...headers,
      },
      body,
      progress,
    )
  }
  async testConnection() {
    await this.createDirectory(this.config.directory)
    await this.listFiles(this.config.directory)
  }
  async createDirectory(path: string) {
    const parts = segments(path)
    for (let i = 1; i <= parts.length; i++) {
      const folder = `${parts.slice(0, i).join('/')}/`
      const response = await this.request('MKCOL', folder)
      if (response.status === 405) {
        // A 405 can mean an existing file or an unsupported method. Confirm collection.
        const entries = await this.stat(folder)
        if (
          !entries.some(
            (entry) =>
              entry.path.replace(/\/$/, '') === folder.replace(/\/$/, '') &&
              entry.directory,
          )
        )
          throw new StorageError('forbidden')
      } else checkStatus(response.status, [201])
    }
  }
  private async stat(path: string, depth = '0'): Promise<RemoteFile[]> {
    const response = await this.request('PROPFIND', path, { Depth: depth })
    checkStatus(response.status, [207])
    if (
      /<!DOCTYPE|<!ENTITY/i.test(response.text) ||
      XMLValidator.validate(response.text) !== true
    )
      throw new StorageError('invalid')
    const parsed = new XMLParser({
      removeNSPrefix: true,
      ignoreAttributes: true,
      parseTagValue: false,
    }).parse(response.text) as {
      multistatus?: { response?: DavResponse | DavResponse[] }
    }
    if (!parsed.multistatus) throw new StorageError('invalid')
    const entries: RemoteFile[] = []
    for (const item of array(parsed.multistatus.response)) {
      const prop = array(item.propstat).find((p) =>
        /\s200(?:\s|$)/.test(p.status ?? ''),
      )?.prop
      if (!prop || typeof item.href !== 'string') continue
      let href: URL
      try {
        href = new URL(item.href, this.url(path))
      } catch {
        continue
      }
      if (
        href.origin !== this.base.origin ||
        !href.pathname.startsWith(this.base.pathname) ||
        href.search ||
        href.hash ||
        href.username ||
        href.password
      )
        continue
      let decoded: string[]
      try {
        decoded = href.pathname
          .slice(this.base.pathname.length)
          .split('/')
          .filter(Boolean)
          .map(decodeURIComponent)
      } catch {
        continue
      }
      if (
        decoded.some(
          (p) => p.includes('/') || p.includes('\\') || p === '.' || p === '..',
        )
      )
        continue
      const remotePath = decoded.join('/')
      const modified = Date.parse(prop.getlastmodified ?? '')
      entries.push({
        path: remotePath,
        name: decoded.at(-1) ?? '',
        directory: prop.resourcetype?.collection !== undefined,
        captured: captureDateFromName(decoded.at(-1) ?? ''),
        modified: Number.isFinite(modified) ? modified : 0,
        size: Number(prop.getcontentlength ?? 0),
      })
    }
    return entries
  }
  async listFiles(directory = this.config.directory) {
    const normalized = segments(directory).join('/')
    const entries = await this.stat(`${normalized}/`, '1')
    return entries
      .filter((entry) => entry.path !== normalized)
      .sort(
        (a, b) =>
          (b.captured ?? b.modified) - (a.captured ?? a.modified) ||
          b.name.localeCompare(a.name),
      )
  }
  async readFile(path: string) {
    const response = await this.request('GET', path)
    checkStatus(response.status, [200])
    return response.body
  }
  async deleteFile(path: string) {
    const response = await this.request('DELETE', path)
    checkStatus(response.status, [200, 204])
  }
  async upload(input: UploadInput) {
    if (input.reconcile) {
      // A connection can fail after the server commits the PUT. Verify byte-for-byte
      // before declaring it successful; length or ETag alone is not proof.
      const existing = await this.request('GET', input.path)
      if (existing.status !== 404) {
        checkStatus(existing.status, [200])
        const a = new Uint8Array(existing.body),
          b = new Uint8Array(input.data)
        if (a.length !== b.length || a.some((v, i) => v !== b[i]))
          throw new StorageError('conflict')
        return
      }
    }
    await this.createDirectory(segments(input.path).slice(0, -1).join('/'))
    const response = await this.request(
      'PUT',
      input.path,
      { 'Content-Type': input.contentType, 'If-None-Match': '*' },
      input.data,
      input.onProgress,
    )
    // 204 normally indicates replacement, which strict no-overwrite mode rejects.
    checkStatus(response.status, [201])
  }
}

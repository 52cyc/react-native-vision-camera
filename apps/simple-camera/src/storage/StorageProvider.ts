export type StorageErrorCode =
  | 'auth'
  | 'forbidden'
  | 'space'
  | 'timeout'
  | 'network'
  | 'conflict'
  | 'uncertain'
  | 'invalid'
  | 'unsupported'
  | 'server'
export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    public readonly retryable = false,
  ) {
    super(code)
  }
}
export interface StorageConnection {
  id: string
  name: string
  type: 'webdav'
  url: string
  username: string
  password: string
  directory: string
  dateFolders: boolean
  naming: 'timestamp' | 'uuid'
}
export interface RemoteFile {
  path: string
  name: string
  directory: boolean
  modified: number
  captured?: number
  size: number
}
export interface UploadInput {
  path: string
  data: ArrayBuffer
  contentType: string
  onProgress?: (sent: number, total: number) => void
  /** True after a previous PUT may have reached the server. Never blindly repeat it. */
  reconcile: boolean
}
export interface StorageProvider {
  getCapabilities(): {
    list: boolean
    preview: boolean
    delete: boolean
    directories: boolean
  }
  testConnection(): Promise<void>
  upload(input: UploadInput): Promise<void>
  listFiles?(directory?: string): Promise<RemoteFile[]>
  readFile?(path: string): Promise<ArrayBuffer>
  createDirectory?(path: string): Promise<void>
  deleteFile?(path: string): Promise<void>
}
export interface TransportResponse {
  status: number
  text: string
  body: ArrayBuffer
}
export type Transport = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: ArrayBuffer,
  progress?: (sent: number, total: number) => void,
) => Promise<TransportResponse>

export function checkStatus(status: number, allowed: number[]) {
  if (allowed.includes(status)) return
  if (status === 401) throw new StorageError('auth')
  if (status === 403) throw new StorageError('forbidden')
  if (status === 507) throw new StorageError('space')
  if (status === 412) throw new StorageError('conflict')
  if (status === 408 || status === 504) throw new StorageError('timeout', true)
  if (status >= 300 && status < 400) throw new StorageError('invalid')
  throw new StorageError('server', status === 429 || status >= 500)
}

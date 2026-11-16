import { StorageError, type StorageProvider } from '../storage/StorageProvider'

export type UploadState = 'waiting' | 'uploading' | 'success' | 'failed'
export interface UploadTask {
  id: string
  path: string
  targetName: string
  state: UploadState
  attempts: number
  progress?: number
  error?: string
  bytes: number
}
interface Entry {
  task: UploadTask
  data?: ArrayBuffer
  provider: StorageProvider
  sent: boolean
  nextAttempt: number
}
export const MAX_PENDING = 3
export const MAX_BYTES = 64 * 1024 * 1024
export const MAX_ATTEMPTS = 4

/** One upload at a time. Payloads never enter React state, logs or persisted settings. */
export class UploadManager {
  private entries: Entry[] = []
  private listeners = new Set<() => void>()
  private snapshot: readonly UploadTask[] = []
  private active = true
  private running = false
  private reserved = false
  subscribe = (callback: () => void) => {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
  getSnapshot = () => this.snapshot
  private emit() {
    this.snapshot = this.entries.map((entry) => ({ ...entry.task }))
    this.listeners.forEach((callback) => {
      callback()
    })
  }
  get pending() {
    return this.entries.filter((entry) => entry.data != null).length
  }
  get memoryBytes() {
    return this.entries.reduce(
      (sum, entry) => sum + (entry.data?.byteLength ?? 0),
      0,
    )
  }
  reserve() {
    if (
      !this.active ||
      this.reserved ||
      this.pending >= MAX_PENDING ||
      this.memoryBytes >= MAX_BYTES
    )
      return false
    this.reserved = true
    return true
  }
  releaseReservation() {
    this.reserved = false
  }
  enqueue(
    task: Pick<UploadTask, 'id' | 'path' | 'targetName'>,
    data: ArrayBuffer,
    provider: StorageProvider,
  ) {
    if (
      !this.reserved ||
      data.byteLength === 0 ||
      this.memoryBytes + data.byteLength > MAX_BYTES
    )
      throw new StorageError('space')
    this.entries.push({
      task: { ...task, bytes: data.byteLength, state: 'waiting', attempts: 0 },
      data,
      provider,
      sent: false,
      nextAttempt: 0,
    })
    this.reserved = false
    this.emit()
    void this.pump()
  }
  setActive(active: boolean) {
    this.active = active
    if (active) void this.pump()
  }
  retry(id: string, now = Date.now()) {
    const entry = this.entries.find((entry) => entry.task.id === id)
    if (
      !entry?.data ||
      entry.task.state !== 'failed' ||
      entry.task.attempts >= MAX_ATTEMPTS ||
      now < entry.nextAttempt
    )
      return false
    entry.task.state = 'waiting'
    entry.task.error = undefined
    this.emit()
    void this.pump()
    return true
  }
  discard(id: string) {
    const entry = this.entries.find((entry) => entry.task.id === id)
    if (entry?.task.state === 'uploading') return false
    this.entries = this.entries.filter((entry) => entry.task.id !== id)
    this.emit()
    return true
  }
  private async pump() {
    if (this.running || !this.active) return
    this.running = true
    try {
      while (this.active) {
        const entry = this.entries.find(
          (entry) => entry.task.state === 'waiting' && entry.data,
        )
        if (!entry?.data) break
        entry.task.state = 'uploading'
        entry.task.attempts++
        entry.task.progress = undefined
        this.emit()
        try {
          const reconcile = entry.sent
          entry.sent = true
          await entry.provider.upload({
            path: entry.task.path,
            data: entry.data,
            contentType: 'image/jpeg',
            reconcile,
            onProgress: (sent, total) => {
              const progress = total > 0 ? Math.min(1, sent / total) : undefined
              if (
                progress === undefined ||
                entry.task.progress === undefined ||
                progress - entry.task.progress >= 0.02 ||
                progress === 1
              ) {
                entry.task.progress = progress
                this.emit()
              }
            },
          })
          entry.task.state = 'success'
          entry.data = undefined
        } catch (error) {
          entry.task.state = 'failed'
          entry.task.error =
            error instanceof StorageError ? error.code : 'network'
          entry.nextAttempt =
            Date.now() + Math.min(30_000, 1000 * 2 ** (entry.task.attempts - 1))
        }
        // Keep at most 30 completed metadata rows. Failed buffers remain explicitly retryable/discardable.
        const done = this.entries.filter((entry) => !entry.data)
        if (done.length > 30)
          this.entries = this.entries.filter((entry) => entry !== done[0])
        this.emit()
      }
    } finally {
      this.running = false
    }
  }
}

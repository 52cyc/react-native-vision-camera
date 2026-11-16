import {
  type StorageConnection,
  StorageError,
  type StorageProvider,
} from './storage/StorageProvider'
import type { UploadManager } from './upload/UploadManager'

interface MemoryPhoto {
  containerFormat: string
  getFileDataAsync(): Promise<ArrayBuffer>
  dispose(): void
}
export function photoPath(
  connection: StorageConnection,
  id: string,
  now = new Date(),
) {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  const year = now.getFullYear(),
    month = pad(now.getMonth() + 1),
    day = pad(now.getDate())
  const datePath = connection.dateFolders ? `/${year}/${month}/${day}` : ''
  const timestamp = `${year}${month}${day}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`
  const filename =
    connection.naming === 'uuid'
      ? `IMG_${id}.jpg`
      : `IMG_${timestamp}_${id}.jpg`
  return `${connection.directory.replace(/\/+$/, '')}${datePath}/${filename}`
}

export async function captureToQueue(
  capture: () => Promise<MemoryPhoto>,
  queue: UploadManager,
  connection: StorageConnection,
  provider: StorageProvider,
  id: string,
) {
  if (!queue.reserve()) throw new StorageError('space')
  try {
    const photo = await capture()
    try {
      // Android's in-memory CameraX implementation has limitations for non-JPEG formats.
      // Refuse unexpected containers instead of silently changing format or writing a file.
      if (photo.containerFormat !== 'jpeg')
        throw new StorageError('unsupported')
      const data = await photo.getFileDataAsync()
      queue.enqueue(
        { id, path: photoPath(connection, id), targetName: connection.name },
        data,
        provider,
      )
    } finally {
      photo.dispose()
    }
  } finally {
    queue.releaseReservation()
  }
}

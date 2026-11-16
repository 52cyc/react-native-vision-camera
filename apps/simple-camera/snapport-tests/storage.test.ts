import { afterAll, describe, expect, mock, test } from 'bun:test'
import { createServer } from 'node:http'

// Only the URL polyfill's native Blob hooks are mocked. Provider and queue code are real.
mock.module('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'android', Version: 36 },
}))
const { WebDAVProvider, basicAuth, validateConnection, captureDateFromName } =
  await import('../src/storage/WebDAVProvider')
const { StorageError } = await import('../src/storage/StorageProvider')
const { UploadManager, MAX_BYTES } = await import('../src/upload/UploadManager')
const { captureToQueue, photoPath } = await import('../src/cameraCapture')

import type {
  StorageConnection,
  StorageProvider,
  Transport,
  UploadInput,
} from '../src/storage/StorageProvider'

const config: StorageConnection = {
  id: 'test-only',
  name: 'Mock DAV',
  type: 'webdav',
  url: 'https://dav.example.test/dav/',
  username: '测试用户',
  password: 'test-only-not-a-real-secret',
  directory: '/SnapPort',
  dateFolders: true,
  naming: 'timestamp',
}
const bytes = () => new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]).buffer
const response = (status: number, body = new ArrayBuffer(0), text = '') => ({
  status,
  body,
  text,
})
const provider = (
  upload: (input: UploadInput) => Promise<void>,
): StorageProvider => ({
  upload,
  testConnection: async () => {},
  getCapabilities: () => ({
    list: false,
    preview: false,
    delete: false,
    directories: false,
  }),
})
async function settle(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return
    await Bun.sleep(2)
  }
  throw new Error('test did not settle')
}
function listing(href: string, directory = true) {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>7</d:getcontentlength><d:getlastmodified>Mon, 16 Nov 2026 05:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
}

describe('WebDAV protocol', () => {
  test('UTF-8 Basic authentication is correct; photos stay binary', () => {
    expect(basicAuth(config.username, config.password)).toBe(
      `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
    )
  })
  test('rejects HTTP, credentials in URL, traversal and newline credentials', () => {
    for (const patch of [
      { url: 'http://dav.test/' },
      { url: 'https://user:secret@dav.test/' },
      { directory: '/../private' },
      { password: 'bad\nheader' },
      { url: 'https://dav.test/?token=x' },
    ]) {
      expect(() => validateConnection({ ...config, ...patch })).toThrow()
    }
  })
  test('uploads exact bytes with conditional PUT and encoded paths', async () => {
    const calls: { method: string; url: string }[] = []
    const payload = bytes()
    const transport: Transport = async (
      method,
      url,
      headers,
      body,
      progress,
    ) => {
      calls.push({ method, url })
      expect(headers.Authorization).toBe(
        basicAuth(config.username, config.password),
      )
      if (method === 'PUT') {
        expect(body).toBe(payload)
        expect(headers['If-None-Match']).toBe('*')
        expect(headers['Content-Type']).toBe('image/jpeg')
        progress?.(payload.byteLength, payload.byteLength)
      }
      return response(201)
    }
    let sent = 0
    await new WebDAVProvider(config, transport).upload({
      path: '/SnapPort/中文 #目录/a #?.jpg',
      data: payload,
      contentType: 'image/jpeg',
      reconcile: false,
      onProgress: (value) => {
        sent = value
      },
    })
    expect(calls.map((call) => call.method)).toEqual(['MKCOL', 'MKCOL', 'PUT'])
    expect(calls.at(-1)?.url).toBe(
      'https://dav.example.test/dav/SnapPort/%E4%B8%AD%E6%96%87%20%23%E7%9B%AE%E5%BD%95/a%20%23%3F.jpg',
    )
    expect(sent).toBe(payload.byteLength)
  })
  test.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [507, 'space'],
    [504, 'timeout'],
    [412, 'conflict'],
    [302, 'invalid'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const dav = new WebDAVProvider(config, async (method) =>
      response(method === 'MKCOL' ? 201 : Number(status)),
    )
    try {
      await dav.upload({
        path: '/SnapPort/a.jpg',
        data: bytes(),
        contentType: 'image/jpeg',
        reconcile: false,
      })
      throw new Error('must fail')
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError)
      expect(String((error as InstanceType<typeof StorageError>).code)).toBe(
        String(code),
      )
    }
  })
  test('405 MKCOL must resolve to an existing collection', async () => {
    const dav = new WebDAVProvider(config, async (method) =>
      method === 'MKCOL'
        ? response(405)
        : response(207, undefined, listing('/dav/SnapPort/', false)),
    )
    await expect(dav.createDirectory('/SnapPort')).rejects.toThrow('forbidden')
  })
  test('reads namespaced DAV XML, rejects external href and directory self', async () => {
    const xml = listing('/dav/SnapPort/a%20%23.jpg', false)
    const dav = new WebDAVProvider(config, async () =>
      response(207, undefined, xml),
    )
    expect((await dav.listFiles('/SnapPort'))[0]?.name).toBe('a #.jpg')
    const external = new WebDAVProvider(config, async () =>
      response(
        207,
        undefined,
        listing('https://attacker.test/private.jpg', false),
      ),
    )
    expect(await external.listFiles('/SnapPort')).toEqual([])
    const self = new WebDAVProvider(config, async () =>
      response(207, undefined, listing('/dav/SnapPort/')),
    )
    expect(await self.listFiles('/SnapPort')).toEqual([])
  })
  test('rejects DTD and malformed multistatus', async () => {
    for (const xml of [
      '<!DOCTYPE a><d:multistatus xmlns:d="DAV:"/>',
      '<html/>',
    ]) {
      await expect(
        new WebDAVProvider(config, async () =>
          response(207, undefined, xml),
        ).listFiles(),
      ).rejects.toThrow('invalid')
    }
  })
  test('retry reconciles server-committed bytes without another PUT', async () => {
    const methods: string[] = []
    const dav = new WebDAVProvider(config, async (method) => {
      methods.push(method)
      return response(200, bytes())
    })
    await dav.upload({
      path: 'SnapPort/a.jpg',
      data: bytes(),
      contentType: 'image/jpeg',
      reconcile: true,
    })
    expect(methods).toEqual(['GET'])
  })
  test('retry refuses a different remote file', async () => {
    const dav = new WebDAVProvider(config, async () =>
      response(200, new Uint8Array([9]).buffer),
    )
    await expect(
      dav.upload({
        path: 'a.jpg',
        data: bytes(),
        contentType: 'image/jpeg',
        reconcile: true,
      }),
    ).rejects.toThrow('conflict')
  })
  test('a replacement response is never reported as success', async () => {
    const dav = new WebDAVProvider(config, async (method) =>
      response(method === 'MKCOL' ? 201 : 204),
    )
    await expect(
      dav.upload({
        path: '/SnapPort/a.jpg',
        data: bytes(),
        contentType: 'image/jpeg',
        reconcile: false,
      }),
    ).rejects.toThrow()
  })
})

describe('memory capture and queue', () => {
  test('disposes the photo after copying encoded data and releases payload on success', async () => {
    const queue = new UploadManager()
    let disposed = 0
    await captureToQueue(
      async () => ({
        containerFormat: 'jpeg',
        getFileDataAsync: async () => bytes(),
        dispose: () => {
          disposed++
        },
      }),
      queue,
      config,
      provider(async () => {}),
      'one',
    )
    await settle(() => queue.getSnapshot()[0]?.state === 'success')
    expect(disposed).toBe(1)
    expect(queue.memoryBytes).toBe(0)
  })
  test('encoding failure disposes photo and frees capture reservation', async () => {
    const queue = new UploadManager()
    let disposed = 0
    await expect(
      captureToQueue(
        async () => ({
          containerFormat: 'jpeg',
          getFileDataAsync: async () => {
            throw new Error('encoding failed')
          },
          dispose: () => {
            disposed++
          },
        }),
        queue,
        config,
        provider(async () => {}),
        'two',
      ),
    ).rejects.toThrow()
    expect(disposed).toBe(1)
    expect(queue.reserve()).toBe(true)
  })
  test('capture failure releases reservation, non-JPEG fails without falling back to a file', async () => {
    const queue = new UploadManager()
    await expect(
      captureToQueue(
        async () => {
          throw new Error('capture failed')
        },
        queue,
        config,
        provider(async () => {}),
        'bad',
      ),
    ).rejects.toThrow()
    let disposed = false
    await expect(
      captureToQueue(
        async () => ({
          containerFormat: 'dng',
          getFileDataAsync: async () => bytes(),
          dispose: () => {
            disposed = true
          },
        }),
        queue,
        config,
        provider(async () => {}),
        'raw',
      ),
    ).rejects.toThrow('unsupported')
    expect(disposed).toBe(true)
    expect(queue.memoryBytes).toBe(0)
  })
  test('retains failed bytes, limits backoff and attempts, discards explicitly', async () => {
    const queue = new UploadManager()
    let calls = 0
    const failing = provider(async () => {
      calls++
      throw new StorageError('network', true)
    })
    expect(queue.reserve()).toBe(true)
    queue.enqueue(
      { id: 'failed', path: 'a.jpg', targetName: 'Mock' },
      bytes(),
      failing,
    )
    await settle(() => queue.getSnapshot()[0]?.state === 'failed')
    expect(queue.memoryBytes).toBe(7)
    expect(queue.retry('failed')).toBe(false)
    for (let i = 0; i < 3; i++) {
      expect(queue.retry('failed', Date.now() + 60_000)).toBe(true)
      await settle(() => queue.getSnapshot()[0]?.state === 'failed')
    }
    expect(calls).toBe(4)
    expect(queue.retry('failed', Date.now() + 60_000)).toBe(false)
    queue.discard('failed')
    expect(queue.memoryBytes).toBe(0)
  })
  test('limits to three pending photos and serial uploads', async () => {
    const queue = new UploadManager()
    let active = 0,
      maximum = 0
    const releases: (() => void)[] = []
    const blocked = provider(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active--
    })
    for (let i = 0; i < 3; i++) {
      expect(queue.reserve()).toBe(true)
      queue.enqueue(
        { id: String(i), path: `${i}.jpg`, targetName: 'Mock' },
        bytes(),
        blocked,
      )
    }
    expect(queue.reserve()).toBe(false)
    expect(queue.pending).toBe(3)
    for (let i = 0; i < 3; i++) {
      await settle(() => releases.length > i)
      releases[i]?.()
      await Bun.sleep(3)
    }
    await settle(() => queue.pending === 0)
    expect(maximum).toBe(1)
  })
  test('rejects a buffer above the budget without queueing it', () => {
    const queue = new UploadManager()
    expect(queue.reserve()).toBe(true)
    expect(() =>
      queue.enqueue(
        { id: 'large', path: 'a.jpg', targetName: 'Mock' },
        new ArrayBuffer(MAX_BYTES + 1),
        provider(async () => {}),
      ),
    ).toThrow('space')
    queue.releaseReservation()
    expect(queue.pending).toBe(0)
  })
  test('background pauses queued requests until foreground resumes', async () => {
    const queue = new UploadManager()
    queue.setActive(false)
    expect(queue.reserve()).toBe(false)
    queue.setActive(true)
    expect(queue.reserve()).toBe(true)
    queue.setActive(false)
    let called = false
    queue.enqueue(
      { id: 'wait', path: 'a.jpg', targetName: 'Mock' },
      bytes(),
      provider(async () => {
        called = true
      }),
    )
    await Bun.sleep(5)
    expect(called).toBe(false)
    queue.setActive(true)
    await settle(() => queue.pending === 0)
    expect(called).toBe(true)
  })
  test('names stay stable per task and different captures use distinct paths', () => {
    const date = new Date(2026, 10, 16, 14, 2, 3, 4)
    expect(photoPath(config, 'a', date)).toBe(
      '/SnapPort/2026/11/16/IMG_20261116_140203_004_a.jpg',
    )
    expect(photoPath(config, 'a', date)).not.toBe(photoPath(config, 'b', date))
  })
})

// Real HTTP round-trip to an isolated loopback DAV mock. Only the TEST transport
// rewrites the test HTTPS origin; the app's native HTTPS-only transport is untouched.
const remote = new Map<string, ArrayBuffer>()
let simulateDisconnect = false
const server = createServer(async (request, result) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const send = (status: number, body?: ArrayBuffer) => {
    result.writeHead(status)
    result.end(body ? Buffer.from(body) : undefined)
  }
  if (
    request.headers.authorization !==
    basicAuth(config.username, config.password)
  ) {
    send(401)
    return
  }
  if (request.method === 'MKCOL') {
    send(201)
    return
  }
  if (request.method === 'PUT') {
    if (remote.has(path) && request.headers['if-none-match'] === '*') {
      send(412)
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const combined = Buffer.concat(chunks)
    remote.set(path, Uint8Array.from(combined).buffer)
    if (simulateDisconnect) {
      simulateDisconnect = false
      result.destroy()
      return
    }
    send(201)
    return
  }
  if (request.method === 'GET') {
    send(remote.has(path) ? 200 : 404, remote.get(path))
    return
  }
  send(405)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string')
  throw new Error('mock server unavailable')
const mockOrigin = `http://127.0.0.1:${address.port}`
afterAll(() => {
  server.closeAllConnections()
  server.close()
})
const loopback: Transport = async (method, url, headers, body) => {
  const local = `${mockOrigin}${new URL(url).pathname}`
  const result = await fetch(local, {
    method,
    headers,
    body,
    redirect: 'manual',
  })
  return response(result.status, await result.arrayBuffer())
}
test('real HTTP mock receives binary bytes and does not overwrite collisions', async () => {
  const dav = new WebDAVProvider(config, loopback)
  const input = {
    path: 'SnapPort/network.jpg',
    data: bytes(),
    contentType: 'image/jpeg',
    reconcile: false,
  }
  await dav.upload(input)
  expect(
    new Uint8Array(
      remote.get('/dav/SnapPort/network.jpg') ?? new ArrayBuffer(0),
    ),
  ).toEqual(new Uint8Array(bytes()))
  await expect(dav.upload(input)).rejects.toThrow('conflict')
})
test('server commit followed by disconnect is recovered without a duplicate', async () => {
  const dav = new WebDAVProvider(config, loopback)
  const input = {
    path: 'SnapPort/disconnect.jpg',
    data: bytes(),
    contentType: 'image/jpeg',
    reconcile: false,
  }
  simulateDisconnect = true
  await expect(dav.upload(input)).rejects.toThrow()
  await dav.upload({ ...input, reconcile: true })
  expect(
    [...remote.keys()].filter((path) => path.includes('disconnect')),
  ).toHaveLength(1)
})

test('gallery uses capture time in SnapPort filenames and falls back for other names', () => {
  expect(captureDateFromName('IMG_20261116_140203_004_uuid.jpg')).toBe(
    new Date(2026, 10, 16, 14, 2, 3, 4).getTime(),
  )
  expect(captureDateFromName('IMG_20261340_140203_004_bad.jpg')).toBeUndefined()
  expect(captureDateFromName('other.jpg')).toBeUndefined()
})

test('corrected credentials can be applied without changing a captured destination', async () => {
  let password = 'old-test-value'
  const calls: string[] = []
  const dav = new WebDAVProvider(
    config,
    async (_method, url, headers) => {
      calls.push(url)
      expect(headers.Authorization).toBe(basicAuth(config.username, password))
      return response(201)
    },
    () => ({ username: config.username, password }),
  )
  password = 'corrected-test-value'
  await dav.upload({
    path: 'SnapPort/fixed.jpg',
    data: bytes(),
    contentType: 'image/jpeg',
    reconcile: false,
  })
  expect(calls.at(-1)).toBe('https://dav.example.test/dav/SnapPort/fixed.jpg')
})

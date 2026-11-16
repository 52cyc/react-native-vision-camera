import type { HybridObject } from 'react-native-nitro-modules'

export interface HttpResponse {
  status: number
  text: string
  body: ArrayBuffer
}

/** App-local transport. Foreground, HTTPS only, no cookies, redirects or disk cache. */
export interface SnapPortBridge
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  request(
    id: string,
    method: string,
    url: string,
    headersJSON: string,
    body: ArrayBuffer | undefined,
    onProgress: (sent: number, total: number) => void,
  ): Promise<HttpResponse>
  cancelAll(): void
  readVault(): Promise<string>
  writeVault(value: string): Promise<void>
  randomID(): string
  locale(): string
}

import { AppState } from 'react-native'
import { bridge } from 'snapport-native'
import { StorageError, type Transport } from '../storage/StorageProvider'

export const nativeTransport: Transport = async (
  method,
  url,
  headers,
  body,
  progress,
) => {
  if (AppState.currentState !== 'active')
    throw new StorageError('network', true)
  try {
    return await bridge.request(
      bridge.randomID(),
      method,
      url,
      JSON.stringify(headers),
      body,
      progress ?? (() => {}),
    )
  } catch (error) {
    throw new StorageError(
      String(error).includes('TIMEOUT') ? 'timeout' : 'network',
      true,
    )
  }
}

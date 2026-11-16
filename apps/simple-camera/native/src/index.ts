import { NitroModules } from 'react-native-nitro-modules'
import type { SnapPortBridge } from './SnapPortBridge.nitro'
export const bridge =
  NitroModules.createHybridObject<SnapPortBridge>('SnapPortBridge')

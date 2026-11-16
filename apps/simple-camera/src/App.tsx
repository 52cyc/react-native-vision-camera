import {
  createStaticNavigation,
  type StaticParamList,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { VisionCamera } from 'react-native-vision-camera'
import { bridge } from 'snapport-native'
import { AppSettingsScreen } from './screens/AppSettingsScreen'
import { CameraScreen } from './screens/CameraScreen'
import { GalleryScreen } from './screens/GalleryScreen'
import { PermissionsScreen } from './screens/PermissionsScreen'
import { PhotoScreen } from './screens/PhotoScreen'
import { StorageSettingsScreen } from './screens/StorageSettingsScreen'
import { UploadStatusScreen } from './screens/UploadStatusScreen'
import { VideoScreen } from './screens/VideoScreen'
import { loadSettings, uploads } from './services/snapport'

const RootStack = createNativeStackNavigator({
  initialRouteName:
    VisionCamera.cameraPermissionStatus === 'authorized'
      ? 'Camera'
      : 'Permissions',
  screens: {
    Permissions: PermissionsScreen,
    Camera: {
      screen: CameraScreen,
    },
    Gallery: GalleryScreen,
    Uploads: UploadStatusScreen,
    StorageSettings: StorageSettingsScreen,
    AppSettings: AppSettingsScreen,
    Photo: {
      screen: PhotoScreen,
      options: {
        animation: 'none',
        presentation: 'transparentModal',
      },
    },
    Video: {
      screen: VideoScreen,
      options: {
        animation: 'none',
        presentation: 'transparentModal',
      },
    },
  },
  screenOptions: {
    navigationBarHidden: true,
    headerShown: false,
    contentStyle: {
      backgroundColor: 'black',
    },
  },
})

type RootStackParamList = StaticParamList<typeof RootStack>

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Navigation = createStaticNavigation(RootStack)

function App() {
  useEffect(() => {
    void loadSettings()
    const update = (state: string) => {
      uploads.setActive(state === 'active')
      if (state !== 'active') bridge.cancelAll()
    }
    update(AppState.currentState)
    const listener = AppState.addEventListener('change', update)
    return () => {
      listener.remove()
      uploads.setActive(false)
      bridge.cancelAll()
    }
  }, [])
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Navigation />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}

export default App

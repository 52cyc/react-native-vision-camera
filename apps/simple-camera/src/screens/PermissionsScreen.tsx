import { useNavigation } from '@react-navigation/native'
import { useEffect, useState } from 'react'
import { Linking, Text, View } from 'react-native'
import { useCameraPermission } from 'react-native-vision-camera'
import { Action, ui } from '../components/SnapUI'
import { useSafeAreaPadding } from '../hooks/useSafeAreaPadding'
import { text, useSettings } from '../services/snapport'

export function PermissionsScreen() {
  const navigation = useNavigation()
  const cameraPermission = useCameraPermission()
  const padding = useSafeAreaPadding()
  useSettings()
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (cameraPermission.hasPermission)
      navigation.reset({ index: 0, routes: [{ name: 'Camera' }] })
  }, [cameraPermission.hasPermission, navigation])
  return (
    <View
      style={[
        ui.page,
        padding,
        { justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
      ]}
    >
      <Text style={ui.title}>SnapPort</Text>
      <Text style={ui.text}>
        {text(
          '拍下此刻，存入你的云端。',
          'Capture the moment. Keep it in your cloud.',
        )}
      </Text>
      <Text style={ui.note}>
        {text(
          '需要相机权限才能拍照。照片仅在内存中等待上传，不主动写入相册。退出应用会丢失未上传照片。',
          'Camera permission is needed to capture photos. Photos wait in memory for upload and are not saved to the camera roll. Unsent photos are lost when the app exits.',
        )}
      </Text>
      <Action
        label={text('允许使用相机', 'Allow camera')}
        onPress={() => {
          void cameraPermission
            .requestPermission()
            .then((granted) => {
              if (!granted)
                setMessage(
                  text(
                    '请在系统设置中允许相机权限。',
                    'Allow camera access in system settings.',
                  ),
                )
            })
            .catch(() =>
              setMessage(
                text('无法申请相机权限。', 'Cannot request camera permission.'),
              ),
            )
        }}
      />
      <Action
        label={text('打开系统设置', 'Open system settings')}
        onPress={() => {
          void Linking.openSettings().catch(() => {})
        }}
      />
      <Action
        label={text('配置云存储', 'Configure cloud storage')}
        onPress={() => navigation.navigate('StorageSettings')}
      />
      {!!message && <Text style={ui.error}>{message}</Text>}
    </View>
  )
}

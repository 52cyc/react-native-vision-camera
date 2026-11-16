import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import { Action, Page, ui } from '../components/SnapUI'
import { text, updateSettings, useSettings } from '../services/snapport'

export function AppSettingsScreen() {
  const settings = useSettings()
  const [error, setError] = useState('')
  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(patch)
      setError('')
    } catch {
      setError(
        text(
          '无法保存设置，请检查设备安全存储。',
          'Cannot save settings. Check device secure storage.',
        ),
      )
    }
  }
  return (
    <Page title={text('应用设置', 'App settings')}>
      <Text style={ui.text}>{text('语言', 'Language')}</Text>
      <View style={ui.row}>
        {(['system', 'zh', 'en'] as const).map((language) => (
          <Action
            key={language}
            label={`${settings.language === language ? '✓ ' : ''}${language === 'system' ? text('跟随系统', 'System') : language === 'zh' ? '中文' : 'English'}`}
            onPress={() => {
              void save({ language })
            }}
          />
        ))}
      </View>
      <View style={ui.section}>
        <View style={ui.row}>
          <Text style={ui.text}>
            {text(
              '启用视频（使用本地临时文件）',
              'Enable video (local temporary files)',
            )}
          </Text>
          <Switch
            value={settings.allowVideo}
            onValueChange={(allowVideo) => {
              void save({ allowVideo })
            }}
          />
        </View>
        <Text style={ui.note}>
          {text(
            '视频沿用官方录制能力，不属于照片内存直传模式，不上传至 WebDAV。开启后在相机中切换视频模式并长按快门。',
            'Video uses the original recorder and temporary files. It is separate from memory-only photos and is not uploaded. Switch to video mode and hold the shutter.',
          )}
        </Text>
      </View>
      <View style={ui.section}>
        <View style={ui.row}>
          <Text style={ui.text}>
            {text('照片 GPS 信息', 'Photo GPS metadata')}
          </Text>
          <Switch
            value={settings.gps}
            onValueChange={(gps) => {
              void save({ gps })
            }}
          />
        </View>
        <Text style={ui.note}>
          {text(
            '开启后申请定位权限。定位信息可能被写入上传照片的 EXIF。',
            'Requests location permission when enabled. Location may be embedded in uploaded photo EXIF.',
          )}
        </Text>
      </View>
      <Text style={ui.note}>
        {text(
          '照片不主动写入文件或系统相册。未上传照片只存在于本次进程内存中；进入后台暂停新上传，正在执行的请求会取消，返回前台后可手动重试。',
          'Photos are not written to files or the camera roll. Pending photos exist only in process memory. Backgrounding pauses the queue and cancels active requests. Retry after returning to the app.',
        )}
      </Text>
      <Text style={ui.note}>
        SnapPort · VisionCamera · MIT{'\n'}
        {text(
          '保留上游版权与许可证。',
          'Upstream copyright and license retained.',
        )}
      </Text>
      {!!error && <Text style={ui.error}>{error}</Text>}
    </Page>
  )
}

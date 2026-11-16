import { useState } from 'react'
import { Alert, Switch, Text, TextInput, View } from 'react-native'
import { bridge } from 'snapport-native'
import { Action, Page, ui } from '../components/SnapUI'
import {
  errorText,
  providerFor,
  text,
  updateSettings,
  useSettings,
} from '../services/snapport'
import {
  type StorageConnection,
  StorageError,
} from '../storage/StorageProvider'
import { validateConnection } from '../storage/WebDAVProvider'

export function StorageSettingsScreen() {
  const settings = useSettings()
  const [draft, setDraft] = useState<StorageConnection>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const change = (patch: Partial<StorageConnection>) => {
    if (draft) setDraft({ ...draft, ...patch })
    setMessage('')
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(
        errorText(error instanceof StorageError ? error.code : 'server'),
      )
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    run(async () => {
      if (!draft) return
      validateConnection(draft)
      const connections = [
        ...settings.connections.filter((item) => item.id !== draft.id),
        draft,
      ]
      await updateSettings({
        connections,
        defaultId: settings.defaultId ?? draft.id,
      })
      setDraft(undefined)
      setMessage(text('连接已安全保存。', 'Connection saved securely.'))
    })
  const test = (connection: StorageConnection) =>
    run(async () => {
      await providerFor(connection).testConnection()
      const success = text(
        '目录可访问，写入权限会在上传时确认。',
        'Directory accessible. Write access is confirmed when uploading.',
      )
      setStatuses((previous) => ({ ...previous, [connection.id]: success }))
      setMessage(success)
    })
  return (
    <Page title={text('存储管理', 'Storage connections')}>
      <Text style={ui.note}>
        {text(
          '使用 WebDAV 的完整 HTTPS 地址。支持飞牛、群晖、Nextcloud 等兼容服务。账号仅存入设备安全存储。',
          'Enter the full HTTPS WebDAV URL. Compatible with NAS and Nextcloud services. Credentials stay in device secure storage.',
        )}
      </Text>
      {settings.loadError && (
        <Text style={ui.error}>
          {text(
            '安全存储读取失败。请解锁设备后重新打开应用，现有连接不会被覆盖。',
            'Secure storage unavailable. Unlock your device and reopen the app. Existing settings are protected.',
          )}
        </Text>
      )}
      {!draft &&
        settings.connections.map((connection) => (
          <View key={connection.id} style={ui.section}>
            <Text style={ui.text}>
              {connection.name}
              {connection.id === settings.defaultId
                ? text(' · 默认', ' · Default')
                : ''}
            </Text>
            <Text style={ui.note}>
              {connection.url}
              {'\n'}
              {connection.directory}
            </Text>
            <Text style={ui.note}>
              {statuses[connection.id] ??
                text('本次尚未测试', 'Not tested this session')}
            </Text>
            <View style={ui.row}>
              <Action
                label={text('编辑', 'Edit')}
                disabled={busy}
                onPress={() => {
                  setDraft({ ...connection })
                  setMessage('')
                }}
              />
              <Action
                label={text('测试', 'Test')}
                disabled={busy}
                onPress={() => {
                  void test(connection)
                }}
              />
              <Action
                label={text('设为默认', 'Set default')}
                disabled={busy || connection.id === settings.defaultId}
                onPress={() => {
                  void run(() => updateSettings({ defaultId: connection.id }))
                }}
              />
              <Action
                label={text('删除', 'Delete')}
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    text('删除连接？', 'Delete connection?'),
                    text(
                      '待上传照片仍保留原目标，云端文件不会删除。',
                      'Pending uploads retain their destination. Remote files remain unchanged.',
                    ),
                    [
                      { text: text('取消', 'Cancel'), style: 'cancel' },
                      {
                        text: text('删除', 'Delete'),
                        style: 'destructive',
                        onPress: () => {
                          void run(() => {
                            const connections = settings.connections.filter(
                              (item) => item.id !== connection.id,
                            )
                            return updateSettings({
                              connections,
                              defaultId:
                                settings.defaultId === connection.id
                                  ? connections[0]?.id
                                  : settings.defaultId,
                            })
                          })
                        },
                      },
                    ],
                  )
                }
              />
            </View>
          </View>
        ))}
      {draft ? (
        <View style={ui.section}>
          {(
            [
              ['name', text('连接名称', 'Connection name')],
              ['url', text('HTTPS WebDAV 地址', 'HTTPS WebDAV URL')],
              ['username', text('用户名', 'Username')],
              ['password', text('密码或应用密码', 'Password or app password')],
              ['directory', text('上传目录', 'Upload directory')],
            ] as const
          ).map(([field, label]) => (
            <View key={field} style={{ gap: 6 }}>
              <Text style={ui.text}>{label}</Text>
              <TextInput
                style={ui.input}
                accessibilityLabel={label}
                value={draft[field]}
                editable={!busy}
                onChangeText={(value) => change({ [field]: value })}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={field === 'password'}
                keyboardType={field === 'url' ? 'url' : 'default'}
                textContentType={
                  field === 'password'
                    ? 'password'
                    : field === 'username'
                      ? 'username'
                      : 'none'
                }
              />
            </View>
          ))}
          <View style={ui.row}>
            <Text style={ui.text}>
              {text('按日期分类', 'Organize by date')}
            </Text>
            <Switch
              disabled={busy}
              value={draft.dateFolders}
              onValueChange={(dateFolders) => change({ dateFolders })}
            />
          </View>
          <Action
            label={
              draft.naming === 'timestamp'
                ? 'IMG_yyyyMMdd_HHmmss_SSS_UUID.jpg'
                : 'IMG_UUID.jpg'
            }
            disabled={busy}
            onPress={() =>
              change({
                naming: draft.naming === 'timestamp' ? 'uuid' : 'timestamp',
              })
            }
          />
          <View style={ui.row}>
            <Action
              label={text('测试连接', 'Test connection')}
              disabled={busy}
              onPress={() => {
                void test(draft)
              }}
            />
            <Action
              label={text('安全保存', 'Save securely')}
              disabled={busy}
              onPress={() => {
                void save()
              }}
            />
            <Action
              label={text('取消', 'Cancel')}
              disabled={busy}
              onPress={() => {
                setDraft(undefined)
                setMessage('')
              }}
            />
          </View>
        </View>
      ) : (
        <Action
          label={text('添加 WebDAV 连接', 'Add WebDAV connection')}
          disabled={busy || !settings.loaded || settings.loadError}
          onPress={() => {
            setMessage('')
            setDraft({
              id: bridge.randomID(),
              name: '',
              type: 'webdav',
              url: '',
              username: '',
              password: '',
              directory: '/SnapPort',
              dateFolders: true,
              naming: 'timestamp',
            })
          }}
        />
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={ui.text}>
          {message}
        </Text>
      )}
      {busy && <Text style={ui.note}>{text('正在处理…', 'Working…')}</Text>}
    </Page>
  )
}

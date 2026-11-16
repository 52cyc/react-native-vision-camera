import { useNavigation } from '@react-navigation/native'
import {
  Canvas,
  type SkImage,
  Skia,
  Image as SkiaImageView,
} from '@shopify/react-native-skia'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Modal, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Action, palette, ui } from '../components/SnapUI'
import {
  defaultProvider,
  errorText,
  providerFor,
  text,
  useSettings,
} from '../services/snapport'
import { type RemoteFile, StorageError } from '../storage/StorageProvider'

export function GalleryScreen() {
  const settings = useSettings()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const target = settings.connections.find(
    (connection) => connection.id === settings.defaultId,
  )
  const [directory, setDirectory] = useState(target?.directory ?? '')
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState<SkImage>()
  const [previewing, setPreviewing] = useState(false)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const generation = useRef(0)
  const previewGeneration = useRef(0)
  const imageRef = useRef<SkImage | undefined>(undefined)
  const closePreview = useCallback(() => {
    previewGeneration.current++
    setPreviewing(false)
    setImage(undefined)
    // Keep the native image alive until the next React commit removes the Canvas.
  }, [])
  useEffect(() => {
    const previous = imageRef.current
    imageRef.current = image
    if (previous && previous !== image) previous.dispose()
  }, [image])
  useEffect(
    () => () => {
      generation.current++
      previewGeneration.current++
      imageRef.current?.dispose()
    },
    [],
  )
  useEffect(() => {
    setDirectory(target?.directory ?? '')
  }, [target?.directory])
  const refresh = useCallback(async () => {
    const provider = target ? providerFor(target) : undefined
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      if (!provider) {
        setFiles([])
        return
      }
      const entries = await provider.listFiles(directory)
      if (current === generation.current)
        setFiles(
          entries.filter(
            (file) =>
              file.directory || /\.(jpe?g|heic|png|webp)$/i.test(file.name),
          ),
        )
    } catch (error) {
      if (current === generation.current) {
        setFiles([])
        setError(
          errorText(error instanceof StorageError ? error.code : 'network'),
        )
      }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [directory, target])
  useEffect(() => {
    void refresh()
    return () => {
      generation.current++
    }
  }, [refresh])
  const preview = async (file: RemoteFile) => {
    if (file.directory) {
      setDirectory(file.path)
      return
    }
    if (file.size > 32 * 1024 * 1024) {
      setError(
        text(
          '照片超过 32 MiB 预览上限。',
          'Photo exceeds the 32 MiB preview limit.',
        ),
      )
      return
    }
    const provider = defaultProvider()
    if (!provider) return
    const current = ++previewGeneration.current
    setPreviewing(true)
    setError('')
    try {
      const buffer = await provider.readFile(file.path)
      if (current !== previewGeneration.current) return
      const encoded = Skia.Data.fromBytes(new Uint8Array(buffer))
      let decoded: SkImage | null
      try {
        decoded = Skia.Image.MakeImageFromEncoded(encoded)
      } finally {
        encoded.dispose()
      }
      if (!decoded) throw new Error('decode')
      if (decoded.width() * decoded.height() > 80_000_000) {
        decoded.dispose()
        throw new Error('size')
      }
      if (current === previewGeneration.current) setImage(decoded)
      else decoded.dispose()
    } catch {
      if (current === previewGeneration.current) {
        closePreview()
        setError(
          text(
            '无法加载云端照片，请检查网络或图片格式。',
            'Cannot preview this photo. Check the network and image format.',
          ),
        )
      }
    }
  }
  return (
    <View
      style={[
        ui.page,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={ui.header}>
        <Action
          label={text('返回', 'Back')}
          onPress={() => navigation.goBack()}
        />
        <Text style={ui.title}>{text('云端相册', 'Cloud gallery')}</Text>
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={ui.note}>
          {target?.name ??
            text('请先配置默认存储', 'Configure a default connection first')}
          {'\n'}
          {directory}
        </Text>
        {target &&
          directory.replace(/^\/+|\/+$/g, '') !==
            target.directory.replace(/^\/+|\/+$/g, '') && (
            <Action
              label={text('上级目录', 'Parent folder')}
              onPress={() =>
                setDirectory(
                  directory.split('/').filter(Boolean).slice(0, -1).join('/'),
                )
              }
            />
          )}
        {!!error && <Text style={ui.error}>{error}</Text>}
        <Text style={ui.note}>
          {text(
            '优先按 SnapPort 文件名中的拍摄时间排序，其余按云端修改时间。WebDAV 不提供通用缩略图，点击照片后仅在内存预览。',
            'Sorted by capture time in SnapPort filenames, otherwise remote modification time. WebDAV has no standard thumbnails. Tap a photo for an in-memory preview.',
          )}
        </Text>
      </View>
      <FlatList
        data={files}
        keyExtractor={(item) => item.path}
        refreshing={loading}
        onRefresh={() => {
          void refresh()
        }}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <Text style={ui.note}>
            {loading
              ? text('正在读取…', 'Loading…')
              : text(
                  '此目录暂无照片。下拉刷新或进入日期目录。',
                  'No photos in this folder. Pull to refresh or open a date folder.',
                )}
          </Text>
        }
        renderItem={({ item }) => (
          <Action
            label={`${item.directory ? '▸ ' : ''}${item.name}`}
            onPress={() => {
              void preview(item)
            }}
          />
        )}
      />
      <Modal
        visible={previewing}
        onRequestClose={closePreview}
        animationType="fade"
      >
        <View
          style={[
            ui.page,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <View style={ui.header}>
            <Action
              label={text('关闭预览', 'Close preview')}
              onPress={closePreview}
            />
          </View>
          <View
            style={{ flex: 1 }}
            onLayout={(event) => setSize(event.nativeEvent.layout)}
          >
            {image ? (
              <Canvas style={{ flex: 1 }}>
                <SkiaImageView
                  image={image}
                  x={0}
                  y={0}
                  width={size.width}
                  height={size.height}
                  fit="contain"
                />
              </Canvas>
            ) : (
              <Text style={[ui.text, { padding: 24, color: palette.muted }]}>
                {text('正在内存中加载照片…', 'Loading photo into memory…')}
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

import { useIsFocused, useNavigation } from '@react-navigation/native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useAnimatedValue,
  View,
} from 'react-native'
import {
  type CameraDevice,
  type FlashMode,
  type Location,
  type Recorder,
  type Size,
  useCameraDevices,
  useMicrophonePermission,
  usePhotoOutput,
  useVideoOutput,
  VisionCamera,
} from 'react-native-vision-camera'
import { useLocation } from 'react-native-vision-camera-location'
import { bridge } from 'snapport-native'
import { captureToQueue } from '../cameraCapture'
import { CameraSelectorButton } from '../components/CameraSelectorButton'
import { CameraView } from '../components/CameraView'
import { CaptureButton } from '../components/CaptureButton'
import { FullOverlay } from '../components/FullOverlay'
import { Action, palette, ui } from '../components/SnapUI'
import { useIsActive } from '../hooks/useIsActive'
import { useSafeAreaPadding } from '../hooks/useSafeAreaPadding'
import {
  defaultProvider,
  errorText,
  text,
  uploads,
  useSettings,
  useUploads,
} from '../services/snapport'
import { StorageError } from '../storage/StorageProvider'
import { MAX_BYTES, MAX_PENDING } from '../upload/UploadManager'

function LocationFeed({
  onLocation,
}: {
  onLocation: (location: Location | undefined) => void
}) {
  const location = useLocation({ accuracy: 'balanced', distanceFilter: 10 })
  useEffect(() => {
    if (!location.hasPermission)
      void location.requestPermission().catch(() => {})
  }, [location.hasPermission, location.requestPermission])
  useEffect(() => {
    onLocation(location.currentLocation)
    return () => onLocation(undefined)
  }, [onLocation, location.currentLocation])
  return null
}

export function CameraScreen() {
  const navigation = useNavigation()
  const settings = useSettings()
  const tasks = useUploads()
  const isAppActive = useIsActive()
  const isScreenFocused = useIsFocused()
  const safePadding = useSafeAreaPadding()
  const devices = useCameraDevices()
  const [selectedDevice, setSelectedDevice] = useState<CameraDevice>()
  const device =
    devices.find((item) => item.id === selectedDevice?.id) ??
    devices.find((item) => item.position === 'back') ??
    devices[0]
  const [resolutionIndex, setResolutionIndex] = useState(0)
  const [flash, setFlash] = useState<FlashMode>('off')
  const [exposure, setExposure] = useState(0)
  const [hdr, setHDR] = useState(false)
  const [hdrApplied, setHDRApplied] = useState(false)
  const [lowLight, setLowLight] = useState(false)
  const [videoMode, setVideoMode] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const location = useRef<Location | undefined>(undefined)
  const setLocation = useCallback((value: Location | undefined) => {
    location.current = value
  }, [])
  const uiRotation = useAnimatedValue(0, { useNativeDriver: true })
  const microphone = useMicrophonePermission()
  const resolutions = useMemo(
    () =>
      device
        ?.getSupportedResolutions('photo')
        .slice()
        .sort((a, b) => b.width * b.height - a.width * a.height) ?? [],
    [device],
  )
  const resolution: Size = resolutions[resolutionIndex] ??
    resolutions[0] ?? { width: 4096, height: 3072 }
  const photoOutput = usePhotoOutput({
    targetResolution: resolution,
    containerFormat: 'jpeg',
    quality: 1,
    qualityPrioritization: 'quality',
  })
  const videoOutput = useVideoOutput({ enableAudio: microphone.hasPermission })
  const activeRecorder = useRef<Recorder | undefined>(undefined)
  const startingRecording = useRef(false)
  const alive = useRef(true)
  const sessionRunning = useRef(false)
  const cameraActive = useRef(false)
  cameraActive.current = isAppActive && isScreenFocused
  const cancelRecording = useCallback(async () => {
    const recorder = activeRecorder.current
    activeRecorder.current = undefined
    if (recorder) {
      try {
        await recorder.cancelRecording()
      } catch {
      } finally {
        recorder.dispose()
      }
    }
    if (alive.current) setRecording(false)
  }, [])
  const allowedVideo = settings.allowVideo && videoMode
  const target = settings.connections.find(
    (connection) => connection.id === settings.defaultId,
  )
  const full =
    uploads.pending >= MAX_PENDING || uploads.memoryBytes >= MAX_BYTES

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      cameraActive.current = false
      void cancelRecording()
    }
  }, [cancelRecording])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset camera-local settings when the selected device changes.
  useEffect(() => {
    setReady(false)
    setResolutionIndex(0)
    setExposure(0)
    setFlash('off')
    setHDR(false)
    setLowLight(false)
  }, [device?.id])
  useEffect(() => {
    if (!isAppActive || !isScreenFocused) {
      setReady(false)
      void cancelRecording()
    }
    if (isAppActive && VisionCamera.cameraPermissionStatus !== 'authorized')
      navigation.navigate('Permissions')
  }, [isAppActive, isScreenFocused, navigation, cancelRecording])

  const takePhoto = useCallback(async () => {
    const provider = defaultProvider()
    if (!provider) {
      setMessage(
        text(
          '请先配置默认 WebDAV 存储。',
          'Configure a default WebDAV connection first.',
        ),
      )
      return
    }
    if (!ready || !isAppActive || !isScreenFocused) return
    setCapturing(true)
    setMessage('')
    try {
      await captureToQueue(
        () =>
          photoOutput.capturePhoto(
            {
              flashMode: device?.hasFlash ? flash : 'off',
              location: settings.gps ? location.current : undefined,
            },
            {},
          ),
        uploads,
        provider.config,
        provider,
        bridge.randomID(),
      )
      if (alive.current)
        setMessage(
          text(
            '照片已进入内存上传队列。',
            'Photo added to the memory upload queue.',
          ),
        )
    } catch (error) {
      if (alive.current)
        setMessage(
          error instanceof StorageError
            ? errorText(error.code)
            : text('拍照失败，请稍后重试。', 'Capture failed. Please retry.'),
        )
    } finally {
      if (alive.current) setCapturing(false)
    }
  }, [
    photoOutput,
    ready,
    isAppActive,
    isScreenFocused,
    flash,
    device?.hasFlash,
    settings.gps,
  ])

  const startRecording = useCallback(async () => {
    if (
      !allowedVideo ||
      !ready ||
      activeRecorder.current ||
      startingRecording.current
    )
      return
    startingRecording.current = true
    let recorder: Recorder | undefined
    try {
      recorder = await videoOutput.createRecorder({})
      if (!alive.current || !cameraActive.current) {
        recorder.dispose()
        return
      }
      activeRecorder.current = recorder
      setRecording(true)
      await recorder.startRecording(
        (path) => {
          activeRecorder.current = undefined
          recorder?.dispose()
          if (alive.current) {
            setRecording(false)
            navigation.navigate('Video', { videoURL: path })
          }
        },
        () => {
          activeRecorder.current = undefined
          recorder?.dispose()
          if (alive.current) {
            setRecording(false)
            setMessage(text('视频录制失败。', 'Video recording failed.'))
          }
        },
        () => {},
        () => {},
      )
    } catch {
      activeRecorder.current = undefined
      recorder?.dispose()
      if (alive.current) {
        setRecording(false)
        setMessage(text('无法开始录制。', 'Cannot start recording.'))
      }
    } finally {
      startingRecording.current = false
    }
  }, [allowedVideo, ready, videoOutput, navigation])
  const stopRecording = useCallback(async () => {
    await activeRecorder.current?.stopRecording()
  }, [])
  const changeDevice = (next: CameraDevice) => {
    if (!recording && !capturing) {
      setReady(false)
      setSelectedDevice(next)
    }
  }
  const busy = capturing || recording

  if (!device)
    return (
      <View style={[styles.container, safePadding]}>
        <Text style={ui.text}>
          {text('没有可用摄像头。', 'No camera available.')}
        </Text>
        <Action
          label={text('存储管理', 'Storage')}
          onPress={() => navigation.navigate('StorageSettings')}
        />
      </View>
    )
  return (
    <View style={[styles.container, safePadding]}>
      <StatusBar barStyle="light-content" />
      {settings.gps && isAppActive && isScreenFocused && (
        <LocationFeed onLocation={setLocation} />
      )}
      <CameraView
        isActive={isAppActive && isScreenFocused}
        device={device}
        outputs={allowedVideo ? [videoOutput] : [photoOutput]}
        mirrorMode={device.position === 'front' ? 'on' : 'off'}
        orientationSource="device"
        exposure={device.supportsExposureBias ? exposure : undefined}
        enableLowLightBoost={
          device.supportsLowLightBoost ? lowLight : undefined
        }
        constraints={
          allowedVideo
            ? []
            : [
                { resolutionBias: photoOutput },
                ...(device.supportsPhotoHDR && hdr ? [{ photoHDR: true }] : []),
              ]
        }
        onConfigured={() => {
          if (sessionRunning.current && cameraActive.current) setReady(true)
        }}
        onStarted={() => {
          sessionRunning.current = true
          setReady(cameraActive.current)
        }}
        onStopped={() => {
          sessionRunning.current = false
          setReady(false)
        }}
        onInterruptionEnded={() =>
          setReady(cameraActive.current && sessionRunning.current)
        }
        onUIRotationChanged={(rotation) =>
          Animated.spring(uiRotation, {
            toValue: rotation,
            useNativeDriver: true,
          }).start()
        }
        onSessionConfigSelected={(config) =>
          setHDRApplied(config.isPhotoHDREnabled)
        }
        onInterruptionStarted={() => {
          setReady(false)
          setMessage(
            text('相机被系统中断。', 'Camera interrupted by the system.'),
          )
        }}
        onError={() => {
          setReady(false)
          setMessage(
            text(
              '相机配置失败，请切换摄像头或关闭高级功能。',
              'Camera configuration failed. Switch camera or disable advanced features.',
            ),
          )
        }}
      />
      <FullOverlay style={safePadding} pointerEvents="box-none">
        <View
          style={[
            ui.row,
            { justifyContent: 'space-between', paddingHorizontal: 12 },
          ]}
        >
          <Text style={styles.brand}>SnapPort</Text>
          <View pointerEvents={busy ? 'none' : 'auto'}>
            <CameraSelectorButton
              uiRotation={uiRotation}
              devices={devices}
              setDevice={changeDevice}
            />
          </View>
        </View>
        <ScrollView
          horizontal
          style={{ flexGrow: 0, maxHeight: 64 }}
          contentContainerStyle={{
            alignItems: 'center',
            paddingHorizontal: 12,
            gap: 8,
          }}
        >
          {device.hasFlash && !allowedVideo && (
            <Action
              label={`${text('闪光', 'Flash')} ${flash}`}
              disabled={busy}
              onPress={() =>
                setFlash(
                  flash === 'off' ? 'auto' : flash === 'auto' ? 'on' : 'off',
                )
              }
            />
          )}
          {!allowedVideo && resolutions.length > 0 && (
            <Action
              label={`${resolution.width}×${resolution.height}`}
              disabled={busy}
              onPress={() => {
                setReady(false)
                setResolutionIndex((resolutionIndex + 1) % resolutions.length)
              }}
            />
          )}
          {device.supportsPhotoHDR && !allowedVideo && (
            <Action
              label={`HDR ${hdrApplied ? '✓' : hdr ? text('请求中', 'requested') : text('关闭', 'off')}`}
              disabled={busy}
              onPress={() => setHDR(!hdr)}
            />
          )}
          {device.supportsLowLightBoost && (
            <Action
              label={`${text('弱光增强', 'Low light')} ${lowLight ? '✓' : '○'}`}
              disabled={busy}
              onPress={() => setLowLight(!lowLight)}
            />
          )}
          {device.supportsExposureBias && (
            <>
              <Action
                label={`EV − (${exposure.toFixed(1)})`}
                disabled={busy}
                onPress={() =>
                  setExposure(Math.max(device.minExposureBias, exposure - 0.5))
                }
              />
              <Action
                label="EV +"
                disabled={busy}
                onPress={() =>
                  setExposure(Math.min(device.maxExposureBias, exposure + 0.5))
                }
              />
            </>
          )}
        </ScrollView>
        <View style={{ flex: 1 }} pointerEvents="none" />
        <View style={styles.feedback}>
          <Text style={styles.info}>
            {allowedVideo
              ? text('视频 · 本地临时文件', 'Video · local temporary files')
              : text(
                  '照片 · 内存直传 · 最高质量',
                  'Photo · memory upload · maximum quality',
                )}
          </Text>
          <Text style={styles.info}>
            {target?.name ?? text('尚未配置存储', 'Storage not configured')} ·{' '}
            {
              tasks.filter(
                (task) =>
                  task.state === 'waiting' || task.state === 'uploading',
              ).length
            }{' '}
            {text('待上传', 'pending')}
          </Text>
          {!!message && (
            <Text accessibilityLiveRegion="polite" style={styles.info}>
              {message}
            </Text>
          )}
          {full && (
            <Text style={styles.warning}>
              {text(
                '内存队列已满，请重试或放弃失败照片。',
                'Queue full. Retry or discard failed photos.',
              )}
            </Text>
          )}
          {recording && (
            <Text style={styles.warning}>
              {text('正在录像…松开结束', 'Recording…release to finish')}
            </Text>
          )}
        </View>
        {settings.allowVideo && (
          <View
            style={[ui.row, { justifyContent: 'center', marginBottom: 12 }]}
          >
            <Action
              label={
                allowedVideo
                  ? text('切换到照片', 'Switch to photo')
                  : text('切换到视频', 'Switch to video')
              }
              disabled={busy}
              onPress={() => {
                setReady(false)
                setVideoMode(!videoMode)
                if (!videoMode && !microphone.hasPermission)
                  void microphone.requestPermission()
              }}
            />
          </View>
        )}
        <View style={styles.shutter}>
          <CaptureButton
            takePhoto={takePhoto}
            startRecording={startRecording}
            stopRecording={stopRecording}
            mode={allowedVideo ? 'video' : 'photo'}
            disabled={
              !ready ||
              capturing ||
              (!allowedVideo && (full || !target || !settings.loaded))
            }
          />
        </View>
        <View style={styles.navigation}>
          <Action
            label={text('云端相册', 'Gallery')}
            disabled={busy}
            onPress={() => navigation.navigate('Gallery')}
          />
          <Action
            label={text('上传', 'Uploads')}
            disabled={busy}
            onPress={() => navigation.navigate('Uploads')}
          />
          <Action
            label={text('存储', 'Storage')}
            disabled={busy}
            onPress={() => navigation.navigate('StorageSettings')}
          />
          <Action
            label={text('设置', 'Settings')}
            disabled={busy}
            onPress={() => navigation.navigate('AppSettings')}
          />
        </View>
      </FullOverlay>
    </View>
  )
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  brand: { color: palette.ink, fontSize: 24, fontWeight: '600' },
  info: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  warning: { color: palette.error, textAlign: 'center', fontSize: 14 },
  feedback: { padding: 12, gap: 4, backgroundColor: '#101317CC' },
  shutter: { alignItems: 'center', paddingVertical: 16 },
  navigation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
})

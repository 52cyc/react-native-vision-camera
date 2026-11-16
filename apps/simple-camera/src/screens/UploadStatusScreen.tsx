import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { Action, Page, ui } from '../components/SnapUI'
import {
  errorText,
  text,
  uploads,
  useSettings,
  useUploads,
} from '../services/snapport'
import { MAX_ATTEMPTS, MAX_BYTES, MAX_PENDING } from '../upload/UploadManager'

export function UploadStatusScreen() {
  useSettings()
  const tasks = useUploads()
  const [, tick] = useState(0)
  const [message, setMessage] = useState('')
  // Retry availability changes with time; the manager remains the authority.
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const labels = {
    waiting: text('等待上传', 'Waiting'),
    uploading: text('正在上传', 'Uploading'),
    success: text('上传成功', 'Uploaded'),
    failed: text('上传失败', 'Failed'),
  }
  return (
    <Page title={text('上传状态', 'Upload status')}>
      <Text style={ui.note}>
        {text(
          `仅保留在内存中：最多 ${MAX_PENDING} 张 / ${MAX_BYTES / 1024 / 1024} MiB。退出应用会丢失未上传照片。`,
          `Memory only: at most ${MAX_PENDING} photos / ${MAX_BYTES / 1024 / 1024} MiB. Unsent photos are lost when the app exits.`,
        )}
      </Text>
      {!tasks.length && (
        <Text style={ui.text}>
          {text(
            '还没有拍摄照片。配置存储后即可开始。',
            'No captures yet. Configure storage to get started.',
          )}
        </Text>
      )}
      {tasks
        .slice()
        .reverse()
        .map((task) => (
          <View key={task.id} style={ui.section}>
            <Text style={ui.text}>
              {labels[task.state]}
              {task.state === 'uploading' && task.progress !== undefined
                ? ` · ${Math.round(task.progress * 100)}%`
                : ''}
            </Text>
            <Text style={ui.note}>
              {task.targetName}
              {'\n'}
              {task.path}
              {'\n'}
              {(task.bytes / 1024 / 1024).toFixed(1)} MiB · {task.attempts}/
              {MAX_ATTEMPTS}
            </Text>
            {task.error && (
              <Text style={ui.error}>{errorText(task.error)}</Text>
            )}
            {task.state === 'uploading' && task.progress === 1 && (
              <Text style={ui.note}>
                {text(
                  '字节已发送，等待服务器确认。',
                  'Bytes sent. Waiting for server confirmation.',
                )}
              </Text>
            )}
            <View style={ui.row}>
              {task.state === 'failed' && (
                <Action
                  label={text('手动重试', 'Retry')}
                  disabled={task.attempts >= MAX_ATTEMPTS}
                  onPress={() => {
                    setMessage(
                      uploads.retry(task.id)
                        ? ''
                        : text(
                            '请等待退避时间结束后重试（最多 30 秒）。',
                            'Wait for the retry delay (at most 30 seconds).',
                          ),
                    )
                  }}
                />
              )}
              {task.state !== 'uploading' && (
                <Action
                  label={
                    task.state === 'success'
                      ? text('移除记录', 'Clear record')
                      : text('放弃并释放内存', 'Discard and release memory')
                  }
                  onPress={() => {
                    uploads.discard(task.id)
                  }}
                />
              )}
            </View>
          </View>
        ))}
      {!!message && <Text style={ui.note}>{message}</Text>}
    </Page>
  )
}

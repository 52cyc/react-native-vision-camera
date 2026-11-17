# SnapPort 架构与内存上传链路

SnapPort 在 `apps/simple-camera` 中实现相机到 HTTPS WebDAV 的内存照片上传。
当前源码已实现完整业务链路；2026-11-17 已完成 iOS 原生编译、真机安装和界面启动。Android 原生编译、真实相机与真实 WebDAV 的端到端验证尚未完成，不能将 Mock 测试或界面启动视为完整真机验收。

## 组成与职责

| 位置 | 职责 |
|---|---|
| `src/screens/CameraScreen.tsx` | 复用相机预览、摄像头选择、快门、录像和对焦组件，显示能力受限的相机控制 |
| `src/cameraCapture.ts` | 拍照占位、读取编码数据、检查格式、生成远端路径、始终释放 Photo |
| `src/upload/UploadManager.ts` | 仅内存队列、串行上传、字节进度、失败保留、有限手动重试、主动放弃 |
| `src/storage/StorageProvider.ts` | 存储适配器、可选能力、连接／上传／文件类型、统一错误 |
| `src/storage/WebDAVProvider.ts` | URL 编码、UTF-8 Basic、MKCOL／PROPFIND／PUT／GET／DELETE、条件创建和重试核对 |
| `src/services/transport.ts` | 原生模块的网络适配和安全错误映射，拒绝后台新请求 |
| `src/services/snapport.ts` | 设备安全存储、连接及默认目标、语言和应用设置、订阅界面状态 |
| `native/` | 独立的应用内 Nitro workspace，接收 ArrayBuffer、HTTPS 请求、进度和安全存储；不修改 VisionCamera SDK |
| `src/screens/GalleryScreen.tsx` | DAV 目录浏览、刷新、日期排序、只在内存中解码和预览 |

未增加后端、全局状态框架或未实现的 S3 空壳。原 SDK 包源码、发布版本及 MIT 协议保持原样；应用展示名改为 SnapPort，iOS 开发团队与 Bundle Identifier 使用本机可签名配置。

## 拍照到上传

1. 检查相机已启动、处于前台、存在默认 WebDAV 连接；同步取得队列拍照占位。
2. `usePhotoOutput()` 配置 `containerFormat: 'jpeg'`、`quality: 1`、`qualityPrioritization: 'quality'`，默认选择设备报告的最大照片分辨率。
3. `capturePhoto(settings, {})` 返回 Photo，调用 `getFileDataAsync()` 取得编码 JPEG 和 SDK 提供的 EXIF。
4. 捕获时固定连接和文件路径，将 ArrayBuffer 交给队列。此后更换默认连接不会改变已有任务的目标。同一连接且 DAV 地址完全相同时，重试允许读取修正后的账号密码。
5. 在 `try/finally` 中 `photo.dispose()`，释放原生 Photo；队列保留独立编码数据以支持失败重试。它不需要继续持有 Photo。
6. 原生 transport 发送同一份编码数据，不再缩放、重编码、构建文件 URI、Blob 或 Base64 图片。
7. 收到 HTTP 201 才把新上传标记为成功；删除任务的数据引用。失败保留字节；用户放弃时删除引用，剩余内存由运行时回收。

照片路径没有调用 `capturePhotoToFile`、`saveToFileAsync`、`saveToTemporaryFileAsync` 或相册写入接口。Android 内存 RAW／非 JPEG API 存在上游限制，因此当前只拍 JPEG，遇到意外容器直接报错，绝不降级到文件方案。JPEG 是相机原生编码；“不压缩”指不进行上传前的额外有损重编码，并非声称 JPEG 无损。

分辨率属于 SDK 的协商目标，实际分辨率仍由设备和输出组合决定。用户可以循环选择设备提供的分辨率；默认优先最大值。质量固定最高值，不提供降低质量的开关。HDR 显示最终会话是否实际启用；低光增强仅在设备声明支持时出现，不把它冒充完整厂商夜景模式。多摄像头设备由原生设备选择器提供；未新增同时多摄采集工作流。

## 内存预算与生命周期

- 最多 3 个未完成照片任务，编码数据合计最多 64 MiB；最多 1 次拍照读取、1 个串行上传。
- 无法预知下一张 JPEG 的大小。超过预算时照片会被明确拒绝、Photo 被释放，界面提示失败。拍照过程中仍可能短暂存在原生照片和编码数据副本。
- **64 MiB 是队列编码数据上限，不是应用 RSS 上限。** 相机缓冲区、原生网络持有的数据及预览解码另有开销，必须在低内存真机上测量峰值。
- 成功只保留最多 30 条元信息。失败最多尝试 4 次，手动重试使用指数退避（1、2、4 秒，通用上限 30 秒），保留原文件名；重试满额仍可放弃以释放内存。
- 切后台暂停队列并取消原生请求，前台只继续尚未开始的任务；已失败任务由用户重试。不承诺后台上传完成。
- 应用退出、系统杀进程、开发刷新会丢失未上传照片。没有恢复数据库、离线文件或后台持久化任务。
- `Photo.dispose()` 是显式资源释放；ArrayBuffer 在无引用后由运行时释放。系统自身的内存管理、厂商相机内部行为需要真机审计，不能仅靠代码或 Mock 证明物理设备从未发生任何磁盘活动。

## WebDAV 的接入与成功语义

连接包含服务的**完整、最终 HTTPS WebDAV 基地址**、用户名／密码（可用应用密码）、上传目录、日期分类和文件命名策略。

默认路径为 `/SnapPort/YYYY/MM/DD/IMG_yyyyMMdd_HHmmss_SSS_UUID.jpg`；UUID 来自系统随机 UUID，重试不重新命名。
上传目录相对于配置的 DAV 基地址，不是相对于服务器域名根路径。URL 各段独立编码，支持中文、空格、`#`、`?` 等字符。

| 操作 | 行为 |
|---|---|
| 测试连接 | 创建／确认配置目录，再执行 PROPFIND。成功说明目录可访问，最终 PUT 权限仍在上传时验证 |
| 创建目录 | 逐级 MKCOL，接受 201；405 时用 Depth 0 PROPFIND 确认真的是已存在目录 |
| 上传 | 二进制 PUT，`Content-Type: image/jpeg`、`If-None-Match: *`；接受新建 201 |
| 文件列表 | Depth 1 PROPFIND，解析 207 的成功 propstat，拒绝 DTD／实体声明和越出 DAV 基地址的 href |
| 重试核对 | 对固定文件名 GET；若字节完全相同，认为上次已提交。不同则报告冲突，404 才尝试新 PUT |
| 删除 | Provider 提供 DELETE，但当前相册 UI 不提供远端删除按钮，避免误删 |

服务器必须遵守 DAV 和 HTTP 条件请求；不支持条件创建的服务不属于严格防覆盖模式的已验证兼容范围。收到 204 不会假报新文件上传成功。无法从客户端保证一个故意忽略条件头、谎报状态的服务器永不覆盖，因此需要真实服务的冲突验收。

支持 **Basic over HTTPS**，没有实现 Digest、交互式 OAuth 或私有 NAS 登录协议；这些服务应提供 WebDAV 应用密码。重定向一律拒绝，避免转发凭证和重复 PUT；请配置最终地址。401、403、507、408／504、412、网络／TLS 等错误有可理解的提示。始终使用系统证书校验，自签名证书需由设备信任其 CA，不提供跳过验证开关。

原生响应体上限 32 MiB。因此大于 32 MiB 的已提交照片发生“确认丢失”时，可能不能自动完成字节核对，需要人工核实后放弃该任务。它不会改名上传另一个副本。

## 原生传输与凭证

- iOS：前台 `URLSession.dataTask`，HTTP body 来自 ArrayBuffer 的 Data；ephemeral configuration，URLCache／cookie／credential storage 为空，禁用重定向，响应累积只在内存中。
- Android：OkHttp 的自定义 RequestBody 分块读取 ArrayBuffer，显式 Content-Length；无磁盘 Cache、自动请求重试和重定向，保留系统 TLS 校验。总请求 90 秒、连接 15 秒、读写空闲 30 秒。
- 两端通过 Nitro 传递 ArrayBuffer，不经过 React Native 的文件上传或图片网络加载器。生成的桥接文件随源码交付。
- iOS 凭证保存在 Keychain，`WhenUnlockedThisDeviceOnly`。
- Android 使用 Android Keystore 中的 AES 密钥，以 AES-GCM 加密连接配置后存入私有 SharedPreferences；普通文件内只有密文和随机 IV，禁用应用备份。
- Base64 仅用于 Basic 认证头及 Android 密文表示，不用于照片传输。密码不放入 URL、日志或测试真实配置中。

## 云端相册和本地文件边界

相册逐级浏览默认存储的目录，不递归拉取全部相册。SnapPort 时间戳文件名优先按拍摄时间排序，其他文件用服务端修改时间回退；UUID 命名无法从文件名还原完整拍摄时间。日期目录可手动进入；支持下拉刷新、空数据和错误提示。

标准 WebDAV 没有通用缩略图端点，所以当前显示文件列表。点击照片后通过无缓存原生 GET 取得字节，Skia 直接解码到内存显示，关闭／离开后释放图像；不使用远端 URL 的系统 Image 缓存。预览最多 32 MiB 编码数据和 8000 万像素；也可能受平台解码器格式限制。没有承诺对所有 HEIC／RAW 格式提供预览。

视频默认关闭。启用后切换视频模式、长按录制，沿用 SDK 本地临时视频与原视频播放页；它不上传 WebDAV，也不属于无本地文件承诺。取消录制调用 SDK cancelRecording 删除未完成的视频。已完成视频临时文件的清理策略仍需后续完善。

## 扩展其他存储

新增 Provider 时实现 `StorageProvider` 的 `testConnection`、`upload`、`getCapabilities`，按需实现列表、预览、目录和删除方法；扩充连接配置的可辨识类型，再接入设置页和 provider 工厂。相机与队列不应出现 WebDAV 请求代码。

S3／MinIO／R2 下一步需要条件写入、签名、会话／临时凭证和列表分页。长期管理员密钥不应硬编码到客户端；优先由受控服务签发限权、限时凭证或预签名 URL。OSS／COS 采用同样边界；Drive／OneDrive 等需要各自合规 OAuth 和 API。当前未提供这些后端的可用上传入口。

## API 核实依据

本次核实本地 `packages/react-native-vision-camera/src/hooks/usePhotoOutput.ts`、`specs/outputs/CameraPhotoOutput.nitro.ts`、`specs/instances/Photo.nitro.ts`，以及对应 iOS／Android 原生实现；没有套用 V4 的文件式 `takePhoto()`。

参考：[Photo output](https://visioncamera.margelo.com/docs/photo-output)、[A Photo](https://visioncamera.margelo.com/docs/a-photo)。在线文档仅为补充，当前分支源码是实际签名依据。

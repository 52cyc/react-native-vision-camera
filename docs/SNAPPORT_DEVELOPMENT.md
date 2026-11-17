# 开发和验证 SnapPort

当前在 `SnapPort-Camera` 分支开发，基于 VisionCamera 5.2.4，业务代码在 `apps/simple-camera`。
**2026-11-17 已完成 iOS 真机编译、安装与启动，用户确认看到 SnapPort 界面。** Android 安装包、真实拍照上传与真实 WebDAV 尚未完成验证。TypeScript、协议与队列测试及两个平台的 JavaScript 打包结果见下文。

## 准备环境

| 项目 | 仓库配置／本机情况 |
|---|---|
| Bun | 仓库声明 1.3.14，本机 1.3.5 完成安装与脚本执行；未擅自升级 |
| Node | App 要求 Node >=20 |
| React Native／React／TypeScript | 0.85.3／19.2.3／6.0.3，保持原版本 |
| Android | JDK 21；项目 compile／target 36、min 26、Build Tools 36.1.0、NDK 29.0.14206865 |
| iOS | Xcode；项目部署目标 15.5；本地 RN 0.85 helpers 声明最低 15.1 |
| Ruby／CocoaPods | Gemfile 要求 Ruby >=3.4.9，锁文件 Bundler 4.0.13，CocoaPods >=1.16.2 且 <1.17 |

在仓库根目录执行：

```sh
bun install --frozen-lockfile
bun run build
bun example native:specs
```

`build` 编译 SDK 的 TypeScript 输出，不是原生安装包构建。Nitrogen 版本复用仓库的 0.37.0。新增的 `snapport-native` 是 workspace，源码应直接从 `apps/simple-camera/native` 自动链接；勿把它复制到 SDK 的 `packages/`。

新增依赖仅为：用于 DAV XML 的 `fast-xml-parser`、补齐 React Native URL 解析的 `react-native-url-polyfill`、本地 `snapport-native`。原生传输使用 OkHttp（Android）和系统 URLSession（iOS），安全存储不依赖重量级第三方库。

## Android 真机运行

1. 在 Android Studio 中安装上述 SDK、Build Tools 和 NDK，配置 `ANDROID_HOME` 或 `apps/simple-camera/android/local.properties` 中的 `sdk.dir`，勿提交个人路径。
2. 手机开启开发者选项及 USB 调试，连接后通过 `adb devices` 确认授权。
3. 在仓库根目录运行 Metro：

```sh
bun example start
```

另一个终端在仓库根目录运行：

```sh
adb reverse tcp:8081 tcp:8081
bun example android
```

独立检查 APK 编译：

```sh
cd apps/simple-camera/android
./gradlew assembleDebug --no-daemon --console=plain
```

成功后默认调试 APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。目前没有验证成功的 APK 可供安装。

## iPhone 真机运行

本机使用 Homebrew 的 Ruby 3.4（不修改系统 Ruby）。在仓库根目录执行：

```sh
export PATH="/opt/homebrew/opt/ruby@3.4/bin:/opt/homebrew/lib/ruby/gems/3.4.0/bin:$PATH"
cd apps/simple-camera
bundle install
cd ios
ENTERPRISE_REPOSITORY=https://repo.maven.apache.org/maven2 bundle exec pod install
```

随后打开 `apps/simple-camera/ios/SimpleCamera.xcworkspace`，选择 `SimpleCamera` scheme 和已连接 iPhone，在 Signing 中配置自己的开发团队与可用 Bundle Identifier。界面名称为 SnapPort，工程名／模块注册名暂时沿用 SimpleCamera，以降低改造范围。

在仓库根目录运行 `bun example start`，保证 iPhone 可以访问开发机的 Metro；Xcode 选择设备后 Run。若使用局域网 NAS，允许本地网络访问。模拟器可以验证页面和链接，但不能代替真实摄像头、硬件能力与内存审计。

无签名模拟器编译命令：

```sh
cd apps/simple-camera
xcodebuild -workspace ios/SimpleCamera.xcworkspace -scheme SimpleCamera \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath /tmp/snapport-ios-build CODE_SIGNING_ALLOWED=NO build
```

本机已安装 Pods。Podfile 将低于 15.5 的依赖部署目标统一至 15.5；RN 补丁处理中文目录的文件 URL 与 Hermes 路径编码。iOS 启动入口使用 SceneDelegate，兼容当前手机的 iOS 27。开发者模式和首次开发证书信任需在 iPhone 上确认。

## 配置真实 WebDAV

在“存储”页面添加连接，填写：

- 连接名称。
- 最终 HTTPS WebDAV 地址，包含服务要求的基路径。Nextcloud 通常是 `https://你的域名/remote.php/dav/files/你的用户/`；NAS 的路径和端口以管理端实际显示为准，不假定飞牛／群晖通用地址。
- 用户名、密码或应用密码。当前支持 Basic over HTTPS；不支持要求交互登录或仅 Digest 的端点。
- 上传目录，默认 `/SnapPort`。目录相对于 DAV 基地址。
- 日期分类、时间戳加 UUID 或纯 UUID 文件名。

点击“测试连接”确认目录可访问，再“安全保存”并设为默认。测试会创建／确认配置目录，不会制造模拟照片或把 Mock 结果写成真实上传成功。

回到相机，允许相机权限，等快门可用后拍照；在“上传”页面观察进度与服务端确认。100% 字节进度不等于上传成功，只有成功状态代表确认完毕。请到服务端检查照片大小、分辨率、EXIF 与文件名。

服务端需允许 MKCOL／PROPFIND／PUT／GET，并遵守 `If-None-Match: *`；拒绝重定向。遇到证书错误应安装有效证书／信任的 CA，绝不关闭证书验证。

## 执行检查

在仓库根目录：

```sh
bun run build
bun example native:specs
bun example typecheck
bun example typecheck:snapport-tests
bun example test:snapport
bunx --no-install biome check apps/simple-camera/src apps/simple-camera/native/src \
  apps/simple-camera/snapport-tests apps/simple-camera/package.json \
  apps/simple-camera/tsconfig.json apps/simple-camera/tsconfig.snapport-tests.json
```

开发 Mock 位于 `apps/simple-camera/snapport-tests/storage.test.ts`：

- 真正执行 WebDAVProvider、UploadManager 和 captureToQueue。
- 在协议测试中注入 transport，覆盖状态码、编码、已有目录确认、XML、冲突核对。
- 启动独立 loopback HTTP DAV 服务，接收真实二进制 PUT，模拟服务端提交后断开 socket，再验证 GET 核对恢复且不重复创建。
- **只有测试 transport** 把测试 HTTPS 域名映射到 loopback HTTP；App 无此开关，也没有跳过 TLS 证书校验的配置。
- 用合成字节和 mock Photo 验证资源释放、内存预算和重试；不是实际相机 JPEG／原生网络模块的端到端测试。

Android／iOS JavaScript 打包命令（从 `apps/simple-camera` 执行）：

```sh
bunx --no-install react-native bundle --platform android --dev false \
  --entry-file index.js --bundle-output /tmp/snapport-android.jsbundle \
  --assets-dest /tmp/snapport-android-assets --max-workers 2
bunx --no-install react-native bundle --platform ios --dev false \
  --entry-file index.js --bundle-output /tmp/snapport-ios.jsbundle \
  --assets-dest /tmp/snapport-ios-assets --max-workers 2
```

## 本次实际验证记录

2026-11-16：

| 检查 | 结果与边界 |
|---|---|
| 分支／Git 初始状态 | `SnapPort-Camera`，开始时工作区干净；未切分支、提交或 Push |
| 初始依赖安装 | `bun install --frozen-lockfile` 成功；新增依赖后用 `bun install` 更新锁文件，未升级已有 RN／Bun |
| SDK TypeScript 构建 | `bun run build` 成功，六个原有包；没有改 SDK 源码 |
| Nitro 桥接生成 | `bun example native:specs` 成功，生成 iOS／Android／C++ 桥接 |
| App／测试类型检查 | 两个独立的 TypeScript 检查均通过 |
| Lint／格式 | Biome 检查应用业务代码、原生 TS spec、测试和配置；结果通过；生成的桥接代码不手工格式化 |
| WebDAV／队列 Mock | 27 项通过、0 失败，79 次断言；包含真实 loopback HTTP 交互，未覆盖原生网络实机 |
| 自动链接配置 | RN CLI 成功识别 SnapPortNative 的 podspec 和 Android Package |
| Android／iOS Metro | 两个平台均成功写出 JS bundle 和资源；不等于原生 App 编译成功 |
| Swift 语法 | `xcrun swiftc -frontend -parse .../HybridSnapPortBridge.swift` 成功；未完成 SDK 类型链接／原生编译。系统 swift-format 与仓库配置格式不兼容，改用工具默认格式检查本次手写 Swift 文件，通过 |
| Android 原生构建 | 已执行 Gradle；Maven 下载 `org.ow2.asm:asm-util:9.7.1` 时 TLS 握手失败。尚未进入本次原生实现的编译；默认 Android SDK 路径也不存在 |
| iOS 依赖与构建 | `bundle install` 因系统 Ruby 2.6 缺少锁定 Bundler 4.0.13 而失败；xcodebuild 因缺少 Pods xcconfig／xcfilelist 失败，未进入本次原生实现的编译 |
| 真实设备／真实服务器 | 未执行，未提供凭证，不声称已通过 |

开始时示例直接运行 tsc 曾因 SDK 的 `lib/` 尚未生成而找不到本地包；运行仓库现有 `bun run build` 后解决。原始示例声明了 READ／WRITE_EXTERNAL_STORAGE 并主动申请 GPS；照片不需要这些文件权限，已移除；GPS 改为显式设置开启后才挂载定位监听。

## iPhone 启动验证（2026-11-17）

- 使用 Xcode 27.2、Ruby 3.4.12 和已安装的 Pods 构建 Debug 版本；签名校验通过。
- 已安装到 iPhone 13 Pro Max（iOS 27.2），用户完成开发者信任后，确认看到 SnapPort 界面。
- 根据设备崩溃日志，将旧 AppDelegate 窗口启动迁移至 SceneDelegate，解决 iOS 27 的启动闪退。
- 本机持续构建目录：`~/Library/Developer/Xcode/DerivedData/SnapPort-device`；构建与启动日志：`~/Library/Logs/SnapPort`。
- 本机开发团队与 Bundle Identifier 已配置；其他开发者应替换为自己的签名配置。
- 当前只验证安装和界面启动，未验证真实拍照上传、WebDAV 服务、无照片文件落盘或内存峰值。

## 真机验收清单

1. **文件审计**：关闭视频，在 Android Studio Device Explorer／Xcode 容器中记录 App files、cache、tmp 及系统相册变化，连续拍照／失败重试／预览；除加密配置外不应出现新增照片文件。需要时监测原生文件写入调用。不能仅凭“相册没有照片”判断合格。
2. **资源审计**：用 Android Memory Profiler／Xcode Instruments 连拍高分辨率，包含失败、放弃和重试；确认 Photo 及时释放、待传最多 3 张、成功／放弃后内存能够回收。记录总 RSS 峰值，特别是 48MP／更高像素设备。
3. **协议验证**：在真实服务检查 PUT 请求体、Content-Type、条件头与 201；制造同路径不同文件，必须拒绝覆盖；模拟服务器接收完数据后丢失响应，再重试应核对同一文件且不创建副本。
4. **异常验证**：错误应用密码、禁写目录、空间不足、断网／网络切换、证书错误，不得假报成功；恢复后在应用仍存活时手动重试；退出后明确丢失待传数据。
5. **生命周期**：相机进入后台停止；上传取消；回到前台等待相机恢复并手动重试失败任务。权限撤销后回到授权页。测试长按录像时切后台及录制取消。
6. **相机回归**：前后／多镜头切换、点击对焦、原生双指缩放、支持设备的闪光／曝光／HDR／低光增强、最高质量、实际分辨率、横竖屏和安全区域。HDR 必须显示最终协商结果。
7. **凭证与预览**：重启后连接可用；普通配置内找不到明文账号密码；错误信息不带凭证；云端目录刷新与关闭预览后不留下照片文件。关闭视频时不请求麦克风，GPS 关闭时不主动请求定位。

## 已知限制与后续工作

- iOS 已编译并在真机启动；Android 原生编译仍待完成。两端真实相机、WebDAV 上传和内存／文件审计仍需验收，再做正式发布。
- 仅实现 WebDAV Basic，尚无 S3／MinIO／R2／OSS／COS／OAuth 网盘、离线持久化、后台可靠上传或 Go 服务。
- 只提供 JPEG 内存拍照，质量固定最高；没有 RAW／HEIC 拍摄开关、完整厂商夜景模式及同时多摄工作流。
- WebDAV 无通用缩略图；相册为目录列表和内存原图预览，没有递归索引／分页和通用 EXIF 拍摄时间解析。
- 32 MiB 原生响应体上限会限制大图预览及确认丢失后的大图内容核对；不会绕过上限改为文件下载。
- 预览解码和相机缓冲区可能显著大于队列字节预算；需要低内存真机测量，必要时降低可排队数量或增加可配置预算，不能偷偷降低照片质量。
- 视频独立使用临时文件，不上传；完成视频的过期清理尚未新增。开启后不应声称整个应用“完全不产生本地媒体文件”。
- 系统语言在进程启动时读取；应用设置支持中文／英文切换。更改系统语言后可重新打开应用。
- 暂保留原 App 图标、工程／包标识和上游示例的 Photo／Video 页面；发布前补齐独立应用标识、图标、签名和商店资料。

## 本次修改文件清单

共 73 个文件（含本清单和 Nitrogen 生成的桥接文件）；未修改 `packages/` 下 SDK 源码。

```text
README.md
apps/simple-camera/android/app/src/main/AndroidManifest.xml
apps/simple-camera/android/app/src/main/res/values/strings.xml
apps/simple-camera/ios/SimpleCamera/Info.plist
apps/simple-camera/native/SnapPortNative.podspec
apps/simple-camera/native/android/CMakeLists.txt
apps/simple-camera/native/android/build.gradle
apps/simple-camera/native/android/src/main/AndroidManifest.xml
apps/simple-camera/native/android/src/main/cpp/cpp-adapter.cpp
apps/simple-camera/native/android/src/main/java/com/margelo/nitro/snapport/HybridSnapPortBridge.kt
apps/simple-camera/native/android/src/main/java/com/margelo/nitro/snapport/SnapPortNativePackage.kt
apps/simple-camera/native/ios/HybridSnapPortBridge.swift
apps/simple-camera/native/nitro.json
apps/simple-camera/native/nitrogen/generated/.gitattributes
apps/simple-camera/native/nitrogen/generated/android/SnapPortNative+autolinking.cmake
apps/simple-camera/native/nitrogen/generated/android/SnapPortNative+autolinking.gradle
apps/simple-camera/native/nitrogen/generated/android/SnapPortNativeOnLoad.cpp
apps/simple-camera/native/nitrogen/generated/android/SnapPortNativeOnLoad.hpp
apps/simple-camera/native/nitrogen/generated/android/c++/JFunc_void_double_double.hpp
apps/simple-camera/native/nitrogen/generated/android/c++/JHttpResponse.hpp
apps/simple-camera/native/nitrogen/generated/android/c++/JHybridSnapPortBridgeSpec.cpp
apps/simple-camera/native/nitrogen/generated/android/c++/JHybridSnapPortBridgeSpec.hpp
apps/simple-camera/native/nitrogen/generated/android/kotlin/com/margelo/nitro/snapport/Func_void_double_double.kt
apps/simple-camera/native/nitrogen/generated/android/kotlin/com/margelo/nitro/snapport/HttpResponse.kt
apps/simple-camera/native/nitrogen/generated/android/kotlin/com/margelo/nitro/snapport/HybridSnapPortBridgeSpec.kt
apps/simple-camera/native/nitrogen/generated/android/kotlin/com/margelo/nitro/snapport/SnapPortNativeOnLoad.kt
apps/simple-camera/native/nitrogen/generated/ios/SnapPortNative+autolinking.rb
apps/simple-camera/native/nitrogen/generated/ios/SnapPortNative-Swift-Cxx-Bridge.cpp
apps/simple-camera/native/nitrogen/generated/ios/SnapPortNative-Swift-Cxx-Bridge.hpp
apps/simple-camera/native/nitrogen/generated/ios/SnapPortNative-Swift-Cxx-Umbrella.hpp
apps/simple-camera/native/nitrogen/generated/ios/SnapPortNativeAutolinking.mm
apps/simple-camera/native/nitrogen/generated/ios/SnapPortNativeAutolinking.swift
apps/simple-camera/native/nitrogen/generated/ios/c++/HybridSnapPortBridgeSpecSwift.cpp
apps/simple-camera/native/nitrogen/generated/ios/c++/HybridSnapPortBridgeSpecSwift.hpp
apps/simple-camera/native/nitrogen/generated/ios/swift/Func_void.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/Func_void_HttpResponse.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/Func_void_double_double.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/Func_void_std__exception_ptr.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/Func_void_std__string.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/HttpResponse.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/HybridSnapPortBridgeSpec.swift
apps/simple-camera/native/nitrogen/generated/ios/swift/HybridSnapPortBridgeSpec_cxx.swift
apps/simple-camera/native/nitrogen/generated/shared/c++/HttpResponse.hpp
apps/simple-camera/native/nitrogen/generated/shared/c++/HybridSnapPortBridgeSpec.cpp
apps/simple-camera/native/nitrogen/generated/shared/c++/HybridSnapPortBridgeSpec.hpp
apps/simple-camera/native/package.json
apps/simple-camera/native/react-native.config.js
apps/simple-camera/native/src/SnapPortBridge.nitro.ts
apps/simple-camera/native/src/index.ts
apps/simple-camera/package.json
apps/simple-camera/snapport-tests/storage.test.ts
apps/simple-camera/src/App.tsx
apps/simple-camera/src/cameraCapture.ts
apps/simple-camera/src/components/CameraView.tsx
apps/simple-camera/src/components/CaptureButton.tsx
apps/simple-camera/src/components/SnapUI.tsx
apps/simple-camera/src/screens/AppSettingsScreen.tsx
apps/simple-camera/src/screens/CameraScreen.tsx
apps/simple-camera/src/screens/GalleryScreen.tsx
apps/simple-camera/src/screens/PermissionsScreen.tsx
apps/simple-camera/src/screens/StorageSettingsScreen.tsx
apps/simple-camera/src/screens/UploadStatusScreen.tsx
apps/simple-camera/src/services/snapport.ts
apps/simple-camera/src/services/transport.ts
apps/simple-camera/src/storage/StorageProvider.ts
apps/simple-camera/src/storage/WebDAVProvider.ts
apps/simple-camera/src/upload/UploadManager.ts
apps/simple-camera/tsconfig.json
apps/simple-camera/tsconfig.snapport-tests.json
bun.lock
docs/SNAPPORT_ARCHITECTURE.md
docs/SNAPPORT_DEVELOPMENT.md
package.json
```

Pod::Spec.new do |s|
  s.name = 'SnapPortNative'
  s.version = '1.0.0'
  s.summary = 'SnapPort memory-only HTTPS transport and secure credential vault'
  s.homepage = 'https://github.com/52cyc/react-native-vision-camera'
  s.license = 'MIT'
  s.author = 'SnapPort contributors'
  s.platforms = { :ios => min_ios_version_supported }
  s.source = { :git => 'https://github.com/52cyc/react-native-vision-camera.git' }
  s.source_files = ['ios/**/*.{swift,h,m,mm}', 'cpp/**/*.{hpp,cpp}']
  s.frameworks = ['Security', 'Foundation']
  load File.join(__dir__, 'nitrogen/generated/ios/SnapPortNative+autolinking.rb')
  add_nitrogen_files(s)
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end

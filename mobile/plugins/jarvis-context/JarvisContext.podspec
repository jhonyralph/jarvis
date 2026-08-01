Pod::Spec.new do |s|
  s.name = 'JarvisContext'
  s.version = '0.1.0'
  s.summary = 'Minimized native context bridge for Jarvis.'
  s.license = { :type => 'MIT' }
  s.homepage = 'https://github.com/jonathan/jarvis'
  s.author = { 'Jarvis' => 'local@jarvis.invalid' }
  s.source = { :git => 'https://github.com/jonathan/jarvis.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/JarvisContext/**/*.{swift,h,m,c,cc,mm}'
  s.resource_bundles = {
    'JarvisContextPrivacy' => ['ios/Sources/JarvisContext/PrivacyInfo.xcprivacy']
  }
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
  s.frameworks = 'CoreLocation', 'EventKit'
end

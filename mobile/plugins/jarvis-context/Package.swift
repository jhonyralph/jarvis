// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JarvisContext",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "JarvisContext", targets: ["JarvisContext"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "JarvisContext",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/JarvisContext",
            resources: [
                .process("PrivacyInfo.xcprivacy")
            ]
        ),
        .testTarget(
            name: "JarvisContextTests",
            dependencies: ["JarvisContext"],
            path: "ios/Tests/JarvisContextTests"
        )
    ]
)

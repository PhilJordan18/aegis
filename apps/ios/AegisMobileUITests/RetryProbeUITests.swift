import XCTest

/// Throwaway probe of the #67 retry ceiling, on branch 67-ci-ios-retry-probe only; never merged.
final class RetryProbeUITests: XCTestCase {
    private var marker: String {
        let home = ProcessInfo.processInfo.environment["SIMULATOR_HOST_HOME"] ?? NSTemporaryDirectory()
        return (home as NSString).appendingPathComponent("aegis-retry-probe-marker")
    }

    func testFailsOnlyOnItsFirstAttempt() {
        if FileManager.default.fileExists(atPath: marker) { return }
        FileManager.default.createFile(atPath: marker, contents: Data())
        XCTFail("probe: the first attempt fails on purpose")
    }

    func testFailsOnEveryAttempt() {
        XCTFail("probe: every attempt fails on purpose")
    }
}

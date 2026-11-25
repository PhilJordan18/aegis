import XCTest

extension XCTestCase {
    /// The launch arguments that set the default text size, unless
    /// `arguments` already set one. A test written for the default size says
    /// so: the simulator's own setting must not silently change what it
    /// checks (#211). The largest-size tests pass their own size.
    static func textSize(_ arguments: [String]) -> [String] {
        arguments.contains("-UIPreferredContentSizeCategoryName")
            ? [] : ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    }
}

import XCTest

extension XCUIApplication {
    /// Waits until no element appears, disappears, moves or changes its text
    /// across three snapshots about a second apart in all. An accessibility
    /// audit taken earlier samples a screen still in transition (a list
    /// filling in after launch, a refresh collapsing) and reports text it
    /// cannot match to an element, or sizes caught mid-animation.
    @MainActor
    func waitForStillScreen(timeout: TimeInterval = 10) -> Bool {
        let deadline = Date.now + timeout
        var last: [String]?
        var stillFor = 0
        while Date.now < deadline {
            let current = (try? snapshot()).map(Self.signature) ?? []
            stillFor = current == last ? stillFor + 1 : 0
            if stillFor >= 2 { return true }
            last = current
            Thread.sleep(forTimeInterval: 0.4)
        }
        return false
    }

    private static func signature(_ root: any XCUIElementSnapshot) -> [String] {
        var lines: [String] = []
        var pending: [any XCUIElementSnapshot] = [root]
        while let element = pending.popLast() {
            lines.append("\(element.elementType.rawValue)|\(element.identifier)|\(element.label)|\(element.frame)")
            pending.append(contentsOf: element.children)
        }
        return lines
    }
}

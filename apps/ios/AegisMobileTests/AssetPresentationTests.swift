import Foundation
import Testing
@testable import AegisMobile

/// Presentation of server-evaluated readiness (`sections.md` §1.2, §1.3).
/// Nothing here may turn a non-ready asset into a ready one.
struct AssetPresentationTests {
    @Test(arguments: [
        ("READY", [String](), "AVAILABLE", AssetStatus.ready),
        ("READY", [], "RESERVED", .ready),
        ("UNKNOWN", ["UNKNOWN_PHYSICAL_STATE"], "AVAILABLE", .needsChecking),
        ("BLOCKED", ["CALIBRATION_EXPIRED"], "AVAILABLE", .blocked),
        ("BLOCKED", ["NOT_AVAILABLE"], "RESERVED", .alreadyReserved),
        ("BLOCKED", ["NOT_AVAILABLE"], "UNAVAILABLE", .unavailable),
        ("BLOCKED", ["NOT_AVAILABLE"], "BORROWED", .borrowed),
        ("BLOCKED", ["NOT_AVAILABLE"], "IN_TRANSIT", .blocked),
        ("SOMETHING_NEW", [], "AVAILABLE", .unrecognized),
    ])
    func mapsTheServerStatus(_ result: String, _ reasons: [String], _ availability: String, _ expected: AssetStatus) {
        let asset = CatalogFixtures.asset(result: result, reasons: reasons, availability: availability)
        #expect(AssetStatus(asset) == expected)
    }

    /// §1.2 defensive rule: whatever readiness says, a borrowed asset is not "Prêt".
    @Test(arguments: ["READY", "UNKNOWN", "BLOCKED", "SOMETHING_NEW"])
    func neverShowsABorrowedAssetAsReady(_ result: String) {
        let asset = CatalogFixtures.asset(result: result, availability: "BORROWED")
        #expect(AssetStatus(asset) == .borrowed)
        #expect(AssetStatus(asset).tone == .neutral)
    }

    @Test func neverShowsAnUnrecognizedResultAsReady() {
        let status = AssetStatus(CatalogFixtures.asset(result: "READY_SOON"))
        #expect(status == .unrecognized)
        #expect(status.tone == .neutral)
        #expect(status.symbol != AssetStatus.ready.symbol)
    }

    @Test func everyStatusHasASymbolAndAText() {
        let all: [AssetStatus] = [.ready, .blocked, .needsChecking, .borrowed, .alreadyReserved, .unavailable, .unrecognized]
        #expect(Set(all.map(\.symbol)).count == all.count)
        #expect(all.allSatisfy { !$0.label.isEmpty })
    }

    @Test func ordersAndDeduplicatesTheReasons() {
        let reasons: [ContractValue<ReadinessReason>] = [
            .unrecognized("SOLAR_FLARE"), .known(.accessDenied), .known(.calibrationExpired),
            .known(.unknownPhysicalState), .known(.maintenance), .known(.damaged),
            .known(.notPresent), .known(.notAvailable), .known(.accessDenied), .unrecognized("OTHER"),
        ]
        #expect(ReasonItem.ordered(reasons) == [
            .known(.notAvailable), .known(.notPresent), .known(.damaged), .known(.maintenance),
            .known(.calibrationExpired), .known(.accessDenied), .known(.unknownPhysicalState), .unrecognized,
        ])
    }

    @Test func everyReasonHasGuidance() {
        let asset = CatalogFixtures.asset(result: "BLOCKED")
        for reason in ReadinessReason.allCases.map(ReasonItem.known) + [.unrecognized] {
            #expect(!reason.title(for: asset).isEmpty)
            #expect(!reason.guidance.isEmpty)
        }
    }

    @Test func cardShowsTheMainReasonAndCountsTheOthers() throws {
        let asset = CatalogFixtures.asset(result: "BLOCKED", reasons: ["ACCESS_DENIED", "CALIBRATION_EXPIRED"],
                                          calibration: #"{"required":true,"dueAt":"2026-09-08T16:00:00Z","status":"EXPIRED"}"#)
        let detail = try #require(AssetPresentation.detail(for: asset))
        #expect(detail.symbol == ReasonItem.known(.calibrationExpired).symbol)
        #expect(detail.text == ReasonItem.known(.calibrationExpired).title(for: asset))
        #expect(detail.text.contains("2026"))
        #expect(detail.guidance?.contains("1") == true)
    }

    @Test func readyCardNamesTheCompartment() throws {
        let detail = try #require(AssetPresentation.detail(for: CatalogFixtures.asset()))
        #expect(detail.text.contains("A1"))
        #expect(AssetPresentation.detail(for: CatalogFixtures.asset(placement: "null")) == nil)
    }

    @Test func describesFacts() {
        #expect(AssetPresentation.compartment(nil) == String(localized: "Aucun placement connu"))
        #expect(AssetPresentation.compartment(CatalogFixtures.asset().placement) == "A1 · AEGIS-DEMO-01")
        #expect(AssetPresentation.accessLevel(.unrecognized("X")) == String(localized: "État indisponible"))
        #expect(AssetPresentation.calibration(CalibrationView(required: true, dueAt: nil, status: .unrecognized("X")))
                == String(localized: "État indisponible"))
        #expect(AssetPresentation.calibration(CalibrationView(required: false, dueAt: nil, status: .known(.notRequired)))
                == String(localized: "Non requise"))
    }

    @Test func footerUsesTheOldestEvaluation() throws {
        let older = CatalogFixtures.decode(CatalogFixtures.json(index: 1, evaluatedAt: "2026-10-22T18:00:00Z"),
                                           as: TechnicianAsset.self)
        let newer = CatalogFixtures.decode(CatalogFixtures.json(index: 2, evaluatedAt: "2026-10-22T18:30:00Z"),
                                           as: TechnicianAsset.self)
        #expect(AssetPresentation.oldestEvaluation([newer, older]) == older.readiness.evaluatedAt)
        #expect(AssetPresentation.oldestEvaluation([]) == nil)
    }

    // MARK: Time

    /// Contract-owner decision (22 October 2026, `docs/localisation/convention.md`
    /// on #96): date, time and explicit America/Toronto zone, never truncated
    /// to a date, whatever the device zone. Pinned to the convention examples
    /// for 21 October 2026 at 19:20 UTC, as closely as Apple's formatter gets:
    /// the convention requires platform formats and forbids assembling them by
    /// hand. Remaining differences with its `Intl` examples, reported rather
    /// than patched: fr_CA "21 oct. 2026 à 15:20 HAE" (convention
    /// "21 oct. 2026, 15 h 20 HAE"), en_CA "Oct 21, 2026 at 3:20 PM EDT"
    /// (convention "Oct 21, 2026, 3:20 p.m. EDT"). Same zone, date and time.
    @Test(arguments: [
        ("fr_CA", "21 oct. 2026 à 15:20 HAE"),
        ("en_CA", "Oct 21, 2026 at 3:20 PM EDT"),
    ])
    func calibrationDueTimeFollowsTheLaboratoryConvention(_ locale: String, _ expected: String) throws {
        let instant = try Date("2026-10-21T19:20:00Z", strategy: .iso8601)
        let text = AegisTime.laboratoryDateTime(instant, locale: Locale(identifier: locale))
        #expect(Self.plainSpaces(text) == expected)
    }

    @Test(arguments: [
        ("fr_CA", "30 nov. 2026 à 22:00 HNE"),
        ("en_CA", "Nov 30, 2026 at 10:00 PM EST"),
    ])
    func calibrationDueTimeShowsStandardTimeInWinter(_ locale: String, _ expected: String) throws {
        let instant = try Date("2026-12-01T03:00:00Z", strategy: .iso8601)
        let text = AegisTime.laboratoryDateTime(instant, locale: Locale(identifier: locale))
        #expect(Self.plainSpaces(text) == expected)
    }

    private static func plainSpaces(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    @Test func deviceTimeAddsTheDayOnlyWhenNotToday() throws {
        let zone = try #require(TimeZone(identifier: "America/Vancouver"))
        let now = try Date("2026-10-22T20:00:00Z", strategy: .iso8601)
        let earlier = try Date("2026-10-22T18:30:00Z", strategy: .iso8601)
        let yesterday = try Date("2026-10-21T18:30:00Z", strategy: .iso8601)
        let locale = Locale(identifier: "en_CA")

        let today = AegisTime.deviceTime(earlier, now: now, locale: locale, timeZone: zone)
        #expect(today.contains("11:30"))
        #expect(today.contains("PDT"))
        #expect(!today.contains("21"))
        #expect(!today.contains("22"))
        #expect(AegisTime.deviceTime(yesterday, now: now, locale: locale, timeZone: zone).contains("21"))
    }
}

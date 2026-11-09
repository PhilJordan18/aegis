import Foundation
import Testing
@testable import AegisMobile

/// The shared search corpus of doc 09 §22.3 and ADR-014, read as is from
/// `docs/cahier-conception/09-corpus-recherche-q.json`, the same file the API
/// and the Manager test against.
struct SearchCorpusTests {
    struct Corpus: Decodable {
        let cases: [Case]
    }

    struct Part: Decodable {
        let text: String
        let times: Int?
    }

    struct Case: Decodable, CustomTestStringConvertible {
        let id: String
        let parts: [Part]
        let trimmed: [Part]?
        let graphemes: Int
        let result: String

        var testDescription: String { id }

        static func text(_ parts: [Part]) -> String {
            parts.map { String(repeating: $0.text, count: $0.times ?? 1) }.joined()
        }
    }

    static let cases: [Case] = {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let file = root.appendingPathComponent("docs/cahier-conception/09-corpus-recherche-q.json")
        guard let data = try? Data(contentsOf: file),
              let corpus = try? JSONDecoder().decode(Corpus.self, from: data) else { return [] }
        return corpus.cases
    }()

    @Test func theCorpusIsRead() {
        #expect(Self.cases.count >= 40, "corpus missing or unreadable at the repository root")
    }

    @Test(arguments: SearchCorpusTests.cases)
    func trimsAndCountsLikeTheServer(_ corpusCase: Case) {
        let input = Case.text(corpusCase.parts)
        let expected = Case.text(corpusCase.trimmed ?? corpusCase.parts)
        let sent = AssetQuery.normalizedSearch(input)
        let trimmed = sent ?? ""

        // Swift `==` compares canonically equivalent text as equal, which
        // would hide a normalization: compare the scalars themselves.
        #expect(Array(trimmed.unicodeScalars) == Array(expected.unicodeScalars))
        #expect(trimmed.count == corpusCase.graphemes)
        #expect((sent == nil) == (corpusCase.graphemes == 0), "an empty search is never sent")
        #expect(Self.verdict(trimmed) == corpusCase.result)
    }

    /// The server's order (§22.3): size first, then control characters.
    static func verdict(_ trimmed: String) -> String {
        guard (1...100).contains(trimmed.count) else { return "SIZE" }
        let control = trimmed.unicodeScalars.contains { $0.value < 0x20 || (0x7F...0x9F).contains($0.value) }
        return control ? "INVALID_VALUE" : "VALID"
    }
}

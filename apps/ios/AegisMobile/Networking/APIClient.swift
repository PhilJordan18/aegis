import Foundation

/// Sends one HTTP request. Abstracted so tests can replace the network with an
/// explicit double instead of reaching a real server.
protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionTransport: HTTPTransport {
    let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }
}

/// `application/problem+json` body defined by doc 09 §7. Only the fields the
/// client reacts to are decoded; unknown fields are tolerated. `title`,
/// `detail` and violation messages are never shown to the user.
struct APIProblem: Decodable, Equatable, Sendable {
    struct Violation: Decodable, Equatable, Sendable {
        let field: String
        let code: String
    }

    let status: Int
    let code: String
    let title: String
    let detail: String
    let traceId: String?
    var violations: [Violation]? = nil
}

enum APIError: Error, Equatable {
    /// The request never produced an HTTP response (offline, refused, timed out,
    /// transport security rejection...).
    case unreachable(URLError.Code)
    /// The server answered with a non-2xx status. `retryAfter` carries a valid
    /// `Retry-After` delay in whole seconds, nil when absent or unusable.
    case http(status: Int, problem: APIProblem?, retryAfter: Duration? = nil)
    /// The response could not be understood: not HTTP, wrong media type or body.
    case invalidResponse
    case cancelled
}

/// A typed request against the versioned API root.
struct Endpoint<Response: Decodable & Sendable>: Sendable {
    let method: String
    /// Path relative to `/api/v1`, without a leading slash.
    let path: String
    var query: [URLQueryItem] = []
    var body: Data? = nil

    static func json(method: String, path: String, body: some Encodable) -> Endpoint {
        // Encoding a plain request DTO cannot fail.
        Endpoint(method: method, path: path, body: try! JSONEncoder().encode(body))
    }
}

struct APIClient: Sendable {
    static let requestTimeout: TimeInterval = 15

    let configuration: APIConfiguration
    let transport: any HTTPTransport

    init(configuration: APIConfiguration, transport: any HTTPTransport = URLSessionTransport()) {
        self.configuration = configuration
        self.transport = transport
    }

    func makeRequest<Response>(for endpoint: Endpoint<Response>, bearer token: String? = nil) -> URLRequest {
        var request = URLRequest(
            url: Self.url(configuration.baseURL.appending(path: endpoint.path), query: endpoint.query),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: Self.requestTimeout
        )
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.httpBody = body
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    func send<Response>(_ endpoint: Endpoint<Response>, bearer token: String? = nil) async throws(APIError) -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: makeRequest(for: endpoint, bearer: token))
        } catch let error as URLError where error.code == .cancelled {
            throw .cancelled
        } catch let error as URLError {
            throw .unreachable(error.code)
        } catch is CancellationError {
            throw .cancelled
        } catch {
            throw .unreachable(.unknown)
        }

        guard let http = response as? HTTPURLResponse else { throw .invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw .http(status: http.statusCode, problem: Self.decodeProblem(data, from: http),
                        retryAfter: Self.retryAfter(from: http))
        }
        guard http.mimeType == "application/json" else { throw .invalidResponse }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw .invalidResponse
        }
    }

    /// Query values are encoded strictly (RFC 3986 unreserved characters only):
    /// `URLComponents` would leave `+`, which servers decode as a space.
    static func url(_ url: URL, query: [URLQueryItem]) -> URL {
        guard !query.isEmpty,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        func encode(_ text: String) -> String {
            text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
        }
        components.percentEncodedQueryItems = query.map { URLQueryItem(name: encode($0.name), value: $0.value.map(encode)) }
        return components.url ?? url
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// Accepts delta-seconds only, 1 to 3600: the API sends 1 to 60 for the
    /// sign-in limiter. Anything else is ignored rather than guessed.
    static func retryAfter(from response: HTTPURLResponse) -> Duration? {
        guard let value = response.value(forHTTPHeaderField: "Retry-After"),
              let seconds = Int(value.trimmingCharacters(in: .whitespaces)),
              (1...3600).contains(seconds) else { return nil }
        return .seconds(seconds)
    }

    private static func decodeProblem(_ data: Data, from response: HTTPURLResponse) -> APIProblem? {
        guard response.mimeType == "application/problem+json" else { return nil }
        return try? decoder.decode(APIProblem.self, from: data)
    }

    private static let instantStyles = [
        Date.ISO8601FormatStyle(includingFractionalSeconds: true),
        Date.ISO8601FormatStyle(),
    ]

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            // RFC 3339 instants, with or without fractional seconds (doc 09 §3).
            for style in instantStyles {
                if let date = try? Date(text, strategy: style) { return date }
            }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Expected an RFC 3339 instant")
        }
        return decoder
    }()
}

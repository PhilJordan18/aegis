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
/// client reacts to are decoded; unknown fields are tolerated.
struct APIProblem: Decodable, Equatable, Sendable {
    let status: Int
    let code: String
    let title: String
    let detail: String
    let traceId: String?
}

enum APIError: Error, Equatable {
    /// The request never produced an HTTP response (offline, refused, timed out,
    /// transport security rejection...).
    case unreachable(URLError.Code)
    /// The server answered with a non-2xx status.
    case http(status: Int, problem: APIProblem?)
    /// The response could not be understood: not HTTP, wrong media type or body.
    case invalidResponse
    case cancelled
}

/// A typed request against the versioned API root.
struct Endpoint<Response: Decodable & Sendable>: Sendable {
    let method: String
    /// Path relative to `/api/v1`, without a leading slash.
    let path: String
}

struct APIClient: Sendable {
    static let requestTimeout: TimeInterval = 15

    let configuration: APIConfiguration
    let transport: any HTTPTransport

    init(configuration: APIConfiguration, transport: any HTTPTransport = URLSessionTransport()) {
        self.configuration = configuration
        self.transport = transport
    }

    func makeRequest<Response>(for endpoint: Endpoint<Response>) -> URLRequest {
        var request = URLRequest(
            url: configuration.baseURL.appending(path: endpoint.path),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: Self.requestTimeout
        )
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    func send<Response>(_ endpoint: Endpoint<Response>) async throws(APIError) -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: makeRequest(for: endpoint))
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
            throw .http(status: http.statusCode, problem: Self.decodeProblem(data, from: http))
        }
        guard http.mimeType == "application/json" else { throw .invalidResponse }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw .invalidResponse
        }
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

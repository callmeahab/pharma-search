import Foundation

enum APIEnvironment {
    static let defaultBaseURLString = "https://aposteka.rs"
}

enum APIClientError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "API adresa nije ispravna."
        case .invalidResponse:
            return "Server je vratio neočekivan odgovor."
        case .server(let message):
            return message
        }
    }
}

struct APIClient {
    var baseURLString: String

    private var baseURL: URL? {
        URL(string: baseURLString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    func featured(limit: Int = 24) async throws -> FeaturedResponse {
        let response: ConnectDataResponse<FeaturedResponse> = try await post(
            "/service.PharmaAPI/GetFeatured",
            body: FeaturedPayload(limit: limit),
            isConnectRPC: true
        )
        return response.data
    }

    func searchGroups(query: String, offset: Int = 0, limit: Int = 24) async throws -> MobileSearchResponse {
        let response: ConnectDataResponse<MobileSearchResponse> = try await post(
            "/service.PharmaAPI/SearchGroups",
            body: SearchGroupsPayload(q: query, offset: offset, limit: limit),
            isConnectRPC: true
        )
        return response.data
    }

    func places() async throws -> PlacesResponse {
        try await get("/api/vendor-places")
    }

    func login(email: String, password: String) async throws -> SessionResponse {
        try await post("/api/auth/login", body: AuthPayload(email: email, password: password))
    }

    func register(email: String, name: String, password: String) async throws -> SessionResponse {
        try await post("/api/auth/register", body: RegisterPayload(email: email, name: name, password: password))
    }

    func me(token: String) async throws -> MeResponse {
        try await get("/api/auth/me", token: token)
    }

    func logout(token: String) async throws -> BoolResponse {
        try await post("/api/auth/logout", body: EmptyPayload(), token: token)
    }

    func watches(token: String) async throws -> WatchListResponse {
        try await get("/api/watch", token: token)
    }

    func addWatch(group: ProductGroup, token: String, targetPrice: Double? = nil) async throws -> WatchAddResponse {
        let offer = group.bestOffer
        let imageProduct = group.displayImageProduct
        return try await post(
            "/api/watch",
            body: WatchAddPayload(
                groupKey: group.id,
                displayName: group.normalizedName,
                thumbnail: resolvedImageURLString(imageProduct?.thumbnail, relativeTo: imageProduct?.link) ?? "",
                price: group.priceRange.min,
                vendor: offer?.vendorName ?? "",
                targetPrice: targetPrice
            ),
            token: token
        )
    }

    func removeWatch(groupKey: String, token: String) async throws -> BoolResponse {
        try await post("/api/watch/remove", body: WatchRemovePayload(groupKey: groupKey), token: token)
    }

    func alerts(token: String) async throws -> AlertsResponse {
        try await get("/api/alerts", token: token)
    }

    func registerPushToken(_ pushToken: String, token: String, appVersion: String) async throws -> BoolResponse {
        try await post(
            "/api/mobile/push-token",
            body: PushTokenPayload(platform: "ios", token: pushToken, deviceId: nil, appVersion: appVersion),
            token: token
        )
    }

    private func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = [], token: String? = nil) async throws -> T {
        guard let baseURL else {
            throw APIClientError.invalidBaseURL
        }

        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components?.url else {
            throw APIClientError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        return try decode(data: data, response: response)
    }

    private func post<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        token: String? = nil,
        isConnectRPC: Bool = false
    ) async throws -> T {
        guard let baseURL else {
            throw APIClientError.invalidBaseURL
        }

        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if isConnectRPC {
            request.setValue("1", forHTTPHeaderField: "Connect-Protocol-Version")
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        return try decode(data: data, response: response)
    }

    private func decode<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            if let apiError = try? JSONDecoder().decode(APIErrorPayload.self, from: data) {
                throw APIClientError.server(apiError.error)
            }
            throw APIClientError.server("Greška servera \(httpResponse.statusCode).")
        }

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }
}

private struct ConnectDataResponse<T: Decodable>: Decodable {
    let data: T
}

private struct APIErrorPayload: Decodable {
    let error: String
}

private struct FeaturedPayload: Encodable {
    let limit: Int
}

private struct SearchGroupsPayload: Encodable {
    let q: String
    let offset: Int
    let limit: Int
}

private struct EmptyPayload: Encodable {}

private struct AuthPayload: Encodable {
    let email: String
    let password: String
}

private struct RegisterPayload: Encodable {
    let email: String
    let name: String
    let password: String
}

private struct WatchAddPayload: Encodable {
    let groupKey: String
    let displayName: String
    let thumbnail: String
    let price: Double
    let vendor: String
    let targetPrice: Double?
}

private struct WatchRemovePayload: Encodable {
    let groupKey: String
}

private struct PushTokenPayload: Encodable {
    let platform: String
    let token: String
    let deviceId: String?
    let appVersion: String
}

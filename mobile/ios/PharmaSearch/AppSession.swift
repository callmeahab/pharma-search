import Foundation
import UIKit

@MainActor
final class AppSession: ObservableObject {
    @Published private(set) var token: String?
    @Published private(set) var user: AuthUser?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private var client = APIClient(baseURLString: APIEnvironment.defaultBaseURLString)

    var isSignedIn: Bool {
        token != nil && user != nil
    }

    func configure(baseURLString: String) {
        client = APIClient(baseURLString: baseURLString)
    }

    func restore() async {
        guard let storedToken = KeychainStore.authToken() else {
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await client.me(token: storedToken)
            token = storedToken
            user = response.user
            requestRemotePushRegistration()
        } catch {
            KeychainStore.deleteAuthToken()
            token = nil
            user = nil
        }
    }

    func login(email: String, password: String) async {
        await authenticate {
            try await client.login(email: email, password: password)
        }
    }

    func register(email: String, name: String, password: String) async {
        await authenticate {
            try await client.register(email: email, name: name, password: password)
        }
    }

    func logout() async {
        if let token {
            _ = try? await client.logout(token: token)
        }
        KeychainStore.deleteAuthToken()
        token = nil
        user = nil
    }

    func registerPushToken(_ pushToken: String) async {
        guard let token else { return }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        do {
            _ = try await client.registerPushToken(pushToken, token: token, appVersion: version)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func authenticate(_ operation: () async throws -> SessionResponse) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await operation()
            token = response.token
            user = response.user
            KeychainStore.saveAuthToken(response.token)
            requestRemotePushRegistration()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func requestRemotePushRegistration() {
        Task {
            await requestRemoteNotifications()
        }
    }
}

import Foundation

@MainActor
final class WatchlistViewModel: ObservableObject {
    @Published private(set) var watches: [Watch] = []
    @Published private(set) var alerts: [AlertItem] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    func load(baseURLString: String, token: String?) async {
        guard let token else {
            watches = []
            alerts = []
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let client = APIClient(baseURLString: baseURLString)
        do {
            async let watchResponse = client.watches(token: token)
            async let alertResponse = client.alerts(token: token)
            watches = try await watchResponse.watches
            alerts = try await alertResponse.alerts
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func remove(_ watch: Watch, baseURLString: String, token: String?) async {
        guard let token else { return }
        let client = APIClient(baseURLString: baseURLString)
        do {
            _ = try await client.removeWatch(groupKey: watch.groupKey, token: token)
            watches.removeAll { $0.id == watch.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

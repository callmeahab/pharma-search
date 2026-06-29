import Foundation

@MainActor
final class ProductSearchViewModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var groups: [ProductGroup] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var title = "Popularni proizvodi"

    private var client = APIClient(baseURLString: APIEnvironment.defaultBaseURLString)
    private var searchTask: Task<Void, Never>?

    func configure(baseURLString: String) {
        client = APIClient(baseURLString: baseURLString)
    }

    func loadFeatured() async {
        searchTask?.cancel()
        isLoading = true
        errorMessage = nil
        title = "Popularni proizvodi"

        do {
            let response = try await client.featured()
            groups = response.groups
        } catch {
            groups = []
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func submitSearch() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            guard let self else { return }
            if trimmed.isEmpty {
                await loadFeatured()
            } else {
                await search(trimmed)
            }
        }
    }

    private func search(_ term: String) async {
        isLoading = true
        errorMessage = nil
        title = "Rezultati za \(term)"

        do {
            let response = try await client.searchGroups(query: term)
            groups = response.groups
            if response.groups.isEmpty {
                errorMessage = "Nema pronađenih proizvoda."
            }
        } catch {
            groups = []
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

import SwiftUI
import CoreLocation
import MapKit

struct ContentView: View {
    @AppStorage("isDarkTheme") private var isDarkTheme = false
    @StateObject private var searchViewModel = ProductSearchViewModel()
    @StateObject private var session = AppSession()
    @StateObject private var watchlistViewModel = WatchlistViewModel()
    @StateObject private var placesViewModel = PlacesViewModel()

    private let apiBaseURL = APIEnvironment.defaultBaseURLString

    var body: some View {
        TabView {
            SearchScreen(
                apiBaseURL: apiBaseURL,
                isDarkTheme: $isDarkTheme,
                viewModel: searchViewModel,
                session: session,
                onWatchChanged: refreshWatchlist
            )
            .tabItem {
                Label("Pretraga", systemImage: "magnifyingglass")
            }

            MapScreen(
                apiBaseURL: apiBaseURL,
                viewModel: placesViewModel
            )
            .tabItem {
                Label("Mapa", systemImage: "map")
            }

            WatchlistScreen(
                apiBaseURL: apiBaseURL,
                session: session,
                viewModel: watchlistViewModel
            )
            .tabItem {
                Label("Praćenje", systemImage: "bell")
            }

            AccountScreen(
                isDarkTheme: $isDarkTheme,
                session: session
            )
            .tabItem {
                Label("Nalog", systemImage: "person.crop.circle")
            }
        }
        .preferredColorScheme(isDarkTheme ? .dark : .light)
        .task {
            configureClients()
            await session.restore()
            await searchViewModel.loadFeatured()
            await watchlistViewModel.load(baseURLString: apiBaseURL, token: session.token)
        }
        .onChange(of: session.token) { _, token in
            Task {
                await watchlistViewModel.load(baseURLString: apiBaseURL, token: token)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .didRegisterRemotePushToken)) { notification in
            guard let token = notification.object as? String else { return }
            Task {
                await session.registerPushToken(token)
            }
        }
    }

    private func configureClients() {
        searchViewModel.configure(baseURLString: apiBaseURL)
        session.configure(baseURLString: apiBaseURL)
    }

    private func refreshWatchlist() {
        Task {
            await watchlistViewModel.load(baseURLString: apiBaseURL, token: session.token)
        }
    }
}

private struct SearchScreen: View {
    let apiBaseURL: String
    @Binding var isDarkTheme: Bool
    @ObservedObject var viewModel: ProductSearchViewModel
    @ObservedObject var session: AppSession
    let onWatchChanged: () -> Void

    @State private var isShowingSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchHeader

                if viewModel.isLoading {
                    ProgressView("Učitavanje proizvoda")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage = viewModel.errorMessage, viewModel.groups.isEmpty {
                    ContentUnavailableView("Nema rezultata", systemImage: "magnifyingglass", description: Text(errorMessage))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            SectionHeader(title: viewModel.title, count: viewModel.groups.count)

                            ForEach(viewModel.groups) { group in
                                NavigationLink {
                                    ProductDetailView(
                                        group: group,
                                        apiBaseURL: apiBaseURL,
                                        session: session,
                                        onWatchChanged: onWatchChanged
                                    )
                                } label: {
                                    ProductGroupCard(group: group)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                    }
                    .background(Color(.systemGroupedBackground))
                }
            }
            .navigationTitle("Aposteka")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Podešavanja")
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView(isDarkTheme: $isDarkTheme)
            }
        }
    }

    private var searchHeader: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                TextField("Pretraži proizvode", text: $viewModel.query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit(viewModel.submitSearch)

                if !viewModel.query.isEmpty {
                    Button {
                        viewModel.query = ""
                        Task {
                            await viewModel.loadFeatured()
                        }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Obriši pretragu")
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 50)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            Button {
                viewModel.submitSearch()
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.headline)
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Pretraži")
        }
        .padding(16)
        .background(Color(.systemBackground))
    }
}

@MainActor
final class PlacesViewModel: ObservableObject {
    @Published private(set) var places: [PharmacyPlace] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private var client = APIClient(baseURLString: APIEnvironment.defaultBaseURLString)

    func configure(baseURLString: String) {
        client = APIClient(baseURLString: baseURLString)
    }

    func load(baseURLString: String) async {
        if !places.isEmpty || isLoading {
            return
        }

        configure(baseURLString: baseURLString)
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await client.places()
            places = response.places.filter { $0.latitude != 0 && $0.longitude != 0 }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sortedPlaces(from location: LocationPoint?) -> [PharmacyPlace] {
        guard let location else { return places }
        return places.sorted { lhs, rhs in
            (lhs.distanceMeters(from: location) ?? .greatestFiniteMagnitude) <
                (rhs.distanceMeters(from: location) ?? .greatestFiniteMagnitude)
        }
    }
}

final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var location: LocationPoint?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func requestLocation() {
        errorMessage = nil
        isLoading = true

        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            isLoading = false
            errorMessage = "Dozvolite pristup lokaciji u podešavanjima."
        @unknown default:
            isLoading = false
            errorMessage = "Nije moguće odrediti lokaciju."
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if isLoading, manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            manager.requestLocation()
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            isLoading = false
            errorMessage = "Dozvolite pristup lokaciji u podešavanjima."
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        location = LocationPoint(latitude: latest.coordinate.latitude, longitude: latest.coordinate.longitude)
        isLoading = false
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        isLoading = false
        errorMessage = "Nije moguće odrediti lokaciju."
    }
}

private struct MapScreen: View {
    let apiBaseURL: String
    @ObservedObject var viewModel: PlacesViewModel
    @StateObject private var locationProvider = LocationProvider()
    @State private var cameraPosition: MapCameraPosition = .region(Self.defaultRegion)
    @State private var selectedPlaceID: String?

    private var sortedPlaces: [PharmacyPlace] {
        viewModel.sortedPlaces(from: locationProvider.location)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                mapHeader

                if viewModel.isLoading {
                    ProgressView("Učitavanje lokacija")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if sortedPlaces.isEmpty {
                    ContentUnavailableView(
                        "Nema lokacija",
                        systemImage: "map",
                        description: Text(viewModel.errorMessage ?? "Lokacije apoteka nisu dostupne.")
                    )
                } else {
                    Map(position: $cameraPosition, selection: $selectedPlaceID) {
                        if let location = locationProvider.location {
                            Annotation("Vi", coordinate: coordinate(for: location)) {
                                ZStack {
                                    Circle()
                                        .fill(.blue.opacity(0.18))
                                        .frame(width: 34, height: 34)
                                    Circle()
                                        .fill(.blue)
                                        .frame(width: 13, height: 13)
                                }
                            }
                        }

                        ForEach(sortedPlaces.prefix(300)) { place in
                            Annotation(place.title, coordinate: coordinate(for: place), anchor: .bottom) {
                                AppLogoMark(size: selectedPlaceID == place.id ? 32 : 28)
                                    .padding(5)
                                    .background(.regularMaterial, in: Circle())
                                    .overlay {
                                        Circle()
                                            .stroke(selectedPlaceID == place.id ? Color.teal : Color.green, lineWidth: 2)
                                    }
                                    .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
                            }
                            .tag(place.id)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    nearestList
                        .frame(height: 238)
                }
            }
            .navigationTitle("Mapa")
            .task {
                await viewModel.load(baseURLString: apiBaseURL)
                updateCamera()
            }
            .onChange(of: locationProvider.location) { _, _ in
                updateCamera()
            }
            .onChange(of: viewModel.places.count) { _, _ in
                updateCamera()
            }
        }
    }

    private var mapHeader: some View {
        HStack(spacing: 12) {
            Button {
                locationProvider.requestLocation()
            } label: {
                if locationProvider.isLoading {
                    ProgressView()
                    Text("Traženje")
                } else {
                    Label("Moja lokacija", systemImage: "location.fill")
                }
            }
            .buttonStyle(.borderedProminent)

            VStack(alignment: .leading, spacing: 3) {
                Text(locationProvider.location == nil ? "Učitajte lokaciju za najbliže apoteke." : "Najbliže lokacije su sortirane.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let error = locationProvider.errorMessage ?? viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color(.systemBackground))
    }

    private var nearestList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text("Najbliže apoteke")
                    .font(.headline)
                    .padding(.horizontal, 16)
                    .padding(.top, 14)

                ForEach(sortedPlaces.prefix(20)) { place in
                    PharmacyPlaceRow(
                        place: place,
                        userLocation: locationProvider.location,
                        isSelected: selectedPlaceID == place.id
                    ) {
                        selectedPlaceID = place.id
                        cameraPosition = .region(region(centeredOn: place))
                    }
                    .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func updateCamera() {
        cameraPosition = .region(regionForPlaces(sortedPlaces, userLocation: locationProvider.location))
    }

    static let defaultRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 44.0165, longitude: 21.0059),
        span: MKCoordinateSpan(latitudeDelta: 5.8, longitudeDelta: 5.8)
    )
}

private struct PharmacyPlaceRow: View {
    let place: PharmacyPlace
    let userLocation: LocationPoint?
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                AppLogoMark(size: 28)
                    .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 4) {
                    Text(place.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if !place.displayAddress.isEmpty {
                        Text(place.displayAddress)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    HStack(spacing: 8) {
                        if let meters = place.distanceMeters(from: userLocation) {
                            Text(formatDistance(meters))
                                .foregroundStyle(.green)
                        }
                        if let openNow = place.openNow {
                            Text(openNow ? "Otvoreno" : "Zatvoreno")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .font(.caption.weight(.medium))
                }

                Spacer()

                if let url = mapsURL(for: place) {
                    Link(destination: url) {
                        Image(systemName: "arrow.triangle.turn.up.right.diamond")
                            .font(.headline)
                    }
                }
            }
            .padding(12)
            .background(isSelected ? Color.green.opacity(0.14) : Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private func coordinate(for place: PharmacyPlace) -> CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
}

private func coordinate(for location: LocationPoint) -> CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
}

private func mapsURL(for place: PharmacyPlace) -> URL? {
    if let url = URL(string: place.mapsUrl), !place.mapsUrl.isEmpty {
        return url
    }
    let query = "\(place.latitude),\(place.longitude)"
    return URL(string: "http://maps.apple.com/?ll=\(query)&q=\(place.title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "Apoteka")")
}

private func region(centeredOn place: PharmacyPlace) -> MKCoordinateRegion {
    MKCoordinateRegion(
        center: coordinate(for: place),
        span: MKCoordinateSpan(latitudeDelta: 0.035, longitudeDelta: 0.035)
    )
}

private func regionForPlaces(_ places: [PharmacyPlace], userLocation: LocationPoint?) -> MKCoordinateRegion {
    let placeCoordinates = places.prefix(userLocation == nil ? 80 : 30).map(coordinate(for:))
    let coordinates = placeCoordinates + [userLocation.map(coordinate(for:))].compactMap { $0 }

    guard !coordinates.isEmpty else {
        return MapScreen.defaultRegion
    }
    guard coordinates.count > 1 else {
        return MKCoordinateRegion(
            center: coordinates[0],
            span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
        )
    }

    let minLat = coordinates.map(\.latitude).min() ?? 44.0165
    let maxLat = coordinates.map(\.latitude).max() ?? 44.0165
    let minLon = coordinates.map(\.longitude).min() ?? 21.0059
    let maxLon = coordinates.map(\.longitude).max() ?? 21.0059
    let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
    return MKCoordinateRegion(
        center: center,
        span: MKCoordinateSpan(
            latitudeDelta: max(0.035, (maxLat - minLat) * 1.35),
            longitudeDelta: max(0.035, (maxLon - minLon) * 1.35)
        )
    )
}

private struct WatchlistScreen: View {
    let apiBaseURL: String
    @ObservedObject var session: AppSession
    @ObservedObject var viewModel: WatchlistViewModel

    var body: some View {
        NavigationStack {
            Group {
                if !session.isSignedIn {
                    ContentUnavailableView(
                        "Prijavite se za praćenje cena",
                        systemImage: "bell.badge",
                        description: Text("Proizvodi koje pratite i obaveštenja o pojeftinjenjima vezani su za vaš nalog.")
                    )
                } else if viewModel.isLoading {
                    ProgressView("Učitavanje liste praćenja")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if let errorMessage = viewModel.errorMessage {
                            Section {
                                Text(errorMessage)
                                    .foregroundStyle(.red)
                            }
                        }

                        Section("Proizvodi koje pratite") {
                            if viewModel.watches.isEmpty {
                                Text("Još nema proizvoda za praćenje.")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(viewModel.watches) { watch in
                                    WatchRow(watch: watch)
                                        .swipeActions {
                                            Button(role: .destructive) {
                                                Task {
                                                    await viewModel.remove(watch, baseURLString: apiBaseURL, token: session.token)
                                                }
                                            } label: {
                                                Label("Ukloni", systemImage: "trash")
                                            }
                                        }
                                }
                            }
                        }

                        Section("Nedavna obaveštenja") {
                            if viewModel.alerts.isEmpty {
                                Text("Još nema obaveštenja o cenama.")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(viewModel.alerts) { alert in
                                    AlertRow(alert: alert)
                                }
                            }
                        }
                    }
                    .refreshable {
                        await viewModel.load(baseURLString: apiBaseURL, token: session.token)
                    }
                }
            }
            .navigationTitle("Praćenje")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await viewModel.load(baseURLString: apiBaseURL, token: session.token)
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(!session.isSignedIn)
                }
            }
        }
    }
}

private struct AccountScreen: View {
    @Binding var isDarkTheme: Bool
    @ObservedObject var session: AppSession

    var body: some View {
        NavigationStack {
            Form {
                Section("Izgled") {
                    Toggle("Tamna tema", isOn: $isDarkTheme)
                }

                if let user = session.user {
                    Section("Prijavljeni ste") {
                        LabeledContent("E-pošta", value: user.email)
                        LabeledContent("Ime", value: user.name.isEmpty ? "Nije uneto" : user.name)

                        Button(role: .destructive) {
                            Task {
                                await session.logout()
                            }
                        } label: {
                            Label("Odjavi se", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                } else {
                    LoginForm(session: session)
                }

                if let errorMessage = session.errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Nalog")
        }
    }
}

private struct LoginForm: View {
    @ObservedObject var session: AppSession
    @State private var isRegistering = false
    @State private var email = ""
    @State private var name = ""
    @State private var password = ""

    var body: some View {
        Section("Nalog") {
            Picker("Režim", selection: $isRegistering) {
                Text("Prijavi se").tag(false)
                Text("Napravi nalog").tag(true)
            }
            .pickerStyle(.segmented)

            if isRegistering {
                TextField("Ime", text: $name)
                    .textContentType(.name)
            }

            TextField("E-pošta", text: $email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            SecureField("Lozinka", text: $password)
                .textContentType(isRegistering ? .newPassword : .password)

            Button {
                Task {
                    if isRegistering {
                        await session.register(email: email, name: name, password: password)
                    } else {
                        await session.login(email: email, password: password)
                    }
                }
            } label: {
                if session.isLoading {
                    ProgressView()
                } else {
                    Label(isRegistering ? "Napravi nalog" : "Prijavi se", systemImage: "person.crop.circle.badge.checkmark")
                }
            }
            .disabled(email.isEmpty || password.isEmpty || session.isLoading)
        }
    }
}

private struct SectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.headline)
            Spacer()
            Text("\(count)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

private struct ProductGroupCard: View {
    let group: ProductGroup

    var body: some View {
        HStack(spacing: 12) {
            ProductThumbnail(urlString: group.displayImageProduct?.thumbnail, baseURLString: group.displayImageProduct?.link)
                .frame(width: 68, height: 68)

            VStack(alignment: .leading, spacing: 6) {
                Text(group.normalizedName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(2)

                Text(group.bestOffer?.vendorName ?? "Najbolja dostupna ponuda")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(formatPrice(group.priceRange.min))
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.green)

                    Text(pharmacyCountText(group.vendorCount))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(.tertiarySystemGroupedBackground), in: Capsule())
                }
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct ProductThumbnail: View {
    let urlString: String?
    var baseURLString: String? = nil

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(.tertiarySystemGroupedBackground))

            if let url = resolvedImageURL(urlString, relativeTo: baseURLString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                    case .failure:
                        AppLogoMark(size: 32)
                            .opacity(0.82)
                    case .empty:
                        ProgressView()
                    @unknown default:
                        EmptyView()
                    }
                }
                .padding(8)
            } else {
                AppLogoMark(size: 32)
                    .opacity(0.82)
            }
        }
    }
}

private struct AppLogoMark: View {
    let size: CGFloat

    var body: some View {
        Image("ApostekaLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

private struct ProductDetailView: View {
    let group: ProductGroup
    let apiBaseURL: String
    @ObservedObject var session: AppSession
    let onWatchChanged: () -> Void

    @State private var isSavingWatch = false
    @State private var watchMessage: String?

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    ProductThumbnail(urlString: group.displayImageProduct?.thumbnail, baseURLString: group.displayImageProduct?.link)
                        .frame(width: 82, height: 82)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.normalizedName)
                            .font(.headline)
                        Text("\(pharmacyCountText(group.vendorCount)), \(offerCountText(group.productCount))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text("Od \(formatPrice(group.priceRange.min))")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                }
                .padding(.vertical, 6)
            }

            Section("Obaveštenja o ceni") {
                if session.isSignedIn {
                    Button {
                        Task {
                            await addWatch()
                        }
                    } label: {
                        if isSavingWatch {
                            ProgressView()
                        } else {
                            Label("Prati cenu", systemImage: "bell.badge")
                        }
                    }
                    .disabled(isSavingWatch)
                } else {
                    Label("Prijavite se da pratite ovu cenu", systemImage: "person.crop.circle")
                        .foregroundStyle(.secondary)
                }

                if let watchMessage {
                    Text(watchMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Ponude") {
                ForEach(group.products.sorted(by: { $0.price < $1.price })) { product in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(product.vendorName)
                                .font(.headline)
                            Spacer()
                            Text(formatPrice(product.price))
                                .font(.headline.monospacedDigit())
                                .foregroundStyle(.green)
                        }

                        Text(product.title)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        if let url = URL(string: product.link), !product.link.isEmpty {
                            Link(destination: url) {
                                Label("Otvori ponudu", systemImage: "safari")
                            }
                            .font(.subheadline.weight(.medium))
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .navigationTitle("Uporedi cene")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func addWatch() async {
        guard let token = session.token else { return }
        isSavingWatch = true
        defer { isSavingWatch = false }

        do {
            _ = try await APIClient(baseURLString: apiBaseURL).addWatch(group: group, token: token)
            watchMessage = "Dodato na listu praćenja."
            onWatchChanged()
        } catch {
            watchMessage = error.localizedDescription
        }
    }
}

private struct WatchRow: View {
    let watch: Watch

    var body: some View {
        HStack(spacing: 12) {
            ProductThumbnail(urlString: watch.thumbnail)
                .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 4) {
                Text(watch.displayName.isEmpty ? "Praćeni proizvod" : watch.displayName)
                    .font(.headline)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if let lastPrice = watch.lastPrice {
                        Text(formatPrice(lastPrice))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                    if !watch.lastVendor.isEmpty {
                        Text(watch.lastVendor)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
    }
}

private struct AlertRow: View {
    let alert: AlertItem

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(alert.displayName.isEmpty ? "Obaveštenje o ceni" : alert.displayName)
                .font(.headline)
                .lineLimit(2)

            HStack(spacing: 8) {
                if let newPrice = alert.newPrice {
                    Text(formatPrice(newPrice))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.green)
                }
                Text(alert.kind == "target" ? "Ciljna cena dostignuta" : "Cena je pala")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if !alert.vendor.isEmpty {
                Text(alert.vendor)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct SettingsView: View {
    @Binding var isDarkTheme: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Izgled") {
                    Toggle("Tamna tema", isOn: $isDarkTheme)
                }
            }
            .navigationTitle("Podešavanja")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Gotovo") {
                        dismiss()
                    }
                }
            }
        }
    }
}

private func pharmacyCountText(_ count: Int) -> String {
    "\(count) \(serbianPlural(count, one: "apoteka", few: "apoteke", many: "apoteka"))"
}

private func offerCountText(_ count: Int) -> String {
    "\(count) \(serbianPlural(count, one: "ponuda", few: "ponude", many: "ponuda"))"
}

private func serbianPlural(_ count: Int, one: String, few: String, many: String) -> String {
    let mod10 = count % 10
    let mod100 = count % 100

    if mod10 == 1 && mod100 != 11 {
        return one
    }
    if (2...4).contains(mod10) && !(12...14).contains(mod100) {
        return few
    }
    return many
}

private func formatPrice(_ price: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "RSD"
    formatter.maximumFractionDigits = 0
    formatter.locale = Locale(identifier: "sr_RS")
    return formatter.string(from: NSNumber(value: price)) ?? "\(Int(price)) RSD"
}

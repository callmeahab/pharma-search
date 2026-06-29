import Foundation

struct PriceRange: Decodable, Hashable {
    let min: Double
    let max: Double
    let avg: Double
}

struct Product: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let price: Double
    let vendorId: String
    let vendorName: String
    let link: String
    let thumbnail: String
    let brandName: String
    let groupKey: String
    let dosageValue: Double?
    let dosageUnit: String?
    let form: String?
    let category: String?
    let quantity: Double?
    let priceUpdatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case price
        case vendorId = "vendor_id"
        case vendorIdCamel = "vendorId"
        case vendorName = "vendor_name"
        case vendorNameCamel = "vendorName"
        case link
        case thumbnail
        case brandName = "brand_name"
        case brand = "brand"
        case groupKey = "group_key"
        case groupKeyCamel = "groupKey"
        case dosageValue = "dosage_value"
        case dosageValueCamel = "dosageValue"
        case dosageUnit = "dosage_unit"
        case dosageUnitCamel = "dosageUnit"
        case form
        case category
        case quantity
        case quantityValue = "quantityValue"
        case priceUpdatedAt = "price_updated_at"
        case updatedAt = "updatedAt"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        price = try container.decodeIfPresent(Double.self, forKey: .price) ?? 0
        vendorId = try container.decodeIfPresent(String.self, forKey: .vendorId)
            ?? container.decodeIfPresent(String.self, forKey: .vendorIdCamel)
            ?? ""
        vendorName = try container.decodeIfPresent(String.self, forKey: .vendorName)
            ?? container.decodeIfPresent(String.self, forKey: .vendorNameCamel)
            ?? ""
        link = try container.decodeIfPresent(String.self, forKey: .link) ?? ""
        thumbnail = try container.decodeIfPresent(String.self, forKey: .thumbnail) ?? ""
        brandName = try container.decodeIfPresent(String.self, forKey: .brandName)
            ?? container.decodeIfPresent(String.self, forKey: .brand)
            ?? ""
        groupKey = try container.decodeIfPresent(String.self, forKey: .groupKey)
            ?? container.decodeIfPresent(String.self, forKey: .groupKeyCamel)
            ?? ""
        dosageValue = try container.decodeIfPresent(Double.self, forKey: .dosageValue)
            ?? container.decodeIfPresent(Double.self, forKey: .dosageValueCamel)
        dosageUnit = try container.decodeIfPresent(String.self, forKey: .dosageUnit)
            ?? container.decodeIfPresent(String.self, forKey: .dosageUnitCamel)
        form = try container.decodeIfPresent(String.self, forKey: .form)
        category = try container.decodeIfPresent(String.self, forKey: .category)
        quantity = try container.decodeIfPresent(Double.self, forKey: .quantity)
            ?? container.decodeIfPresent(Double.self, forKey: .quantityValue)
        priceUpdatedAt = try container.decodeIfPresent(String.self, forKey: .priceUpdatedAt)
            ?? container.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

struct ProductGroup: Decodable, Hashable, Identifiable {
    let id: String
    let normalizedName: String
    let products: [Product]
    let priceRange: PriceRange
    let vendorCount: Int
    let productCount: Int
    let dosageValue: Double?
    let dosageUnit: String?
    let hiddenOffers: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case normalizedName = "normalized_name"
        case products
        case priceRange = "price_range"
        case vendorCount = "vendor_count"
        case productCount = "product_count"
        case dosageValue = "dosage_value"
        case dosageUnit = "dosage_unit"
        case hiddenOffers = "hidden_offers"
    }

    var bestOffer: Product? {
        products.min { lhs, rhs in
            lhs.price < rhs.price
        }
    }

    var displayImageProduct: Product? {
        products.first { resolvedImageURL($0.thumbnail, relativeTo: $0.link) != nil } ?? bestOffer
    }
}

func resolvedImageURL(_ rawValue: String?, relativeTo baseValue: String? = nil) -> URL? {
    guard let rawValue else { return nil }
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.range(of: "data:image", options: [.caseInsensitive, .anchored]) == nil else {
        return nil
    }

    if trimmed.hasPrefix("//") {
        return URL(string: "https:\(trimmed)")
    }
    if let url = URL(string: trimmed), url.scheme != nil {
        return url
    }
    guard let baseValue, let baseURL = URL(string: baseValue) else {
        return nil
    }
    return URL(string: trimmed, relativeTo: baseURL)?.absoluteURL
}

func resolvedImageURLString(_ rawValue: String?, relativeTo baseValue: String? = nil) -> String? {
    resolvedImageURL(rawValue, relativeTo: baseValue)?.absoluteString
}

struct MobileSearchResponse: Decodable {
    let groups: [ProductGroup]
    let totalProducts: Int
    let totalGroups: Int
    let offset: Int
    let limit: Int

    enum CodingKeys: String, CodingKey {
        case groups
        case totalProducts = "total_products"
        case totalGroups = "total_groups"
        case total
        case offset
        case limit
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        groups = try container.decode([ProductGroup].self, forKey: .groups)
        let total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        totalProducts = try container.decodeIfPresent(Int.self, forKey: .totalProducts) ?? total
        totalGroups = try container.decodeIfPresent(Int.self, forKey: .totalGroups) ?? total
        offset = try container.decodeIfPresent(Int.self, forKey: .offset) ?? 0
        limit = try container.decodeIfPresent(Int.self, forKey: .limit) ?? groups.count
    }
}

struct FeaturedResponse: Decodable {
    let groups: [ProductGroup]
    let total: Int
    let offset: Int
    let limit: Int
}

struct LocationPoint: Hashable {
    let latitude: Double
    let longitude: Double
}

struct PharmacyPlace: Decodable, Hashable, Identifiable {
    let id: String
    let vendorId: String
    let vendorName: String
    let name: String
    let address: String
    let formattedAddress: String
    let city: String
    let phone: String
    let website: String
    let mapsUrl: String
    let latitude: Double
    let longitude: Double
    let productCount: Int
    let openNow: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case vendorId = "vendor_id"
        case vendorName = "vendor_name"
        case name
        case address
        case formattedAddress = "formatted_address"
        case city
        case phone
        case website
        case mapsUrl = "maps_url"
        case latitude
        case longitude
        case productCount = "product_count"
        case openNow = "open_now"
    }

    var title: String {
        name.isEmpty ? vendorName : name
    }

    var displayAddress: String {
        if !formattedAddress.isEmpty {
            return formattedAddress
        }
        return [address, city].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    func distanceMeters(from location: LocationPoint?) -> Double? {
        guard let location else { return nil }
        return haversineMeters(
            startLatitude: location.latitude,
            startLongitude: location.longitude,
            endLatitude: latitude,
            endLongitude: longitude
        )
    }
}

struct PlacesResponse: Decodable {
    let places: [PharmacyPlace]
}

struct AuthUser: Decodable, Hashable, Identifiable {
    let id: String
    let email: String
    let name: String
    let emailVerified: Bool
}

struct SessionResponse: Decodable {
    let token: String
    let user: AuthUser
}

struct MeResponse: Decodable {
    let user: AuthUser
}

struct BoolResponse: Decodable {
    let ok: Bool
}

struct Watch: Decodable, Hashable, Identifiable {
    let id: String
    let groupKey: String
    let displayName: String
    let thumbnail: String
    let targetPrice: Double?
    let lastPrice: Double?
    let lastVendor: String
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case groupKey = "group_key"
        case displayName = "display_name"
        case thumbnail
        case targetPrice = "target_price"
        case lastPrice = "last_price"
        case lastVendor = "last_vendor"
        case createdAt = "created_at"
    }
}

struct WatchListResponse: Decodable {
    let watches: [Watch]
}

struct WatchAddResponse: Decodable {
    let id: String
    let ok: Bool
}

struct AlertItem: Decodable, Hashable, Identifiable {
    var id: String { "\(groupKey)-\(sentAt)-\(kind)" }

    let kind: String
    let oldPrice: Double?
    let newPrice: Double?
    let vendor: String
    let sentAt: String
    let displayName: String
    let groupKey: String

    enum CodingKeys: String, CodingKey {
        case kind
        case oldPrice = "old_price"
        case newPrice = "new_price"
        case vendor
        case sentAt = "sent_at"
        case displayName = "display_name"
        case groupKey = "group_key"
    }
}

struct AlertsResponse: Decodable {
    let alerts: [AlertItem]
}

private let earthRadiusMeters = 6_371_000.0

func haversineMeters(
    startLatitude: Double,
    startLongitude: Double,
    endLatitude: Double,
    endLongitude: Double
) -> Double {
    let startLat = startLatitude * .pi / 180
    let endLat = endLatitude * .pi / 180
    let deltaLat = (endLatitude - startLatitude) * .pi / 180
    let deltaLon = (endLongitude - startLongitude) * .pi / 180
    let a = sin(deltaLat / 2) * sin(deltaLat / 2) +
        cos(startLat) * cos(endLat) * sin(deltaLon / 2) * sin(deltaLon / 2)
    return earthRadiusMeters * 2 * atan2(sqrt(a), sqrt(1 - a))
}

func formatDistance(_ meters: Double) -> String {
    if meters < 1000 {
        return "\(Int(meters.rounded())) m"
    }
    return String(format: "%.1f km", meters / 1000)
}

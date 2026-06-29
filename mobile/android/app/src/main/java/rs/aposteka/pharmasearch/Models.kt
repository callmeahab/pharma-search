package rs.aposteka.pharmasearch

data class PriceRange(
    val min: Double,
    val max: Double,
    val avg: Double,
)

data class Product(
    val id: String,
    val title: String,
    val price: Double,
    val vendorId: String,
    val vendorName: String,
    val link: String,
    val thumbnail: String,
    val brandName: String,
    val groupKey: String,
    val dosageValue: Double?,
    val dosageUnit: String?,
    val form: String?,
    val category: String?,
    val quantity: Double?,
    val priceUpdatedAt: String?,
)

data class ProductGroup(
    val id: String,
    val normalizedName: String,
    val products: List<Product>,
    val priceRange: PriceRange,
    val vendorCount: Int,
    val productCount: Int,
    val dosageValue: Double?,
    val dosageUnit: String?,
    val hiddenOffers: Int?,
) {
    val bestOffer: Product?
        get() = products.minByOrNull { it.price }

    val displayImageProduct: Product?
        get() = products.firstOrNull { resolvedImageUrl(it.thumbnail, it.link) != null } ?: bestOffer
}

data class MobileSearchResponse(
    val groups: List<ProductGroup>,
    val totalProducts: Int,
    val totalGroups: Int,
    val offset: Int,
    val limit: Int,
)

data class FeaturedResponse(
    val groups: List<ProductGroup>,
    val total: Int,
    val offset: Int,
    val limit: Int,
)

data class LocationPoint(
    val latitude: Double,
    val longitude: Double,
)

data class PharmacyPlace(
    val id: String,
    val vendorId: String,
    val vendorName: String,
    val name: String,
    val address: String,
    val formattedAddress: String,
    val city: String,
    val phone: String,
    val website: String,
    val mapsUrl: String,
    val latitude: Double,
    val longitude: Double,
    val productCount: Int,
    val openNow: Boolean?,
) {
    val title: String
        get() = name.ifBlank { vendorName }

    val displayAddress: String
        get() = formattedAddress.ifBlank { listOf(address, city).filter { it.isNotBlank() }.joinToString(", ") }

    fun distanceMeters(from: LocationPoint?): Double? {
        from ?: return null
        return haversineMeters(from.latitude, from.longitude, latitude, longitude)
    }
}

data class PlacesResponse(
    val places: List<PharmacyPlace>,
)

data class AuthUser(
    val id: String,
    val email: String,
    val name: String,
    val emailVerified: Boolean,
)

data class SessionResponse(
    val token: String,
    val user: AuthUser,
)

data class Watch(
    val id: String,
    val groupKey: String,
    val displayName: String,
    val thumbnail: String,
    val targetPrice: Double?,
    val lastPrice: Double?,
    val lastVendor: String,
    val createdAt: String?,
)

data class AlertItem(
    val kind: String,
    val oldPrice: Double?,
    val newPrice: Double?,
    val vendor: String,
    val sentAt: String,
    val displayName: String,
    val groupKey: String,
)

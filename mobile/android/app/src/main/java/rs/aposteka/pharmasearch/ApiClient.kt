package rs.aposteka.pharmasearch

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object ApiEnvironment {
    const val defaultBaseUrl = "https://aposteka.rs"
}

class PharmaApiClient(private val baseUrl: String) {
    suspend fun featured(limit: Int = 24): FeaturedResponse = withContext(Dispatchers.IO) {
        val json = connect("/service.PharmaAPI/GetFeatured", JSONObject().put("limit", limit))
        FeaturedResponse(
            groups = json.getJSONArray("groups").toGroups(),
            total = json.optInt("total"),
            offset = json.optInt("offset"),
            limit = json.optInt("limit"),
        )
    }

    suspend fun searchGroups(query: String, offset: Int = 0, limit: Int = 24): MobileSearchResponse =
        withContext(Dispatchers.IO) {
            val json = connect(
                "/service.PharmaAPI/SearchGroups",
                JSONObject()
                    .put("q", query)
                    .put("offset", offset)
                    .put("limit", limit),
            )
            MobileSearchResponse(
                groups = json.getJSONArray("groups").toGroups(),
                totalProducts = json.optInt("total_products", json.optInt("total")),
                totalGroups = json.optInt("total_groups", json.optInt("total")),
                offset = json.optInt("offset"),
                limit = json.optInt("limit"),
            )
        }

    suspend fun places(): List<PharmacyPlace> = withContext(Dispatchers.IO) {
        get("/api/vendor-places").getJSONArray("places").toPlaces()
    }

    suspend fun login(email: String, password: String): SessionResponse = withContext(Dispatchers.IO) {
        val json = post("/api/auth/login", JSONObject().put("email", email).put("password", password))
        SessionResponse(token = json.getString("token"), user = json.getJSONObject("user").toAuthUser())
    }

    suspend fun register(email: String, name: String, password: String): SessionResponse = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email).put("name", name).put("password", password)
        val json = post("/api/auth/register", body)
        SessionResponse(token = json.getString("token"), user = json.getJSONObject("user").toAuthUser())
    }

    suspend fun me(token: String): AuthUser = withContext(Dispatchers.IO) {
        get("/api/auth/me", token = token).getJSONObject("user").toAuthUser()
    }

    suspend fun logout(token: String) = withContext(Dispatchers.IO) {
        post("/api/auth/logout", JSONObject(), token)
    }

    suspend fun watches(token: String): List<Watch> = withContext(Dispatchers.IO) {
        get("/api/watch", token = token).getJSONArray("watches").toWatches()
    }

    suspend fun addWatch(group: ProductGroup, token: String) = withContext(Dispatchers.IO) {
        val offer = group.bestOffer
        val imageProduct = group.displayImageProduct
        val body = JSONObject()
            .put("groupKey", group.id)
            .put("displayName", group.normalizedName)
            .put("thumbnail", resolvedImageUrl(imageProduct?.thumbnail, imageProduct?.link).orEmpty())
            .put("price", group.priceRange.min)
            .put("vendor", offer?.vendorName.orEmpty())
        post("/api/watch", body, token)
    }

    suspend fun removeWatch(groupKey: String, token: String) = withContext(Dispatchers.IO) {
        post("/api/watch/remove", JSONObject().put("groupKey", groupKey), token)
    }

    suspend fun alerts(token: String): List<AlertItem> = withContext(Dispatchers.IO) {
        get("/api/alerts", token = token).getJSONArray("alerts").toAlerts()
    }

    suspend fun registerPushToken(pushToken: String, token: String, appVersion: String) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("platform", "android")
            .put("token", pushToken)
            .put("appVersion", appVersion)
        post("/api/mobile/push-token", body, token)
    }

    private fun get(path: String, query: Map<String, String> = emptyMap(), token: String? = null): JSONObject {
        val endpoint = buildUrl(path, query)
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 10_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("Accept", "application/json")
        if (token != null) {
            connection.setRequestProperty("Authorization", "Bearer $token")
        }

        return readJson(connection)
    }

    private fun post(path: String, body: JSONObject, token: String? = null): JSONObject {
        val connection = URL(buildUrl(path, emptyMap())).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 10_000
        connection.readTimeout = 20_000
        connection.doOutput = true
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json")
        if (path.startsWith("/service.")) {
            connection.setRequestProperty("Connect-Protocol-Version", "1")
        }
        if (token != null) {
            connection.setRequestProperty("Authorization", "Bearer $token")
        }
        connection.outputStream.use { output ->
            output.write(body.toString().toByteArray(Charsets.UTF_8))
        }

        return readJson(connection)
    }

    private fun connect(path: String, body: JSONObject): JSONObject {
        val response = post(path, body)
        return response.optJSONObject("data") ?: response
    }

    private fun readJson(connection: HttpURLConnection): JSONObject {
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val body = BufferedReader(InputStreamReader(stream)).use { it.readText() }
        connection.disconnect()

        if (status !in 200..299) {
            val message = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(message?.ifBlank { "Greška servera $status" } ?: "Greška servera $status")
        }

        return JSONObject(body)
    }

    private fun buildUrl(path: String, query: Map<String, String>): String {
        val cleanBase = baseUrl.trimEnd('/')
        if (query.isEmpty()) return cleanBase + path
        val encoded = query.entries.joinToString("&") { (key, value) ->
            "${key}=${URLEncoder.encode(value, "UTF-8")}"
        }
        return "$cleanBase$path?$encoded"
    }
}

private fun JSONObject.toAuthUser(): AuthUser =
    AuthUser(
        id = optString("id"),
        email = optString("email"),
        name = optString("name"),
        emailVerified = optBoolean("emailVerified"),
    )

private fun JSONArray.toGroups(): List<ProductGroup> =
    (0 until length()).map { index -> getJSONObject(index).toGroup() }

private fun JSONObject.toGroup(): ProductGroup {
    val priceRange = optJSONObject("price_range") ?: JSONObject()
    return ProductGroup(
        id = optString("id"),
        normalizedName = optString("normalized_name"),
        products = optJSONArray("products")?.toProducts().orEmpty(),
        priceRange = PriceRange(
            min = priceRange.optDouble("min"),
            max = priceRange.optDouble("max"),
            avg = priceRange.optDouble("avg"),
        ),
        vendorCount = optInt("vendor_count"),
        productCount = optInt("product_count"),
        dosageValue = nullableDouble("dosage_value"),
        dosageUnit = nullableString("dosage_unit"),
        hiddenOffers = if (has("hidden_offers") && !isNull("hidden_offers")) optInt("hidden_offers") else null,
    )
}

private fun JSONArray.toProducts(): List<Product> =
    (0 until length()).map { index -> getJSONObject(index).toProduct() }

private fun JSONArray.toWatches(): List<Watch> =
    (0 until length()).map { index -> getJSONObject(index).toWatch() }

private fun JSONArray.toPlaces(): List<PharmacyPlace> =
    (0 until length()).map { index -> getJSONObject(index).toPlace() }

private fun JSONObject.toPlace(): PharmacyPlace =
    PharmacyPlace(
        id = optString("id"),
        vendorId = firstString("vendor_id", "vendorId"),
        vendorName = firstString("vendor_name", "vendorName"),
        name = optString("name"),
        address = optString("address"),
        formattedAddress = firstString("formatted_address", "formattedAddress"),
        city = firstString("city", "locality"),
        phone = optString("phone"),
        website = optString("website"),
        mapsUrl = firstString("maps_url", "mapsUrl"),
        latitude = optDouble("latitude"),
        longitude = optDouble("longitude"),
        productCount = optInt("product_count"),
        openNow = nullableBool("open_now"),
    )

private fun JSONObject.toWatch(): Watch =
    Watch(
        id = optString("id"),
        groupKey = optString("group_key"),
        displayName = optString("display_name"),
        thumbnail = optString("thumbnail"),
        targetPrice = nullableDouble("target_price"),
        lastPrice = nullableDouble("last_price"),
        lastVendor = optString("last_vendor"),
        createdAt = nullableString("created_at"),
    )

private fun JSONArray.toAlerts(): List<AlertItem> =
    (0 until length()).map { index -> getJSONObject(index).toAlert() }

private fun JSONObject.toAlert(): AlertItem =
    AlertItem(
        kind = optString("kind"),
        oldPrice = nullableDouble("old_price"),
        newPrice = nullableDouble("new_price"),
        vendor = optString("vendor"),
        sentAt = optString("sent_at"),
        displayName = optString("display_name"),
        groupKey = optString("group_key"),
    )

private fun JSONObject.toProduct(): Product =
    Product(
        id = optString("id"),
        title = optString("title"),
        price = optDouble("price"),
        vendorId = firstString("vendor_id", "vendorId"),
        vendorName = firstString("vendor_name", "vendorName"),
        link = optString("link"),
        thumbnail = optString("thumbnail"),
        brandName = firstString("brand_name", "brand"),
        groupKey = firstString("group_key", "groupKey"),
        dosageValue = firstDouble("dosage_value", "dosageValue"),
        dosageUnit = firstNullableString("dosage_unit", "dosageUnit"),
        form = nullableString("form"),
        category = nullableString("category"),
        quantity = firstDouble("quantity", "quantityValue"),
        priceUpdatedAt = firstNullableString("price_updated_at", "updatedAt"),
    )

private fun JSONObject.nullableString(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() } else null

private fun JSONObject.nullableDouble(key: String): Double? =
    if (has(key) && !isNull(key)) optDouble(key) else null

private fun JSONObject.nullableBool(key: String): Boolean? =
    if (has(key) && !isNull(key)) optBoolean(key) else null

private fun JSONObject.firstString(vararg keys: String): String =
    keys.firstNotNullOfOrNull { key -> nullableString(key) }.orEmpty()

private fun JSONObject.firstNullableString(vararg keys: String): String? =
    keys.firstNotNullOfOrNull { key -> nullableString(key) }

private fun JSONObject.firstDouble(vararg keys: String): Double? =
    keys.firstNotNullOfOrNull { key -> nullableDouble(key) }

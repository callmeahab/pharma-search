package rs.aposteka.pharmasearch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

data class PlacesUiState(
    val places: List<PharmacyPlace> = emptyList(),
    val userLocation: LocationPoint? = null,
    val isLoadingPlaces: Boolean = false,
    val isLoadingLocation: Boolean = false,
    val errorMessage: String? = null,
)

class PlacesViewModel : ViewModel() {
    var uiState by mutableStateOf(PlacesUiState())
        private set

    fun load(baseUrl: String) {
        if (uiState.places.isNotEmpty() || uiState.isLoadingPlaces) return
        viewModelScope.launch {
            uiState = uiState.copy(isLoadingPlaces = true, errorMessage = null)
            runCatching {
                PharmaApiClient(baseUrl).places()
            }.onSuccess { places ->
                uiState = uiState.copy(
                    places = places.filter { it.latitude != 0.0 && it.longitude != 0.0 },
                    isLoadingPlaces = false,
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isLoadingPlaces = false,
                    errorMessage = error.message ?: "Nije moguće učitati lokacije.",
                )
            }
        }
    }

    fun loadLocation(context: Context) {
        if (uiState.isLoadingLocation) return
        viewModelScope.launch {
            uiState = uiState.copy(isLoadingLocation = true, errorMessage = null)
            val location = currentLocationOrNull(context)
            uiState = uiState.copy(
                userLocation = location,
                isLoadingLocation = false,
                errorMessage = if (location == null) "Nije moguće odrediti lokaciju." else null,
            )
        }
    }

    fun sortedPlaces(): List<PharmacyPlace> =
        uiState.userLocation?.let { location ->
            uiState.places.sortedBy { it.distanceMeters(location) ?: Double.MAX_VALUE }
        } ?: uiState.places
}

fun hasLocationPermission(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

private suspend fun currentLocationOrNull(context: Context): LocationPoint? {
    if (!hasLocationPermission(context)) return null
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .filter { provider -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }
    if (providers.isEmpty()) return null

    val recent = providers
        .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
        .maxByOrNull { it.time }
    if (recent != null && System.currentTimeMillis() - recent.time < 10 * 60 * 1000) {
        return recent.toPoint()
    }

    return withTimeoutOrNull(10_000) {
        suspendCancellableCoroutine { continuation ->
            val provider = providers.first()
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    manager.removeUpdates(this)
                    if (continuation.isActive) continuation.resume(location.toPoint())
                }

                override fun onProviderDisabled(provider: String) = Unit
                override fun onProviderEnabled(provider: String) = Unit
            }

            continuation.invokeOnCancellation { manager.removeUpdates(listener) }
            runCatching {
                manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
            }.onFailure {
                manager.removeUpdates(listener)
                if (continuation.isActive) continuation.resume(null)
            }
        }
    }
}

private fun Location.toPoint(): LocationPoint =
    LocationPoint(latitude = latitude, longitude = longitude)

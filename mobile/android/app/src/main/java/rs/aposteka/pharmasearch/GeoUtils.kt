package rs.aposteka.pharmasearch

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

private const val EARTH_RADIUS_METERS = 6_371_000.0

fun haversineMeters(
    startLatitude: Double,
    startLongitude: Double,
    endLatitude: Double,
    endLongitude: Double,
): Double {
    val startLat = Math.toRadians(startLatitude)
    val endLat = Math.toRadians(endLatitude)
    val deltaLat = Math.toRadians(endLatitude - startLatitude)
    val deltaLon = Math.toRadians(endLongitude - startLongitude)
    val a = sin(deltaLat / 2) * sin(deltaLat / 2) +
        cos(startLat) * cos(endLat) * sin(deltaLon / 2) * sin(deltaLon / 2)
    return EARTH_RADIUS_METERS * 2 * atan2(sqrt(a), sqrt(1 - a))
}

fun formatDistance(meters: Double): String =
    if (meters < 1000) {
        "${meters.roundToInt()} m"
    } else {
        String.format("%.1f km", meters / 1000)
    }

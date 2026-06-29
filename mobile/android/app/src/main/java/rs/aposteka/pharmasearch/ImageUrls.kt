package rs.aposteka.pharmasearch

import java.net.URI

fun resolvedImageUrl(thumbnail: String?, productLink: String? = null): String? {
    val raw = thumbnail?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (raw.startsWith("data:image", ignoreCase = true)) return null

    val clean = raw.replace(" ", "%20")
    if (clean.startsWith("http://", ignoreCase = true) || clean.startsWith("https://", ignoreCase = true)) {
        return clean
    }
    if (clean.startsWith("//")) {
        return "https:$clean"
    }

    val base = productLink?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { URI(base).resolve(clean).toString() }.getOrNull()
}

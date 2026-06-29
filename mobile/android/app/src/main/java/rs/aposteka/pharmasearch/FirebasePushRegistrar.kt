package rs.aposteka.pharmasearch

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

suspend fun firebaseMessagingTokenOrNull(): String? =
    suspendCancellableCoroutine { continuation ->
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener { task ->
                    val token = if (task.isSuccessful) task.result else null
                    if (continuation.isActive) {
                        continuation.resume(token)
                    }
                }
        } catch (_: Throwable) {
            if (continuation.isActive) {
                continuation.resume(null)
            }
        }
    }

package rs.aposteka.pharmasearch

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

class SessionViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("auth", Context.MODE_PRIVATE)

    var token by mutableStateOf<String?>(prefs.getString("authToken", null))
        private set

    var user by mutableStateOf<AuthUser?>(null)
        private set

    var isLoading by mutableStateOf(false)
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    val isSignedIn: Boolean
        get() = token != null && user != null

    fun restore(baseUrl: String) {
        val storedToken = token ?: return
        viewModelScope.launch {
            runCatching {
                PharmaApiClient(baseUrl).me(storedToken)
            }.onSuccess { restoredUser ->
                user = restoredUser
                registerPushTokenIfAvailable(baseUrl)
            }.onFailure {
                clearSession()
            }
        }
    }

    fun login(baseUrl: String, email: String, password: String) {
        authenticate(baseUrl) {
            PharmaApiClient(baseUrl).login(email, password)
        }
    }

    fun register(baseUrl: String, email: String, name: String, password: String) {
        authenticate(baseUrl) {
            PharmaApiClient(baseUrl).register(email, name, password)
        }
    }

    fun logout(baseUrl: String) {
        val existingToken = token
        viewModelScope.launch {
            if (existingToken != null) {
                runCatching { PharmaApiClient(baseUrl).logout(existingToken) }
            }
            clearSession()
        }
    }

    private fun authenticate(baseUrl: String, operation: suspend () -> SessionResponse) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null

            runCatching { operation() }
                .onSuccess { response ->
                    token = response.token
                    user = response.user
                    prefs.edit().putString("authToken", response.token).apply()
                    registerPushTokenIfAvailable(baseUrl)
                }
                .onFailure { error ->
                    errorMessage = error.message ?: "Prijava nije uspela."
                }

            isLoading = false
        }
    }

    private fun registerPushTokenIfAvailable(baseUrl: String) {
        val authToken = token ?: return
        viewModelScope.launch {
            val pushToken = firebaseMessagingTokenOrNull() ?: return@launch
            runCatching {
                PharmaApiClient(baseUrl).registerPushToken(pushToken, authToken, BuildConfig.VERSION_NAME)
            }.onFailure { error ->
                errorMessage = error.message
            }
        }
    }

    private fun clearSession() {
        token = null
        user = null
        prefs.edit().remove("authToken").apply()
    }
}

package rs.aposteka.pharmasearch

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class WatchlistUiState(
    val watches: List<Watch> = emptyList(),
    val alerts: List<AlertItem> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

class WatchlistViewModel : ViewModel() {
    var uiState by mutableStateOf(WatchlistUiState())
        private set

    fun load(baseUrl: String, token: String?) {
        if (token == null) {
            uiState = WatchlistUiState()
            return
        }

        viewModelScope.launch {
            uiState = uiState.copy(isLoading = true, errorMessage = null)
            val api = PharmaApiClient(baseUrl)
            runCatching {
                api.watches(token) to api.alerts(token)
            }.onSuccess { (watches, alerts) ->
                uiState = WatchlistUiState(watches = watches, alerts = alerts)
            }.onFailure { error ->
                uiState = WatchlistUiState(errorMessage = error.message ?: "Nije moguće učitati listu praćenja.")
            }
        }
    }

    fun remove(baseUrl: String, token: String?, watch: Watch) {
        token ?: return
        viewModelScope.launch {
            runCatching {
                PharmaApiClient(baseUrl).removeWatch(watch.groupKey, token)
            }.onSuccess {
                uiState = uiState.copy(watches = uiState.watches.filterNot { it.id == watch.id })
            }.onFailure { error ->
                uiState = uiState.copy(errorMessage = error.message ?: "Nije moguće ukloniti praćenje.")
            }
        }
    }
}

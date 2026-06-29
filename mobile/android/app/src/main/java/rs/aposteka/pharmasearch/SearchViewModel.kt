package rs.aposteka.pharmasearch

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

data class SearchUiState(
    val title: String = "Popularni proizvodi",
    val groups: List<ProductGroup> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

class SearchViewModel : ViewModel() {
    var query by mutableStateOf("")
        private set

    val baseUrl = ApiEnvironment.defaultBaseUrl

    var uiState by mutableStateOf(SearchUiState())
        private set

    private var activeJob: Job? = null

    init {
        loadFeatured()
    }

    fun updateQuery(value: String) {
        query = value
    }

    fun clearSearch() {
        query = ""
        loadFeatured()
    }

    fun submitSearch() {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) {
            loadFeatured()
            return
        }

        activeJob?.cancel()
        activeJob = viewModelScope.launch {
            uiState = uiState.copy(
                title = "Rezultati za $trimmed",
                isLoading = true,
                errorMessage = null,
            )

            runCatching {
                PharmaApiClient(baseUrl).searchGroups(trimmed)
            }.onSuccess { response ->
                uiState = SearchUiState(
                    title = "Rezultati za $trimmed",
                    groups = response.groups,
                    isLoading = false,
                    errorMessage = if (response.groups.isEmpty()) "Nema pronađenih proizvoda." else null,
                )
            }.onFailure { error ->
                uiState = SearchUiState(
                    title = "Rezultati za $trimmed",
                    isLoading = false,
                    errorMessage = error.message ?: "Pretraga nije uspela.",
                )
            }
        }
    }

    private fun loadFeatured() {
        activeJob?.cancel()
        activeJob = viewModelScope.launch {
            uiState = SearchUiState(isLoading = true)

            runCatching {
                PharmaApiClient(baseUrl).featured()
            }.onSuccess { response ->
                uiState = SearchUiState(
                    title = "Popularni proizvodi",
                    groups = response.groups,
                    isLoading = false,
                )
            }.onFailure { error ->
                uiState = SearchUiState(
                    title = "Popularni proizvodi",
                    isLoading = false,
                    errorMessage = error.message ?: "Nije moguće učitati proizvode.",
                )
            }
        }
    }
}

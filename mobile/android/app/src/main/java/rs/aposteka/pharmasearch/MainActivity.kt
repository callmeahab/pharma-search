package rs.aposteka.pharmasearch

import android.Manifest
import android.content.Intent
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val settings = getSharedPreferences("settings", Context.MODE_PRIVATE)
        setContent {
            var isDarkTheme by remember { mutableStateOf(settings.getBoolean("darkTheme", false)) }

            PharmaSearchTheme(darkTheme = isDarkTheme) {
                MainScreen(
                    isDarkTheme = isDarkTheme,
                    onDarkThemeChange = { enabled ->
                        isDarkTheme = enabled
                        settings.edit().putBoolean("darkTheme", enabled).apply()
                    },
                )
            }
        }
    }
}

private enum class AppTab {
    Search,
    Map,
    Watchlist,
    Account,
}

@Composable
private fun PharmaSearchTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    val colors = if (darkTheme) {
        darkColorScheme(
            primary = Color(0xFF58D68D),
            secondary = Color(0xFF8ACFA8),
            surface = Color(0xFF151A17),
            background = Color(0xFF0D1110),
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF16834A),
            secondary = Color(0xFF286B4C),
            surface = Color.White,
            background = Color(0xFFF6F7F8),
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(
    isDarkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    searchViewModel: SearchViewModel = viewModel(),
    sessionViewModel: SessionViewModel = viewModel(),
    watchlistViewModel: WatchlistViewModel = viewModel(),
    placesViewModel: PlacesViewModel = viewModel(),
) {
    var selectedTab by remember { mutableStateOf(AppTab.Search) }
    var selectedGroup by remember { mutableStateOf<ProductGroup?>(null) }
    var showingSettings by remember { mutableStateOf(false) }

    LaunchedEffect(searchViewModel.baseUrl) {
        sessionViewModel.restore(searchViewModel.baseUrl)
    }
    LaunchedEffect(searchViewModel.baseUrl, sessionViewModel.token) {
        watchlistViewModel.load(searchViewModel.baseUrl, sessionViewModel.token)
    }

    selectedGroup?.let { group ->
        ProductDetailScreen(
            group = group,
            baseUrl = searchViewModel.baseUrl,
            token = sessionViewModel.token,
            onBack = { selectedGroup = null },
            onWatchChanged = { watchlistViewModel.load(searchViewModel.baseUrl, sessionViewModel.token) },
        )
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (selectedTab) {
                            AppTab.Search -> "Aposteka"
                            AppTab.Map -> "Mapa"
                            AppTab.Watchlist -> "Praćenje"
                            AppTab.Account -> "Nalog"
                        },
                    )
                },
                actions = {
                    IconButton(onClick = { showingSettings = true }) {
                        Icon(Icons.Rounded.Settings, contentDescription = "Izgled")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == AppTab.Search,
                    onClick = { selectedTab = AppTab.Search },
                    icon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                    label = { Text("Pretraga") },
                )
                NavigationBarItem(
                    selected = selectedTab == AppTab.Map,
                    onClick = { selectedTab = AppTab.Map },
                    icon = { Icon(Icons.Rounded.Map, contentDescription = null) },
                    label = { Text("Mapa") },
                )
                NavigationBarItem(
                    selected = selectedTab == AppTab.Watchlist,
                    onClick = { selectedTab = AppTab.Watchlist },
                    icon = { Icon(Icons.Rounded.Notifications, contentDescription = null) },
                    label = { Text("Praćenje") },
                )
                NavigationBarItem(
                    selected = selectedTab == AppTab.Account,
                    onClick = { selectedTab = AppTab.Account },
                    icon = { Icon(Icons.Rounded.Person, contentDescription = null) },
                    label = { Text("Nalog") },
                )
            }
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(padding),
        ) {
            when (selectedTab) {
                AppTab.Search -> SearchTab(searchViewModel, onSelect = { selectedGroup = it })
                AppTab.Map -> MapTab(
                    baseUrl = searchViewModel.baseUrl,
                    viewModel = placesViewModel,
                )
                AppTab.Watchlist -> WatchlistTab(
                    token = sessionViewModel.token,
                    state = watchlistViewModel.uiState,
                    isSignedIn = sessionViewModel.isSignedIn,
                    onRefresh = { watchlistViewModel.load(searchViewModel.baseUrl, sessionViewModel.token) },
                    onRemove = { watchlistViewModel.remove(searchViewModel.baseUrl, sessionViewModel.token, it) },
                )
                AppTab.Account -> AccountTab(
                    baseUrl = searchViewModel.baseUrl,
                    session = sessionViewModel,
                )
            }
        }
    }

    if (showingSettings) {
        AppearanceDialog(
            isDarkTheme = isDarkTheme,
            onDarkThemeChange = onDarkThemeChange,
            onDismiss = { showingSettings = false },
        )
    }
}

@Composable
private fun SearchTab(
    viewModel: SearchViewModel,
    onSelect: (ProductGroup) -> Unit,
) {
    val state = viewModel.uiState

    Column(Modifier.fillMaxSize()) {
        SearchHeader(
            query = viewModel.query,
            onQueryChange = viewModel::updateQuery,
            onSearch = viewModel::submitSearch,
            onClear = viewModel::clearSearch,
        )

        when {
            state.isLoading -> LoadingState("Učitavanje proizvoda")
            state.groups.isEmpty() -> EmptyState(state.errorMessage ?: "Nema proizvoda za prikaz.")
            else -> ProductList(
                title = state.title,
                groups = state.groups,
                onSelect = onSelect,
            )
        }
    }
}

@Composable
private fun SearchHeader(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onClear: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .weight(1f)
                .height(58.dp),
            trailingIcon = {
                if (query.isNotBlank()) {
                    IconButton(onClick = onClear) {
                        Icon(Icons.Rounded.Close, contentDescription = "Obriši")
                    }
                }
            },
            placeholder = {
                Text(
                    "Pretraži proizvode",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { onSearch() }),
            shape = RoundedCornerShape(14.dp),
        )

        FilledIconButton(
            onClick = onSearch,
            modifier = Modifier.size(58.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Rounded.Search, contentDescription = "Pretraži")
        }
    }
}

@Composable
private fun MapTab(
    baseUrl: String,
    viewModel: PlacesViewModel,
) {
    val context = LocalContext.current
    val state = viewModel.uiState
    val places = viewModel.sortedPlaces()
    var selectedPlace by remember { mutableStateOf<PharmacyPlace?>(null) }
    val locationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { permissions ->
        if (permissions.values.any { it }) {
            viewModel.loadLocation(context)
        }
    }

    LaunchedEffect(baseUrl) {
        viewModel.load(baseUrl)
    }
    LaunchedEffect(places) {
        if (selectedPlace == null) {
            selectedPlace = places.firstOrNull()
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Button(
                onClick = {
                    if (hasLocationPermission(context)) {
                        viewModel.loadLocation(context)
                    } else {
                        locationLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                            ),
                        )
                    }
                },
                enabled = !state.isLoadingLocation,
            ) {
                if (state.isLoadingLocation) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Traženje lokacije")
                } else {
                    Icon(Icons.Rounded.MyLocation, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Moja lokacija")
                }
            }
            Text(
                text = if (state.userLocation != null) "Najbliže lokacije su sortirane." else "Učitajte lokaciju za najbliže apoteke.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray,
                modifier = Modifier.weight(1f),
            )
        }

        if (state.isLoadingPlaces) {
            LoadingState("Učitavanje lokacija")
            return
        }
        if (places.isEmpty()) {
            EmptyState(state.errorMessage ?: "Nema lokacija za prikaz.")
            return
        }

        PharmacyMapView(
            places = places,
            userLocation = state.userLocation,
            selectedPlace = selectedPlace,
            onSelect = { selectedPlace = it },
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        )

        if (state.errorMessage != null) {
            Text(
                text = state.errorMessage,
                color = Color(0xFFB3261E),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Text("Najbliže apoteke", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            items(places.take(20), key = { it.id }) { place ->
                PharmacyPlaceRow(
                    place = place,
                    userLocation = state.userLocation,
                    isSelected = selectedPlace?.id == place.id,
                    onClick = { selectedPlace = place },
                    onOpenMap = { openPlaceInMaps(context, place) },
                )
            }
        }
    }
}

@Composable
private fun PharmacyMapView(
    places: List<PharmacyPlace>,
    userLocation: LocationPoint?,
    selectedPlace: PharmacyPlace?,
    onSelect: (PharmacyPlace) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val fitKey = remember(places, userLocation) {
        "${places.size}:${userLocation?.latitude}:${userLocation?.longitude}"
    }
    var lastFitKey by remember { mutableStateOf("") }

    AndroidView(
        modifier = modifier,
        factory = { viewContext ->
            Configuration.getInstance().userAgentValue = viewContext.packageName
            MapView(viewContext).apply {
                setTileSource(TileSourceFactory.MAPNIK)
                setMultiTouchControls(true)
                controller.setZoom(7.0)
                controller.setCenter(GeoPoint(44.0165, 21.0059))
            }
        },
        update = { map ->
            map.overlays.clear()
            userLocation?.let { location ->
                Marker(map).apply {
                    position = GeoPoint(location.latitude, location.longitude)
                    title = "Vaša lokacija"
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    map.overlays.add(this)
                }
            }
            places.take(400).forEach { place ->
                Marker(map).apply {
                    position = GeoPoint(place.latitude, place.longitude)
                    title = place.title
                    snippet = place.displayAddress
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    setOnMarkerClickListener { marker, _ ->
                        onSelect(place)
                        marker.showInfoWindow()
                        true
                    }
                    map.overlays.add(this)
                    if (selectedPlace?.id == place.id) {
                        showInfoWindow()
                    }
                }
            }
            if (lastFitKey != fitKey) {
                val points = places.take(150).map { GeoPoint(it.latitude, it.longitude) } +
                    listOfNotNull(userLocation?.let { GeoPoint(it.latitude, it.longitude) })
                when (points.size) {
                    0 -> Unit
                    1 -> {
                        map.controller.setZoom(14.0)
                        map.controller.setCenter(points.first())
                    }
                    else -> map.zoomToBoundingBox(BoundingBox.fromGeoPoints(points), true, 80)
                }
                lastFitKey = fitKey
            }
            map.invalidate()
        },
    )
}

@Composable
private fun PharmacyPlaceRow(
    place: PharmacyPlace,
    userLocation: LocationPoint?,
    isSelected: Boolean,
    onClick: () -> Unit,
    onOpenMap: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) Color(0xFFE8F5ED) else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Rounded.Place, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(place.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (place.displayAddress.isNotBlank()) {
                    Text(place.displayAddress, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    place.distanceMeters(userLocation)?.let { meters ->
                        Text(formatDistance(meters), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                    }
                    place.openNow?.let { open ->
                        Text(if (open) "Otvoreno" else "Zatvoreno", color = Color.Gray)
                    }
                }
            }
            TextButton(onClick = onOpenMap) {
                Text("Ruta")
            }
        }
    }
}

private fun openPlaceInMaps(context: Context, place: PharmacyPlace) {
    val fallback = "geo:${place.latitude},${place.longitude}?q=${place.latitude},${place.longitude}(${Uri.encode(place.title)})"
    val uri = Uri.parse(place.mapsUrl.ifBlank { fallback })
    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
}

@Composable
private fun WatchlistTab(
    token: String?,
    state: WatchlistUiState,
    isSignedIn: Boolean,
    onRefresh: () -> Unit,
    onRemove: (Watch) -> Unit,
) {
    if (!isSignedIn) {
        EmptyState("Prijavite se da pratite cene i dobijate obaveštenja o pojeftinjenjima.")
        return
    }
    if (state.isLoading) {
        LoadingState("Učitavanje liste praćenja")
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Proizvodi koje pratite", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onRefresh, enabled = token != null) {
                    Text("Osveži")
                }
            }
        }

        if (state.errorMessage != null) {
            item {
                Text(state.errorMessage, color = Color(0xFFB3261E))
            }
        }

        if (state.watches.isEmpty()) {
            item {
                Text("Još nema proizvoda za praćenje.", color = Color.Gray)
            }
        } else {
            items(state.watches, key = { it.id }) { watch ->
                WatchCard(watch = watch, onRemove = { onRemove(watch) })
            }
        }

        item {
            Text("Nedavna obaveštenja", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        if (state.alerts.isEmpty()) {
            item {
                Text("Još nema obaveštenja o cenama.", color = Color.Gray)
            }
        } else {
            items(state.alerts, key = { "${it.groupKey}-${it.sentAt}-${it.kind}" }) { alert ->
                AlertCard(alert)
            }
        }
    }
}

@Composable
private fun AccountTab(
    baseUrl: String,
    session: SessionViewModel,
) {
    var isRegistering by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    val user = session.user
                    if (user != null) {
                        Text("Prijavljeni ste", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(user.email)
                        if (user.name.isNotBlank()) {
                            Text(user.name, color = Color.Gray)
                        }
                        Button(onClick = { session.logout(baseUrl) }) {
                            Text("Odjavi se")
                        }
                    } else {
                        Text(if (isRegistering) "Napravi nalog" else "Prijavi se", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { isRegistering = false }) {
                                Text("Prijavi se")
                            }
                            TextButton(onClick = { isRegistering = true }) {
                                Text("Napravi nalog")
                            }
                        }
                        if (isRegistering) {
                            OutlinedTextField(
                                value = name,
                                onValueChange = { name = it },
                                label = { Text("Ime") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("E-pošta") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Lozinka") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                if (isRegistering) {
                                    session.register(baseUrl, email, name, password)
                                } else {
                                    session.login(baseUrl, email, password)
                                }
                            },
                            enabled = email.isNotBlank() && password.isNotBlank() && !session.isLoading,
                        ) {
                            if (session.isLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            } else {
                                Text(if (isRegistering) "Napravi nalog" else "Prijavi se")
                            }
                        }
                    }
                    if (session.errorMessage != null) {
                        Text(session.errorMessage!!, color = Color(0xFFB3261E))
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductList(
    title: String,
    groups: List<ProductGroup>,
    onSelect: (ProductGroup) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Text(groups.size.toString(), color = Color.Gray)
            }
        }

        items(groups, key = { it.id }) { group ->
            ProductGroupCard(group = group, onClick = { onSelect(group) })
        }
    }
}

@Composable
private fun ProductGroupCard(group: ProductGroup, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ProductThumbnail(thumbnail = group.displayImageProduct?.thumbnail, productLink = group.displayImageProduct?.link)

            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    text = group.normalizedName,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = group.bestOffer?.vendorName ?: "Najbolja dostupna ponuda",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.Gray,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = formatPrice(group.priceRange.min),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = pharmacyCountText(group.vendorCount),
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.Gray,
                    )
                }
            }

            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = Color.LightGray)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProductDetailScreen(
    group: ProductGroup,
    baseUrl: String,
    token: String?,
    onBack: () -> Unit,
    onWatchChanged: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isSavingWatch by remember { mutableStateOf(false) }
    var watchMessage by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Uporedi cene") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Nazad")
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        ProductThumbnail(thumbnail = group.displayImageProduct?.thumbnail, productLink = group.displayImageProduct?.link, size = 72)
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(group.normalizedName, style = MaterialTheme.typography.titleLarge)
                            Text("${pharmacyCountText(group.vendorCount)}, ${offerCountText(group.productCount)}", color = Color.Gray)
                            Text(
                                "Od ${formatPrice(group.priceRange.min)}",
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
            }

            item {
                Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (token == null) {
                            Text("Prijavite se da pratite ovu cenu.", color = Color.Gray)
                        } else {
                            Button(
                                onClick = {
                                    scope.launch {
                                        isSavingWatch = true
                                        runCatching {
                                            PharmaApiClient(baseUrl).addWatch(group, token)
                                        }.onSuccess {
                                            watchMessage = "Dodato na listu praćenja."
                                            onWatchChanged()
                                        }.onFailure { error ->
                                            watchMessage = error.message ?: "Nije moguće dodati praćenje."
                                        }
                                        isSavingWatch = false
                                    }
                                },
                                enabled = !isSavingWatch,
                            ) {
                                if (isSavingWatch) {
                                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                } else {
                                    Text("Prati cenu")
                                }
                            }
                        }
                        if (watchMessage != null) {
                            Text(watchMessage!!, color = Color.Gray)
                        }
                    }
                }
            }

            items(group.products.sortedBy { it.price }, key = { it.id }) { product ->
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(product.vendorName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.weight(1f))
                            Text(
                                formatPrice(product.price),
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        Text(product.title, color = Color.Gray)
                        TextButton(
                            onClick = {
                                if (product.link.isNotBlank()) {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(product.link)))
                                }
                            },
                            enabled = product.link.isNotBlank(),
                        ) {
                            Icon(Icons.Rounded.OpenInBrowser, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Otvori ponudu")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WatchCard(watch: Watch, onRemove: () -> Unit) {
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ProductThumbnail(thumbnail = watch.thumbnail)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(watch.displayName.ifBlank { "Praćeni proizvod" }, style = MaterialTheme.typography.titleMedium, maxLines = 2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (watch.lastPrice != null) {
                        Text(formatPrice(watch.lastPrice), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    }
                    if (watch.lastVendor.isNotBlank()) {
                        Text(watch.lastVendor, color = Color.Gray, maxLines = 1)
                    }
                }
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Rounded.Delete, contentDescription = "Ukloni")
            }
        }
    }
}

@Composable
private fun AlertCard(alert: AlertItem) {
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(alert.displayName.ifBlank { "Obaveštenje o ceni" }, style = MaterialTheme.typography.titleMedium, maxLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (alert.newPrice != null) {
                    Text(formatPrice(alert.newPrice), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                }
                Text(if (alert.kind == "target") "Ciljna cena dostignuta" else "Cena je pala", color = Color.Gray)
            }
            if (alert.vendor.isNotBlank()) {
                Text(alert.vendor, color = Color.Gray)
            }
        }
    }
}

@Composable
private fun ProductThumbnail(
    thumbnail: String?,
    productLink: String? = null,
    size: Int = 60,
) {
    val imageUrl = remember(thumbnail, productLink) { resolvedImageUrl(thumbnail, productLink) }
    var imageFailed by remember(imageUrl) { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xFFEAF6EF)),
        contentAlignment = Alignment.Center,
    ) {
        if (imageUrl != null && !imageFailed) {
            AsyncImage(
                model = imageUrl,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .padding((size * 0.12).dp),
                onError = { imageFailed = true },
            )
        } else {
            ProductIcon(size = size)
        }
    }
}

@Composable
private fun ProductIcon(size: Int = 60) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xFFEAF6EF)),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(id = R.drawable.app_logo),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .padding((size * 0.12).dp),
        )
    }
}

@Composable
private fun LoadingState(message: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator()
            Text(message, color = Color.Gray)
        }
    }
}

@Composable
private fun EmptyState(message: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(message, color = Color.Gray)
    }
}

@Composable
private fun AppearanceDialog(
    isDarkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Izgled") },
        text = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Tamna tema", style = MaterialTheme.typography.bodyLarge)
                Switch(checked = isDarkTheme, onCheckedChange = onDarkThemeChange)
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Gotovo")
            }
        },
    )
}

private fun pharmacyCountText(count: Int): String =
    "$count ${serbianPlural(count, one = "apoteka", few = "apoteke", many = "apoteka")}"

private fun offerCountText(count: Int): String =
    "$count ${serbianPlural(count, one = "ponuda", few = "ponude", many = "ponuda")}"

private fun serbianPlural(count: Int, one: String, few: String, many: String): String {
    val mod10 = count % 10
    val mod100 = count % 100
    return when {
        mod10 == 1 && mod100 != 11 -> one
        mod10 in 2..4 && mod100 !in 12..14 -> few
        else -> many
    }
}

private fun formatPrice(price: Double): String {
    val formatter = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("sr-RS"))
    formatter.maximumFractionDigits = 0
    return formatter.format(price)
}

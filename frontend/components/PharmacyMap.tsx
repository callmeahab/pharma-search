"use client";

import maplibregl, {
  GeoJSONSource,
  type FilterSpecification,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { ExternalLink, Globe, LocateFixed, Mail, MapPin, Phone } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { PharmacyPlace, placeDirectionsUrl, telHref } from "@/lib/vendors";

const MIN_ZOOM = 5;
const MAX_ZOOM = 17;
const DEFAULT_CENTER: [number, number] = [21.0059, 44.0165];
const SOURCE_ID = "pharmacy-places";
const CLUSTER_LAYER_ID = "pharmacy-clusters";
const CLUSTER_COUNT_LAYER_ID = "pharmacy-cluster-count";
const POINT_LAYER_ID = "pharmacy-points";
const POINT_LABEL_LAYER_ID = "pharmacy-point-labels";
const SELECTED_LAYER_ID = "pharmacy-selected-point";
const PIN_IMAGE_ID = "pharmacy-pin";

const LIGHT_MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function PharmacyMap({
  places,
  selectedId,
  onSelect,
}: {
  places: PharmacyPlace[];
  selectedId?: string;
  onSelect?: (place: PharmacyPlace) => void;
}) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapStyleRef = useRef("");
  const placesRef = useRef<PharmacyPlace[]>(places);
  const placesByIdRef = useRef<Map<string, PharmacyPlace>>(new Map());
  const onSelectRef = useRef<typeof onSelect>(onSelect);
  const selectedPlaceIdRef = useRef<string>("");
  const previousSelectedIdRef = useRef<string>("");

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedId) || places[0],
    [places, selectedId]
  );
  const selectedPlacesAtLocation = useMemo(() => {
    if (!selectedPlace) return [];
    const selectedLocation = placeLocationKey(selectedPlace);
    return places.filter((place) => placeLocationKey(place) === selectedLocation);
  }, [places, selectedPlace]);
  const placesKey = useMemo(() => places.map((place) => place.id).join("|"), [places]);

  useEffect(() => {
    placesRef.current = places;
    placesByIdRef.current = new Map(places.map((place) => [place.id, place]));
    onSelectRef.current = onSelect;
    selectedPlaceIdRef.current = selectedPlace?.id || "";
  }, [places, onSelect, selectedPlace?.id]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialStyle = mapStyleForTheme(document.documentElement.classList.contains("dark") ? "dark" : theme);
    mapStyleRef.current = initialStyle;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: DEFAULT_CENTER,
      zoom: 7,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      scrollZoom: true,
    });

    mapRef.current = map;
    map.scrollZoom.setZoomRate(1 / 160);
    map.scrollZoom.setWheelZoomRate(1 / 700);
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right"
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      addPlaceLayers(map, placesRef.current, isDarkMapStyle(mapStyleRef.current));
      setSelectedFilter(map, selectedPlaceIdRef.current);
      fitMapToPlaces(map, placesRef.current, 0);

      map.on("click", CLUSTER_LAYER_ID, handleClusterClick);
      map.on("click", POINT_LAYER_ID, handlePointClick);
      map.on("mouseenter", CLUSTER_LAYER_ID, () => setMapCursor(map, "pointer"));
      map.on("mouseleave", CLUSTER_LAYER_ID, () => setMapCursor(map, ""));
      map.on("mouseenter", POINT_LAYER_ID, () => setMapCursor(map, "pointer"));
      map.on("mouseleave", POINT_LAYER_ID, () => setMapCursor(map, ""));
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const nextStyle = mapStyleForTheme(theme);
    if (mapStyleRef.current === nextStyle) return;

    mapStyleRef.current = nextStyle;
    map.setStyle(nextStyle);

    const restorePlaceLayers = () => {
      addPlaceLayers(map, placesRef.current, isDarkMapStyle(nextStyle));
      setSelectedFilter(map, selectedPlaceIdRef.current);
    };
    map.once("style.load", restorePlaceLayers);

    return () => {
      map.off("style.load", restorePlaceLayers);
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    const source = map.getSource(SOURCE_ID);
    if (!source) return;

    (source as GeoJSONSource).setData(makeFeatureCollection(places));
    fitMapToPlaces(map, places, 450);
  }, [placesKey, places]);

  useEffect(() => {
    const map = mapRef.current;
    const nextSelectedId = selectedPlace?.id || "";
    previousSelectedIdRef.current ||= nextSelectedId;

    if (!map || !map.loaded()) return;
    setSelectedFilter(map, nextSelectedId);

    const selectedChanged =
      nextSelectedId && previousSelectedIdRef.current && previousSelectedIdRef.current !== nextSelectedId;
    previousSelectedIdRef.current = nextSelectedId;

    if (!selectedChanged || !selectedPlace) return;
    map.easeTo({
      center: [selectedPlace.longitude, selectedPlace.latitude],
      zoom: Math.max(map.getZoom(), 12),
      duration: 450,
      essential: true,
    });
  }, [selectedPlace]);

  function handleClusterClick(event: MapLayerMouseEvent) {
    const map = mapRef.current;
    const feature = event.features?.[0];
    if (!map || !feature) return;

    const clusterId = feature.properties?.cluster_id;
    const source = map.getSource(SOURCE_ID);
    const geometry = feature.geometry;
    if (typeof clusterId !== "number" || !source || geometry.type !== "Point") return;

    (source as GeoJSONSource).getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({
        center: geometry.coordinates as [number, number],
        zoom: Math.min(zoom, MAX_ZOOM),
        duration: 500,
        essential: true,
      });
    });
  }

  function handlePointClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    const placeId = typeof feature?.properties?.id === "string" ? feature.properties.id : "";
    const place = placesByIdRef.current.get(placeId);
    if (!place) return;

    onSelectRef.current?.(place);
  }

  function resetView() {
    const map = mapRef.current;
    if (!map) return;
    fitMapToPlaces(map, places, 500);
  }

  if (places.length === 0) {
    return null;
  }

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="relative h-[420px] overflow-hidden">
        <div ref={containerRef} className="h-full w-full" />

        <button
          type="button"
          title="Prikazi sve"
          aria-label="Prikazi sve lokacije"
          onClick={resetView}
          className="absolute right-[10px] top-[78px] z-10 grid h-[31px] w-[31px] place-items-center rounded-lg border border-gray-200 bg-white text-[#333] shadow-[0_0_0_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-[#f2f2f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-health-primary dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-100 dark:shadow-[0_10px_24px_rgba(0,0,0,0.28),0_0_0_1px_rgba(255,255,255,0.08)] dark:hover:bg-gray-800"
        >
          <LocateFixed size={17} strokeWidth={2.4} />
        </button>

        {selectedPlace && (
          <div
            className="pointer-events-auto absolute bottom-3 left-3 z-10 max-h-[min(18rem,calc(100%-1.5rem))] max-w-[min(25rem,calc(100%-1.5rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            {selectedPlacesAtLocation.length > 1 ? (
              <>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {selectedPlacesAtLocation.length.toLocaleString("sr-RS")} lokacija na ovoj adresi
                </h2>
                {placeAddress(selectedPlace) && (
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">
                    {placeAddress(selectedPlace)}
                  </p>
                )}
                <div className="mt-2 divide-y divide-gray-200 dark:divide-gray-700">
                  {selectedPlacesAtLocation.map((place) => (
                    <MapInfoPlace key={place.id} place={place} compact />
                  ))}
                </div>
              </>
            ) : (
              <MapInfoPlace place={selectedPlace} showAddress />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function MapInfoPlace({
  place,
  compact = false,
  showAddress = false,
}: {
  place: PharmacyPlace;
  compact?: boolean;
  showAddress?: boolean;
}) {
  const address = placeAddress(place);
  const website = place.website || place.vendor_website;
  const photo = showAddress ? place.photos?.[0] : undefined;

  return (
    <div className={compact ? "py-2 first:pt-0 last:pb-0" : ""}>
      {photo?.url && (
        <div className="-mx-3 -mt-3 mb-3 aspect-[16/9] overflow-hidden rounded-t-lg bg-gray-100 dark:bg-gray-800">
          {/* eslint-disable-next-line @next/next/no-img-element -- Foursquare place photos are remote runtime URLs */}
          <img
            src={photo.original_url || photo.url}
            alt={place.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{place.name}</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">{place.vendor_name}</p>
      {showAddress && address && (
        <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{address}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {place.phone && (
          <a
            href={telHref(place.phone)}
            className="inline-flex items-center gap-1 rounded-md bg-health-primary px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-health-secondary"
          >
            <Phone size={13} />
            Pozovi
          </a>
        )}
        <a
          href={placeDirectionsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <MapPin size={13} />
          Mapa
        </a>
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Globe size={13} />
            Sajt
            <ExternalLink size={11} />
          </a>
        )}
        {place.email && (
          <a
            href={`mailto:${place.email}`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Mail size={13} />
            Email
          </a>
        )}
      </div>
    </div>
  );
}

function placeAddress(place: PharmacyPlace): string {
  return place.formatted_address || [place.address, place.city].filter(Boolean).join(", ");
}

function placeLocationKey(place: PharmacyPlace): string {
  return `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
}

function mapStyleForTheme(theme: "light" | "dark"): string {
  return theme === "dark" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE;
}

function isDarkMapStyle(style: string): boolean {
  return style === DARK_MAP_STYLE;
}

function addPlaceLayers(map: MapLibreMap, places: PharmacyPlace[], darkMode = false) {
  if (map.getSource(SOURCE_ID)) return;
  addPharmacyPinImage(map);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: makeFeatureCollection(places),
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 26,
    clusterMinPoints: 4,
  });

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": ["step", ["get", "point_count"], "#16a34a", 10, "#0d9488", 30, "#2563eb"],
      "circle-opacity": 0.88,
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 30, 26],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Open Sans Semibold"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  map.addLayer({
    id: SELECTED_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: selectedFilter(""),
    paint: {
      "circle-color": "#0f766e",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 12, 12, 18, 16, 24],
      "circle-opacity": 0.2,
      "circle-stroke-color": "#0f766e",
      "circle-stroke-width": 3,
    },
  });

  map.addLayer({
    id: POINT_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": PIN_IMAGE_ID,
      "icon-anchor": "center",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 12, 0.72, 16, 0.94],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-padding": 3,
    },
  });

  map.addLayer({
    id: POINT_LABEL_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    minzoom: 15,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Regular"],
      "text-size": 10,
      "text-offset": [0, 1.45],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": darkMode ? "#f9fafb" : "#111827",
      "text-halo-color": darkMode ? "#111827" : "#ffffff",
      "text-halo-width": 1.2,
    },
  });
}

function addPharmacyPinImage(map: MapLibreMap) {
  if (map.hasImage(PIN_IMAGE_ID)) return;

  const canvas = document.createElement("canvas");
  canvas.width = 88;
  canvas.height = 88;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.shadowColor = "rgba(15, 23, 42, 0.34)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(44, 42, 28, 0, Math.PI * 2);
  ctx.fillStyle = "#15803d";
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(44, 42, 19, 0, Math.PI * 2);
  ctx.fillStyle = "#16a34a";
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, 39, 27, 10, 30, 3);
  roundedRect(ctx, 29, 37, 30, 10, 3);

  map.addImage(PIN_IMAGE_ID, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function makeFeatureCollection(places: PharmacyPlace[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      properties: {
        id: place.id,
        name: place.name,
        vendorName: place.vendor_name,
        city: place.city,
      },
      geometry: {
        type: "Point",
        coordinates: [place.longitude, place.latitude],
      },
    })),
  };
}

function fitMapToPlaces(map: MapLibreMap, places: PharmacyPlace[], duration: number) {
  if (places.length === 0) return;

  if (places.length === 1) {
    map.easeTo({
      center: [places[0].longitude, places[0].latitude],
      zoom: 13,
      duration,
      essential: true,
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  places.forEach((place) => bounds.extend([place.longitude, place.latitude]));
  map.fitBounds(bounds, {
    padding: { top: 48, right: 48, bottom: 88, left: 48 },
    maxZoom: 13,
    duration,
    essential: true,
  });
}

function setSelectedFilter(map: MapLibreMap, selectedId: string) {
  if (!map.getLayer(SELECTED_LAYER_ID)) return;
  map.setFilter(SELECTED_LAYER_ID, selectedFilter(selectedId));
}

function selectedFilter(selectedId: string): FilterSpecification {
  return ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], selectedId]];
}

function setMapCursor(map: MapLibreMap, cursor: string) {
  map.getCanvas().style.cursor = cursor;
}

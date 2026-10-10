import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { OfferMapFilters, OfferMapItem } from '../types/offerMap';
import {
  activeOfferMapFilterCount,
} from '../types/offerMap';
import {
  groupOfferMapItems,
  OfferMapDetailSheet,
  OfferMapFilterSheet,
  OfferMapHeader,
  OfferMapLegend,
  OfferMapStatusOverlay,
  offerMapApplicationLabel,
  offerMapContractLabel,
  offerMapGroupMarkerIcon,
  offerMapLabelColor,
  offerMapMarkerAccessibilityLabel,
  offerMapProductLabel,
} from './offer-map/OfferMapControls';
import { techUi } from './technician/TechnicianUI';
import { buildOfferMapMarkerUpdateScript } from '../utils/offerMapWebViewBridge';
import { offerMapGroupTierInput, resolveOfferMapMarkerTiers } from '../utils/offerMapMarkerTier';

export interface OfferMapProps {
  offers: OfferMapItem[];
  filters: OfferMapFilters;
  onFiltersChange: (filters: OfferMapFilters) => void;
  loading: boolean;
  error: Error | null;
  totalCount: number;
  unmappedCount: number;
  onRetry: () => void;
  onBack?: () => void;
  /** Rediseño, fase 5A: el botón "List" de la cabecera, para volver a la lista. */
  onShowList?: () => void;
  onViewOffer: (offerId: string) => void;
}

const MAP_READY_TIMEOUT_MS = 12_000;

/** Debe coincidir con el `setView` inicial del HTML de abajo. */
const OFFER_MAP_INITIAL_ZOOM = 3;

const LEAFLET_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
    #map { position: absolute; inset: 0; background: #E2EBF2; }
    .leaflet-top.leaflet-left { top: 96px !important; left: 12px !important; }
    .leaflet-control-attribution { font-size: 8px !important; }
    .offer-map-marker-icon {
      background: transparent !important;
      border: 0 !important;
    }
    .offer-map-marker-icon svg {
      display: block;
      filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.24));
    }
    .offer-map-marker-icon.is-selected .offer-marker-selection { opacity: 1; }
    .offer-map-marker-icon:focus-visible {
      outline: 3px solid #0891B2;
      outline-offset: 1px;
      border-radius: 18px;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function installEarlyErrorRelay() {
      function earlyPost(message) {
        try { window.ReactNativeWebView.postMessage(message); } catch (error) {}
      }
      window.__offerMapPost = earlyPost;
      window.onerror = function(message, source, line, column, error) {
        var detail = error && error.message ? error.message : String(message || 'unknown JavaScript error');
        earlyPost('offer-map-error:JavaScript error: ' + detail);
        return false;
      };
      window.onunhandledrejection = function(event) {
        var reason = event && event.reason;
        var detail = reason && reason.message ? reason.message : String(reason || 'unhandled promise rejection');
        earlyPost('offer-map-error:JavaScript error: ' + detail);
      };
      earlyPost('offer-map-html-started');
    })();
  </script>
  <script>
    function post(message) {
      try {
        if (typeof window.__offerMapPost === 'function') window.__offerMapPost(message);
        else window.ReactNativeWebView.postMessage(message);
      } catch (error) {}
    }
    var map = null;
    var markersLayer = null;
    var markersByGroupKey = {};
    var selectedGroupKey = null;
    var ready = false;
    var pendingPayload = null;

    function updateSelectedMarker(groupKey) {
      selectedGroupKey = groupKey || null;
      Object.keys(markersByGroupKey).forEach(function(key) {
        markersByGroupKey[key].setZIndexOffset(key === selectedGroupKey ? 10000 : 0);
        var element = markersByGroupKey[key].getElement();
        if (!element) return;
        if (key === selectedGroupKey) element.classList.add('is-selected');
        else element.classList.remove('is-selected');
      });
    }

    window.setSelectedOfferGroup = updateSelectedMarker;

    function postZoom() {
      if (map) post('offer-map-zoom:' + map.getZoom());
    }

    // fit sólo viene a true cuando cambian las ofertas. Un repintado por
    // cambio de nivel de marcador NO puede reencuadrar: le robaría el zoom
    // al usuario justo después de que lo haya hecho a mano.
    function renderGroups(groups, fit) {
      markersLayer.clearLayers();
      markersByGroupKey = {};
      var bounds = [];
      groups.forEach(function(group) {
        var latitude = Number(group.latitude);
        var longitude = Number(group.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !group.offers.length) return;
        var icon = L.divIcon({
          className: 'offer-map-marker-icon',
          html: group.markerSvg,
          iconSize: group.iconSize,
          iconAnchor: group.iconAnchor,
          popupAnchor: group.popupAnchor,
        });
        var marker = L.marker([latitude, longitude], {
          icon: icon,
          keyboard: true,
          riseOnHover: true,
          title: group.accessibilityLabel,
        });
        marker.on('click', function() {
          updateSelectedMarker(group.key);
          post('offer-map-select:' + group.key);
        });
        marker.addTo(markersLayer);
        markersByGroupKey[group.key] = marker;
        var markerElement = marker.getElement();
        if (markerElement) {
          markerElement.setAttribute('aria-label', group.accessibilityLabel);
          markerElement.setAttribute('role', 'button');
        }
        bounds.push([latitude, longitude]);
      });

      updateSelectedMarker(selectedGroupKey);

      if (fit) {
        if (bounds.length === 1) map.setView(bounds[0], 6);
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [120, 100], maxZoom: 7 });
        // Un encuadre que no cambia el zoom no dispara zoomend, así que el
        // nivel se anuncia siempre y React Native nunca se queda desfasado.
        postZoom();
      }
      post('offer-map-markers:' + groups.length);
    }

    function parsePayload(payload) {
      var parsed = JSON.parse(payload);
      if (!parsed || !Array.isArray(parsed.groups)) throw new Error('Offer marker payload has no group list');
      return parsed;
    }

    window.updateOfferMarkers = function(payload) {
      post('offer-map-update-received');
      try {
        if (!ready || !markersLayer) {
          pendingPayload = payload;
          return;
        }
        var parsed = parsePayload(payload);
        renderGroups(parsed.groups, parsed.fit);
      } catch (error) {
        post('offer-map-error:' + (error.message || 'marker error'));
      }
    };

    function initMap() {
      try {
        post('offer-map-leaflet-loaded');
        map = L.map('map', { zoomControl: true }).setView([48.5, 8.0], 3);
        post('offer-map-created');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);
        post('offer-map-marker-layer-created');
        map.on('zoomend', postZoom);
        ready = true;
        post('offer-map-ready');
        postZoom();
        if (pendingPayload !== null) {
          var payload = pendingPayload;
          pendingPayload = null;
          var parsed = parsePayload(payload);
          renderGroups(parsed.groups, parsed.fit);
        }
      } catch (error) {
        post('offer-map-error:' + (error.message || 'initialization error'));
      }
    }
  </script>
  <script
    src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"
    crossorigin=""
    onload="initMap()"
    onerror="window.__offerMapPost && window.__offerMapPost('offer-map-error:Leaflet failed to load')"
  ></script>
</body>
</html>`;

export function OfferMap({
  offers,
  filters,
  onFiltersChange,
  loading,
  error,
  totalCount,
  unmappedCount,
  onRetry,
  onBack,
  onShowList,
  onViewOffer,
}: OfferMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [zoom, setZoom] = useState(OFFER_MAP_INITIAL_ZOOM);
  const groups = useMemo(() => groupOfferMapItems(offers), [offers]);
  const tiers = useMemo(
    () => resolveOfferMapMarkerTiers(groups.map(offerMapGroupTierInput), zoom),
    [groups, zoom],
  );
  const selectedGroup = selectedGroupKey
    ? groups.find((group) => group.key === selectedGroupKey) ?? null
    : null;
  const markerGroups = useMemo(() => groups.map((group) => ({
    ...group,
    accessibilityLabel: offerMapMarkerAccessibilityLabel(group),
    ...offerMapGroupMarkerIcon(group, tiers.get(group.key) ?? 'label'),
    offers: group.offers.map((offer) => ({
      id: offer.id,
      title: offer.title,
      companyName: offer.companyName,
      location: offer.location,
      score: offer.score,
      matchLabel: offer.matchLabel,
      blocked: offer.blockers.length > 0,
      labelColor: offerMapLabelColor(offer),
      contractLabel: offerMapContractLabel(offer.contractType),
      productLabel: offerMapProductLabel(offer.productType),
      applicationLabel: offerMapApplicationLabel(offer.applicationStatus),
      approximate: offer.locationPrecision === 'country',
    })),
  })), [groups, tiers]);

  /** Reencuadrar sólo cuando cambian las ofertas, no cuando cambia el zoom. */
  const fitKey = useMemo(
    () => groups.map((group) => `${group.key}:${group.latitude},${group.longitude}`).join('|'),
    [groups],
  );
  const fittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mapReady) return;
    const fit = fittedKeyRef.current !== fitKey;
    fittedKeyRef.current = fitKey;
    webViewRef.current?.injectJavaScript(
      buildOfferMapMarkerUpdateScript({ groups: markerGroups, fit }),
    );
  }, [fitKey, markerGroups, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    webViewRef.current?.injectJavaScript(
      `window.setSelectedOfferGroup(${JSON.stringify(selectedGroupKey)});true;`,
    );
  }, [mapReady, selectedGroupKey]);

  useEffect(() => {
    if (mapReady || mapError || error) return;
    const timeout = setTimeout(() => {
      setMapError('The map took too long to initialize. Check your connection and try again.');
    }, MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [error, mapKey, mapReady, mapError]);

  function handleMessage(event: WebViewMessageEvent) {
    const message = event.nativeEvent.data;
    if (message === 'offer-map-ready') {
      setMapReady(true);
      setMapError(null);
      return;
    }
    if (message.startsWith('offer-map-select:')) {
      setSelectedGroupKey(message.slice('offer-map-select:'.length));
      return;
    }
    if (message.startsWith('offer-map-zoom:')) {
      const nextZoom = Number(message.slice('offer-map-zoom:'.length));
      if (Number.isFinite(nextZoom)) setZoom(nextZoom);
      return;
    }
    if (message.startsWith('offer-map-error:')) {
      setMapReady(false);
      setMapError(message.slice('offer-map-error:'.length));
    }
  }

  function retryMap() {
    setMapReady(false);
    setMapError(null);
    fittedKeyRef.current = null;
    setZoom(OFFER_MAP_INITIAL_ZOOM);
    setMapKey((value) => value + 1);
  }

  const filterCount = activeOfferMapFilterCount(filters);
  const effectiveError = error?.message ?? mapError;
  const emptyBecauseFilters = !loading && !effectiveError && offers.length === 0 && totalCount > 0 && filterCount > 0;
  const emptyBecauseLocations = !loading && !effectiveError && offers.length === 0 && totalCount > 0 && unmappedCount === totalCount;
  const emptyPublished = !loading && !effectiveError && totalCount === 0;

  return (
    <View style={styles.container}>
      <View style={styles.webViewContainer}>
        <WebView
          key={mapKey}
          ref={webViewRef}
          source={{ html: LEAFLET_HTML }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onLoadStart={() => {
            setMapReady(false);
            setMapError(null);
            // Un mapa recargado vuelve a nacer sin encuadrar.
            fittedKeyRef.current = null;
          }}
          onMessage={handleMessage}
          onError={(event) => {
            setMapReady(false);
            setMapError(event.nativeEvent.description || 'The map document could not be loaded.');
          }}
          onHttpError={(event) => {
            setMapReady(false);
            setMapError(`Map request failed with HTTP ${event.nativeEvent.statusCode}.`);
          }}
          onContentProcessDidTerminate={() => {
            setMapReady(false);
            setMapError('The iOS map process stopped unexpectedly. Try loading it again.');
          }}
          style={styles.map}
        />
      </View>

      <OfferMapHeader
        visibleCount={offers.length}
        totalCount={totalCount}
        unmappedCount={unmappedCount}
        filters={filters}
        onBack={onBack}
        onOpenFilters={() => setFilterOpen(true)}
        onShowList={onShowList}
      />

      {!loading && !effectiveError && offers.length > 0 ? <OfferMapLegend /> : null}

      {!effectiveError && (loading || !mapReady) ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingCard}>
            <ActivityIndicator color={techUi.accent} size="large" />
          </View>
        </View>
      ) : null}

      {effectiveError ? (
        <OfferMapStatusOverlay
          kind="error"
          title="Map unavailable"
          message={effectiveError}
          actionLabel="Try again"
          onAction={() => {
            onRetry();
            retryMap();
          }}
        />
      ) : null}

      {emptyBecauseFilters ? (
        <OfferMapStatusOverlay
          kind="empty"
          title="No offers match these filters"
          message="Reset the filters to see all published opportunities."
          actionLabel="Reset filters"
          onAction={() => onFiltersChange({})}
        />
      ) : null}

      {emptyBecauseLocations ? (
        <OfferMapStatusOverlay
          kind="empty"
          title="No mappable locations"
          message="Published offers are available, but none currently has a location that can be placed on the map."
        />
      ) : null}

      {emptyPublished ? (
        <OfferMapStatusOverlay
          kind="empty"
          title="No published offers"
          message="New opportunities will appear here as soon as companies publish them."
        />
      ) : null}

      <OfferMapFilterSheet
        visible={filterOpen}
        filters={filters}
        onChange={onFiltersChange}
        onClose={() => setFilterOpen(false)}
      />

      <OfferMapDetailSheet
        group={selectedGroup}
        onClose={() => setSelectedGroupKey(null)}
        onViewOffer={onViewOffer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: techUi.page },
  webViewContainer: { flex: 1, width: '100%' },
  map: { flex: 1, width: '100%', backgroundColor: techUi.page },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingCard: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: techUi.border,
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
});

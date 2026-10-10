import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { SafeTechnicianView } from '../types';
import type { TechnicianHabilitation } from '../types/technician';
import type { MapOfferMatchOption } from '../types/mapOffers';
import type { TechnicianTypeCode } from '../types/catalog';
import { useAircraftTypeRatingsCatalog } from '../state/useAircraftTypeRatingsCatalog';
import { buildAircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { technicianTypeLabel } from '../constants/technicianTypes';
import { resolveTypeRatingLabels } from '../utils/v2CompatAdapters';
import { groupTechnicianMapMarkers } from '../utils/technicianMapMarkers';
import { TechnicianMapHeader, TechnicianMapLegend } from './technician-map/TechnicianMapControls';
import {
  TechnicianMapDetailSheet,
  TechnicianOfferSelectionSheet,
} from './technician-map/TechnicianMapSheets';

export interface TechnicianMapProps {
  technicians: SafeTechnicianView[];
  habilitationsById: Record<string, TechnicianHabilitation[]>;
  technicianTypesById: Record<string, TechnicianTypeCode[]>;
  /** Los filtros son los compartidos con la búsqueda (fase 3B): el panel lo abre quien monta el mapa. */
  filterCount: number;
  onOpenFilters: () => void;
  /** El botón para volver a la lista. */
  onShowList?: () => void;
  loading: boolean;
  onBack?: () => void;
  offerMatchesByTechnician?: Record<string, MapOfferMatchOption[]>;
  loadingOfferMatches?: boolean;
  onSendOffer?: (technicianId: string, offerId: string) => Promise<void>;
  onViewProfile?: (technicianId: string) => void;
}

const LEAFLET_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
    #map { position: absolute; inset: 0; background: #F8FAFC; }
    .leaflet-top.leaflet-left { top: 92px !important; left: 12px !important; }
    .leaflet-control-attribution { font-size: 8px !important; }
    .technician-marker-count.leaflet-tooltip {
      background: transparent;
      border: 0;
      box-shadow: none;
      color: #FFFFFF;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      pointer-events: none;
    }
    .technician-marker-count.leaflet-tooltip:before { display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    function post(message) {
      try { window.ReactNativeWebView.postMessage(message); } catch (error) {}
    }

    var map = null;
    var markersLayer = null;
    var markersByGroupKey = {};
    var selectedGroupKey = null;
    var pendingPayload = null;
    var isMapReady = false;

    var AVAIL = {
      open_to_offers: '#10B981',
      unavailable: '#94A3B8',
    };

    function updateSelectedMarker(groupKey) {
      selectedGroupKey = groupKey || null;
      Object.keys(markersByGroupKey).forEach(function(key) {
        var marker = markersByGroupKey[key];
        marker.setStyle({
          color: key === selectedGroupKey ? '#2563EB' : marker.__baseColor,
          weight: key === selectedGroupKey ? 5 : marker.__baseWeight,
        });
      });
    }

    window.setSelectedTechnicianGroup = updateSelectedMarker;

    function renderMarkers(groups) {
      try {
        markersLayer.clearLayers();
        markersByGroupKey = {};
        var bounds = [];
        var added = 0;

        groups.forEach(function(group) {
          var latitude = Number(group.latitude);
          var longitude = Number(group.longitude);
          var members = Array.isArray(group.technicians) ? group.technicians : [];
          if (!members.length || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

          var isGroup = members.length > 1;
          var isApproximate = group.locationPrecision !== 'city';
          var baseColor = isApproximate && !isGroup ? '#0A1628' : '#FFFFFF';
          var baseWeight = isApproximate ? 3 : 2.5;
          var marker = L.circleMarker([latitude, longitude], {
            radius: isGroup ? 22 : (isApproximate ? 12 : 10),
            fillColor: isGroup ? '#0A1628' : (AVAIL[members[0].availability] || AVAIL.unavailable),
            color: baseColor,
            fillOpacity: isGroup ? 0.92 : (isApproximate ? 0.34 : 0.9),
            weight: baseWeight,
            dashArray: isApproximate ? '4 3' : null,
          });
          marker.__baseColor = baseColor;
          marker.__baseWeight = baseWeight;
          marker.on('click', function() {
            updateSelectedMarker(group.key);
            post('map-select-group:' + group.key);
          });
          if (isGroup) {
            marker.bindTooltip(String(members.length), {
              permanent: true,
              direction: 'center',
              className: 'technician-marker-count',
              opacity: 1,
            });
          } else if (isApproximate) {
            marker.bindTooltip('Approximate country location', { direction: 'top' });
          }
          marker.addTo(markersLayer);
          markersByGroupKey[group.key] = marker;
          bounds.push([latitude, longitude]);
          added++;
        });

        updateSelectedMarker(selectedGroupKey);
        if (bounds.length === 1) map.setView(bounds[0], 5);
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [54, 54], maxZoom: 7 });
        post('markers-added:' + added);
      } catch (error) {
        post('update-markers-error:' + (error.message || 'render error'));
      }
    }

    window.updateMarkers = function(payload) {
      try {
        if (!isMapReady || !markersLayer) {
          pendingPayload = payload;
          return;
        }
        var groups = JSON.parse(payload);
        if (!Array.isArray(groups)) throw new Error('Marker payload is not an array');
        renderMarkers(groups);
      } catch (error) {
        post('update-markers-error:' + (error.message || 'parse error'));
      }
    };

    function initMap() {
      try {
        map = L.map('map', { zoomControl: true }).setView([48.5, 8.0], 3);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);
        isMapReady = true;
        post('map-ready');
        if (pendingPayload !== null) {
          var payload = pendingPayload;
          pendingPayload = null;
          window.updateMarkers(payload);
        }
      } catch (error) {
        post('map-init-error:' + (error.message || 'initialization error'));
      }
    }
  </script>
  <script
    src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"
    crossorigin=""
    onload="initMap()"
    onerror="post('leaflet-load-error')"
  ></script>
</body>
</html>`;

function hasMapCoordinates(technician: SafeTechnicianView): boolean {
  return Number.isFinite(Number(technician.latitude)) && Number.isFinite(Number(technician.longitude));
}

export function TechnicianMap({
  technicians,
  habilitationsById,
  technicianTypesById,
  filterCount,
  onOpenFilters,
  onShowList,
  loading,
  onBack,
  offerMatchesByTechnician = {},
  loadingOfferMatches = false,
  onSendOffer,
  onViewProfile,
}: TechnicianMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [selectedOfferTechId, setSelectedOfferTechId] = useState<string | null>(null);
  const [sendingOfferId, setSendingOfferId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const { ratings } = useAircraftTypeRatingsCatalog();
  const ratingIndex = useMemo(() => buildAircraftRatingIndex(ratings), [ratings]);

  const mappedTechnicians = useMemo(() => technicians.filter(hasMapCoordinates), [technicians]);
  const markerGroups = useMemo(() => groupTechnicianMapMarkers(mappedTechnicians), [mappedTechnicians]);
  const markerPayload = useMemo(
    () => markerGroups.map((group) => ({
      key: group.key,
      latitude: group.latitude,
      longitude: group.longitude,
      locationPrecision: group.locationPrecision,
      technicians: group.technicians.map((technician) => ({
        id: technician.id,
        availability: technician.availability.status,
      })),
    })),
    [markerGroups],
  );
  const selectedGroup = selectedGroupKey
    ? markerGroups.find((group) => group.key === selectedGroupKey) ?? null
    : null;
  const selectedOfferTechnician = selectedOfferTechId
    ? technicians.find((technician) => technician.id === selectedOfferTechId) ?? null
    : null;
  const selectedOfferOptions = selectedOfferTechId
    ? offerMatchesByTechnician[selectedOfferTechId] ?? []
    : [];
  const tradeLabelsById = useMemo(
    () => Object.fromEntries(
      technicians.map((technician) => [
        technician.id,
        (technicianTypesById[technician.id] ?? []).map(technicianTypeLabel),
      ]),
    ),
    [technicians, technicianTypesById],
  );
  const typeRatingLabelsById = useMemo(
    () => Object.fromEntries(
      technicians.map((technician) => [
        technician.id,
        resolveTypeRatingLabels(habilitationsById[technician.id] ?? [], ratingIndex),
      ]),
    ),
    [technicians, habilitationsById, ratingIndex],
  );

  useEffect(() => {
    if (!mapReady) return;
    webViewRef.current?.injectJavaScript(
      `window.updateMarkers(${JSON.stringify(JSON.stringify(markerPayload))});true;`,
    );
  }, [mapReady, markerPayload]);

  useEffect(() => {
    if (!mapReady) return;
    webViewRef.current?.injectJavaScript(
      `window.setSelectedTechnicianGroup(${JSON.stringify(selectedGroupKey)});true;`,
    );
  }, [mapReady, selectedGroupKey]);

  useEffect(() => {
    if (selectedGroupKey && !selectedGroup) setSelectedGroupKey(null);
  }, [selectedGroup, selectedGroupKey]);

  async function handleSendOffer(offerId: string) {
    if (!selectedOfferTechId || !onSendOffer) return;
    setSendError(null);
    setSendingOfferId(offerId);
    try {
      await onSendOffer(selectedOfferTechId, offerId);
    } catch (error: any) {
      setSendError(error?.message ?? 'An error occurred while sending this direct offer.');
    } finally {
      setSendingOfferId(null);
    }
  }

  function handleMessage(event: WebViewMessageEvent) {
    const message = event.nativeEvent.data;
    if (message === 'map-ready') {
      setMapReady(true);
      return;
    }
    if (message.startsWith('map-select-group:')) {
      setSelectedGroupKey(message.slice('map-select-group:'.length));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          source={{ html: LEAFLET_HTML }}
          style={styles.webView}
          onLoadStart={() => setMapReady(false)}
          onMessage={handleMessage}
        />
      </View>

      <TechnicianMapHeader
        visibleCount={technicians.length}
        filterCount={filterCount}
        loading={loading}
        onBack={onBack}
        onOpenFilters={onOpenFilters}
        onShowList={onShowList}
      />

      {!loading && markerGroups.length > 0 ? <TechnicianMapLegend /> : null}

      <TechnicianMapDetailSheet
        group={selectedGroup}
        tradeLabelsById={tradeLabelsById}
        typeRatingLabelsById={typeRatingLabelsById}
        onClose={() => setSelectedGroupKey(null)}
        onViewProfile={onViewProfile}
        onStartDirectOffer={(technicianId) => {
          setSelectedGroupKey(null);
          setSendError(null);
          setSelectedOfferTechId(technicianId);
        }}
      />

      <TechnicianOfferSelectionSheet
        technician={selectedOfferTechnician}
        options={selectedOfferOptions}
        loading={loadingOfferMatches}
        sendingOfferId={sendingOfferId}
        error={sendError}
        onSend={handleSendOffer}
        onClose={() => {
          setSelectedOfferTechId(null);
          setSendError(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webViewContainer: { flex: 1, width: '100%', minHeight: 450 },
  webView: { flex: 1, width: '100%' },
});

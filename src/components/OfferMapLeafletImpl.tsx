import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { LeafletEvent, Marker as LeafletMarker } from 'leaflet';
import type { OfferMapProps } from './OfferMap.native';
import {
  groupOfferMapItems,
  OfferMapDetailSheet,
  OfferMapFilterSheet,
  OfferMapHeader,
  OfferMapLegend,
  OfferMapMarkerGroup,
  OfferMapStatusOverlay,
  offerMapGroupMarkerIcon,
  offerMapMarkerAccessibilityLabel,
} from './offer-map/OfferMapControls';
import { activeOfferMapFilterCount } from '../types/offerMap';
import { techUi } from './technician/TechnicianUI';
import { offerMapGroupTierInput, resolveOfferMapMarkerTiers } from '../utils/offerMapMarkerTier';

function useLeafletCss() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    if (!document.getElementById('offer-map-leaflet-overrides')) {
      const style = document.createElement('style');
      style.id = 'offer-map-leaflet-overrides';
      style.textContent = `
        .leaflet-top.leaflet-left { top: 96px; left: 12px; }
        .leaflet-popup-content-wrapper {
          border-radius: 16px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
        }
        .leaflet-popup-content { margin: 14px; min-width: 232px; max-width: 286px; }
        .leaflet-popup-tip-container { display: none; }
        .leaflet-popup-close-button { top: 8px; right: 8px; font-size: 20px; color: #527088; }
        .offer-map-marker-icon {
          background: transparent;
          border: 0;
          cursor: pointer;
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
      `;
      document.head.appendChild(style);
    }
  }, []);
}

function OfferMapAutoFit({ groups }: { groups: OfferMapMarkerGroup[] }) {
  const map = useMap();
  const coordinateKey = groups
    .map((group) => `${group.key}:${group.latitude},${group.longitude}`)
    .join('|');

  useEffect(() => {
    const bounds = groups.map((group) => [group.latitude, group.longitude] as [number, number]);
    if (bounds.length === 1) map.setView(bounds[0], 6);
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [120, 100], maxZoom: 7 });
  // coordinateKey captures coordinate changes without making the array identity a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinateKey, groups.length, map]);

  return null;
}

/** El zoom vive en el mapa; los niveles de marcador se deciden fuera. */
function OfferMapZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const report = () => onZoom(map.getZoom());
    report();
    map.on('zoomend', report);
    return () => {
      map.off('zoomend', report);
    };
  }, [map, onZoom]);

  return null;
}

const OFFER_MAP_INITIAL_ZOOM = 3;

export default function OfferMapLeafletImpl({
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
  useLeafletCss();
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(OFFER_MAP_INITIAL_ZOOM);
  const groups = useMemo(() => groupOfferMapItems(offers), [offers]);
  const tiers = useMemo(
    () => resolveOfferMapMarkerTiers(groups.map(offerMapGroupTierInput), zoom),
    [groups, zoom],
  );
  const selectedGroup = selectedGroupKey
    ? groups.find((group) => group.key === selectedGroupKey) ?? null
    : null;
  const filterCount = activeOfferMapFilterCount(filters);
  const emptyBecauseFilters = !loading && !error && offers.length === 0 && totalCount > 0 && filterCount > 0;
  const emptyBecauseLocations = !loading && !error && offers.length === 0 && totalCount > 0 && unmappedCount === totalCount;
  const emptyPublished = !loading && !error && totalCount === 0;

  return (
    <View style={styles.container}>
      <View style={styles.mapFrame}>
        <MapContainer
          center={[48.5, 8]}
          zoom={OFFER_MAP_INITIAL_ZOOM}
          zoomControl
          style={{ width: '100%', height: '100%', backgroundColor: techUi.page }}
        >
          <TileLayer
            attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <OfferMapAutoFit groups={groups} />
          <OfferMapZoomWatcher onZoom={setZoom} />
          {groups.map((group) => {
            const accessibilityLabel = offerMapMarkerAccessibilityLabel(group);
            const marker = offerMapGroupMarkerIcon(group, tiers.get(group.key) ?? 'label');
            const icon = divIcon({
              className: `offer-map-marker-icon${selectedGroupKey === group.key ? ' is-selected' : ''}`,
              html: marker.markerSvg,
              iconSize: marker.iconSize,
              iconAnchor: marker.iconAnchor,
              popupAnchor: marker.popupAnchor,
            });

            function applyAccessibility(event: LeafletEvent) {
              const element = (event.target as LeafletMarker).getElement();
              element?.setAttribute('aria-label', accessibilityLabel);
              element?.setAttribute('role', 'button');
            }

            return (
              <Marker
                key={group.key}
                position={[group.latitude, group.longitude]}
                icon={icon}
                keyboard
                riseOnHover
                zIndexOffset={selectedGroupKey === group.key ? 10000 : 0}
                title={accessibilityLabel}
                eventHandlers={{
                  add: applyAccessibility,
                  click: (event) => {
                    applyAccessibility(event);
                    setSelectedGroupKey(group.key);
                  },
                }}
              />
            );
          })}
        </MapContainer>
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

      {!loading && !error && offers.length > 0 ? <OfferMapLegend /> : null}

      {loading ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingCard}>
            <ActivityIndicator color={techUi.accent} size="large" />
          </View>
        </View>
      ) : null}

      {error ? (
        <OfferMapStatusOverlay
          kind="error"
          title="Map unavailable"
          message={error.message}
          actionLabel="Try again"
          onAction={onRetry}
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
  container: { flex: 1, position: 'relative', backgroundColor: techUi.page },
  mapFrame: { flex: 1 },
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

<script setup lang="ts">
import mapboxgl, { type Map as MapboxMap } from 'mapbox-gl'
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { EarthquakePoint } from '../types/earthquake'
import { haversineKm, pointInPolygon, buildRectanglePolygon, buildCirclePolygon } from '../utils/geo'
import { magnitudeColor, magnitudeRadiusMeters } from '../utils/earthquakeData'
import { useEarthquakeData } from '../composables/useEarthquakeData'
import { useAttributeFilters } from '../composables/useAttributeFilters'
import { useDistanceFilter } from '../composables/useDistanceFilter'
import { useShapeFilter } from '../composables/useShapeFilter'
import { useSavedFilters } from '../composables/useSavedFilters'

const MAP_STYLE = 'mapbox://styles/mapbox/navigation-night-v1'

const containerEl = ref<HTMLDivElement | null>(null)
const isFilterOpen = ref(false)
const isSavedFiltersModalOpen = ref(false)
const isDistanceOpen = ref(false)

let map: MapboxMap | null = null
const overlay = ref<MapboxOverlay | null>(null)

const { points, status, statusMessage, loadCsv } = useEarthquakeData()
const {
  limits,
  activeFilters,
  addFilter,
  removeFilter,
  clearFilters,
  updateFilterField,
  clampFilterRange,
  formatFieldValue,
  FIELD_STEP,
} = useAttributeFilters(points)

const distance = useDistanceFilter()
const {
  distanceOrigin,
  distanceKm,
  pickingOrigin,
  distanceFilterActive,
  addressQuery,
  geocodeStatus,
  geocodeError,
  addressSuggestions,
  addressSuggestionsOpen,
  addressSuggestionIndex,
  addressFieldRef,
  startPickOrigin,
  clearOrigin,
  setOriginFromAddress,
  onAddressQueryInput,
  onAddressKeydown,
  selectAddressSuggestion,
  closeAddressDropdownIfOutside,
} = distance
void addressFieldRef // template ref="addressFieldRef"

const shape = useShapeFilter()
const {
  shapeType,
  shapeTypeModalOpen,
  drawingShape,
  shapePoints,
  dragStart,
  dragCurrent,
  shapeFilterActive,
  openShapeModal,
  closeShapeModal,
  selectShapeType,
  finishPolygon,
  cancelDrawing,
  clearShape,
  onMapMouseDown,
  onMapMouseMove,
  onMapMouseUp,
} = shape

const savedFiltersApi = useSavedFilters({
  getState: () => ({
    activeFilters: activeFilters.value.map((f) => ({ id: f.id, field: f.field, range: { ...f.range } })),
    distanceOrigin: distanceOrigin.value ? { ...distanceOrigin.value } : null,
    distanceKm: distanceKm.value,
    shapeType: shapeType.value,
    shapePoints: shapePoints.value.map((p) => [p[0], p[1]]),
  }),
  applyState: (s) => {
    activeFilters.value = s.activeFilters
    distanceOrigin.value = s.distanceOrigin
    distanceKm.value = s.distanceKm
    shapeType.value = s.shapeType
    shapePoints.value = s.shapePoints
  },
})
const {
  savedFilters,
  saveFilterLabel,
  saveFilterError,
  loadSavedFiltersFromStorage,
  saveCurrentFilter,
  loadSavedFilter,
  deleteSavedFilter,
  formatSavedDate,
} = savedFiltersApi

const filteredPoints = computed(() => {
  const data = points.value
  const fs = activeFilters.value
  const applyAttributeFilters = (d: EarthquakePoint) => {
    for (const f of fs) {
      if (f.field === 'magnitude') {
        if (d.magnitude < f.range.min || d.magnitude > f.range.max) return false
        continue
      }
      if (f.field === 'latitude') {
        if (d.latitude < f.range.min || d.latitude > f.range.max) return false
        continue
      }
      if (f.field === 'longitude') {
        if (d.longitude < f.range.min || d.longitude > f.range.max) return false
        continue
      }
      if (f.field === 'depthKm') {
        if (d.depthKm === undefined) continue
        if (d.depthKm < f.range.min || d.depthKm > f.range.max) return false
        continue
      }
      if (f.field === 'year') {
        if (d.year === undefined) continue
        if (d.year < f.range.min || d.year > f.range.max) return false
      }
    }
    return true
  }

  const applyDistanceFilter = (d: EarthquakePoint) => {
    const origin = distanceOrigin.value
    if (!origin) return true
    const km = distanceKm.value
    if (!Number.isFinite(km) || km <= 0) return true
    return haversineKm([origin.longitude, origin.latitude], [d.longitude, d.latitude]) <= km
  }

  const applyShapeFilter = (d: EarthquakePoint) => {
    const pts = shapePoints.value
    if (shapeType.value === 'rectangle' || shapeType.value === 'circle') {
      if (pts.length < 2) return true
    } else if (pts.length < 3) return true
    if (shapeType.value === 'rectangle') {
      if (pts.length >= 4) return pointInPolygon([d.longitude, d.latitude], [...pts, pts[0]!])
      if (pts.length < 2) return true
      const poly = buildRectanglePolygon(pts[0]!, pts[1]!)
      return pointInPolygon([d.longitude, d.latitude], poly)
    }
    if (shapeType.value === 'circle') {
      if (pts.length < 2) return true
      const poly = buildCirclePolygon(pts[0]!, pts[1]!)
      return pointInPolygon([d.longitude, d.latitude], poly)
    }
    // polygon
    if (pts.length < 3) return true
    const poly = pts
    return pointInPolygon([d.longitude, d.latitude], poly)
  }

  if (!fs.length && !distanceFilterActive.value && !shapeFilterActive.value) return data

  return data.filter((d) => applyAttributeFilters(d) && applyDistanceFilter(d) && applyShapeFilter(d))
})

function handleStartPickOrigin() {
  startPickOrigin()
  isFilterOpen.value = false
  isDistanceOpen.value = true
}

function handleLoadSavedFilter(item: import('../types/earthquake').SavedFilter) {
  loadSavedFilter(item)
  isFilterOpen.value = false
  isSavedFiltersModalOpen.value = false
}

function handleAddressKeydown(e: KeyboardEvent) {
  onAddressKeydown(e, setOriginFromAddress)
}

function handleOpenShapeModal() {
  openShapeModal()
}

function initMap() {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) {
    status.value = 'error'
    statusMessage.value = 'Missing VITE_MAPBOX_TOKEN (see .env.example)'
    return
  }
  mapboxgl.accessToken = token

  const el = containerEl.value
  if (!el) return

  map = new mapboxgl.Map({
    container: el,
    style: MAP_STYLE,
    center: [0, 15],
    zoom: 1.35,
    // Force 2D map (Mercator). The "globe" projection is what makes it look 3D.
    projection: { name: 'mercator' },
    pitch: 0,
    bearing: 0,
    antialias: true,
  })

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right')

  map.on('click', (e) => {
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    if (pickingOrigin.value) {
      distanceOrigin.value = { longitude: lngLat[0], latitude: lngLat[1] }
      pickingOrigin.value = false
      return
    }
    // Polygon: add point on click. Rect/circle use drag (mousedown-mouseup).
    if (drawingShape.value && shapeType.value === 'polygon') {
      shapePoints.value = [...shapePoints.value, lngLat]
    }
  })

  map.on('mousedown', onMapMouseDown as (e: mapboxgl.MapMouseEvent) => void)
  map.on('mousemove', onMapMouseMove as (e: mapboxgl.MapMouseEvent) => void)
  map.on('mouseup', onMapMouseUp as (e: mapboxgl.MapMouseEvent) => void)

  // Attach the deck.gl overlay after the map style is loaded.
  // On Mapbox GL JS, attaching too early can lead to layers not rendering.
  map.once('load', () => {
    // Deepen the overall "blue" tone a bit.
    // Layer ids differ across styles, so we do this best-effort.
    try {
      map?.setPaintProperty('background', 'background-color', '#070b18')
    } catch {}
    try {
      map?.setPaintProperty('water', 'fill-color', '#071a34')
    } catch {}
    try {
      map?.setPaintProperty('waterway', 'line-color', '#0b2c55')
    } catch {}

    overlay.value = new MapboxOverlay({
      // interleaved=false tends to be the most robust default across GPUs/browsers.
      interleaved: false,
      getTooltip: ({ object }: any) => {
        if (!object) return null
        const o = object as EarthquakePoint
        const when = [o.date, o.time].filter(Boolean).join(' ')
        const depth = o.depthKm !== undefined ? `Depth: ${o.depthKm} km` : null
        return {
          html: `
            <div style="font-weight:600;margin-bottom:4px">M ${o.magnitude.toFixed(1)}</div>
            ${when ? `<div>${when}</div>` : ''}
            ${depth ? `<div>${depth}</div>` : ''}
          `,
        }
      },
    })

    map?.addControl(overlay.value as any)
  })
}

function openSavedFiltersModal() {
  isSavedFiltersModalOpen.value = true
  loadSavedFiltersFromStorage()
}

onMounted(async () => {
  loadSavedFiltersFromStorage()
  document.addEventListener('mousedown', closeAddressDropdownIfOutside)
  try {
    initMap()
    await loadCsv()
  } catch (e) {
    status.value = 'error'
    statusMessage.value = e instanceof Error ? e.message : 'Unknown error'
  }
})

watchEffect(() => {
  if (!overlay.value) return
  const data = filteredPoints.value

  const origin = distanceOrigin.value
  const originData = origin ? [{ longitude: origin.longitude, latitude: origin.latitude }] : []

  const shapePts = shapePoints.value
  const dStart = dragStart.value
  const dCurrent = dragCurrent.value
  let shapePolygon: [number, number][] | null = null
  // Completed shape
  if (shapeType.value === 'rectangle' && shapePts.length >= 4) {
    shapePolygon = [...shapePts, shapePts[0]!]
  } else if (shapeType.value === 'rectangle' && shapePts.length >= 2) {
    shapePolygon = buildRectanglePolygon(shapePts[0]!, shapePts[1]!)
  } else if (shapeType.value === 'circle' && shapePts.length >= 2) {
    shapePolygon = buildCirclePolygon(shapePts[0]!, shapePts[1]!)
  } else if (shapeType.value === 'polygon' && shapePts.length >= 3) {
    shapePolygon = [...shapePts, shapePts[0]!]
  }
  // Rect/circle drag preview
  if (!shapePolygon && dStart && dCurrent && (shapeType.value === 'rectangle' || shapeType.value === 'circle')) {
    if (shapeType.value === 'rectangle') {
      shapePolygon = buildRectanglePolygon(dStart, dCurrent)
    } else {
      shapePolygon = buildCirclePolygon(dStart, dCurrent)
    }
  }

  const polygonLayer = new PolygonLayer<{ polygon: [number, number][] }>({
    id: 'shape',
    data: shapePolygon ? [{ polygon: shapePolygon }] : [],
    pickable: false,
    filled: true,
    stroked: true,
    getPolygon: (d) => d.polygon,
    getFillColor: [120, 170, 255, 40],
    getLineColor: [120, 170, 255, 180],
    lineWidthMinPixels: 2,
  })

  const layers: any[] = [polygonLayer]

  // Polygon drawing: show outline while adding points
  if (shapeType.value === 'polygon' && drawingShape.value && shapePts.length >= 2) {
    const pathData = shapePts
    layers.push(
      new PathLayer<{ path: [number, number][] }>({
        id: 'shape-outline',
        data: [{ path: pathData }],
        getPath: (d) => d.path,
        getColor: [120, 170, 255, 200],
        widthUnits: 'pixels',
        getWidth: 2,
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
      })
    )
  }

  overlay.value.setProps({
    layers: [
      ...layers,
      new ScatterplotLayer<{ longitude: number; latitude: number }>({
        id: 'origin',
        data: originData,
        pickable: false,
        stroked: true,
        filled: true,
        getPosition: (d) => [d.longitude, d.latitude],
        getFillColor: [255, 255, 255, 200],
        getLineColor: [120, 170, 255, 220],
        getRadius: 60000,
        radiusUnits: 'meters',
        radiusMinPixels: 4,
        radiusMaxPixels: 10,
      }),
      new ScatterplotLayer<EarthquakePoint>({
        id: 'earthquakes',
        data,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 180],
        stroked: false,
        filled: true,
        opacity: 0.85,
        getPosition: (d) => [d.longitude, d.latitude],
        getFillColor: (d) => magnitudeColor(d.magnitude),
        getRadius: (d) => magnitudeRadiusMeters(d.magnitude),
        radiusUnits: 'meters',
        radiusMinPixels: 2,
        radiusMaxPixels: 30,
      }),
    ],
  })
})

onUnmounted(() => {
  document.removeEventListener('mousedown', closeAddressDropdownIfOutside)
  overlay.value?.finalize()
  overlay.value = null

  map?.remove()
  map = null
})
</script>

<template>
  <div class="root">
    <div class="map-shell">
      <div class="top-left">
        <button class="filter-toggle" type="button" @click="isFilterOpen = true">
          Filters
          <span v-if="activeFilters.length" class="pill">{{ activeFilters.length }}</span>
        </button>
        <button class="filter-toggle" type="button" @click="openSavedFiltersModal">
          Saved filters
          <span v-if="savedFilters.length" class="pill">{{ savedFilters.length }}</span>
        </button>

        <div class="status" :data-status="status">
          <span class="dot" />
          <span class="text">{{ statusMessage }}</span>
        </div>
      </div>

      <div class="top-right">
        <div class="spatial-buttons">
          <div class="spatial-item">
            <button
              class="spatial-toggle"
              type="button"
              :data-active="distanceFilterActive"
              @click="isDistanceOpen = !isDistanceOpen"
            >
              Distance
              <span v-if="distanceFilterActive" class="pill">on</span>
              <span class="chevron" :data-open="isDistanceOpen">▾</span>
            </button>
            <Transition name="spatial-panel">
              <div v-if="isDistanceOpen" class="spatial-panel">
                <div class="section">
                  <div ref="addressFieldRef" class="field address-field">
                    <div class="field-label">Origin from address</div>
                    <div class="row">
                      <input
                        v-model="addressQuery"
                        class="input-label"
                        type="text"
                        placeholder="Address or place name"
                        :disabled="geocodeStatus === 'loading'"
                        autocomplete="off"
                        @input="onAddressQueryInput"
                        @keydown="handleAddressKeydown"
                      />
                      <button
                        class="btn primary"
                        type="button"
                        :disabled="geocodeStatus === 'loading'"
                        @click="setOriginFromAddress"
                      >
                        {{ geocodeStatus === 'loading' ? 'Searching…' : 'Set origin' }}
                      </button>
                    </div>
                    <div
                      v-if="addressSuggestionsOpen && addressSuggestions.length"
                      class="address-dropdown"
                      role="listbox"
                    >
                      <button
                        v-for="(s, i) in addressSuggestions"
                        :key="s.place_name + String(s.center[0])"
                        type="button"
                        class="address-dropdown-item"
                        :class="{ selected: i === addressSuggestionIndex }"
                        role="option"
                        :aria-selected="i === addressSuggestionIndex"
                        @click="selectAddressSuggestion(s)"
                        @mousedown.prevent
                      >
                        {{ s.place_name }}
                      </button>
                    </div>
                    <div v-if="geocodeError" class="hint error">{{ geocodeError }}</div>
                  </div>
                  <div class="row">
                    <button class="btn" type="button" @click="handleStartPickOrigin">
                      {{ distanceOrigin ? 'Change origin (click map)' : 'Pick origin (click map)' }}
                    </button>
                    <button class="btn ghost" type="button" :disabled="!distanceOrigin" @click="clearOrigin">Clear</button>
                  </div>
                  <div class="grid2">
                    <div class="field">
                      <div class="field-label">Origin</div>
                      <div class="field-value mono">
                        <template v-if="distanceOrigin">
                          {{ formatFieldValue('longitude', distanceOrigin.longitude) }}, {{ formatFieldValue('latitude', distanceOrigin.latitude) }}
                        </template>
                        <template v-else>Not set</template>
                      </div>
                    </div>
                    <div class="field">
                      <div class="field-label">Distance (km)</div>
                      <input class="num" type="number" min="0" step="1" v-model.number="distanceKm" />
                    </div>
                  </div>
                  <div v-if="pickingOrigin" class="hint">Click on the map to set the origin.</div>
                </div>
              </div>
            </Transition>
          </div>

          <div class="spatial-item">
            <button
              class="spatial-toggle"
              type="button"
              :data-active="shapeFilterActive"
              @click="handleOpenShapeModal"
            >
              Shape
              <span v-if="shapeFilterActive" class="pill">on</span>
            </button>
            <div v-if="drawingShape" class="drawing-toolbar">
              <span class="drawing-hint">
                <template v-if="shapeType === 'rectangle'">Drag on map to draw rectangle.</template>
                <template v-else-if="shapeType === 'circle'">Drag on map to draw circle.</template>
                <template v-else>Click to add points, then Finish.</template>
              </span>
              <button
                v-if="shapeType === 'polygon'"
                class="btn small"
                type="button"
                :disabled="shapePoints.length < 3"
                @click="finishPolygon"
              >
                Finish
              </button>
              <button class="btn ghost small" type="button" @click="cancelDrawing">Cancel</button>
            </div>
            <div v-else-if="shapeFilterActive" class="drawing-toolbar">
              <span class="drawing-hint">Drag shape to move.</span>
              <button class="btn ghost small" type="button" @click="clearShape">Clear</button>
            </div>
          </div>
        </div>
      </div>

      <div ref="containerEl" class="map" />
    </div>

    <div v-if="isFilterOpen" class="backdrop" @click="isFilterOpen = false" />

    <div v-if="shapeTypeModalOpen" class="modal-backdrop" @click.self="closeShapeModal">
      <div class="modal shape-type-modal">
        <div class="modal-title">Select shape type</div>
        <div class="shape-type-options">
          <button class="shape-type-btn" type="button" @click="selectShapeType('rectangle')">
            <span class="shape-type-icon">▭</span>
            <span>Rectangle</span>
            <span class="shape-type-desc">Drag on map</span>
          </button>
          <button class="shape-type-btn" type="button" @click="selectShapeType('circle')">
            <span class="shape-type-icon">○</span>
            <span>Circle</span>
            <span class="shape-type-desc">Drag from center to edge</span>
          </button>
          <button class="shape-type-btn" type="button" @click="selectShapeType('polygon')">
            <span class="shape-type-icon">⬡</span>
            <span>Polygon</span>
            <span class="shape-type-desc">Click to add points</span>
          </button>
        </div>
        <button class="btn ghost modal-close" type="button" @click="closeShapeModal">Cancel</button>
      </div>
    </div>

    <div v-if="isSavedFiltersModalOpen" class="modal-backdrop" @click.self="isSavedFiltersModalOpen = false">
      <div class="modal saved-filters-modal">
        <div class="modal-title">Saved filters</div>
        <p class="modal-desc">Save the current setup (attribute filters, distance &amp; shape) or load a saved one.</p>
        <div class="row save-filter-row">
          <input
            v-model="saveFilterLabel"
            class="input-label"
            type="text"
            placeholder="Filter name"
            @keydown.enter="saveCurrentFilter"
          />
          <button class="btn primary" type="button" @click="saveCurrentFilter">Save current</button>
        </div>
        <div v-if="saveFilterError" class="hint error">{{ saveFilterError }}</div>
        <div v-if="savedFilters.length" class="saved-list">
          <div v-for="item in savedFilters" :key="item.id" class="saved-item">
            <div class="saved-item-info">
              <span class="saved-item-label">{{ item.label }}</span>
              <span class="saved-item-date">{{ formatSavedDate(item.savedAt) }}</span>
            </div>
            <div class="saved-item-actions">
              <button class="btn primary small" type="button" @click="handleLoadSavedFilter(item)">Load</button>
              <button class="btn ghost small" type="button" title="Delete" @click="deleteSavedFilter(item.id)">×</button>
            </div>
          </div>
        </div>
        <div v-else class="hint">No saved filters yet. Name and save above.</div>
        <button class="btn ghost modal-close" type="button" @click="isSavedFiltersModalOpen = false">Close</button>
      </div>
    </div>

    <aside class="drawer" :data-open="isFilterOpen">
      <div class="drawer-head">
        <div class="drawer-title">Filters</div>
        <button class="icon-btn" type="button" title="Close" @click="isFilterOpen = false">×</button>
      </div>

      <div class="meta">
        <div class="muted">Showing</div>
        <div class="mono">{{ filteredPoints.length.toLocaleString() }} / {{ points.length.toLocaleString() }}</div>
      </div>

      <div class="drawer-actions">
        <button class="btn primary" type="button" @click="addFilter('magnitude')">Add filter</button>
        <button class="btn ghost" type="button" :disabled="!activeFilters.length" @click="clearFilters">Clear</button>
      </div>

      <div v-if="!activeFilters.length" class="empty">
        No filters yet. Click <span class="kbd">Add filter</span> to start.
      </div>

      <div v-else class="filters">
        <div v-for="f in activeFilters" :key="f.id" class="filter">
          <div class="filter-head">
            <select class="select" :value="f.field" @change="updateFilterField(f.id, ($event.target as HTMLSelectElement).value as any)">
              <option value="magnitude">Magnitude</option>
              <option value="latitude">Latitude</option>
              <option value="longitude">Longitude</option>
              <option value="depthKm">Depth (km)</option>
              <option value="year">Year</option>
            </select>
            <button class="icon-btn subtle" type="button" title="Remove filter" @click="removeFilter(f.id)">×</button>
          </div>

          <div class="range">
            <input
              class="num"
              type="number"
              :step="FIELD_STEP[f.field]"
              :min="limits[f.field].min"
              :max="limits[f.field].max"
              v-model.number="f.range.min"
              @change="clampFilterRange(f.id)"
            />
            <span class="sep">to</span>
            <input
              class="num"
              type="number"
              :step="FIELD_STEP[f.field]"
              :min="limits[f.field].min"
              :max="limits[f.field].max"
              v-model.number="f.range.max"
              @change="clampFilterRange(f.id)"
            />
          </div>

          <div class="hint">
            Range: {{ formatFieldValue(f.field, limits[f.field].min) }} – {{ formatFieldValue(f.field, limits[f.field].max) }}
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style src="./EarthquakeMap.css" scoped></style>

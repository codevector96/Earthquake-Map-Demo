<script setup lang="ts">
import mapboxgl, { type Map as MapboxMap } from 'mapbox-gl'
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, shallowRef, toRaw, watch, watchEffect } from 'vue'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { EarthquakePoint, FieldKey, SavedFilter } from '../types/earthquake'
import { haversineKm, pointInPolygon, buildRectanglePolygon, buildCirclePolygon } from '../utils/geo'
import { magnitudeRadiusMeters } from '../utils/earthquakeData'
import {
  getPointColor,
  getPaletteStopColors,
  COLOR_PALETTE_LABELS,
  COLOR_FIELD_LABELS,
  type ColorPaletteId,
} from '../utils/colorPalettes'
import { useEarthquakeData } from '../composables/useEarthquakeData'
import { useAttributeFilters } from '../composables/useAttributeFilters'
import { useDistanceFilter } from '../composables/useDistanceFilter'
import { useShapeFilter } from '../composables/useShapeFilter'
import { usePointColor } from '../composables/usePointColor'
import { useSavedFilters } from '../composables/useSavedFilters'
import {
  Filter,
  X,
  Save,
  FolderOpen,
  Trash2,
  MapPin,
  Shapes,
  Palette,
} from 'lucide-vue-next'

const MAP_STYLE = 'mapbox://styles/mapbox/navigation-night-v1'

const containerEl = ref<HTMLDivElement | null>(null)
const isFilterOpen = ref(false)
const isSavedFiltersModalOpen = ref(false)
const isDistanceOpen = ref(false)
const isColorOpen = ref(false)
const isShapeOpen = ref(false)

let map: MapboxMap | null = null
// shallowRef so Vue does not deep-react to the overlay (avoids proxy issues when deck.gl stores layers)
const overlay = shallowRef<MapboxOverlay | null>(null)

type MapBounds = { west: number; south: number; east: number; north: number }
const mapBounds = ref<MapBounds | null>(null)

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
  setOriginFromMapClick,
  clearOrigin,
  setOriginFromAddress,
  onAddressQueryInput,
  onAddressKeydown,
  selectAddressSuggestion,
  closeAddressDropdownIfOutside,
} = distance
void addressFieldRef // used in template as ref="addressFieldRef"

const shape = useShapeFilter()
const {
  shapeType,
  drawingShape,
  shapePoints,
  dragStart,
  dragCurrent,
  movingShape,
  shapeFilterActive,
  selectShapeType,
  finishPolygon,
  cancelDrawing,
  clearShape,
  onMapMouseDown,
  onMapMouseMove,
  onMapMouseUp,
} = shape

const { colorByField, colorPalette } = usePointColor()

function selectColorPalette(id: ColorPaletteId) {
  colorPalette.value = id
}

function selectColorField(field: FieldKey) {
  colorByField.value = field
}

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
    // polygon: close the ring for point-in-polygon test
    if (pts.length < 3) return true
    const poly = [...pts, pts[0]!]
    return pointInPolygon([d.longitude, d.latitude], poly)
  }

  if (!fs.length && !distanceFilterActive.value && !shapeFilterActive.value) return data

  return data.filter((d) => applyAttributeFilters(d) && applyDistanceFilter(d) && applyShapeFilter(d))
})

const visiblePointsCount = computed(() => {
  const fp = filteredPoints.value
  const b = mapBounds.value
  if (!b) return fp.length
  return fp.filter(
    (p) =>
      p.longitude >= b.west &&
      p.longitude <= b.east &&
      p.latitude >= b.south &&
      p.latitude <= b.north
  ).length
})

/** Returns a plain array of point objects for deck.gl (no Vue proxies). */
function plainCopyPoints(points: EarthquakePoint[]): EarthquakePoint[] {
  if (!Array.isArray(points) || points.length === 0) return []
  return JSON.parse(JSON.stringify(points))
}

function handleStartPickOrigin() {
  startPickOrigin()
  isFilterOpen.value = false
  isDistanceOpen.value = true
}

function handleLoadSavedFilter(item: SavedFilter) {
  loadSavedFilter(item)
  isFilterOpen.value = false
  isSavedFiltersModalOpen.value = false
}

function handleAddressKeydown(e: KeyboardEvent) {
  onAddressKeydown(e, setOriginFromAddress)
}

const mapCursor = computed(() => {
  if (pickingOrigin.value) return 'crosshair'
  if (movingShape.value) return 'move'
  if (drawingShape.value) return 'crosshair'
  if (shapeFilterActive.value) return 'move'
  return 'default'
})
const mapCursorClass = computed(() => {
  const c = mapCursor.value
  if (c === 'crosshair') return 'cursor-crosshair'
  if (c === 'move') return 'cursor-move'
  return ''
})

function applyMapCursor() {
  const el = containerEl.value
  if (!el) return
  const c = mapCursor.value
  el.style.cursor = c
  el.querySelectorAll('canvas').forEach((canvas) => {
    ;(canvas as HTMLCanvasElement).style.cursor = c
  })
}

watch(mapCursor, () => {
  nextTick(applyMapCursor)
}, { flush: 'post' })

function toggleShapePanel() {
  isDistanceOpen.value = false
  isColorOpen.value = false
  isShapeOpen.value = !isShapeOpen.value
}

function chooseShapeType(type: 'rectangle' | 'circle' | 'polygon') {
  selectShapeType(type)
  isShapeOpen.value = false
}

function openDistance() {
  isColorOpen.value = false
  isShapeOpen.value = false
  isDistanceOpen.value = !isDistanceOpen.value
}

function openColor() {
  isDistanceOpen.value = false
  isShapeOpen.value = false
  isColorOpen.value = !isColorOpen.value
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

  map.on('click', (e) => {
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    if (pickingOrigin.value) {
      setOriginFromMapClick(lngLat[0], lngLat[1])
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
  map.on('mousemove', () => applyMapCursor())

  // Attach the deck.gl overlay after the map style is loaded.
  // On Mapbox GL JS, attaching too early can lead to layers not rendering.
  map.once('load', () => {
    // Deepen the overall "blue" tone. Layer IDs vary by Mapbox style; only set if present.
    const style = map?.getStyle()
    if (style?.layers) {
      const layerIds = new Set(style.layers.map((l) => l.id))
      if (layerIds.has('background'))
        try { map?.setPaintProperty('background', 'background-color', '#070b18') } catch {}
      if (layerIds.has('water'))
        try { map?.setPaintProperty('water', 'fill-color', '#071a34') } catch {}
      if (layerIds.has('waterway'))
        try { map?.setPaintProperty('waterway', 'line-color', '#0b2c55') } catch {}
    }

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

    const setBounds = () => {
      if (map) {
        const b = map.getBounds()
        if (b) {
          mapBounds.value = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
        }
      }
    }
    map?.on('moveend', setBounds)
    map?.on('zoomend', setBounds)
    setBounds()

    map?.addControl(overlay.value as any)
    nextTick(applyMapCursor)
    requestAnimationFrame(() => applyMapCursor())
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
  // Read color refs first so this effect re-runs when they change (even if overlay isn't ready yet)
  const colorField = colorByField.value
  const colorPaletteId = colorPalette.value

  if (!overlay.value) return

  // Pass only plain arrays/objects to deck.gl (no Vue reactive proxies)
  const data = plainCopyPoints(filteredPoints.value)

  const origin = distanceOrigin.value
  const originData = origin
    ? (JSON.parse(JSON.stringify([{ longitude: Number(origin.longitude), latitude: Number(origin.latitude) }])) as { longitude: number; latitude: number }[])
    : []

  const shapePts = toRaw(shapePoints.value) ?? shapePoints.value
  const dStart = dragStart.value
  const dCurrent = dragCurrent.value
  let shapePolygon: [number, number][] | null = null
  // Completed shape
  if (shapeType.value === 'rectangle' && shapePts.length >= 4) {
    shapePolygon = shapePts.map((p) => [Number(p[0]), Number(p[1])])
    shapePolygon.push(shapePolygon[0]!)
  } else if (shapeType.value === 'rectangle' && shapePts.length >= 2) {
    shapePolygon = buildRectanglePolygon(shapePts[0]!, shapePts[1]!)
  } else if (shapeType.value === 'circle' && shapePts.length >= 2) {
    shapePolygon = buildCirclePolygon(shapePts[0]!, shapePts[1]!)
  } else if (shapeType.value === 'polygon' && shapePts.length >= 3) {
    shapePolygon = shapePts.map((p) => [Number(p[0]), Number(p[1])])
    shapePolygon.push(shapePolygon[0]!)
  }
  // Rect/circle drag preview
  if (!shapePolygon && dStart && dCurrent && (shapeType.value === 'rectangle' || shapeType.value === 'circle')) {
    if (shapeType.value === 'rectangle') {
      shapePolygon = buildRectanglePolygon(dStart, dCurrent)
    } else {
      shapePolygon = buildCirclePolygon(dStart, dCurrent)
    }
  }

  const shapeDataPlain = shapePolygon ? (JSON.parse(JSON.stringify([{ polygon: shapePolygon }])) as { polygon: [number, number][] }[]) : []
  const polygonLayer = markRaw(
    new PolygonLayer<{ polygon: [number, number][] }>({
      id: 'shape',
      data: shapeDataPlain,
      pickable: false,
      filled: true,
      stroked: true,
      getPolygon: (d) => d.polygon,
      getFillColor: [120, 170, 255, 40],
      getLineColor: [120, 170, 255, 180],
      lineWidthMinPixels: 2,
    })
  )

  const layers: any[] = [polygonLayer]

  // Polygon drawing: show outline while adding points
  if (shapeType.value === 'polygon' && drawingShape.value && shapePts.length >= 2) {
    const pathDataPlain = JSON.parse(JSON.stringify(shapePts.map((p) => [Number(p[0]), Number(p[1])]))) as [number, number][]
    layers.push(
      markRaw(
        new PathLayer<{ path: [number, number][] }>({
          id: 'shape-outline',
          data: JSON.parse(JSON.stringify([{ path: pathDataPlain }])) as { path: [number, number][] }[],
          getPath: (d) => d.path,
          getColor: [120, 170, 255, 200],
          widthUnits: 'pixels',
          getWidth: 2,
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
        })
      )
    )
  }

  overlay.value.setProps({
    layers: [
      ...layers,
      markRaw(
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
        })
      ),
      markRaw(
        new ScatterplotLayer<EarthquakePoint>({
          id: `earthquakes-${colorField}-${colorPaletteId}`,
          data,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 180],
          stroked: false,
          filled: true,
          opacity: 0.85,
          getPosition: (d) => [d.longitude, d.latitude],
          getFillColor: (d) =>
            getPointColor(d, colorField, limits.value, colorPaletteId),
          getRadius: (d) => magnitudeRadiusMeters(d.magnitude),
          radiusUnits: 'meters',
          radiusMinPixels: 2,
          radiusMaxPixels: 30,
        })
      ),
    ],
  })
})

// Ensure map colors update when only palette/field change (explicit dependency)
watch(
  [colorByField, colorPalette],
  () => {
    if (!overlay.value) return
    const colorField = colorByField.value
    const colorPaletteId = colorPalette.value
    const data = plainCopyPoints(filteredPoints.value)
    const origin = distanceOrigin.value
    const originData = origin
      ? (JSON.parse(JSON.stringify([{ longitude: Number(origin.longitude), latitude: Number(origin.latitude) }])) as { longitude: number; latitude: number }[])
      : []
    const shapePts = toRaw(shapePoints.value) ?? shapePoints.value
    const dStart = dragStart.value
    const dCurrent = dragCurrent.value
    let shapePolygon: [number, number][] | null = null
    if (shapeType.value === 'rectangle' && shapePts.length >= 4) {
      shapePolygon = shapePts.map((p) => [Number(p[0]), Number(p[1])])
      shapePolygon.push(shapePolygon[0]!)
    } else if (shapeType.value === 'rectangle' && shapePts.length >= 2) {
      shapePolygon = buildRectanglePolygon(shapePts[0]!, shapePts[1]!)
    } else if (shapeType.value === 'circle' && shapePts.length >= 2) {
      shapePolygon = buildCirclePolygon(shapePts[0]!, shapePts[1]!)
    } else if (shapeType.value === 'polygon' && shapePts.length >= 3) {
      shapePolygon = shapePts.map((p) => [Number(p[0]), Number(p[1])])
      shapePolygon.push(shapePolygon[0]!)
    }
    if (!shapePolygon && dStart && dCurrent && (shapeType.value === 'rectangle' || shapeType.value === 'circle')) {
      shapePolygon =
        shapeType.value === 'rectangle'
          ? buildRectanglePolygon(dStart, dCurrent)
          : buildCirclePolygon(dStart, dCurrent)
    }
    const shapeDataPlain = shapePolygon ? (JSON.parse(JSON.stringify([{ polygon: shapePolygon }])) as { polygon: [number, number][] }[]) : []
    const polygonLayer = markRaw(
      new PolygonLayer<{ polygon: [number, number][] }>({
        id: 'shape',
        data: shapeDataPlain,
        pickable: false,
        filled: true,
        stroked: true,
        getPolygon: (d) => d.polygon,
        getFillColor: [120, 170, 255, 40],
        getLineColor: [120, 170, 255, 180],
        lineWidthMinPixels: 2,
      })
    )
    const layers: any[] = [polygonLayer]
    if (shapeType.value === 'polygon' && drawingShape.value && shapePts.length >= 2) {
      const pathDataPlain = JSON.parse(JSON.stringify(shapePts.map((p) => [Number(p[0]), Number(p[1])]))) as [number, number][]
      layers.push(
        markRaw(
          new PathLayer<{ path: [number, number][] }>({
            id: 'shape-outline',
            data: JSON.parse(JSON.stringify([{ path: pathDataPlain }])) as { path: [number, number][] }[],
            getPath: (d) => d.path,
            getColor: [120, 170, 255, 200],
            widthUnits: 'pixels',
            getWidth: 2,
            widthMinPixels: 2,
            capRounded: true,
            jointRounded: true,
          })
        )
      )
    }
    overlay.value.setProps({
      layers: [
        ...layers,
        markRaw(
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
          })
        ),
        markRaw(
          new ScatterplotLayer<EarthquakePoint>({
            id: `earthquakes-${colorField}-${colorPaletteId}`,
            data,
            pickable: true,
            autoHighlight: true,
            highlightColor: [255, 255, 255, 180],
            stroked: false,
            filled: true,
            opacity: 0.85,
            getPosition: (d) => [d.longitude, d.latitude],
            getFillColor: (d) => getPointColor(d, colorField, limits.value, colorPaletteId),
            getRadius: (d) => magnitudeRadiusMeters(d.magnitude),
            radiusUnits: 'meters',
            radiusMinPixels: 2,
            radiusMaxPixels: 30,
          })
        ),
      ],
    })
  },
  { flush: 'post' }
)

onUnmounted(() => {
  document.removeEventListener('mousedown', closeAddressDropdownIfOutside)
  overlay.value?.finalize()
  overlay.value = null

  map?.remove()
  map = null
})
</script>

<template>
  <div class="h-screen min-h-0 w-full relative text-[#333]">
    <div class="relative w-full h-full min-h-0">
      <div class="absolute z-[3] left-3 top-3 flex flex-col gap-2">
        <div class="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            title="Filters"
            class="relative inline-flex items-center justify-center w-11 h-11 rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer text-[13px] font-medium select-none transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5] hover:border-black/20"
            @click="isFilterOpen = true"
          >
            <Filter class="w-5 h-5 shrink-0" stroke-width="2" />
            <span
              v-if="activeFilters.length"
              class="absolute -right-1 -bottom-1 min-w-[18px] h-[18px] px-1.5 rounded-full border border-[#ff7043]/50 bg-[#ff7043] text-white text-[11px] font-semibold tabular-nums inline-flex items-center justify-center"
            >
              {{ activeFilters.length }}
            </span>
          </button>
          <div
            class="py-2 px-3 rounded-[10px] bg-white border border-black/10 inline-flex items-center gap-2 text-xs text-[#333] select-none shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
            :data-status="status"
          >
            <span class="status-dot w-2 h-2 rounded-full bg-[#666]" />
            <span v-if="status === 'ready'">{{ visiblePointsCount.toLocaleString() }} points</span>
            <span v-else>{{ statusMessage }}</span>
          </div>
        </div>
      </div>

      <div class="absolute z-[3] right-3 top-3 flex flex-col items-end">
        <div class="flex gap-2 items-center">
          <!-- Distance -->
          <div class="relative flex flex-col items-end">
            <button
              type="button"
              title="Distance"
              class="spatial-btn w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer select-none transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5] hover:border-black/20 data-[active=true]:border-[#ff7043] data-[active=true]:bg-[rgba(255,112,67,0.12)] data-[active=true]:text-[#ff7043] data-[open=true]:border-2 data-[open=true]:border-[#ff7043] data-[open=true]:bg-[rgba(255,112,67,0.12)] data-[open=true]:text-[#ff7043] data-[open=true]:ring-2 data-[open=true]:ring-[#ff7043]/30"
              :data-active="distanceFilterActive"
              :data-open="isDistanceOpen"
              @click="openDistance"
            >
              <MapPin class="w-5 h-5" stroke-width="2" />
            </button>
            <Transition name="spatial-panel">
              <div
                v-if="isDistanceOpen"
                class="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-24px)] p-4 rounded-[12px] border border-black/8 bg-white shadow-[0_6px_20px_rgba(0,0,0,0.1)] max-h-[min(70vh,420px)] overflow-y-auto z-10"
              >
                <div class="space-y-3">
                  <div ref="addressFieldRef" class="relative">
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-[#666] mb-1.5">Origin from address</div>
                    <div class="flex gap-2 items-center mb-2.5">
                      <input
                        v-model="addressQuery"
                        type="text"
                        placeholder="Address or place name"
                        class="flex-1 min-w-0 h-10 px-3 rounded-[10px] border border-black/10 bg-white text-[13px] outline-none transition-colors placeholder:text-[#666] hover:border-black/20 focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
                        :disabled="geocodeStatus === 'loading'"
                        autocomplete="off"
                        @input="onAddressQueryInput"
                        @keydown="handleAddressKeydown"
                      />
                      <button
                        type="button"
                        class="py-2 px-3.5 rounded-[10px] border border-black/10 bg-[rgba(255,112,67,0.12)] text-[#ff7043] cursor-pointer text-[13px] font-medium shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[rgba(255,112,67,0.2)] hover:border-[#ff7043] disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="geocodeStatus === 'loading'"
                        @click="setOriginFromAddress"
                      >
                        {{ geocodeStatus === 'loading' ? 'Searching…' : 'Set origin' }}
                      </button>
                    </div>
                    <div
                      v-if="addressSuggestionsOpen && addressSuggestions.length"
                      class="absolute left-0 right-0 top-full mt-1.5 max-h-60 overflow-y-auto rounded-[10px] border border-black/8 bg-white shadow-[0_6px_20px_rgba(0,0,0,0.1)] z-10"
                      role="listbox"
                    >
                      <button
                        v-for="(s, i) in addressSuggestions"
                        :key="s.place_name + String(s.center[0])"
                        type="button"
                        class="block w-full py-2.5 px-3.5 text-left border-0 bg-transparent text-[13px] text-[#333] cursor-pointer leading-snug transition-colors hover:bg-[rgba(255,112,67,0.12)]"
                        :class="i === addressSuggestionIndex ? 'bg-[rgba(255,112,67,0.12)]' : ''"
                        role="option"
                        :aria-selected="i === addressSuggestionIndex"
                        @click="selectAddressSuggestion(s)"
                        @mousedown.prevent
                      >
                        {{ s.place_name }}
                      </button>
                    </div>
                    <div v-if="geocodeError" class="mt-1.5 text-[11px] text-[#c62828] mb-2">{{ geocodeError }}</div>
                  </div>
                  <div class="flex gap-2 items-center mb-2.5">
                    <button
                      type="button"
                      class="py-2 px-3.5 rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer text-[13px] font-medium shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5] hover:border-black/20"
                      @click="handleStartPickOrigin"
                    >
                      {{ distanceOrigin ? 'Change origin (click map)' : 'Pick origin (click map)' }}
                    </button>
                    <button
                      type="button"
                      class="py-2 px-3.5 rounded-[10px] border-0 bg-transparent text-[#333] cursor-pointer text-[13px] font-medium hover:bg-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="!distanceOrigin"
                      @click="clearOrigin"
                    >
                      Clear
                    </button>
                  </div>
                  <div class="grid grid-cols-2 gap-2.5">
                    <div>
                      <div class="text-[11px] font-semibold uppercase tracking-wide text-[#666] mb-1.5">Origin</div>
                      <div class="h-10 flex items-center text-xs px-3 rounded-[10px] border border-black/10 bg-[#f5f5f5] text-[#333] font-mono">
                        <template v-if="distanceOrigin">
                          {{ formatFieldValue('longitude', distanceOrigin.longitude) }}, {{ formatFieldValue('latitude', distanceOrigin.latitude) }}
                        </template>
                        <template v-else>Not set</template>
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] font-semibold uppercase tracking-wide text-[#666] mb-1.5">Distance (km)</div>
                      <input
                        class="w-full h-10 px-3 rounded-[10px] border border-black/10 bg-white text-[#333] text-[13px] outline-none font-mono min-w-0 box-border focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
                        type="number"
                        min="0"
                        step="1"
                        v-model.number="distanceKm"
                      />
                    </div>
                  </div>
                  <div v-if="pickingOrigin" class="mt-1.5 text-[11px] text-[#666]">Click on the map to set the origin.</div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Shape -->
          <div class="relative flex flex-col items-end">
            <button
              type="button"
              title="Shape"
              class="spatial-btn w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer select-none transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5] hover:border-black/20 data-[active=true]:border-[#ff7043] data-[active=true]:bg-[rgba(255,112,67,0.12)] data-[active=true]:text-[#ff7043] data-[open=true]:border-2 data-[open=true]:border-[#ff7043] data-[open=true]:bg-[rgba(255,112,67,0.12)] data-[open=true]:text-[#ff7043] data-[open=true]:ring-2 data-[open=true]:ring-[#ff7043]/30"
              :data-active="shapeFilterActive"
              :data-open="isShapeOpen"
              @click="toggleShapePanel"
            >
              <Shapes class="w-5 h-5" stroke-width="2" />
            </button>
            <Transition name="spatial-panel">
              <div
                v-if="isShapeOpen && !drawingShape"
                class="absolute top-full right-0 mt-2 w-72 rounded-[12px] border border-black/8 bg-white shadow-[0_6px_20px_rgba(0,0,0,0.1)] overflow-hidden z-10 p-2"
              >
                <template v-if="shapeFilterActive">
                  <div class="text-[11px] text-[#666] px-2 py-1.5 mb-1">Drag shape on map to move.</div>
                  <button
                    type="button"
                    class="w-full py-2.5 px-3 rounded-[8px] border-0 bg-transparent text-[#333] cursor-pointer text-sm font-medium hover:bg-[#f5f5f5] text-left"
                    @click="clearShape"
                  >
                    Clear shape
                  </button>
                </template>
                <template v-else>
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-[#666] px-2 py-1.5 mb-1">
                    Select shape type
                  </div>
                  <button
                    type="button"
                    class="w-full flex flex-col items-start gap-0.5 py-2.5 px-3 rounded-[8px] border-2 border-transparent text-[#333] cursor-pointer text-left transition-all hover:bg-[#f5f5f5] hover:border-black/10 focus:border-[#ff7043] focus:shadow-[0_0_0_1px_#ff7043]"
                    @click="chooseShapeType('rectangle')"
                  >
                    <span class="text-sm font-medium">Rectangle</span>
                    <span class="text-xs text-[#666]">Drag on map</span>
                  </button>
                  <button
                    type="button"
                    class="w-full flex flex-col items-start gap-0.5 py-2.5 px-3 rounded-[8px] border-2 border-transparent text-[#333] cursor-pointer text-left transition-all hover:bg-[#f5f5f5] hover:border-black/10 focus:border-[#ff7043] focus:shadow-[0_0_0_1px_#ff7043]"
                    @click="chooseShapeType('circle')"
                  >
                    <span class="text-sm font-medium">Circle</span>
                    <span class="text-xs text-[#666]">Drag from center to edge</span>
                  </button>
                  <button
                    type="button"
                    class="w-full flex flex-col items-start gap-0.5 py-2.5 px-3 rounded-[8px] border-2 border-transparent text-[#333] cursor-pointer text-left transition-all hover:bg-[#f5f5f5] hover:border-black/10 focus:border-[#ff7043] focus:shadow-[0_0_0_1px_#ff7043]"
                    @click="chooseShapeType('polygon')"
                  >
                    <span class="text-sm font-medium">Polygon</span>
                    <span class="text-xs text-[#666]">Click to add points</span>
                  </button>
                </template>
              </div>
            </Transition>
            <div
              v-if="drawingShape"
              class="absolute top-full right-0 mt-2 py-3 px-3.5 rounded-[10px] border border-black/8 bg-white flex flex-wrap items-center gap-2.5 max-w-[280px] shadow-[0_2px_8px_rgba(0,0,0,0.08)] z-10"
            >
              <span class="text-xs text-[#666] flex-1 min-w-[120px]">
                <template v-if="shapeType === 'rectangle'">Drag on map to draw rectangle.</template>
                <template v-else-if="shapeType === 'circle'">Drag on map to draw circle.</template>
                <template v-else>Click to add points, then Finish.</template>
              </span>
              <button
                v-if="shapeType === 'polygon'"
                type="button"
                class="py-1.5 px-3 rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="shapePoints.length < 3"
                @click="finishPolygon"
              >
                Finish
              </button>
              <button
                type="button"
                class="py-1.5 px-3 rounded-[10px] border-0 bg-transparent text-[#333] cursor-pointer text-xs font-medium hover:bg-[#f5f5f5]"
                @click="cancelDrawing"
              >
                Cancel
              </button>
            </div>
          </div>

          <!-- Color -->
          <div class="relative flex flex-col items-end">
            <button
              type="button"
              title="Color"
              class="spatial-btn w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer select-none transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5] hover:border-black/20 data-[active=true]:border-[#ff7043] data-[active=true]:bg-[rgba(255,112,67,0.12)] data-[active=true]:text-[#ff7043] data-[open=true]:border-2 data-[open=true]:border-[#ff7043] data-[open=true]:bg-[rgba(255,112,67,0.12)] data-[open=true]:text-[#ff7043] data-[open=true]:ring-2 data-[open=true]:ring-[#ff7043]/30"
              :data-active="isColorOpen"
              :data-open="isColorOpen"
              @click="openColor"
            >
              <Palette class="w-5 h-5" stroke-width="2" />
            </button>
            <Transition name="spatial-panel">
              <div
                v-if="isColorOpen"
                class="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-24px)] p-4 rounded-[12px] border border-black/8 bg-white shadow-[0_6px_20px_rgba(0,0,0,0.1)] max-h-[min(70vh,420px)] overflow-y-auto z-10"
              >
                <div class="space-y-3">
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-[#666] mb-1.5">Color by field</div>
                    <select
                      :value="colorByField"
                      class="select-field w-full min-w-0 h-10 pl-3 pr-8 rounded-[10px] border border-black/10 bg-white text-[#333] text-[13px] outline-none appearance-none bg-no-repeat bg-[length:14px] bg-[right_10px_center] hover:border-black/20 focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
                      style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E&quot;)"
                      @change="selectColorField(($event.target as HTMLSelectElement).value as FieldKey)"
                    >
                      <option
                        v-for="(label, key) in COLOR_FIELD_LABELS"
                        :key="key"
                        :value="key"
                      >
                        {{ label }}
                      </option>
                    </select>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-[#666] mb-1.5">Palette</div>
                    <div class="flex flex-col gap-2">
                      <button
                        v-for="(label, id) in COLOR_PALETTE_LABELS"
                        :key="id"
                        type="button"
                        class="flex items-center gap-3 py-2.5 px-3 rounded-[6px] border-2 text-[#333] cursor-pointer text-left transition-all shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
                        :class="colorPalette === id ? 'border-[#ff7043] bg-[rgba(255,112,67,0.12)] ring-2 ring-[#ff7043]/30' : 'border-transparent bg-white hover:bg-[#f5f5f5]'"
                        :title="label"
                        @click="selectColorPalette(id)"
                      >
                        <span class="flex-1 min-w-0 h-4 rounded shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] flex flex-row">
                          <span
                            v-for="(color, i) in getPaletteStopColors(id)"
                            :key="i"
                            class="flex-1 min-w-0.5"
                            :style="{ background: `rgb(${color[0]},${color[1]},${color[2]})` }"
                          />
                        </span>
                        <span class="text-xs font-medium shrink-0 min-w-[5em] text-[#333]">{{ label }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div
        ref="containerEl"
        class="map absolute inset-0 w-full h-full min-w-0 min-h-0"
        :class="mapCursorClass"
        :style="{ cursor: mapCursor }"
      />
    </div>

    <div
      v-if="isFilterOpen"
      class="absolute inset-0 z-[4] bg-black/25 md:bg-transparent md:pointer-events-none"
      @click="isFilterOpen = false"
    />

    <div
      v-if="isSavedFiltersModalOpen"
      class="absolute inset-0 z-[6] flex items-center justify-center bg-black/35 p-5"
      @click.self="isSavedFiltersModalOpen = false"
    >
      <div class="bg-white border border-black/8 rounded-[12px] max-w-[380px] w-full shadow-[0_12px_40px_rgba(0,0,0,0.12)] overflow-hidden p-5">
        <div class="font-semibold text-base tracking-tight text-[#333] mb-2">
          Saved filters
        </div>
        <p class="text-[13px] text-[#666] m-0 mb-4 leading-normal">
          Save the current setup (attribute filters, distance &amp; shape) or load a saved one.
        </p>
        <div class="flex gap-2 items-center mb-2">
          <input
            v-model="saveFilterLabel"
            type="text"
            placeholder="Filter name"
            class="flex-1 min-w-0 h-10 px-3 rounded-[10px] border border-black/10 bg-white text-[13px] outline-none placeholder:text-[#666] hover:border-black/20 focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
            @keydown.enter="saveCurrentFilter"
          />
          <button
            type="button"
            class="py-2 px-3.5 rounded-[10px] border border-black/10 bg-[rgba(255,112,67,0.12)] text-[#ff7043] cursor-pointer text-[13px] font-medium shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[rgba(255,112,67,0.2)] hover:border-[#ff7043]"
            @click="saveCurrentFilter"
          >
            Save current
          </button>
        </div>
        <div v-if="saveFilterError" class="text-[11px] text-[#c62828] mb-2">{{ saveFilterError }}</div>
        <div v-if="savedFilters.length" class="flex flex-col gap-2 max-h-[260px] overflow-y-auto mb-4">
          <div
            v-for="item in savedFilters"
            :key="item.id"
            class="flex items-center justify-between gap-3 py-3 px-3.5 rounded-[10px] border border-black/8 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5]"
          >
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="font-semibold text-[13px] text-[#333]">{{ item.label }}</span>
              <span class="text-[11px] text-[#666]">{{ formatSavedDate(item.savedAt) }}</span>
            </div>
            <div class="flex gap-1.5 shrink-0">
              <button
                type="button"
                class="py-1.5 px-3 rounded-[10px] border border-black/10 bg-[rgba(255,112,67,0.12)] text-[#ff7043] cursor-pointer text-xs font-medium"
                @click="handleLoadSavedFilter(item)"
              >
                Load
              </button>
              <button
                type="button"
                class="py-1.5 px-2 rounded-[10px] border-0 bg-transparent text-[#333] cursor-pointer inline-flex items-center justify-center hover:bg-[#f5f5f5]"
                title="Delete"
                @click="deleteSavedFilter(item.id)"
              >
                <Trash2 class="w-4 h-4" stroke-width="2" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="text-[11px] text-[#666] mb-2">No saved filters yet. Name and save above.</div>
        <button
          type="button"
          class="w-full mt-2 py-2 px-3.5 rounded-[10px] border-0 bg-transparent text-[#333] cursor-pointer text-[13px] font-medium hover:bg-[#f5f5f5]"
          @click="isSavedFiltersModalOpen = false"
        >
          Close
        </button>
      </div>
    </div>

    <aside
      class="drawer absolute z-[5] left-0 top-0 bottom-0 w-[380px] max-w-[92vw] border-r border-black/8 bg-white overflow-auto shadow-[0_12px_40px_rgba(0,0,0,0.12)] transition-transform duration-[220ms] ease -translate-x-full data-[open=true]:translate-x-0"
      :data-open="isFilterOpen"
    >
      <div class="sticky top-0 flex items-center justify-between gap-2.5 py-4 px-4 pb-3.5 bg-[#f8f8f8] border-b border-black/8 z-[1]">
        <div class="font-semibold text-base tracking-tight text-[#333]">Filters</div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            title="Save current filters"
            class="w-9 h-9 rounded-[10px] border-0 bg-transparent text-[#ff7043] cursor-pointer inline-flex items-center justify-center transition-colors hover:bg-[rgba(255,112,67,0.12)]"
            @click="openSavedFiltersModal"
          >
            <Save class="w-[18px] h-[18px]" stroke-width="2" />
          </button>
          <button
            type="button"
            title="Load saved filter"
            class="w-9 h-9 rounded-[10px] border-0 bg-transparent text-[#ff7043] cursor-pointer inline-flex items-center justify-center transition-colors hover:bg-[rgba(255,112,67,0.12)]"
            @click="openSavedFiltersModal"
          >
            <FolderOpen class="w-[18px] h-[18px]" stroke-width="2" />
          </button>
          <button
            type="button"
            title="Close"
            class="w-9 h-9 rounded-[10px] border border-black/10 bg-white text-[#333] cursor-pointer inline-flex items-center justify-center transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[#f5f5f5] hover:border-black/20"
            @click="isFilterOpen = false"
          >
            <X class="w-5 h-5" stroke-width="2" />
          </button>
        </div>
      </div>

      <div class="flex justify-between gap-3 text-xs text-[#666] py-3 px-4">
        <div>Visible points</div>
        <div class="font-mono">
          {{ visiblePointsCount.toLocaleString() }}<template v-if="visiblePointsCount !== filteredPoints.length"> of {{ filteredPoints.length.toLocaleString() }} filtered</template><template v-if="filteredPoints.length !== points.length"> ({{ points.length.toLocaleString() }} total)</template>
        </div>
      </div>

      <div v-if="activeFilters.length" class="grid gap-2.5 mx-3 mb-3.5">
        <div
          v-for="f in activeFilters"
          :key="f.id"
          class="p-3.5 rounded-[12px] border border-black/8 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
        >
          <div class="flex gap-2 items-center mb-2.5">
            <select
              :value="f.field"
              class="select-field flex-1 min-w-0 h-10 pl-3 pr-8 rounded-[10px] border border-black/10 bg-white text-[#333] text-[13px] outline-none appearance-none bg-no-repeat bg-[length:14px] bg-[right_10px_center] hover:border-black/20 focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
              style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E&quot;)"
              @change="updateFilterField(f.id, ($event.target as HTMLSelectElement).value as any)"
            >
              <option value="magnitude">Magnitude</option>
              <option value="latitude">Latitude</option>
              <option value="longitude">Longitude</option>
              <option value="depthKm">Depth (km)</option>
              <option value="year">Year</option>
            </select>
            <button
              type="button"
              title="Remove filter"
              class="w-9 h-9 rounded-[10px] border-0 bg-transparent text-[#333] cursor-pointer inline-flex items-center justify-center hover:bg-[#f5f5f5]"
              @click="removeFilter(f.id)"
            >
              <X class="w-5 h-5" stroke-width="2" />
            </button>
          </div>

          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <input
              class="w-full h-10 px-3 rounded-[10px] border border-black/10 bg-white text-[#333] text-[13px] outline-none font-mono min-w-0 box-border hover:border-black/20 focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
              type="number"
              :step="FIELD_STEP[f.field]"
              :min="limits[f.field].min"
              :max="limits[f.field].max"
              v-model.number="f.range.min"
              @change="clampFilterRange(f.id)"
            />
            <span class="text-xs text-[#666] text-center whitespace-nowrap">to</span>
            <input
              class="w-full h-10 px-3 rounded-[10px] border border-black/10 bg-white text-[#333] text-[13px] outline-none font-mono min-w-0 box-border hover:border-black/20 focus:border-[#ff7043] focus:shadow-[0_0_0_3px_rgba(255,112,67,0.35)]"
              type="number"
              :step="FIELD_STEP[f.field]"
              :min="limits[f.field].min"
              :max="limits[f.field].max"
              v-model.number="f.range.max"
              @change="clampFilterRange(f.id)"
            />
          </div>

          <div class="mt-1.5 text-[11px] text-[#666]">
            Range: {{ formatFieldValue(f.field, limits[f.field].min) }} – {{ formatFieldValue(f.field, limits[f.field].max) }}
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 px-4 pb-4">
        <button
          type="button"
          class="w-full py-2 px-3.5 rounded-[10px] border border-black/10 bg-[rgba(255,112,67,0.12)] text-[#ff7043] cursor-pointer text-[13px] font-medium shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-[rgba(255,112,67,0.2)] hover:border-[#ff7043]"
          @click="addFilter('magnitude')"
        >
          Add filter
        </button>
        <button
          type="button"
          class="w-full py-2 px-3.5 rounded-[10px] border-0 bg-transparent text-[#333] cursor-pointer text-[13px] font-medium hover:bg-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!activeFilters.length"
          @click="clearFilters"
        >
          Clear all
        </button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* Status dot colors by parent data-status */
[data-status='ready'] .status-dot {
  background: #2e7d32 !important;
}
[data-status='error'] .status-dot {
  background: #c62828 !important;
}

/* Map cursor for deck.gl canvas */
.map.cursor-crosshair canvas {
  cursor: crosshair !important;
}
.map.cursor-move canvas {
  cursor: move !important;
}

/* Vue Transition */
.spatial-panel-enter-active,
.spatial-panel-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.spatial-panel-enter-from,
.spatial-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>

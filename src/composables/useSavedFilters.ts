import { ref } from 'vue'
import type { FieldKey, SavedFilter, SavedFilterState } from '../types/earthquake'
import { buildRectanglePolygon } from '../utils/geo'

const SAVED_FILTERS_KEY = 'earthquake-map-saved-filters'

export type SavedFiltersOptions = {
  getState: () => SavedFilterState
  applyState: (state: SavedFilterState) => void
}

export function useSavedFilters(options: SavedFiltersOptions) {
  const { getState, applyState } = options
  const savedFilters = ref<SavedFilter[]>([])
  const saveFilterLabel = ref('')
  const saveFilterError = ref('')

  function loadSavedFiltersFromStorage() {
    try {
      const raw = localStorage.getItem(SAVED_FILTERS_KEY)
      if (!raw) {
        savedFilters.value = []
        return
      }
      const parsed = JSON.parse(raw) as SavedFilter[]
      savedFilters.value = Array.isArray(parsed) ? parsed : []
    } catch {
      savedFilters.value = []
    }
  }

  function persistSavedFilters() {
    try {
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(savedFilters.value))
    } catch {
      saveFilterError.value = 'Failed to save to storage'
    }
  }

  function saveCurrentFilter() {
    saveFilterError.value = ''
    const label = saveFilterLabel.value.trim()
    if (!label) {
      saveFilterError.value = 'Enter a name'
      return
    }
    const state = getState()
    const item: SavedFilter = {
      id: crypto.randomUUID(),
      label,
      savedAt: new Date().toISOString(),
      state,
    }
    loadSavedFiltersFromStorage()
    savedFilters.value = [item, ...savedFilters.value]
    persistSavedFilters()
    saveFilterLabel.value = ''
  }

  function loadSavedFilter(item: SavedFilter) {
    const s = item.state
    const validField = (f: string): f is FieldKey =>
      ['magnitude', 'depthKm', 'year', 'latitude', 'longitude'].includes(f)
    let shapePoints = Array.isArray(s.shapePoints)
      ? s.shapePoints
          .filter(
            (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
          )
          .map((p) => [p[0], p[1]] as [number, number])
      : []
    if (s.shapeType === 'rectangle' && shapePoints.length === 2) {
      const poly = buildRectanglePolygon(shapePoints[0]!, shapePoints[1]!)
      shapePoints = poly.slice(0, 4)
    }
    const shapeType = ['rectangle', 'circle', 'polygon'].includes(s.shapeType) ? s.shapeType : 'rectangle'
    applyState({
      activeFilters: (s.activeFilters || [])
        .filter((f) => validField(f.field))
        .map((f) => ({
          id: crypto.randomUUID(),
          field: f.field,
          range: {
            min: Number.isFinite(f.range?.min) ? f.range.min : 0,
            max: Number.isFinite(f.range?.max) ? f.range.max : 10,
          },
        })),
      distanceOrigin:
        s.distanceOrigin &&
        Number.isFinite(s.distanceOrigin.latitude) &&
        Number.isFinite(s.distanceOrigin.longitude)
          ? { longitude: s.distanceOrigin.longitude, latitude: s.distanceOrigin.latitude }
          : null,
      distanceKm: Number.isFinite(s.distanceKm) && s.distanceKm > 0 ? s.distanceKm : 50,
      shapeType,
      shapePoints,
    })
  }

  function deleteSavedFilter(id: string) {
    savedFilters.value = savedFilters.value.filter((f) => f.id !== id)
    persistSavedFilters()
  }

  function formatSavedDate(iso: string): string {
    try {
      const d = new Date(iso)
      const now = new Date()
      const sameDay = d.toDateString() === now.toDateString()
      if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      })
    } catch {
      return ''
    }
  }

  return {
    savedFilters,
    saveFilterLabel,
    saveFilterError,
    loadSavedFiltersFromStorage,
    saveCurrentFilter,
    loadSavedFilter,
    deleteSavedFilter,
    formatSavedDate,
  }
}

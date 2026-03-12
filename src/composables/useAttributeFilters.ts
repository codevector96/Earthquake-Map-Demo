import { computed, ref, type Ref } from 'vue'
import type { EarthquakePoint, FieldKey, FilterRow, LimitsByField, Range } from '../types/earthquake'
import { clampRange, formatFieldValue, FIELD_STEP } from '../utils/earthquakeData'

export type { FieldKey, FilterRow, LimitsByField, Range }

export function useAttributeFilters(points: Ref<EarthquakePoint[]>) {
  const limits = computed<LimitsByField>(() => {
    const data = points.value
    if (!data.length) {
      return {
        magnitude: { min: 0, max: 10 },
        depthKm: { min: 0, max: 700 },
        year: { min: 1900, max: 2100 },
        latitude: { min: -90, max: 90 },
        longitude: { min: -180, max: 180 },
      }
    }
    let magMin = Number.POSITIVE_INFINITY
    let magMax = Number.NEGATIVE_INFINITY
    let depthMin = Number.POSITIVE_INFINITY
    let depthMax = Number.NEGATIVE_INFINITY
    let yearMin = Number.POSITIVE_INFINITY
    let yearMax = Number.NEGATIVE_INFINITY
    let latMin = Number.POSITIVE_INFINITY
    let latMax = Number.NEGATIVE_INFINITY
    let lonMin = Number.POSITIVE_INFINITY
    let lonMax = Number.NEGATIVE_INFINITY
    for (const d of data) {
      magMin = Math.min(magMin, d.magnitude)
      magMax = Math.max(magMax, d.magnitude)
      latMin = Math.min(latMin, d.latitude)
      latMax = Math.max(latMax, d.latitude)
      lonMin = Math.min(lonMin, d.longitude)
      lonMax = Math.max(lonMax, d.longitude)
      if (d.depthKm !== undefined) {
        depthMin = Math.min(depthMin, d.depthKm)
        depthMax = Math.max(depthMax, d.depthKm)
      }
      if (d.year !== undefined) {
        yearMin = Math.min(yearMin, d.year)
        yearMax = Math.max(yearMax, d.year)
      }
    }
    if (!Number.isFinite(depthMin) || !Number.isFinite(depthMax)) {
      depthMin = 0
      depthMax = 700
    }
    if (!Number.isFinite(yearMin) || !Number.isFinite(yearMax)) {
      yearMin = 1900
      yearMax = 2100
    }
    return {
      magnitude: { min: Math.floor(magMin * 10) / 10, max: Math.ceil(magMax * 10) / 10 },
      depthKm: { min: Math.floor(depthMin), max: Math.ceil(depthMax) },
      year: { min: Math.floor(yearMin), max: Math.ceil(yearMax) },
      latitude: { min: Math.floor(latMin * 1000) / 1000, max: Math.ceil(latMax * 1000) / 1000 },
      longitude: { min: Math.floor(lonMin * 1000) / 1000, max: Math.ceil(lonMax * 1000) / 1000 },
    }
  })

  const activeFiltersRef = ref<FilterRow[]>([])

  function addFilter(field: FieldKey = 'magnitude') {
    const l = limits.value[field]
    activeFiltersRef.value = [
      ...activeFiltersRef.value,
      { id: crypto.randomUUID(), field, range: { ...l } },
    ]
  }
  function removeFilter(id: string) {
    activeFiltersRef.value = activeFiltersRef.value.filter((f) => f.id !== id)
  }
  function clearFilters() {
    activeFiltersRef.value = []
  }
  function updateFilterField(id: string, field: FieldKey) {
    activeFiltersRef.value = activeFiltersRef.value.map((f) =>
      f.id !== id ? f : { ...f, field, range: { ...limits.value[field] } }
    )
  }
  function clampFilterRange(id: string) {
    activeFiltersRef.value = activeFiltersRef.value.map((f) =>
      f.id !== id ? f : { ...f, range: clampRange(f.range, limits.value[f.field]) }
    )
  }

  return {
    limits,
    activeFilters: activeFiltersRef,
    addFilter,
    removeFilter,
    clearFilters,
    updateFilterField,
    clampFilterRange,
    formatFieldValue,
    FIELD_STEP,
  }
}

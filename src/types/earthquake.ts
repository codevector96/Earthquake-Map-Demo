export type CsvRow = Record<string, string>

export type EarthquakePoint = {
  latitude: number
  longitude: number
  magnitude: number
  depthKm?: number
  year?: number
  date?: string
  time?: string
  id?: string
}

export type LngLat = { longitude: number; latitude: number }

export type ShapeType = 'rectangle' | 'circle' | 'polygon'

export type Range = { min: number; max: number }

export type FieldKey = 'magnitude' | 'depthKm' | 'year' | 'latitude' | 'longitude'

export type LimitsByField = Record<FieldKey, Range>

export type FilterRow = {
  id: string
  field: FieldKey
  range: Range
}

export type SavedFilterState = {
  activeFilters: FilterRow[]
  distanceOrigin: LngLat | null
  distanceKm: number
  shapeType: ShapeType
  shapePoints: [number, number][]
}

export type SavedFilter = {
  id: string
  label: string
  savedAt: string
  state: SavedFilterState
}

export type GeocodeFeature = {
  center?: [number, number]
  place_name?: string
}

export type GeocodeSuggestion = {
  place_name: string
  center: [number, number]
}

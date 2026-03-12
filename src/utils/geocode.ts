import type { GeocodeFeature, GeocodeSuggestion } from '../types/earthquake'

/**
 * Reverse geocode: get address string for a lng/lat.
 * Returns the place_name of the first feature, or null if none.
 */
export async function reverseGeocode(
  longitude: number,
  latitude: number
): Promise<string | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) return null
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${token}&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as { features?: GeocodeFeature[] }
  const features = data.features ?? []
  const first = features[0]
  return first?.place_name ?? null
}

export async function geocodeSearch(
  query: string,
  options: { limit?: number; autocomplete?: boolean } = {}
): Promise<GeocodeSuggestion[]> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  if (!token) return []
  const trimmed = query.trim()
  if (!trimmed.length) return []
  const limit = options.limit ?? 5
  const autocomplete = options.autocomplete ?? true
  const encoded = encodeURIComponent(trimmed)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=${limit}&autocomplete=${autocomplete}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { features?: GeocodeFeature[] }
  const features = data.features ?? []
  return features
    .filter(
      (f): f is GeocodeFeature & { center: [number, number]; place_name: string } =>
        Boolean(f.center && f.place_name)
    )
    .map((f) => ({ place_name: f.place_name!, center: f.center! }))
}

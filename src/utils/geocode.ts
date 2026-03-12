import type { GeocodeFeature, GeocodeSuggestion } from '../types/earthquake'

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

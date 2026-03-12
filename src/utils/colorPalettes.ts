import type { FieldKey } from '../types/earthquake'
import type { LimitsByField } from '../types/earthquake'
import type { EarthquakePoint } from '../types/earthquake'

/** Palette: array of [r, g, b] stops (0–255); t in [0,1] maps between them. Standard palettes with 8+ colors. */
export type ColorPaletteId = 'magnitude' | 'viridis' | 'blueRed' | 'greenPurple' | 'plasma'

const PALETTE_STOPS: Record<ColorPaletteId, [number, number, number][]> = {
  // Magnitude: blue → cyan → green → yellow → orange → red (8 stops)
  magnitude: [
    [26, 26, 255],
    [77, 77, 255],
    [128, 128, 255],
    [100, 180, 200],
    [120, 220, 120],
    [255, 200, 80],
    [255, 100, 60],
    [255, 50, 50],
  ],
  // Viridis (matplotlib-style, 9 colors): dark purple → blue → teal → green → yellow
  viridis: [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 131, 143],
    [31, 158, 137],
    [53, 183, 121],
    [109, 205, 89],
    [253, 231, 37],
  ],
  // Blue–White–Red diverging (9 colors)
  blueRed: [
    [33, 102, 172],
    [67, 147, 195],
    [146, 197, 222],
    [209, 229, 240],
    [253, 247, 244],
    [244, 165, 130],
    [214, 96, 77],
    [178, 24, 43],
    [103, 0, 31],
  ],
  // Green–Cyan–Blue–Purple (8 colors)
  greenPurple: [
    [0, 255, 127],
    [0, 205, 160],
    [72, 161, 185],
    [100, 120, 180],
    [106, 90, 165],
    [90, 70, 150],
    [80, 65, 145],
    [72, 61, 139],
  ],
  // Plasma (matplotlib-style, 9 colors): dark blue → purple → magenta → orange → yellow
  plasma: [
    [13, 8, 135],
    [70, 3, 159],
    [114, 1, 168],
    [156, 23, 158],
    [189, 55, 134],
    [216, 87, 107],
    [237, 121, 83],
    [251, 159, 58],
    [240, 249, 33],
  ],
}

function interpolate(t: number, stops: [number, number, number][]): [number, number, number] {
  const n = stops.length
  if (n === 0) return [128, 128, 128]
  if (n === 1) return [...stops[0]!]
  const i = Math.max(0, Math.min(n - 2, Math.floor(t * (n - 1))))
  const local = (t * (n - 1)) - i
  const a = stops[i]!
  const b = stops[i + 1]!
  return [
    Math.round(a[0] + local * (b[0] - a[0])),
    Math.round(a[1] + local * (b[1] - a[1])),
    Math.round(a[2] + local * (b[2] - a[2])),
  ]
}

function getValueFromPoint(d: EarthquakePoint, field: FieldKey): number | null {
  switch (field) {
    case 'magnitude':
      return d.magnitude
    case 'depthKm':
      return d.depthKm ?? null
    case 'year':
      return d.year ?? null
    case 'latitude':
      return d.latitude
    case 'longitude':
      return d.longitude
    default:
      return null
  }
}

/**
 * Returns [r, g, b, a] for a point based on the chosen field and palette.
 * Normalizes the field value to [0,1] with limits and interpolates the palette.
 */
export function getPointColor(
  d: EarthquakePoint,
  field: FieldKey,
  limits: LimitsByField,
  paletteId: ColorPaletteId
): [number, number, number, number] {
  const value = getValueFromPoint(d, field)
  const range = limits[field]
  if (value === null || !range || range.min === range.max) {
    const [r, g, b] = PALETTE_STOPS[paletteId]?.[0] ?? [128, 128, 128]
    return [r, g, b, 200]
  }
  const t = Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)))
  const [r, g, b] = interpolate(t, PALETTE_STOPS[paletteId] ?? PALETTE_STOPS.viridis)
  const a = Math.round(160 + t * 80)
  return [r, g, b, a]
}

export const COLOR_PALETTE_LABELS: Record<ColorPaletteId, string> = {
  magnitude: 'Magnitude',
  viridis: 'Viridis',
  blueRed: 'Blue–Red',
  greenPurple: 'Green–Purple',
  plasma: 'Plasma',
}

/** Returns the list of [r,g,b] stop colors for a palette (for rendering as connected rects) */
export function getPaletteStopColors(paletteId: ColorPaletteId): [number, number, number][] {
  const stops = PALETTE_STOPS[paletteId]
  return stops ? [...stops] : [[128, 128, 128]]
}

/** CSS linear-gradient string for a palette (for use as background on a color bar) */
export function getPaletteGradient(paletteId: ColorPaletteId): string {
  const stops = PALETTE_STOPS[paletteId]
  if (!stops?.length) return 'linear-gradient(to right, #888, #888)'
  const parts = stops.map(([r, g, b]) => `rgb(${r},${g},${b})`)
  const n = stops.length
  const percentages = n === 1 ? ['0%'] : parts.map((_, i) => `${(i / (n - 1)) * 100}%`)
  const colorStops = parts.map((c, i) => `${c} ${percentages[i]}`).join(', ')
  return `linear-gradient(to right, ${colorStops})`
}

export const COLOR_FIELD_LABELS: Record<FieldKey, string> = {
  magnitude: 'Magnitude',
  depthKm: 'Depth (km)',
  year: 'Year',
  latitude: 'Latitude',
  longitude: 'Longitude',
}

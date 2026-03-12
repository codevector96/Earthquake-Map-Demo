import type { FieldKey, Range } from '../types/earthquake'

export function clampRange(next: Range, limits: Range): Range {
  const min = Math.max(limits.min, Math.min(limits.max, next.min))
  const max = Math.max(limits.min, Math.min(limits.max, next.max))
  return min <= max ? { min, max } : { min: max, max: min }
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseYearFromMmDdYyyy(date: string | undefined): number | null {
  if (!date) return null
  const parts = date.split('/')
  if (parts.length !== 3) return null
  const year = Number(parts[2])
  return Number.isFinite(year) ? year : null
}

export function magnitudeColor(mag: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (mag - 4) / 4))
  const r = Math.round(80 + t * (255 - 80))
  const g = Math.round(120 - t * 80)
  const b = Math.round(255 - t * 180)
  const a = Math.round(160 + t * 80)
  return [r, g, b, a]
}

export function magnitudeRadiusMeters(mag: number): number {
  return Math.max(2000, Math.pow(2, mag - 3) * 2000)
}

export function formatFieldValue(field: FieldKey, value: number): string {
  if (field === 'year') return String(Math.round(value))
  if (field === 'depthKm') return String(Math.round(value))
  if (field === 'magnitude') return value.toFixed(1)
  return value.toFixed(2)
}

export const FIELD_STEP: Record<FieldKey, number> = {
  magnitude: 0.1,
  depthKm: 1,
  year: 1,
  latitude: 0.1,
  longitude: 0.1,
}

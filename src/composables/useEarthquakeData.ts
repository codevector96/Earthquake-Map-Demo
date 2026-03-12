import { ref } from 'vue'
import Papa from 'papaparse'
import type { CsvRow, EarthquakePoint } from '../types/earthquake'
import { toNumber, parseYearFromMmDdYyyy } from '../utils/earthquakeData'

export function useEarthquakeData() {
  const points = ref<EarthquakePoint[]>([])
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const statusMessage = ref('Loading CSV…')

  async function loadCsv() {
    status.value = 'loading'
    statusMessage.value = 'Loading CSV…'
    const res = await fetch('/data/database.csv')
    if (!res.ok) throw new Error(`Failed to load CSV: ${res.status} ${res.statusText}`)
    const csvText = await res.text()
    const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true })
    if (parsed.errors?.length) {
      throw new Error(parsed.errors[0]?.message ?? 'Failed to parse CSV')
    }
    const next: EarthquakePoint[] = []
    for (const row of parsed.data) {
      const latitude = toNumber(row.Latitude)
      const longitude = toNumber(row.Longitude)
      const magnitude = toNumber(row.Magnitude)
      if (latitude === null || longitude === null || magnitude === null) continue
      const year = parseYearFromMmDdYyyy(row.Date) ?? undefined
      next.push({
        latitude,
        longitude,
        magnitude,
        depthKm: toNumber(row.Depth) ?? undefined,
        year,
        date: row.Date,
        time: row.Time,
        id: row.ID,
      })
    }
    points.value = next
    status.value = 'ready'
    statusMessage.value = `${next.length.toLocaleString()} points`
  }

  return { points, status, statusMessage, loadCsv }
}

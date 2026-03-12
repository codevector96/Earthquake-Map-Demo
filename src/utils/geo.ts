/**
 * Geographic and projection utilities for the earthquake map.
 * Web Mercator (EPSG:3857) is used so rect/circle have constant size on the 2D map.
 */

const MERCATOR_HALF_CIRCUMFERENCE = 20037508.342789244

export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const x = point[0]
  const y = point[1]
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0]
    const yi = polygon[i]![1]
    const xj = polygon[j]![0]
    const yj = polygon[j]![1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function lngLatToMercatorMeters(lng: number, lat: number): [number, number] {
  const x = (lng * MERCATOR_HALF_CIRCUMFERENCE) / 180
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * MERCATOR_HALF_CIRCUMFERENCE) / Math.PI
  return [x, y]
}

export function mercatorMetersToLngLat(mx: number, my: number): [number, number] {
  const lng = (mx * 180) / MERCATOR_HALF_CIRCUMFERENCE
  const lat =
    (360 / Math.PI) * Math.atan(Math.exp((my * Math.PI) / MERCATOR_HALF_CIRCUMFERENCE)) - 90
  return [lng, lat]
}

export function buildRectanglePolygon(a: [number, number], b: [number, number]): [number, number][] {
  const [mx1, my1] = lngLatToMercatorMeters(a[0], a[1])
  const [mx2, my2] = lngLatToMercatorMeters(b[0], b[1])
  const minMx = Math.min(mx1, mx2)
  const maxMx = Math.max(mx1, mx2)
  const minMy = Math.min(my1, my2)
  const maxMy = Math.max(my1, my2)
  return [
    mercatorMetersToLngLat(minMx, minMy),
    mercatorMetersToLngLat(maxMx, minMy),
    mercatorMetersToLngLat(maxMx, maxMy),
    mercatorMetersToLngLat(minMx, maxMy),
    mercatorMetersToLngLat(minMx, minMy),
  ]
}

export function buildCirclePolygon(
  center: [number, number],
  edge: [number, number],
  steps = 64
): [number, number][] {
  const [cx, cy] = lngLatToMercatorMeters(center[0], center[1])
  const [ex, ey] = lngLatToMercatorMeters(edge[0], edge[1])
  const rMeters = Math.hypot(ex - cx, ey - cy)
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const mx = cx + rMeters * Math.cos(t)
    const my = cy + rMeters * Math.sin(t)
    pts.push(mercatorMetersToLngLat(mx, my))
  }
  return pts
}

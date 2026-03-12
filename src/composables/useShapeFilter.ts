import type { MapMouseEvent } from 'mapbox-gl'
import { computed, ref } from 'vue'
import type { ShapeType } from '../types/earthquake'
import {
  buildRectanglePolygon,
  buildCirclePolygon,
  pointInPolygon,
  lngLatToMercatorMeters,
  mercatorMetersToLngLat,
} from '../utils/geo'

export function useShapeFilter() {
  const shapeType = ref<ShapeType>('rectangle')
  const drawingShape = ref(false)
  const shapePoints = ref<[number, number][]>([])
  const dragStart = ref<[number, number] | null>(null)
  const dragCurrent = ref<[number, number] | null>(null)
  const movingShape = ref(false)
  const moveStartLngLat = ref<[number, number] | null>(null)
  const moveStartPoints = ref<[number, number][]>([])

  const shapeFilterActive = computed(() => {
    const pts = shapePoints.value
    if (shapeType.value === 'rectangle') return pts.length >= 4
    if (shapeType.value === 'circle') return pts.length >= 2
    return pts.length >= 3
  })

  function getShapePolygonForHitTest(): [number, number][] | null {
    const pts = shapePoints.value
    if (shapeType.value === 'rectangle' && pts.length >= 4) return [...pts, pts[0]!]
    if (shapeType.value === 'rectangle' && pts.length >= 2)
      return buildRectanglePolygon(pts[0]!, pts[1]!)
    if (shapeType.value === 'circle' && pts.length >= 2)
      return buildCirclePolygon(pts[0]!, pts[1]!)
    if (shapeType.value === 'polygon' && pts.length >= 3) return [...pts, pts[0]!]
    return null
  }

  function isPointInShape(lngLat: [number, number]): boolean {
    const poly = getShapePolygonForHitTest()
    return poly ? pointInPolygon(lngLat, poly) : false
  }

  function selectShapeType(type: ShapeType) {
    shapeType.value = type
    drawingShape.value = true
    shapePoints.value = []
    dragStart.value = null
    dragCurrent.value = null
  }

  function finishPolygon() {
    if (shapeType.value !== 'polygon') return
    if (shapePoints.value.length >= 3) drawingShape.value = false
  }

  function cancelDrawing() {
    drawingShape.value = false
    shapePoints.value = []
    dragStart.value = null
    dragCurrent.value = null
  }

  function clearShape() {
    shapePoints.value = []
    drawingShape.value = false
    dragStart.value = null
    dragCurrent.value = null
    movingShape.value = false
  }

  function onMapMouseDown(e: MapMouseEvent) {
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    if (movingShape.value) return
    if (drawingShape.value && (shapeType.value === 'rectangle' || shapeType.value === 'circle')) {
      if (dragStart.value === null) {
        dragStart.value = lngLat
        dragCurrent.value = null
        e.preventDefault()
      }
      return
    }
    if (!drawingShape.value && shapeFilterActive.value && isPointInShape(lngLat)) {
      movingShape.value = true
      moveStartLngLat.value = lngLat
      moveStartPoints.value = shapePoints.value.map((p) => [p[0], p[1]])
      e.preventDefault()
    }
  }

  function onMapMouseMove(e: MapMouseEvent) {
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    if (movingShape.value && moveStartLngLat.value && moveStartPoints.value.length) {
      const pts = moveStartPoints.value
      if (shapeType.value === 'rectangle' && pts.length === 4) {
        const toM = (p: [number, number]) => lngLatToMercatorMeters(p[0], p[1])
        const m0 = pts.map(toM)
        const mxs = m0.map((m) => m[0])
        const mys = m0.map((m) => m[1])
        const cx = (Math.min(...mxs) + Math.max(...mxs)) / 2
        const cy = (Math.min(...mys) + Math.max(...mys)) / 2
        const halfW = (Math.max(...mxs) - Math.min(...mxs)) / 2
        const halfH = (Math.max(...mys) - Math.min(...mys)) / 2
        const [startMx, startMy] = lngLatToMercatorMeters(
          moveStartLngLat.value[0],
          moveStartLngLat.value[1]
        )
        const [currMx, currMy] = lngLatToMercatorMeters(lngLat[0], lngLat[1])
        const newCx = cx + (currMx - startMx)
        const newCy = cy + (currMy - startMy)
        shapePoints.value = [
          mercatorMetersToLngLat(newCx - halfW, newCy - halfH),
          mercatorMetersToLngLat(newCx + halfW, newCy - halfH),
          mercatorMetersToLngLat(newCx + halfW, newCy + halfH),
          mercatorMetersToLngLat(newCx - halfW, newCy + halfH),
        ]
      } else if (shapeType.value === 'circle' && pts.length === 2) {
        const [cMx, cMy] = lngLatToMercatorMeters(pts[0]![0], pts[0]![1])
        const [eMx, eMy] = lngLatToMercatorMeters(pts[1]![0], pts[1]![1])
        const [startMx, startMy] = lngLatToMercatorMeters(
          moveStartLngLat.value[0],
          moveStartLngLat.value[1]
        )
        const [currMx, currMy] = lngLatToMercatorMeters(lngLat[0], lngLat[1])
        shapePoints.value = [
          mercatorMetersToLngLat(cMx + (currMx - startMx), cMy + (currMy - startMy)),
          mercatorMetersToLngLat(eMx + (currMx - startMx), eMy + (currMy - startMy)),
        ]
      } else if (pts.length >= 3) {
        const toM = (p: [number, number]) => lngLatToMercatorMeters(p[0], p[1])
        const m0 = pts.map(toM)
        const [startMx, startMy] = lngLatToMercatorMeters(
          moveStartLngLat.value[0],
          moveStartLngLat.value[1]
        )
        const [currMx, currMy] = lngLatToMercatorMeters(lngLat[0], lngLat[1])
        const dMx = currMx - startMx
        const dMy = currMy - startMy
        shapePoints.value = m0.map((m) => mercatorMetersToLngLat(m[0] + dMx, m[1] + dMy))
      } else {
        const dlng = lngLat[0] - moveStartLngLat.value[0]
        const dlat = lngLat[1] - moveStartLngLat.value[1]
        shapePoints.value = pts.map((p) => [p[0] + dlng, p[1] + dlat])
      }
      moveStartLngLat.value = lngLat
      moveStartPoints.value = shapePoints.value.map((p) => [p[0], p[1]])
      return
    }
    if (
      drawingShape.value &&
      (shapeType.value === 'rectangle' || shapeType.value === 'circle') &&
      dragStart.value
    ) {
      dragCurrent.value = lngLat
    }
  }

  function onMapMouseUp(e: MapMouseEvent) {
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    if (movingShape.value) {
      movingShape.value = false
      moveStartLngLat.value = null
      moveStartPoints.value = []
      return
    }
    if (
      drawingShape.value &&
      (shapeType.value === 'rectangle' || shapeType.value === 'circle') &&
      dragStart.value
    ) {
      const end = dragCurrent.value ?? lngLat
      if (shapeType.value === 'rectangle') {
        const poly = buildRectanglePolygon(dragStart.value, end)
        shapePoints.value = poly.slice(0, 4)
      } else {
        shapePoints.value = [dragStart.value, end]
      }
      dragStart.value = null
      dragCurrent.value = null
      drawingShape.value = false
    }
  }

  return {
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
  }
}

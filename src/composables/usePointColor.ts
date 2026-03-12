import { ref } from 'vue'
import type { FieldKey } from '../types/earthquake'
import type { ColorPaletteId } from '../utils/colorPalettes'

export function usePointColor() {
  const colorByField = ref<FieldKey>('magnitude')
  const colorPalette = ref<ColorPaletteId>('magnitude')

  return {
    colorByField,
    colorPalette,
  }
}

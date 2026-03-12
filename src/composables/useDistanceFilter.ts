import { computed, ref, onUnmounted } from 'vue'
import type { LngLat } from '../types/earthquake'
import { geocodeSearch, reverseGeocode } from '../utils/geocode'
import { formatFieldValue } from '../utils/earthquakeData'
import type { FieldKey } from './useAttributeFilters'

export function useDistanceFilter() {
  const distanceOrigin = ref<LngLat | null>(null)
  const distanceKm = ref(50)
  const pickingOrigin = ref(false)
  const addressQuery = ref('')
  const geocodeStatus = ref<'idle' | 'loading' | 'error' | 'success'>('idle')
  const geocodeError = ref('')
  const addressSuggestions = ref<Array<{ place_name: string; center: [number, number] }>>([])
  const addressSuggestionsOpen = ref(false)
  const addressSuggestionIndex = ref(0)
  const addressFieldRef = ref<HTMLDivElement | null>(null)
  let addressSearchTimer: ReturnType<typeof setTimeout> | null = null

  const distanceFilterActive = computed(() => distanceOrigin.value != null)

  async function fetchAddressSuggestions(query: string) {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      addressSuggestions.value = []
      addressSuggestionsOpen.value = false
      return
    }
    const results = await geocodeSearch(trimmed, { limit: 5, autocomplete: true })
    addressSuggestions.value = results
    addressSuggestionsOpen.value = results.length > 0
    addressSuggestionIndex.value = 0
  }

  function onAddressQueryInput() {
    geocodeError.value = ''
    if (addressSearchTimer) clearTimeout(addressSearchTimer)
    const q = addressQuery.value
    if (q.trim().length < 2) {
      addressSuggestions.value = []
      addressSuggestionsOpen.value = false
      return
    }
    addressSearchTimer = setTimeout(() => {
      addressSearchTimer = null
      fetchAddressSuggestions(q)
    }, 280)
  }

  function selectAddressSuggestion(s: { place_name: string; center: [number, number] }) {
    distanceOrigin.value = { longitude: s.center[0], latitude: s.center[1] }
    addressQuery.value = s.place_name
    addressSuggestionsOpen.value = false
    addressSuggestions.value = []
    geocodeError.value = ''
    geocodeStatus.value = 'success'
  }

  function onAddressKeydown(e: KeyboardEvent, setOriginFromAddress: () => void) {
    if (!addressSuggestionsOpen.value || !addressSuggestions.value.length) {
      if (e.key === 'Enter') setOriginFromAddress()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      addressSuggestionIndex.value = Math.min(
        addressSuggestionIndex.value + 1,
        addressSuggestions.value.length - 1
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      addressSuggestionIndex.value = Math.max(addressSuggestionIndex.value - 1, 0)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const s = addressSuggestions.value[addressSuggestionIndex.value]
      if (s) selectAddressSuggestion(s)
    }
    if (e.key === 'Escape') {
      addressSuggestionsOpen.value = false
    }
  }

  async function setOriginFromAddress() {
    const query = addressQuery.value.trim()
    if (!query) {
      geocodeError.value = 'Enter an address or place name'
      geocodeStatus.value = 'error'
      return
    }
    if (!import.meta.env.VITE_MAPBOX_TOKEN) {
      geocodeError.value = 'Mapbox token not configured'
      geocodeStatus.value = 'error'
      return
    }
    geocodeStatus.value = 'loading'
    geocodeError.value = ''
    addressSuggestionsOpen.value = false
    try {
      const results = await geocodeSearch(query, { limit: 1, autocomplete: false })
      if (!results.length) {
        geocodeError.value = 'No results found'
        geocodeStatus.value = 'error'
        return
      }
      const [lng, lat] = results[0].center
      distanceOrigin.value = { longitude: lng, latitude: lat }
      geocodeStatus.value = 'success'
      geocodeError.value = ''
    } catch (e) {
      geocodeError.value = e instanceof Error ? e.message : 'Geocoding failed'
      geocodeStatus.value = 'error'
    }
  }

  function startPickOrigin() {
    pickingOrigin.value = true
  }

  async function setOriginFromMapClick(longitude: number, latitude: number) {
    distanceOrigin.value = { longitude, latitude }
    pickingOrigin.value = false
    geocodeError.value = ''
    geocodeStatus.value = 'loading'
    try {
      const placeName = await reverseGeocode(longitude, latitude)
      addressQuery.value = placeName ?? ''
      geocodeStatus.value = placeName ? 'success' : 'idle'
    } catch {
      addressQuery.value = ''
      geocodeStatus.value = 'idle'
    }
  }

  function clearOrigin() {
    distanceOrigin.value = null
    addressQuery.value = ''
    pickingOrigin.value = false
    geocodeStatus.value = 'idle'
    geocodeError.value = ''
    addressSuggestionsOpen.value = false
    addressSuggestions.value = []
  }

  function closeAddressDropdownIfOutside(e: Event) {
    const el = addressFieldRef.value
    const target = e.target as Node
    if (el && target && !el.contains(target)) addressSuggestionsOpen.value = false
  }

  onUnmounted(() => {
    if (addressSearchTimer) clearTimeout(addressSearchTimer)
  })

  return {
    distanceOrigin,
    distanceKm,
    pickingOrigin,
    distanceFilterActive,
    addressQuery,
    geocodeStatus,
    geocodeError,
    addressSuggestions,
    addressSuggestionsOpen,
    addressSuggestionIndex,
    addressFieldRef,
    startPickOrigin,
    setOriginFromMapClick,
    clearOrigin,
    setOriginFromAddress,
    onAddressQueryInput,
    onAddressKeydown,
    selectAddressSuggestion,
    closeAddressDropdownIfOutside,
    formatFieldValue: formatFieldValue as (field: FieldKey, value: number) => string,
  }
}

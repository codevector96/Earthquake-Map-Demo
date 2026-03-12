<script setup lang="ts">
import EarthquakeMap from './components/EarthquakeMap.vue'
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="title">Earthquakes</div>
      <div class="subtitle">deck.gl + Mapbox GL JS + Vue</div>
    </header>

    <main class="main">
      <EarthquakeMap />
    </main>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: #0b1020;
  color: #e7eaf3;
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.title {
  font-weight: 650;
  letter-spacing: 0.2px;
}

.subtitle {
  opacity: 0.8;
  font-size: 12px;
}

.main {
  min-height: 0;
}
</style>


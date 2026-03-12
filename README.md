# Earthquake points map (Vue + deck.gl + Mapbox GL JS)

Displays earthquake points from `public/data/database.csv` on a Mapbox basemap using a deck.gl `ScatterplotLayer`.

## Setup

1. Install dependencies:

```bash
cd earthquake-map
npm install
```

2. Add your Mapbox token:

- Copy `.env.example` → `.env`
- Set `VITE_MAPBOX_TOKEN` to your Mapbox access token

3. Start the dev server:

```bash
npm run dev
```

## Data

- Source CSV: `public/data/database.csv`
- Required columns used: `Latitude`, `Longitude`, `Magnitude` (optional: `Depth`, `Date`, `Time`, `ID`)


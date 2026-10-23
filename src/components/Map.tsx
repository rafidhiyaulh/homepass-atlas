'use client'
import dynamic from 'next/dynamic'

// Leaflet touches `window` at import time, so the map only renders in the browser
export const Map = dynamic(() => import('./AtlasMap'), {
  ssr: false,
  loading: () => <div className="map skeleton" style={{ height: 520 }} />,
})
export type { Shape, Layer } from './AtlasMap'

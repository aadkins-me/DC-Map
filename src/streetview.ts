import type { Map as MlMap } from 'maplibre-gl';

/** Zoom at which the "Street View here" button appears for the map center. */
export const STREET_VIEW_MIN_ZOOM = 16;

/** Google Maps' public URL scheme; it needs no API key and opens the closest panorama. */
export function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function streetViewLink(lat: number, lng: number, className: string, label = 'Street View here'): string {
  return `<a class="${className}" href="${streetViewUrl(lat, lng)}" target="_blank" rel="noopener" data-street-view>${label} <span aria-hidden="true">↗</span></a>`;
}

const HOLD_MS = 550;
const MOVE_TOLERANCE = 10;

/** Calls `onHold` after a still, single-finger press on the map canvas. */
export function onLongPress(map: MlMap, onHold: (lngLat: [number, number]) => void) {
  const canvas = map.getCanvas();
  let timer: number | undefined;
  let start: { x: number; y: number } | null = null;
  let firedAt = 0;

  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
    start = null;
  };

  canvas.addEventListener(
    'touchstart',
    (e) => {
      cancel();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      timer = window.setTimeout(() => {
        if (!start) return;
        const rect = canvas.getBoundingClientRect();
        const ll = map.unproject([start.x - rect.left, start.y - rect.top]);
        firedAt = Date.now();
        cancel();
        navigator.vibrate?.(15);
        onHold([ll.lng, ll.lat]);
      }, HOLD_MS);
    },
    { passive: true },
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const t = e.touches[0];
      if (e.touches.length !== 1 || Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOLERANCE) cancel();
    },
    { passive: true },
  );
  canvas.addEventListener('touchend', cancel, { passive: true });
  canvas.addEventListener('touchcancel', cancel, { passive: true });

  return {
    /** True right after a long press, so the trailing click/contextmenu can be ignored. */
    justFired: () => Date.now() - firedAt < 900,
  };
}

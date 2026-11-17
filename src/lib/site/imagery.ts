// The aerial picture under a site plan. The browser never talks to a map service: tiles are fetched by RunF9's
// own server (GET /api/site/tiles/z/x/y) and passed on, so a member's address, cookies and the page they are on
// stay with RunF9. What the tile source does learn is which map squares RunF9's server asked for.
//
// RUNF9_SITE_IMAGERY chooses the source:
//   off                                  no aerial picture (always the case on an air-gapped deployment)
//   usgs  (default)                      USGS National Map imagery: United States, public domain
//   https://host/…/{z}/{x}/{y}…          any tile service in the standard web map grid ({y} and {x} in either order)
// RUNF9_SITE_IMAGERY_ATTRIBUTION is the credit line shown on the picture for a custom source.

type Env = Record<string, string | undefined>

export interface Imagery { source: 'usgs' | 'custom'; template: string; attribution: string; maxZoom: number }

const USGS: Imagery = {
  source: 'usgs',
  template: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  attribution: 'USDA, USGS The National Map: Orthoimagery',
  maxZoom: 16,
}

/** The aerial picture source this deployment uses, or null when there is none. */
export function imagery(env: Env = process.env): Imagery | null {
  if (/^(1|true|yes)$/i.test(env.RUNF9_AIRGAPPED || '')) return null
  const v = (env.RUNF9_SITE_IMAGERY || 'usgs').trim()
  if (/^(off|none|0|false)$/i.test(v)) return null
  if (/^usgs$/i.test(v)) return USGS
  if (!/^https:\/\/[^\s]+$/i.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(v)) return null
  if (!v.includes('{z}') || !v.includes('{x}') || !v.includes('{y}')) return null
  const max = Number(env.RUNF9_SITE_IMAGERY_MAX_ZOOM)
  return { source: 'custom', template: v, attribution: (env.RUNF9_SITE_IMAGERY_ATTRIBUTION || '').trim().slice(0, 200), maxZoom: Number.isInteger(max) && max >= 1 && max <= 22 ? max : 19 }
}

export const tileUrl = (im: Imagery, z: number, x: number, y: number): string =>
  im.template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

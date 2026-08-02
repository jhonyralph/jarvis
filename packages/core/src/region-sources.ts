/** Region -> known open event source registry.
 *
 *  The personal assistant used to hardcode a SINGLE region (Belo Horizonte's Mapas Culturais feed,
 *  gated behind JARVIS_MAPAS_CULTURAIS_URL) as if it were "the" default. That made the assistant feel
 *  Brazil-only and city-only, and still required the owner to find and paste an endpoint by hand.
 *
 *  This module makes the MECHANISM agnostic instead: a small, typed registry of known-good, verified,
 *  free/open event sources keyed by country (and optionally city), plus a pure matcher that resolves
 *  which entry — if any — applies to a reverse-geocoded location. The registry currently ships with
 *  exactly one verified entry (the same Belo Horizonte feed that existed before, now expressed as data
 *  instead of a special case). Growing coverage to more cities/countries means adding entries here with
 *  a real, verified endpoint — never inventing one. An unmatched region is a supported, expected outcome
 *  (most places simply have no known open events feed yet), not an error.
 */

export interface RegionEventSourceEntry {
  /** Stable id, becomes the registered context source id (e.g. "region:mapas-culturais-bh"). */
  id: string;
  /** ISO 3166-1 alpha-2 country code, matched against Nominatim's reverse-geocode `country_code`. */
  countryCode: string;
  /** Optional city/town match against Nominatim's `city`/`town`/`municipality` (case-insensitive). Absent = matches the whole country. */
  city?: string;
  type: "mapas_culturais" | "ics" | "rss" | "jsonld";
  label: string;
  endpoint: string;
  attribution: string;
  timeZone: string;
}

export const REGION_EVENT_SOURCES: readonly RegionEventSourceEntry[] = [
  {
    id: "region:mapas-culturais-bh",
    countryCode: "br",
    city: "belo horizonte",
    type: "mapas_culturais",
    label: "Mapas Culturais BH",
    endpoint: "https://mapaculturalbh.pbh.gov.br/api/event/find",
    attribution: "Mapas Culturais BH",
    timeZone: "America/Sao_Paulo",
  },
];

/** A best-effort address as returned by Nominatim reverse geocoding (subset of its `address` record). */
export interface RegionAddress {
  countryCode?: string;
  city?: string;
  town?: string;
  municipality?: string;
}

/** Resolves the registry entry (if any) matching a reverse-geocoded address. Country-only entries match
 *  anywhere in that country; city entries require a case-insensitive match against city/town/municipality. */
export function matchRegionEventSource(address: RegionAddress): RegionEventSourceEntry | undefined {
  const country = address.countryCode?.trim().toLowerCase();
  if (!country) return undefined;
  const city = [address.city, address.town, address.municipality].find((value) => value?.trim())?.trim().toLowerCase();
  return REGION_EVENT_SOURCES.find((entry) => entry.countryCode === country && (!entry.city || entry.city === city));
}

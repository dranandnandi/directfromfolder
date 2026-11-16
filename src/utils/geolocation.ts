/**
 * Geolocation utility functions for geofencing and distance calculation
 */

/**
 * Calculate distance between two geographic coordinates using Haversine formula
 * @param lat1 Latitude of first point (in decimal degrees)
 * @param lon1 Longitude of first point (in decimal degrees)
 * @param lat2 Latitude of second point (in decimal degrees)
 * @param lon2 Longitude of second point (in decimal degrees)
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180; // Convert to radians
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Format distance for display with appropriate units
 * @param distanceMeters Distance in meters
 * @returns Formatted string (e.g., "150 m" or "1.2 km")
 */
export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

/**
 * Check if a coordinate is within geofence radius
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param orgLat Organization's latitude
 * @param orgLon Organization's longitude
 * @param thresholdMeters Geofence radius in meters
 * @returns Object with isInside flag and distance in meters
 */
export function checkGeofence(
  userLat: number,
  userLon: number,
  orgLat: number,
  orgLon: number,
  thresholdMeters: number
): { isInside: boolean; distance: number } {
  const distance = calculateDistance(userLat, userLon, orgLat, orgLon);
  return {
    isInside: distance <= thresholdMeters,
    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
  };
}

/**
 * Validate coordinate values
 * @param lat Latitude
 * @param lon Longitude
 * @returns True if coordinates are valid
 */
export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Get user's current location using Geolocation API
 * @param timeout Timeout in milliseconds (default 10000)
 * @returns Promise resolving to coordinates or null if unavailable
 */
export async function getCurrentLocation(
  timeout: number = 10000
): Promise<{ latitude: number; longitude: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser');
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        console.error('Error getting location:', error.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Parse geofence settings from organization JSONB column
 * @param settings JSONB settings object
 * @returns Typed geofence settings with defaults
 */
export interface GeofenceSettings {
  enabled: boolean;
  enforcement_mode: 'strict' | 'warning';
  distance_threshold_meters: number;
  allow_admin_override: boolean;
  secondary_location: {
    enabled: boolean;
    latitude: number | null;
    longitude: number | null;
    address: string;
  };
}

export function parseGeofenceSettings(
  settings: any
): GeofenceSettings {
  return {
    enabled: settings?.enabled ?? true,
    enforcement_mode: settings?.enforcement_mode ?? 'strict',
    distance_threshold_meters: settings?.distance_threshold_meters ?? 500,
    allow_admin_override: settings?.allow_admin_override ?? true,
    secondary_location: {
      enabled: settings?.secondary_location?.enabled === true,
      latitude: settings?.secondary_location?.latitude ?? null,
      longitude: settings?.secondary_location?.longitude ?? null,
      address: settings?.secondary_location?.address ?? '',
    },
  };
}

export interface GeofenceLocation {
  latitude: number;
  longitude: number;
}

export interface OrganizationGeofence {
  location_latitude: number | null;
  location_longitude: number | null;
  geofence_settings: unknown;
}

/** Existing organisations keep their primary location; the second is opt-in. */
export function getGeofenceLocations(org: OrganizationGeofence): GeofenceLocation[] {
  const locations: GeofenceLocation[] = [];
  if (org.location_latitude !== null && org.location_longitude !== null &&
      isValidCoordinate(org.location_latitude, org.location_longitude)) {
    locations.push({ latitude: org.location_latitude, longitude: org.location_longitude });
  }
  const secondary = parseGeofenceSettings(org.geofence_settings).secondary_location;
  if (secondary.enabled && secondary.latitude !== null && secondary.longitude !== null &&
      isValidCoordinate(secondary.latitude, secondary.longitude)) {
    locations.push({ latitude: secondary.latitude, longitude: secondary.longitude });
  }
  return locations;
}

export function getNearestGeofenceDistance(
  latitude: number,
  longitude: number,
  locations: GeofenceLocation[]
): number | null {
  if (!isValidCoordinate(latitude, longitude) || locations.length === 0) return null;
  return Math.min(...locations.map(location =>
    calculateDistance(latitude, longitude, location.latitude, location.longitude)
  ));
}

/** Accept either location, comparing the unrounded distance with the radius. */
export function validateGeofencePosition(
  org: OrganizationGeofence,
  latitude: number,
  longitude: number
): { isValid: boolean; distance: number | null; isOutsideGeofence: boolean } {
  const settings = parseGeofenceSettings(org.geofence_settings);
  const locations = getGeofenceLocations(org);
  if (!settings.enabled || locations.length === 0) {
    return { isValid: true, distance: null, isOutsideGeofence: false };
  }
  const distance = getNearestGeofenceDistance(latitude, longitude, locations);
  if (distance === null) {
    throw new Error('A valid current GPS location is required to punch in/out. Please enable location access and try again.');
  }
  const isOutsideGeofence = distance > settings.distance_threshold_meters;
  if (isOutsideGeofence && settings.enforcement_mode === 'strict') {
    throw new Error(
      `You are ${distance.toFixed(0)}m from the nearest allowed location. ` +
      `Punch is not allowed beyond ${settings.distance_threshold_meters}m. ` +
      'Please move closer to an allowed location or contact your administrator.'
    );
  }
  return { isValid: true, distance: Math.round(distance * 100) / 100, isOutsideGeofence };
}

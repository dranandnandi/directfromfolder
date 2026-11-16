import { describe, expect, it } from 'vitest';
import { calculateDistance, getGeofenceLocations, parseGeofenceSettings, validateGeofencePosition } from './geolocation';

const primary = { latitude: 24.2658376795248, longitude: 72.18399927944736 };
const secondary = { latitude: 24.2758376795248, longitude: 72.19399927944736 };
const organization = (secondEnabled = false, extraSettings = {}) => ({
  location_latitude: primary.latitude,
  location_longitude: primary.longitude,
  geofence_settings: {
    enabled: true,
    enforcement_mode: 'strict',
    distance_threshold_meters: 50,
    secondary_location: { enabled: secondEnabled, ...secondary },
    ...extraSettings,
  },
});
const northOf = (latitude: number, meters: number) => latitude + meters / 6371000 * 180 / Math.PI;

describe('attendance at either allowed location', () => {
  it('leaves existing settings and second-location defaults unchanged', () => {
    const settings = parseGeofenceSettings({ enabled: false, distance_threshold_meters: 850 });
    expect(settings.enabled).toBe(false);
    expect(settings.distance_threshold_meters).toBe(850);
    expect(settings.secondary_location.enabled).toBe(false);
    expect(parseGeofenceSettings(null).secondary_location.enabled).toBe(false);
    expect(getGeofenceLocations({ ...organization(), geofence_settings: null })).toEqual([primary]);
  });

  it.each([primary, secondary])('accepts either location independently: %j', location => {
    expect(validateGeofencePosition(organization(true), location.latitude, location.longitude))
      .toMatchObject({ isValid: true, distance: 0, isOutsideGeofence: false });
  });

  it('does not accept the second location when disabled', () => {
    expect(() => validateGeofencePosition(organization(), secondary.latitude, secondary.longitude))
      .toThrow('50m');
  });

  it('rejects a point outside both locations', () => {
    expect(() => validateGeofencePosition(organization(true), 24.28, 72.21)).toThrow('nearest allowed location');
  });

  it.each([primary, secondary])('uses a 50m radius without rounding the decision: %j', location => {
    expect(validateGeofencePosition(organization(true), northOf(location.latitude, 49.999), location.longitude)
      .isOutsideGeofence).toBe(false);
    expect(() => validateGeofencePosition(organization(true), northOf(location.latitude, 50.001), location.longitude))
      .toThrow('50m');
  });

  it('allows the exact threshold', () => {
    const latitude = northOf(primary.latitude, 50);
    const threshold = calculateDistance(latitude, primary.longitude, primary.latitude, primary.longitude);
    expect(validateGeofencePosition(organization(false, { distance_threshold_meters: threshold }), latitude, primary.longitude)
      .isOutsideGeofence).toBe(false);
  });

  it('preserves disabled enforcement and warning mode', () => {
    expect(validateGeofencePosition(organization(true, { enabled: false }), 0, 0).isOutsideGeofence).toBe(false);
    expect(validateGeofencePosition(organization(true, { enforcement_mode: 'warning' }), 0, 0).isOutsideGeofence).toBe(true);
  });

  it('keeps legacy organisations without any configured location working', () => {
    expect(validateGeofencePosition({ location_latitude: null, location_longitude: null, geofence_settings: null }, 0, 0)
      .isValid).toBe(true);
  });

  it('supports coordinates on the equator and prime meridian', () => {
    expect(validateGeofencePosition({ ...organization(), location_latitude: 0, location_longitude: 0 }, 0, 0)
      .distance).toBe(0);
  });

  it.each([[NaN, 72], [24, NaN], [Infinity, 72], [91, 72], [24, 181], [undefined, undefined]])(
    'rejects missing or invalid GPS: %s, %s', (latitude, longitude) => {
      expect(() => validateGeofencePosition(organization(), latitude as number, longitude as number)).toThrow('GPS');
    }
  );

  it('ignores malformed second coordinates rather than granting access there', () => {
    const org = organization(true, { secondary_location: { enabled: true, latitude: null, longitude: null } });
    expect(getGeofenceLocations(org)).toEqual([primary]);
    expect(() => validateGeofencePosition(org, secondary.latitude, secondary.longitude)).toThrow();
  });
});

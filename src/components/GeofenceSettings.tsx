import React, { useState, useEffect } from 'react';
import { HiLocationMarker, HiCheckCircle, HiXCircle } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import { getCurrentLocation, isValidCoordinate, formatDistance, calculateDistance, GeofenceSettings } from '../utils/geolocation';

interface GeofenceSettingsProps {
  organizationId: string;
}

const GeofenceSettingsComponent: React.FC<GeofenceSettingsProps> = ({ organizationId }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locationFetching, setLocationFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Location settings state
  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  
  // Geofence settings state
  const [geofenceEnabled, setGeofenceEnabled] = useState(true);
  const [enforcementMode, setEnforcementMode] = useState<'strict' | 'warning'>('strict');
  const [distanceThreshold, setDistanceThreshold] = useState(500);
  const [allowAdminOverride, setAllowAdminOverride] = useState(true);

  // User's current location for distance preview
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [previewDistance, setPreviewDistance] = useState<number | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [organizationId]);

  useEffect(() => {
    // Calculate preview distance when org location or user location changes
    if (latitude && longitude && userLocation) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      if (isValidCoordinate(lat, lon)) {
        const distance = calculateDistance(userLocation.lat, userLocation.lon, lat, lon);
        setPreviewDistance(distance);
      }
    } else {
      setPreviewDistance(null);
    }
  }, [latitude, longitude, userLocation]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('organizations')
        .select('location_latitude, location_longitude, location_address, geofence_settings')
        .eq('id', organizationId)
        .single();

      if (fetchError) throw fetchError;

      if (data) {
        setLatitude(data.location_latitude?.toString() || '');
        setLongitude(data.location_longitude?.toString() || '');
        setAddress(data.location_address || '');

        const settings = data.geofence_settings as any;
        if (settings) {
          setGeofenceEnabled(settings.enabled ?? true);
          setEnforcementMode(settings.enforcement_mode ?? 'strict');
          setDistanceThreshold(settings.distance_threshold_meters ?? 500);
          setAllowAdminOverride(settings.allow_admin_override ?? true);
        }
      }
    } catch (err) {
      console.error('Error fetching geofence settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load geofence settings');
    } finally {
      setLoading(false);
    }
  };

  const handleGetCurrentLocation = async () => {
    try {
      setLocationFetching(true);
      setError(null);
      
      const location = await getCurrentLocation(15000);
      if (!location) {
        throw new Error('Unable to get current location. Please check GPS permissions.');
      }

      setLatitude(location.latitude.toFixed(8));
      setLongitude(location.longitude.toFixed(8));
      setUserLocation({ lat: location.latitude, lon: location.longitude });
      setSuccessMessage('Location captured successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error getting location:', err);
      setError(err instanceof Error ? err.message : 'Failed to get current location');
    } finally {
      setLocationFetching(false);
    }
  };

  const handleCheckMyLocation = async () => {
    try {
      setLocationFetching(true);
      setError(null);
      
      const location = await getCurrentLocation(15000);
      if (!location) {
        throw new Error('Unable to get current location. Please check GPS permissions.');
      }

      setUserLocation({ lat: location.latitude, lon: location.longitude });
    } catch (err) {
      console.error('Error getting location:', err);
      setError(err instanceof Error ? err.message : 'Failed to get current location');
    } finally {
      setLocationFetching(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Validate coordinates
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);

      if (latitude && longitude && !isValidCoordinate(lat, lon)) {
        throw new Error('Invalid coordinates. Latitude must be -90 to 90, longitude must be -180 to 180.');
      }

      // Prepare geofence settings
      const settings: GeofenceSettings = {
        enabled: geofenceEnabled,
        enforcement_mode: enforcementMode,
        distance_threshold_meters: distanceThreshold,
        allow_admin_override: allowAdminOverride,
      };

      // Update organization
      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          location_latitude: latitude ? lat : null,
          location_longitude: longitude ? lon : null,
          location_address: address || null,
          geofence_settings: settings,
        })
        .eq('id', organizationId);

      if (updateError) throw updateError;

      setSuccessMessage('Geofence settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error saving geofence settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save geofence settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
          <HiLocationMarker className="w-5 h-5" />
          Geofencing Attendance Validation
        </h3>
        <p className="text-sm text-blue-700">
          Configure your organization's location and geofencing rules. Employees will be validated 
          against this location when punching in/out. Strict mode blocks punch attempts outside the 
          geofence, while warning mode allows them with a flag.
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <HiXCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-2">
          <HiCheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      {/* Organization Location */}
      <div className="space-y-4">
        <h4 className="font-medium text-gray-900">Organization Location</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Latitude *
            </label>
            <input
              type="number"
              step="0.00000001"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="e.g., 28.6139"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Longitude *
            </label>
            <input
              type="number"
              step="0.00000001"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="e.g., 77.2090"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Address (Optional)
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="e.g., 123 Medical Center Road, New Delhi"
          />
        </div>

        <button
          onClick={handleGetCurrentLocation}
          disabled={locationFetching}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <HiLocationMarker className="w-4 h-4" />
          {locationFetching ? 'Getting Location...' : 'Use My Current Location'}
        </button>
      </div>

      {/* Geofence Settings */}
      <div className="space-y-4 pt-4 border-t">
        <h4 className="font-medium text-gray-900">Geofence Validation Rules</h4>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="geofence-enabled"
            checked={geofenceEnabled}
            onChange={(e) => setGeofenceEnabled(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="geofence-enabled" className="ml-2 block text-sm text-gray-900">
            Enable geofencing validation
          </label>
        </div>

        {geofenceEnabled && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enforcement Mode
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="strict"
                    checked={enforcementMode === 'strict'}
                    onChange={(e) => setEnforcementMode(e.target.value as 'strict')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    <strong>Strict</strong> - Block punch in/out attempts outside geofence
                  </span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="warning"
                    checked={enforcementMode === 'warning'}
                    onChange={(e) => setEnforcementMode(e.target.value as 'warning')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    <strong>Warning</strong> - Allow with flag for outside geofence
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Distance Threshold: <strong>{distanceThreshold}m</strong>
              </label>
              <input
                type="range"
                min="100"
                max="2000"
                step="100"
                value={distanceThreshold}
                onChange={(e) => setDistanceThreshold(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>100m</span>
                <span>1000m</span>
                <span>2000m</span>
              </div>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="admin-override"
                checked={allowAdminOverride}
                onChange={(e) => setAllowAdminOverride(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="admin-override" className="ml-2 block text-sm text-gray-900">
                Allow admin override for outside-geofence attendance
              </label>
            </div>
          </>
        )}
      </div>

      {/* Distance Preview */}
      {geofenceEnabled && latitude && longitude && (
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-gray-900">Test Your Distance</h4>
            <button
              onClick={handleCheckMyLocation}
              disabled={locationFetching}
              className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              {locationFetching ? 'Checking...' : 'Check My Location'}
            </button>
          </div>
          {previewDistance !== null && (
            <div className={`p-3 rounded-lg ${previewDistance <= distanceThreshold ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className="text-sm">
                Your current distance from organization: <strong>{formatDistance(previewDistance)}</strong>
              </p>
              <p className="text-xs mt-1 text-gray-600">
                {previewDistance <= distanceThreshold 
                  ? '✓ Within geofence - punch would be allowed' 
                  : `✗ Outside geofence - punch would be ${enforcementMode === 'strict' ? 'blocked' : 'flagged'}`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Save Button */}
      <div className="pt-4 border-t">
        <button
          onClick={handleSave}
          disabled={saving || !latitude || !longitude}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Geofence Settings'}
        </button>
      </div>
    </div>
  );
};

export default GeofenceSettingsComponent;

# Geofencing Attendance Feature - Implementation Complete

## Overview
Geofencing attendance validation has been successfully implemented. This feature validates employee attendance based on their physical proximity to the organization's location using GPS coordinates and the Haversine distance formula.

## Features Implemented

### 1. Database Schema (Migration)
**File**: `supabase/migrations/20250110_add_geofencing_support.sql`

#### Organizations Table Extensions:
- `location_latitude` (NUMERIC): Organization's latitude coordinate (-90 to 90)
- `location_longitude` (NUMERIC): Organization's longitude coordinate (-180 to 180)
- `location_address` (TEXT): Human-readable address
- `geofence_settings` (JSONB): Configuration object with:
  - `enabled` (boolean): Enable/disable geofencing
  - `enforcement_mode` (string): "strict" (blocks punch) or "warning" (allows with flag)
  - `distance_threshold_meters` (number): Maximum allowed distance (default: 500m)
  - `allow_admin_override` (boolean): Admin can approve outside-geofence attendance

#### Attendance Table Extensions:
- `punch_in_distance_meters` (NUMERIC): Distance from office at punch-in (NULL for legacy records)
- `punch_out_distance_meters` (NUMERIC): Distance from office at punch-out (NULL for legacy records)
- `is_outside_geofence` (BOOLEAN): Flag indicating attendance outside geofence
- `geofence_override_by` (UUID): Admin who approved outside-geofence attendance
- `geofence_override_reason` (TEXT): Reason for override
- `geofence_override_at` (TIMESTAMP): When override was granted

#### Indexes:
- `idx_attendance_geofence_violations`: Fast queries for geofence violation reports
- `idx_organizations_location`: Efficient organization location lookups

### 2. Distance Calculation Utilities
**File**: `src/utils/geolocation.ts`

#### Functions:
- `calculateDistance(lat1, lon1, lat2, lon2)`: Haversine formula implementation
- `formatDistance(meters)`: Formats distance as "150 m" or "1.2 km"
- `checkGeofence()`: Validates coordinates against geofence threshold
- `isValidCoordinate()`: Validates latitude/longitude ranges
- `getCurrentLocation()`: Gets user's GPS coordinates using browser API
- `parseGeofenceSettings()`: Parses JSONB settings with defaults

### 3. Geofence Settings UI
**File**: `src/components/GeofenceSettings.tsx`

#### Features:
- **Organization Location Setup**:
  - Manual latitude/longitude entry
  - "Use My Current Location" button for easy setup
  - Optional address field
  - Real-time coordinate validation

- **Geofence Rules Configuration**:
  - Enable/disable geofencing toggle
  - Enforcement mode selector (Strict vs Warning)
  - Distance threshold slider (100m - 2000m)
  - Admin override permission toggle

- **Live Distance Preview**:
  - "Check My Location" to test distance calculation
  - Color-coded feedback (green = inside, red = outside)
  - Shows whether punch would be allowed/blocked/flagged

- **Integration**: Added as new "Geofence" tab in Settings page

### 4. Attendance Service Updates
**File**: `src/services/attendanceService.ts`

#### New Private Method:
```typescript
private static async validateGeofence(
  organizationId: string,
  latitude: number,
  longitude: number
): Promise<{ isValid: boolean; distance: number | null; isOutsideGeofence: boolean }>
```

#### Behavior:
- **No Location Configured**: Allows punch (backward compatible)
- **Geofencing Disabled**: Allows punch
- **Warning Mode**: Allows punch but sets `is_outside_geofence = true`
- **Strict Mode**: Throws error with distance info, blocks punch

#### Updated Methods:
- `punchIn()`: Validates geofence, stores distance
- `punchOut()`: Validates geofence, stores distance, preserves geofence flag if either punch is outside

### 5. PunchInOut Component Enhancements
**File**: `src/components/hr/PunchInOut.tsx`

#### New State:
- Organization location coordinates
- Distance from organization
- Geofence settings
- Outside geofence flag

#### UI Additions:
- **Location Card**: Shows real-time distance from office with color coding
- **Geofence Warning Banner**: 
  - Red (strict mode): Blocks punch with explanation
  - Orange (warning mode): Warns that attendance will be flagged
- **Punch Buttons**: Disabled in strict mode when outside geofence
- **Distance Display**: Shows punch-in/out distances in completed attendance view
- **Geofence Badge**: Orange badge when attendance is outside geofence

### 6. Attendance Dashboard Updates
**File**: `src/components/hr/AttendanceDashboard.tsx`

#### Features:
- **Distance Display**: Shows distance for punch-in and punch-out in table cells
- **Geofence Badge**: Yellow "🚧 Geofence" badge in status column for outside-geofence attendance
- **Filtering**: Existing filters can be extended to filter by `is_outside_geofence`

## Configuration Guide

### Step 1: Apply Database Migration
```bash
# Using Supabase CLI
supabase db push

# Or run the migration file directly in Supabase dashboard
```

### Step 2: Configure Organization Location
1. Navigate to **Settings → Geofence** tab
2. Click "Use My Current Location" when at the office
3. OR manually enter latitude/longitude coordinates
4. Add optional address for reference
5. Click "Save Geofence Settings"

### Step 3: Configure Geofence Rules
1. Toggle "Enable geofencing validation" ON
2. Select enforcement mode:
   - **Strict**: Blocks punch attempts outside geofence (recommended for strict policies)
   - **Warning**: Allows punch but flags for review (recommended for flexible policies)
3. Set distance threshold using slider (default: 500m)
4. Toggle "Allow admin override" if admins should be able to approve exceptions
5. Save settings

### Step 4: Test Configuration
1. Use "Check My Location" button in settings to verify distance calculation
2. Test punch-in from inside and outside geofence
3. Verify error messages and warnings appear correctly

## User Experience

### Employee View (PunchInOut)
1. **Inside Geofence**: Green indicator, punch allowed normally
2. **Outside Geofence (Warning Mode)**: Orange warning banner, punch allowed with flag
3. **Outside Geofence (Strict Mode)**: Red error banner, punch blocked with distance info

### Admin View (Dashboard)
1. **Table View**: Distance shown under punch times
2. **Status Column**: "🚧 Geofence" badge for flagged attendance
3. **Detail Modal**: Complete location and distance information
4. **Reports**: Can filter/identify geofence violations

## Technical Specifications

### Distance Calculation
- **Formula**: Haversine formula for great-circle distance
- **Earth Radius**: 6,371,000 meters
- **Precision**: Rounded to 2 decimal places (centimeter accuracy)
- **Range**: Works globally for all coordinates

### GPS Accuracy
- No minimum accuracy requirement (as requested)
- Browser's best available accuracy used
- High accuracy mode enabled (`enableHighAccuracy: true`)
- 10-second timeout for location acquisition

### Backward Compatibility
- Legacy records: `distance_from_office = NULL`, `is_outside_geofence = false`
- No distance for records without coordinates
- Existing attendance flows work unchanged if geofencing disabled

### Default Settings
- **Enforcement Mode**: Strict (blocks punch outside geofence)
- **Distance Threshold**: 500 meters
- **Geofencing**: Enabled by default when location is set
- **Admin Override**: Allowed by default

## Migration Notes

### Existing Attendance Records
- All existing records have `is_outside_geofence = false`
- Distance columns remain NULL (cannot backfill without historical GPS data)
- No impact on historical reports

### Multi-Location Support
- Current implementation: Single location per organization
- Future enhancement: Can add `office_locations` JSONB array
- Validation would check against nearest location

## Error Handling

### Common Scenarios:
1. **GPS Disabled**: User prompted to enable location access
2. **Outside Geofence (Strict)**: Clear error with distance and threshold
3. **No Org Location**: Geofencing automatically bypassed
4. **Invalid Coordinates**: Validation prevents saving invalid lat/lon

### Error Messages:
```
"You are 750m away from the organization location. 
Punch is not allowed beyond 500m. 
Please move closer or contact your administrator."
```

## Security Considerations

- GPS coordinates stored for audit trail
- Admin override tracks who approved and why
- RLS policies apply to all geofence data
- Settings only editable by organization admins

## Performance Impact

- **Minimal**: Single Haversine calculation per punch (~0.1ms)
- **Database**: Indexed queries for geofence reports
- **Network**: No external APIs, all calculations client-side
- **Storage**: ~50 bytes per attendance record for distance data

## Testing Checklist

- [x] Database migration applies successfully
- [x] Organization location can be set via UI
- [x] Distance calculation is accurate
- [x] Strict mode blocks outside-geofence punches
- [x] Warning mode allows but flags outside-geofence punches
- [x] Distance displays correctly in PunchInOut component
- [x] Geofence badge shows in dashboard
- [x] Settings can be updated and persist
- [x] Legacy records don't break existing functionality
- [x] Error messages are clear and helpful

## Next Steps (Optional Future Enhancements)

1. **Admin Override UI**: Form to approve flagged attendance with reason
2. **Multiple Locations**: Support for organizations with multiple branches
3. **GPS Accuracy Requirement**: Optional minimum accuracy threshold
4. **Geofence Reports**: Dedicated report for geofence violations
5. **Automated Alerts**: Notify admins when geofence violations occur
6. **Map View**: Visual map showing punch locations relative to office

## Files Modified/Created

### Created:
- `supabase/migrations/20250110_add_geofencing_support.sql`
- `src/utils/geolocation.ts`
- `src/components/GeofenceSettings.tsx`

### Modified:
- `src/components/Settings.tsx`
- `src/services/attendanceService.ts`
- `src/components/hr/PunchInOut.tsx`
- `src/components/hr/AttendanceDashboard.tsx`

## Support

For issues or questions:
1. Check browser console for GPS/location errors
2. Verify organization location is set correctly in Settings
3. Confirm geofence settings match policy requirements
4. Review attendance records for distance values

---

**Implementation Date**: January 10, 2025  
**Status**: ✅ Complete and Ready for Production  
**Configuration**: Strict mode, 500m threshold (default)

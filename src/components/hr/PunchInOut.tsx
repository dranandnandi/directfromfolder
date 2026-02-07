import React, { useState, useEffect, useRef } from 'react';
import { HiClock, HiLocationMarker, HiCamera, HiCheck, HiX, HiExclamationCircle } from 'react-icons/hi';
import { AttendanceService } from '../../services/attendanceService';
import { Attendance, DailyAttendanceStatus } from '../../models/attendance';
import { supabase } from '../../utils/supabaseClient';
import { calculateDistance, formatDistance, parseGeofenceSettings } from '../../utils/geolocation';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

const CameraModal: React.FC<CameraModalProps> = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => stopCamera();
  }, [isOpen]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Could not access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsCapturing(true);
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
          onCapture(file);
          onClose();
        }
        setIsCapturing(false);
      }, 'image/jpeg', 0.8);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-4 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Take Selfie</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <HiX className="w-6 h-6" />
          </button>
        </div>
        
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-64 bg-gray-200 rounded-lg object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
        </div>
        
        <div className="flex justify-center gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
          >
            <HiX className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={capturePhoto}
            disabled={isCapturing || !stream}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <HiCamera className="w-5 h-5" />
            {isCapturing ? 'Capturing...' : 'Take Photo'}
          </button>
        </div>
      </div>
    </div>
  );
};

const PunchInOut: React.FC = () => {
  const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [punchType, setPunchType] = useState<'in' | 'out'>('in');
  const [userId, setUserId] = useState<string>('');
  
  // Geofence state
  const [orgLocation, setOrgLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [distanceFromOrg, setDistanceFromOrg] = useState<number | null>(null);
  const [geofenceSettings, setGeofenceSettings] = useState<any>(null);
  const [isOutsideGeofence, setIsOutsideGeofence] = useState(false);

  useEffect(() => {
    initializeComponent();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const initializeComponent = async () => {
    try {
      // Get current user
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) return;

      const { data: userData } = await supabase
        .from('users')
        .select('id, organization_id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!userData) return;
      setUserId(userData.id);

      // Fetch organization geofence settings
      const { data: orgData } = await supabase
        .from('organizations')
        .select('location_latitude, location_longitude, geofence_settings')
        .eq('id', userData.organization_id)
        .single();

      if (orgData?.location_latitude && orgData?.location_longitude) {
        setOrgLocation({
          latitude: orgData.location_latitude,
          longitude: orgData.location_longitude,
        });
        setGeofenceSettings(parseGeofenceSettings(orgData.geofence_settings));
      }

      // Use the enhanced function to get attendance with shift details
      const { data: attendanceData } = await supabase
        .rpc('get_attendance_with_details', {
          p_organization_id: userData.organization_id,
          p_date: new Date().toISOString().split('T')[0],
          p_user_id: userData.id
        });

      if (attendanceData && attendanceData.length > 0) {
        const todayRecord = attendanceData[0];
        // Transform to match Attendance model
        const attendance: any = {
          id: todayRecord.id,
          user_id: todayRecord.user_id,
          date: todayRecord.date,
          punch_in_time: todayRecord.punch_in_time,
          punch_out_time: todayRecord.punch_out_time,
          total_hours: todayRecord.total_hours,
          is_late: todayRecord.is_late,
          is_early_out: todayRecord.is_early_out,
          punch_in_distance_meters: todayRecord.punch_in_distance_meters,
          punch_out_distance_meters: todayRecord.punch_out_distance_meters,
          is_outside_geofence: todayRecord.is_outside_geofence,
          shift: todayRecord.shift_name ? {
            id: '',
            name: todayRecord.shift_name,
            start_time: todayRecord.shift_start_time,
            end_time: todayRecord.shift_end_time,
            duration_hours: 8,
            organization_id: userData.organization_id,
            break_duration_minutes: 60,
            late_threshold_minutes: 15,
            early_out_threshold_minutes: 15,
            is_active: true,
            created_at: '',
            updated_at: ''
          } : undefined
        };
        setTodayAttendance(attendance);
      } else {
        // No attendance record found for today
        setTodayAttendance(null);
      }

      // Get current location
      await getCurrentLocation();
    } catch (error) {
      console.error('Error initializing:', error);
    }
  };

  const getCurrentLocation = async () => {
    try {
      const coords = await AttendanceService.getCurrentLocation();
      setLocation(coords);
      
      const addressText = await AttendanceService.getAddressFromCoordinates(
        coords.latitude,
        coords.longitude
      );
      setAddress(addressText);

      // Calculate distance from organization if org location is set
      if (orgLocation) {
        const distance = calculateDistance(
          coords.latitude,
          coords.longitude,
          orgLocation.latitude,
          orgLocation.longitude
        );
        setDistanceFromOrg(distance);

        // Check if outside geofence
        if (geofenceSettings?.enabled) {
          const isOutside = distance > geofenceSettings.distance_threshold_meters;
          setIsOutsideGeofence(isOutside);
        }
      }
    } catch (error) {
      console.error('Error getting location:', error);
      alert('Please enable location access to punch in/out.');
    }
  };

  const handlePunchIn = () => {
    if (!location) {
      alert('Please enable location access first.');
      return;
    }
    setPunchType('in');
    setShowCamera(true);
  };

  const handlePunchOut = () => {
    if (!location) {
      alert('Please enable location access first.');
      return;
    }
    setPunchType('out');
    setShowCamera(true);
  };

  const handleSelfieCapture = async (file: File) => {
    if (!location || !userId) return;

    setLoading(true);
    try {
      const punchData = {
        latitude: location.latitude,
        longitude: location.longitude,
        address: address,
        selfie_file: file,
        device_info: {
          user_agent: navigator.userAgent,
          platform: navigator.platform,
          timestamp: new Date().toISOString()
        }
      };

      let updatedAttendance: Attendance;
      if (punchType === 'in') {
        updatedAttendance = await AttendanceService.punchIn(userId, punchData);
      } else {
        updatedAttendance = await AttendanceService.punchOut(userId, punchData);
      }

      setTodayAttendance(updatedAttendance);
      alert(`Successfully punched ${punchType}!`);
      setShowCamera(false);
    } catch (error: any) {
      console.error('Error punching:', error);
      
      // Check if it's a storage-related error
      if (error.message?.includes('storage') || error.message?.includes('bucket')) {
        alert(`Punch ${punchType} failed due to photo storage issue. This is a system configuration problem. Please contact your administrator.`);
      } else {
        alert(`Failed to punch ${punchType}: ${error.message || error}. Please try again.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const getAttendanceStatus = (): DailyAttendanceStatus => {
    if (!todayAttendance) {
      return {
        date: new Date().toISOString().split('T')[0],
        status: 'not_punched',
        is_late: false,
        is_early_out: false
      };
    }

    if (todayAttendance.punch_in_time && todayAttendance.punch_out_time) {
      return {
        date: todayAttendance.date,
        status: 'punched_out',
        punch_in_time: todayAttendance.punch_in_time,
        punch_out_time: todayAttendance.punch_out_time,
        total_hours: todayAttendance.total_hours,
        is_late: todayAttendance.is_late,
        is_early_out: todayAttendance.is_early_out,
        shift: todayAttendance.shift
      };
    }

    if (todayAttendance.punch_in_time) {
      return {
        date: todayAttendance.date,
        status: 'punched_in',
        punch_in_time: todayAttendance.punch_in_time,
        is_late: todayAttendance.is_late,
        is_early_out: false,
        shift: todayAttendance.shift
      };
    }

    return {
      date: todayAttendance.date,
      status: 'not_punched',
      is_late: false,
      is_early_out: false
    };
  };

  const formatTime = (timeString: string) => {
    return new Date(timeString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const status = getAttendanceStatus();

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* Current Time Display */}
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <div className="text-4xl font-bold text-gray-900 mb-2">
          {currentTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })}
        </div>
        <div className="text-lg text-gray-600">
          {currentTime.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>

      {/* Location Status */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-3">
          <HiLocationMarker className={`w-5 h-5 ${location ? 'text-green-500' : 'text-red-500'}`} />
          <div className="flex-1">
            <div className="font-medium">
              {location ? 'Location Detected' : 'Location Required'}
            </div>
            <div className="text-sm text-gray-600">
              {address || 'Please enable location access'}
            </div>
            {location && distanceFromOrg !== null && (
              <div className="text-sm mt-1">
                Distance from office: <span className={`font-medium ${isOutsideGeofence ? 'text-orange-600' : 'text-green-600'}`}>
                  {formatDistance(distanceFromOrg)}
                </span>
              </div>
            )}
          </div>
          {!location && (
            <button
              onClick={getCurrentLocation}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Enable
            </button>
          )}
        </div>
        
        {/* Geofence Warning */}
        {geofenceSettings?.enabled && isOutsideGeofence && location && (
          <div className={`mt-3 p-3 rounded-lg border ${
            geofenceSettings.enforcement_mode === 'strict' 
              ? 'bg-red-50 border-red-200' 
              : 'bg-orange-50 border-orange-200'
          }`}>
            <div className="flex items-start gap-2">
              <HiExclamationCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                geofenceSettings.enforcement_mode === 'strict' 
                  ? 'text-red-600' 
                  : 'text-orange-600'
              }`} />
              <div className="flex-1">
                <div className={`text-sm font-medium ${
                  geofenceSettings.enforcement_mode === 'strict' 
                    ? 'text-red-900' 
                    : 'text-orange-900'
                }`}>
                  {geofenceSettings.enforcement_mode === 'strict' 
                    ? '⛔ Outside Geofence - Punch Blocked' 
                    : '⚠️ Outside Geofence - Will be Flagged'}
                </div>
                <div className={`text-xs mt-1 ${
                  geofenceSettings.enforcement_mode === 'strict' 
                    ? 'text-red-700' 
                    : 'text-orange-700'
                }`}>
                  You are {formatDistance(distanceFromOrg!)} from office. 
                  {geofenceSettings.enforcement_mode === 'strict' 
                    ? ` Maximum allowed: ${formatDistance(geofenceSettings.distance_threshold_meters)}. Please move closer or contact admin.`
                    : ` Attendance will be marked as outside geofence for review.`}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Attendance Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Today's Attendance</h3>
        
        {status.status === 'not_punched' && (
          <div className="text-center">
            <div className="text-gray-500 mb-4">You haven't punched in yet today</div>
            <button
              onClick={handlePunchIn}
              disabled={!location || loading || (geofenceSettings?.enabled && geofenceSettings?.enforcement_mode === 'strict' && isOutsideGeofence)}
              className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <HiCheck className="w-5 h-5" />
              {loading ? 'Punching In...' : 'Punch In'}
            </button>
            {geofenceSettings?.enabled && geofenceSettings?.enforcement_mode === 'strict' && isOutsideGeofence && (
              <p className="text-xs text-red-600 mt-2">
                Punch blocked due to geofence policy. Move closer to office or contact admin.
              </p>
            )}
          </div>
        )}

        {status.status === 'punched_in' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Punch In Time:</span>
              <span className="font-medium">{formatTime(status.punch_in_time!)}</span>
            </div>
            {todayAttendance?.punch_in_distance_meters && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Punch In Distance:</span>
                <span className="font-medium">{formatDistance(todayAttendance.punch_in_distance_meters)}</span>
              </div>
            )}
            {status.is_late && (
              <div className="text-red-600 text-sm">⚠️ Marked as late</div>
            )}
            {todayAttendance?.is_outside_geofence && (
              <div className="text-orange-600 text-sm flex items-center gap-1">
                <HiExclamationCircle className="w-4 h-4" />
                Outside geofence
              </div>
            )}
            <button
              onClick={handlePunchOut}
              disabled={!location || loading || (geofenceSettings?.enabled && geofenceSettings?.enforcement_mode === 'strict' && isOutsideGeofence)}
              className="w-full py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <HiX className="w-5 h-5" />
              {loading ? 'Punching Out...' : 'Punch Out'}
            </button>
            {geofenceSettings?.enabled && geofenceSettings?.enforcement_mode === 'strict' && isOutsideGeofence && (
              <p className="text-xs text-red-600 text-center">
                Punch out blocked due to geofence policy. Move closer to office or contact admin.
              </p>
            )}
          </div>
        )}

        {status.status === 'punched_out' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Punch In:</span>
              <span className="font-medium">{formatTime(status.punch_in_time!)}</span>
            </div>
            {todayAttendance?.punch_in_distance_meters && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Punch In Distance:</span>
                <span className="font-medium">{formatDistance(todayAttendance.punch_in_distance_meters)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Punch Out:</span>
              <span className="font-medium">{formatTime(status.punch_out_time!)}</span>
            </div>
            {todayAttendance?.punch_out_distance_meters && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Punch Out Distance:</span>
                <span className="font-medium">{formatDistance(todayAttendance.punch_out_distance_meters)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Total Hours:</span>
              <span className="font-medium">
                {(() => {
                  if (status.punch_in_time && status.punch_out_time) {
                    const punchIn = new Date(status.punch_in_time);
                    const punchOut = new Date(status.punch_out_time);
                    const diffMs = punchOut.getTime() - punchIn.getTime();
                    const hours = diffMs / (1000 * 60 * 60);
                    return `${hours.toFixed(2)}h`;
                  }
                  return '0.00h';
                })()}
              </span>
            </div>
            {todayAttendance?.is_outside_geofence && (
              <div className="text-orange-600 text-sm flex items-center justify-center gap-1 pt-2 border-t">
                <HiExclamationCircle className="w-4 h-4" />
                Marked as outside geofence
              </div>
            )}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-center gap-4">
                {(() => {
                  // Calculate actual late/early status based on shift times
                  if (!status.shift || !status.punch_in_time) {
                    return <span className="text-green-600 text-sm">✓ Present</span>;
                  }

                  const punchInTime = new Date(status.punch_in_time);
                  const punchInHour = punchInTime.getHours();
                  const punchInMinute = punchInTime.getMinutes();
                  
                  // Parse shift start time (format: "HH:MM:SS")
                  const [shiftStartHour, shiftStartMinute] = status.shift.start_time.split(':').map(Number);
                  const [shiftEndHour, shiftEndMinute] = status.shift.end_time.split(':').map(Number);
                  
                  // Convert to minutes for comparison
                  const punchInMinutes = punchInHour * 60 + punchInMinute;
                  const shiftStartMinutes = shiftStartHour * 60 + shiftStartMinute;
                  const shiftEndMinutes = shiftEndHour * 60 + shiftEndMinute;
                  
                  // Check if late (more than 15 minutes after shift start)
                  const isActuallyLate = punchInMinutes > (shiftStartMinutes + 15);
                  
                  // Check if early out (more than 15 minutes before shift end)
                  let isActuallyEarlyOut = false;
                  if (status.punch_out_time) {
                    const punchOutTime = new Date(status.punch_out_time);
                    const punchOutMinutes = punchOutTime.getHours() * 60 + punchOutTime.getMinutes();
                    isActuallyEarlyOut = punchOutMinutes < (shiftEndMinutes - 15);
                  }

                  // Display status based on calculations
                  const statuses = [];
                  
                  // Always show Present first if punched in
                  statuses.push(<span key="present" className="text-green-600 text-sm">✓ Present</span>);
                  
                  if (isActuallyLate) {
                    statuses.push(<span key="late" className="text-red-600 text-sm">⚠️ Late</span>);
                  }
                  if (isActuallyEarlyOut) {
                    statuses.push(<span key="early" className="text-yellow-600 text-sm">⚠️ Early Out</span>);
                  }
                  
                  return statuses;
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Shift Information */}
      {status.shift && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-3">
            <HiClock className="w-5 h-5 text-blue-500" />
            <div>
              <div className="font-medium">{status.shift.name}</div>
              <div className="text-sm text-gray-600">
                {status.shift.start_time} - {status.shift.end_time} ({status.shift.duration_hours}h)
              </div>
            </div>
          </div>
        </div>
      )}

      <CameraModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onCapture={handleSelfieCapture}
      />
    </div>
  );
};

export default PunchInOut;

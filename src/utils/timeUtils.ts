/**
 * Utility functions for handling date and time conversions
 */

/**
 * Combines a date string (YYYY-MM-DD) and time string (HH:MM) into an ISO 8601 string
 * Preserves local timezone to avoid date/time shifting
 */
export function combineDateAndTime(dateString: string, timeString: string): string {
  if (!dateString || !timeString) {
    return '';
  }
  
  // Parse date and time components
  const [year, month, day] = dateString.split('-').map(Number);
  const [hours, minutes] = timeString.split(':').map(Number);
  
  // Create Date object in local timezone
  const combinedDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
  
  // Return as ISO string
  return combinedDateTime.toISOString();
}

/**
 * Extracts the date portion (YYYY-MM-DD) from an ISO 8601 string or Date object
 * Returns date in local timezone
 */
export function extractDateFromISOString(isoString: string): string {
  if (!isoString) {
    return '';
  }
  
  try {
    const date = new Date(isoString);
    // Use local date components to avoid timezone shifts
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('Error extracting date from ISO string:', error);
    return '';
  }
}

/**
 * Extracts the time portion (HH:MM) from an ISO 8601 string or Date object
 * Returns time in local timezone
 */
export function extractTimeFromISOString(isoString: string): string {
  if (!isoString) {
    return '';
  }
  
  try {
    const date = new Date(isoString);
    // Use local time components to avoid timezone shifts
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch (error) {
    console.error('Error extracting time from ISO string:', error);
    return '';
  }
}

/**
 * Generates time slots in 15-minute intervals for a full day
 */
export function generateTimeSlots(): { value: string; label: string }[] {
  const slots = [];
  
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const timeValue = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const period = hour < 12 ? 'AM' : 'PM';
      const timeLabel = `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
      
      slots.push({
        value: timeValue,
        label: timeLabel
      });
    }
  }
  
  return slots;
}

/**
 * Formats a time string (HH:MM) to a more readable format (H:MM AM/PM)
 */
export function formatTimeForDisplay(timeString: string): string {
  if (!timeString) {
    return '';
  }
  
  try {
    const [hours, minutes] = timeString.split(':').map(Number);
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const period = hours < 12 ? 'AM' : 'PM';
    
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
  } catch (error) {
    console.error('Error formatting time for display:', error);
    return timeString;
  }
}
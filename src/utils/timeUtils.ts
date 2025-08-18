/**
 * Utility functions for handling date and time conversions
 */

/**
 * Combines a date string (YYYY-MM-DD) and time string (HH:MM) into an ISO 8601 string
 */
export function combineDateAndTime(dateString: string, timeString: string): string {
  if (!dateString || !timeString) {
    return '';
  }
  
  // Create a new Date object from the date string and time string
  const combinedDateTime = new Date(`${dateString}T${timeString}:00`);
  
  // Return as ISO string
  return combinedDateTime.toISOString();
}

/**
 * Extracts the date portion (YYYY-MM-DD) from an ISO 8601 string
 */
export function extractDateFromISOString(isoString: string): string {
  if (!isoString) {
    return '';
  }
  
  try {
    const date = new Date(isoString);
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error extracting date from ISO string:', error);
    return '';
  }
}

/**
 * Extracts the time portion (HH:MM) from an ISO 8601 string
 */
export function extractTimeFromISOString(isoString: string): string {
  if (!isoString) {
    return '';
  }
  
  try {
    const date = new Date(isoString);
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
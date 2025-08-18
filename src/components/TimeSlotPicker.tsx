import React from 'react';
import { generateTimeSlots } from '../utils/timeUtils';

interface TimeSlotPickerProps {
  value: string;
  onChange: (time: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

const TimeSlotPicker: React.FC<TimeSlotPickerProps> = ({
  value,
  onChange,
  className = '',
  placeholder = 'Select time',
  disabled = false,
  required = false
}) => {
  const timeSlots = generateTimeSlots();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 ${className}`}
      disabled={disabled}
      required={required}
    >
      <option value="">{placeholder}</option>
      {timeSlots.map((slot) => (
        <option key={slot.value} value={slot.value}>
          {slot.label}
        </option>
      ))}
    </select>
  );
};

export default TimeSlotPicker;
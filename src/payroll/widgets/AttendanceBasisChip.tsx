import React from 'react';

interface AttendanceBasisChipProps {
  basis: string;
  value: number;
}

const AttendanceBasisChip: React.FC<AttendanceBasisChipProps> = ({
  basis,
  value
}) => {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
      {basis}: {value}
    </span>
  );
};

export default AttendanceBasisChip;
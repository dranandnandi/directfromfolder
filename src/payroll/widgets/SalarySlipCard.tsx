import React from 'react';

interface SalarySlipCardProps {
  snapshot: any;
  net: number;
}

const SalarySlipCard: React.FC<SalarySlipCardProps> = ({
  net
}) => {
  return (
    <div className="border rounded p-3 bg-gray-50">
      <div className="text-sm">
        <div>Net Pay: ₹{net.toLocaleString('en-IN')}</div>
        {/* Add more snapshot details as needed */}
      </div>
    </div>
  );
};

export default SalarySlipCard;
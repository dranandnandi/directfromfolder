import React from 'react';

interface BankAdviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
}

const BankAdviceModal: React.FC<BankAdviceModalProps> = ({
  isOpen,
  onClose,
  data
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-96 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Bank Advice</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
        <div className="space-y-2">
          {data.map((item, index) => (
            <div key={index} className="border rounded p-3">
              <div className="text-sm">
                Employee: {item.employeeName} | Amount: ₹{item.amount}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BankAdviceModal;
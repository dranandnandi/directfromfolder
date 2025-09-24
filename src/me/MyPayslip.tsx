import React, { useState, useEffect } from 'react';
import { FaDownload } from 'react-icons/fa';
import { PayrollRun } from '../payroll/types';
import { callEdge } from '../lib/edgeClient';

const MyPayslip: React.FC = () => {
  const [payslips, setPayslips] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPayslips();
  }, []);

  const loadPayslips = async () => {
    try {
      const data = await callEdge<PayrollRun[]>('get-my-payslips', {});
      setPayslips(data);
    } catch (error) {
      console.error('Failed to load payslips:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (payslip: PayrollRun) => {
    try {
      const pdfData = await callEdge<Blob>('generate-payslip-pdf', { payslipId: payslip.id });
      const url = URL.createObjectURL(pdfData);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip_${payslip.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download payslip:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Payslips</h1>

      {payslips.length === 0 ? (
        <div className="text-center py-12">
          <FaDownload className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No payslips available</h3>
          <p className="mt-1 text-sm text-gray-500">Your payslips will appear here once processed.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {payslips.map((payslip) => (
            <div key={payslip.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Payslip {payslip.id}</h3>
                  <p className="text-sm text-gray-600">Net Pay: ₹{payslip.net_pay.toLocaleString('en-IN')}</p>
                  <p className="text-sm text-gray-600">Gross Earnings: ₹{payslip.gross_earnings.toLocaleString('en-IN')}</p>
                </div>
                <button
                  onClick={() => handleDownload(payslip)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <FaDownload className="w-4 h-4 mr-2" />
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyPayslip;
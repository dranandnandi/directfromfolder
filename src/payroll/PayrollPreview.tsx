import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useOrganization } from '../contexts/OrganizationContext';
import { PageHeader, AsyncSection, EmptyState } from './widgets/Primitives';
import { Calculator, Eye, TrendingUp, Wallet, Users, Calendar, Edit3 } from 'lucide-react';

// Types for database records
type Employee = {
  id: string;
  name: string | null;
  email: string | null;
  department: string | null;
  role: string | null;
};

type CompensationRow = {
  id: string;
  user_id: string;
  effective_from: string;
  effective_to: string | null;
  ctc_annual: number;
  pay_schedule: string;
  currency: string;
  compensation_payload: {
    components: { component_code: string; amount: number }[];
    notes?: string;
  };
  created_at: string;
  employee_name?: string | null;
};

type PayComponent = {
  id: string;
  code: string;
  name: string;
  type: 'earning' | 'deduction' | 'employer_cost';
  active: boolean;
};

type CompensationWithEmployee = CompensationRow & {
  employee: Employee;
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
};

// Unused components removed to fix build errors

const StatCard: React.FC<{ 
  icon: React.ElementType; 
  title: string; 
  value: string; 
  subtitle?: string;
  color?: string;
}> = ({ icon: Icon, title, value, subtitle, color = "bg-blue-500" }) => (
  <div className="bg-white rounded-lg border shadow-sm p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-full ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
    </div>
  </div>
);

const CompensationCard: React.FC<{ 
  compensation: CompensationWithEmployee;
  payComponents: PayComponent[];
}> = ({ compensation, payComponents }) => {
  // const monthlyCtc = compensation.ctc_annual / 12; // Unused for now
  const components = compensation.compensation_payload.components || [];
  
  // Map component codes to names with fallback mapping
  const getComponentName = (code: string) => {
    // First try to find in payComponents
    const component = payComponents.find(c => c.code.toLowerCase() === code.toLowerCase());
    if (component) return component.name;
    
    // Fallback mapping for common component codes
    const fallbackMapping: Record<string, string> = {
      'basic': 'Basic Salary',
      'BASIC': 'Basic Salary',
      'hra': 'House Rent Allowance',
      'HRA': 'House Rent Allowance',
      'CONV': 'Conveyance Allowance',
      'conv': 'Conveyance Allowance',
      'special': 'Special Allowance',
      'SPECIAL': 'Special Allowance',
      'MED': 'Medical Allowance',
      'med': 'Medical Allowance',
      'PF_EE': 'Provident Fund (Employee)',
      'pf_ee': 'Provident Fund (Employee)',
      'PF': 'Provident Fund',
      'pf': 'Provident Fund',
      'esic_employee': 'ESIC (Employee)',
      'ESIC_EMPLOYEE': 'ESIC (Employee)',
      'ESI': 'Employee State Insurance',
      'esi': 'Employee State Insurance',
      'pt': 'Professional Tax',
      'PT': 'Professional Tax',
      'tds': 'Tax Deducted at Source',
      'TDS': 'Tax Deducted at Source'
    };
    
    return fallbackMapping[code] || code;
  };

  const earnings = components.filter(c => c.amount > 0);
  const deductions = components.filter(c => c.amount < 0);
  
  const grossMonthly = earnings.reduce((sum, c) => sum + c.amount, 0) / 12;
  const deductionsMonthly = Math.abs(deductions.reduce((sum, c) => sum + c.amount, 0)) / 12;
  const netMonthly = grossMonthly - deductionsMonthly;

  return (
    <div className="bg-white rounded-lg border shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {compensation.employee?.name || `User ID: ${compensation.user_id.slice(-8)}`}
          </h3>
          <p className="text-sm text-gray-600">
            {compensation.employee?.name 
              ? 'Employee compensation structure'
              : 'Employee name not found in system'
            }
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Effective: {new Date(compensation.effective_from).toLocaleDateString()} 
            {compensation.effective_to ? ` - ${new Date(compensation.effective_to).toLocaleDateString()}` : ' (Active)'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-600">{formatCurrency(netMonthly)}</p>
          <p className="text-sm text-gray-500">Monthly Net</p>
          <p className="text-xs text-gray-400">{formatCurrency(compensation.ctc_annual)} CTC/Year</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Earnings */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
            <TrendingUp className="w-4 h-4 text-green-600" />
            Earnings
          </h4>
          <div className="space-y-1">
            {earnings.length > 0 ? earnings.map((comp, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-gray-600">{getComponentName(comp.component_code)}</span>
                <span className="font-medium text-green-600">{formatCurrency(comp.amount / 12)}</span>
              </div>
            )) : (
              <p className="text-xs text-gray-400">No earnings components</p>
            )}
          </div>
        </div>

        {/* Deductions */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
            <Calculator className="w-4 h-4 text-red-600" />
            Deductions
          </h4>
          <div className="space-y-1">
            {deductions.length > 0 ? deductions.map((comp, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-gray-600">{getComponentName(comp.component_code)}</span>
                <span className="font-medium text-red-600">{formatCurrency(Math.abs(comp.amount) / 12)}</span>
              </div>
            )) : (
              <p className="text-xs text-gray-400">No deductions</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500">Gross</p>
            <p className="font-semibold text-gray-900">{formatCurrency(grossMonthly)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Deductions</p>
            <p className="font-semibold text-red-600">{formatCurrency(deductionsMonthly)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Net Pay</p>
            <p className="font-semibold text-green-600">{formatCurrency(netMonthly)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function PayrollPreview() {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compensations, setCompensations] = useState<CompensationWithEmployee[]>([]);
  const [payComponents, setPayComponents] = useState<PayComponent[]>([]);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    avgCtc: 0,
    totalPayroll: 0,
    activeCompensations: 0
  });

  useEffect(() => {
    if (organizationId) {
      loadPayrollData();
    }
  }, [organizationId]);

  const loadPayrollData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load pay components first
      const { data: components, error: compError } = await supabase
        .from('pay_components')
        .select('*')
        .eq('active', true)
        .order('sort_order');

      if (compError) throw compError;
      setPayComponents(components || []);
      
      console.log('Pay components loaded:', components);

      // Load employee compensations with employee data (organization-specific)
      const { data: compensationData, error: compensationError } = await supabase
        .from('employee_compensation')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(20); // Limit to recent 20 compensations for preview

      if (compensationError) throw compensationError;
      
      console.log('Raw compensation data:', compensationData);

      // Transform data using the employee_name field from the table
      const transformedData: CompensationWithEmployee[] = (compensationData || []).map(comp => ({
        ...comp,
        employee: {
          id: comp.user_id,
          name: comp.employee_name || null,
          email: null, // Not available in compensation table
          department: null, // Not available in compensation table  
          role: null // Not available in compensation table
        }
      }));

      setCompensations(transformedData);

      // Calculate statistics
      const totalEmployees = new Set(transformedData.map(c => c.user_id)).size;
      const totalCtc = transformedData.reduce((sum, c) => sum + c.ctc_annual, 0);
      const avgCtc = totalEmployees > 0 ? totalCtc / totalEmployees : 0;
      
      // Count active compensations (no end date or future end date)
      const now = new Date().toISOString().split('T')[0];
      const activeCompensations = transformedData.filter(c => 
        !c.effective_to || c.effective_to >= now
      ).length;

      setStats({
        totalEmployees,
        avgCtc,
        totalPayroll: totalCtc,
        activeCompensations
      });

    } catch (err: any) {
      setError(err.message || 'Failed to load payroll data');
      console.error('Payroll data loading error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <PageHeader 
          title="Payroll Preview" 
          subtitle="Live view of your organization's compensation data and payroll metrics" 
        />

        <AsyncSection loading={loading} error={error}>
          {compensations.length === 0 ? (
            <EmptyState 
              title="No compensation data" 
              description="No employee compensations found. Set up compensation structures in the Compensation Editor." 
            />
          ) : (
            <>
              {/* Statistics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard
                  icon={Users}
                  title="Total Employees"
                  value={stats.totalEmployees.toString()}
                  subtitle="With compensation"
                  color="bg-blue-500"
                />
                <StatCard
                  icon={Wallet}
                  title="Average CTC"
                  value={formatCurrency(stats.avgCtc)}
                  subtitle="Per employee annually"
                  color="bg-green-500"
                />
                <StatCard
                  icon={TrendingUp}
                  title="Total Payroll"
                  value={formatCurrency(stats.totalPayroll)}
                  subtitle="Annual CTC commitment"
                  color="bg-purple-500"
                />
                <StatCard
                  icon={Calendar}
                  title="Active Compensations"
                  value={stats.activeCompensations.toString()}
                  subtitle="Currently effective"
                  color="bg-orange-500"
                />
              </div>

              {/* Component Summary */}
              <div className="bg-white rounded-lg border shadow-sm p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  Pay Components Overview
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  {payComponents.map(component => (
                    <div key={component.id} className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className={`text-xs px-2 py-1 rounded-full mb-2 ${
                        component.type === 'earning' ? 'bg-green-100 text-green-800' :
                        component.type === 'deduction' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {component.type}
                      </div>
                      <p className="font-medium text-sm text-gray-900">{component.name}</p>
                      <p className="text-xs text-gray-500">{component.code}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Compensations */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Edit3 className="w-5 h-5" />
                    Recent Compensation Structures
                  </h3>
                  <p className="text-sm text-gray-500">Showing latest {Math.min(20, compensations.length)} records</p>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {compensations.map(compensation => (
                    <CompensationCard
                      key={compensation.id}
                      compensation={compensation}
                      payComponents={payComponents}
                    />
                  ))}
                </div>
              </div>

              {/* Data Quality Notice */}
              {compensations.some(comp => !comp.employee?.name) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <h4 className="text-yellow-800 font-medium mb-2">⚠️ Missing Employee Data</h4>
                  <p className="text-sm text-yellow-700">
                    Some compensation records are missing employee information. This happens when:
                  </p>
                  <ul className="text-sm text-yellow-700 mt-2 ml-4 list-disc">
                    <li>Employee records haven't been created in the users table</li>
                    <li>User IDs in compensation records don't match existing users</li>
                  </ul>
                  <p className="text-sm text-yellow-700 mt-2">
                    Add employee profiles to see complete compensation details.
                  </p>
                </div>
              )}

              {/* Quick Actions */}
              <div className="bg-blue-50 rounded-lg p-6 mt-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Quick Actions</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Get started with payroll management using these tools:
                </p>
                <div className="flex flex-wrap gap-3">
                  <a 
                    href="/payroll/compensation" 
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                  >
                    Edit Compensations
                  </a>
                  <a 
                    href="/payroll/settings" 
                    className="px-4 py-2 bg-white border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 text-sm font-medium"
                  >
                    Manage Components
                  </a>
                  <a 
                    href="/payroll" 
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium"
                  >
                    Payroll Dashboard
                  </a>
                </div>
              </div>
            </>
          )}
        </AsyncSection>
      </div>
    </div>
  );
}
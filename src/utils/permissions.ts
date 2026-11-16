// Keep navigation and route access in sync for payroll roles.
export const PAYROLL_ROLES = ['admin', 'superadmin', 'payroll_admin'];
export const PAYSLIP_ROLES = [...PAYROLL_ROLES, 'user'];
export const canManagePayroll = (role: string) => PAYROLL_ROLES.includes(role);
export const canViewPayslip = (role: string) => PAYSLIP_ROLES.includes(role);

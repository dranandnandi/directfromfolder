export type PayrollPeriod = { id:string; organization_id:string; month:number; year:number; status:string; };
export type PayrollRun = { id:string; user_id:string; net_pay:number; gross_earnings:number; pt_amount:number; snapshot:any; attendance_summary:any; };
export type AttendanceOverride = { user_id:string; payload:{payable_days:number; lop_days:number; paid_leaves:number; ot_hours:number; late_count:number; remarks?:string;} };

export interface CompensationStructure {
  id: string;
  employeeId: string;
  basicSalary: number;
  hra: number;
  conveyance: number;
  lta: number;
  medical: number;
  otherAllowances: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatutoryFiling {
  id: string;
  type: 'pf' | 'esic' | 'professional_tax' | 'income_tax';
  period: string;
  dueDate: string;
  filingDate?: string;
  status: 'pending' | 'filed' | 'overdue';
  amount: number;
  referenceNumber?: string;
  createdAt: string;
  updatedAt: string;
}
export interface User {
  id: string;
  name: string;
  whatsappNumber: string;
  role: string;
  department: string;
}

export enum TaskType {
  QuickAdvisory = 'quickAdvisory',
  ClinicalRound = 'clinicalRound',
  FollowUp = 'followUp',
  PersonalTask = 'personalTask'
}

export interface OrganizationSettings {
  id: string;
  organizationId: string;
  name: string;
  advisoryTypes: string[];
  roundTypes: string[];
  followUpTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export enum TaskPriority {
  Critical = 'critical',
  Moderate = 'moderate',
  LessImportant = 'lessImportant'
}

export enum TaskStatus {
  New = 'new',
  Pending = 'Pending',
  InProgress = 'inProgress',
  Completed = 'completed',
  Overdue = 'overdue'
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  patientId?: string;
  assignees: User[];
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: Date;
  dueDate?: Date;
  completedAt?: Date;
  location?: string;
  roundType?: string;
  followUpType?: string;
  advisoryType?: string;
  contactNumber?: string;
  manualWhatsappNumber?: string;
  hoursToComplete?: number;
  isRecurring?: boolean;
  recurringTemplateId?: string;
}

export interface QualityControlEntry {
  id: string;
  taskId: string;
  userId: string;
  entryDate: Date;
  entryDescription: string;
  remark: string;
  createdAt: Date;
  user?: {
    name: string;
  };
}

export enum RecurrenceFrequency {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Quarterly = 'quarterly',
  SixMonthly = '6monthly',
  Yearly = 'yearly'
}

export interface RecurringTaskTemplate {
  id: string;
  organizationId: string;
  createdBy: string;
  assignedTo?: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  recurrenceFrequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  numberOfOccurrences?: number;
  completionWithinHours?: number;
  completionWithinDays?: number;
  lastGeneratedDate?: Date;
  isActive: boolean;
  patientId?: string;
  location?: string;
  roundType?: string;
  followUpType?: string;
  advisoryType?: string;
  contactNumber?: string;
  manualWhatsappNumber?: string;
  createdAt: Date;
  updatedAt: Date;
}
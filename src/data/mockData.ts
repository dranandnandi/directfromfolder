import { Task, TaskType, TaskPriority, TaskStatus } from '../models/task';

export const mockTasks: Task[] = [
  {
    id: '1',
    type: TaskType.RegularTask,
    title: 'Post-consultation advice',
    description: 'Provide medication instructions for patient after dental procedure',
    patientId: 'P001',
    assignees: [],
    priority: TaskPriority.Moderate,
    status: TaskStatus.New,
    createdAt: new Date()
  },
  {
    id: '2',
    type: TaskType.PatientTracking,
    title: 'Morning Round - Room 204',
    description: 'Check vital signs and update patient chart',
    patientId: 'P002',
    assignees: [],
    priority: TaskPriority.Critical,
    status: TaskStatus.InProgress,
    createdAt: new Date(),
    dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000)
  },
  {
    id: '3',
    type: TaskType.AuditTask,
    title: 'Post-surgery follow-up',
    description: 'Schedule follow-up appointment for knee surgery patient',
    patientId: 'P003',
    assignees: [],
    priority: TaskPriority.Moderate,
    status: TaskStatus.New,
    createdAt: new Date(),
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }
];
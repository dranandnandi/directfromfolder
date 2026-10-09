import { Task, TaskType, TaskPriority, TaskStatus } from '../models/task';

export const mockTasks: Task[] = [
  {
    id: '1',
    type: TaskType.RegularTask,
    title: 'Post-visit advice',
    description: 'Send the agreed next steps to the client after the site visit',
    patientId: 'REF001',
    assignees: [],
    priority: TaskPriority.Moderate,
    status: TaskStatus.New,
    createdAt: new Date()
  },
  {
    id: '2',
    type: TaskType.ClientTracking,
    title: 'Morning Round - Floor 2',
    description: 'Complete the walkthrough checklist and update the client record',
    patientId: 'REF002',
    assignees: [],
    priority: TaskPriority.Critical,
    status: TaskStatus.InProgress,
    createdAt: new Date(),
    dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000)
  },
  {
    id: '3',
    type: TaskType.AuditTask,
    title: 'Service follow-up',
    description: 'Schedule a follow-up appointment with the client',
    patientId: 'REF003',
    assignees: [],
    priority: TaskPriority.Moderate,
    status: TaskStatus.New,
    createdAt: new Date(),
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }
];
import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell
} from 'recharts';
import { supabase } from '../utils/supabaseClient';
import { Task, TaskStatus, TaskType } from '../models/task';

interface StatusData {
  name: string;
  value: number;
}

interface CompletionData {
  date: string;
  completed: number;
  total: number;
}

interface DepartmentData {
  name: string;
  value: number;
}

interface UserPerformanceData {
  name: string;
  completed: number;
  pending: number;
  total: number;
}

const Reports = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState('week'); // week, month, year
  const [viewType, setViewType] = useState('status'); // status, completion, user, department

  useEffect(() => {
    fetchTasks();
  }, [dateRange]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!userData?.organization_id) throw new Error('Organization not found');

      let query = supabase
        .from('tasks')
        .select(`
          *,
          assigned_to:users!tasks_assigned_to_fkey (
            id,
            name,
            department,
            role
          )
        `)
        .eq('organization_id', userData.organization_id);

      // Add date range filter
      const now = new Date();
      const startDate = new Date();
      switch (dateRange) {
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
      }

      query = query.gte('created_at', startDate.toISOString());

      const { data, error } = await query;
      if (error) throw error;

      setTasks(data || []);
    } catch (error: any) {
      console.error('Error fetching tasks:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusDistribution = (): StatusData[] => {
    const distribution = tasks.reduce((acc: Record<string, number>, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(distribution).map(([status, count]) => ({
      name: status,
      value: count
    }));
  };

  const getCompletionTrend = (): CompletionData[] => {
    const trend = tasks.reduce((acc: Record<string, CompletionData>, task) => {
      const date = new Date(task.createdAt).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = { date, completed: 0, total: 0 };
      }
      acc[date].total++;
      if (task.status === TaskStatus.Completed) {
        acc[date].completed++;
      }
      return acc;
    }, {});

    return Object.values(trend);
  };

  const getDepartmentDistribution = (): DepartmentData[] => {
    const distribution = tasks.reduce((acc: Record<string, number>, task) => {
      const dept = task.assignees?.[0]?.department || 'Unassigned';
      acc[dept] = (acc[dept] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(distribution).map(([dept, count]) => ({
      name: dept,
      value: count
    }));
  };

  const getUserPerformance = (): UserPerformanceData[] => {
    const performance = tasks.reduce((acc: Record<string, UserPerformanceData>, task) => {
      const user = task.assignees?.[0]?.name || 'Unassigned';
      if (!acc[user]) {
        acc[user] = { name: user, completed: 0, pending: 0, total: 0 };
      }
      acc[user].total++;
      if (task.status === TaskStatus.Completed) {
        acc[user].completed++;
      } else if (task.status === TaskStatus.InProgress || task.status === TaskStatus.New) {
        acc[user].pending++;
      }
      return acc;
    }, {});

    return Object.values(performance);
  };

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  if (loading) {
    return <div className="text-center py-4">Loading reports...</div>;
  }

  if (error) {
    return <div className="text-red-600 text-center py-4">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Reports & Analytics</h2>
        <div className="flex gap-4">
          <select
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="year">Last Year</option>
          </select>
          <select
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            value={viewType}
            onChange={(e) => setViewType(e.target.value)}
          >
            <option value="status">Status Distribution</option>
            <option value="completion">Completion Trend</option>
            <option value="department">Department Analysis</option>
            <option value="user">User Performance</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        {viewType === 'status' && (
          <>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">Task Status Distribution</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={getStatusDistribution()}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {getStatusDistribution().map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">Task Type Distribution</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: 'Regular Tasks', count: tasks.filter(t => t.type === TaskType.QuickAdvisory).length },
                    { name: 'Patient Tracking', count: tasks.filter(t => t.type === TaskType.ClinicalRound).length },
                    { name: 'Audit Task', count: tasks.filter(t => t.type === TaskType.FollowUp).length },
                    { name: 'Personal Task', count: tasks.filter(t => t.type === TaskType.PersonalTask).length }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* Completion Trend */}
        {viewType === 'completion' && (
          <>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">Task Completion Trend</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={getCompletionTrend()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="completed" stroke="#82ca9d" name="Completed" />
                    <Line type="monotone" dataKey="total" stroke="#8884d8" name="Total" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">Completion Rate</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Completed', value: tasks.filter(t => t.status === TaskStatus.Completed).length },
                        { name: 'Pending', value: tasks.filter(t => t.status !== TaskStatus.Completed).length }
                      ]}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      <Cell fill="#82ca9d" />
                      <Cell fill="#8884d8" />
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* Department Analysis */}
        {viewType === 'department' && (
          <>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">Department Workload Distribution</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={getDepartmentDistribution()}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {getDepartmentDistribution().map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">Department Performance</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getDepartmentDistribution()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* User Performance */}
        {viewType === 'user' && (
          <>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">User Task Distribution</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getUserPerformance()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="completed" stackId="a" fill="#82ca9d" name="Completed" />
                    <Bar dataKey="pending" stackId="a" fill="#8884d8" name="Pending" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-medium mb-4">User Completion Rate</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getUserPerformance()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="completed"
                      fill="#82ca9d"
                      name="Completion Rate"
                    >
                      {getUserPerformance().map((entry: UserPerformanceData, index: number) => {
                        const percentage = entry.total > 0 
                          ? ((entry.completed / entry.total) * 100).toFixed(1) 
                          : '0';
                        return (
                          <Cell key={`cell-${index}`}>
                            {percentage !== '0' && (
                              <text
                                x={0}
                                y={0}
                                dy={-10}
                                fill="#666"
                                fontSize={12}
                                textAnchor="middle"
                              >
                                {`${percentage}%`}
                              </text>
                            )}
                          </Cell>
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <h4 className="text-sm text-gray-500">Total Tasks</h4>
          <p className="text-2xl font-semibold">{tasks.length}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <h4 className="text-sm text-gray-500">Completion Rate</h4>
          <p className="text-2xl font-semibold">
            {tasks.length > 0 
              ? ((tasks.filter(t => t.status === TaskStatus.Completed).length / tasks.length) * 100).toFixed(1)
              : '0'}%
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <h4 className="text-sm text-gray-500">Pending Tasks</h4>
          <p className="text-2xl font-semibold">
            {tasks.filter(t => t.status === TaskStatus.New || t.status === TaskStatus.InProgress).length}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <h4 className="text-sm text-gray-500">Overdue Tasks</h4>
          <p className="text-2xl font-semibold text-red-600">
            {tasks.filter(t => t.status === TaskStatus.Overdue).length}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Reports;
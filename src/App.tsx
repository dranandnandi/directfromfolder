import { useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase, retryOperation } from './utils/supabaseClient';
import LoginForm from './components/auth/LoginForm';
import Sidebar from './components/Sidebar';
import DashboardContainer from './components/DashboardContainer';
import Header from './components/Header';
import { lazy, Suspense } from 'react';
import ConversationDashboard from './components/ConversationDashboard';

const Settings = lazy(() => import('./components/Settings'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const Reports = lazy(() => import('./components/Reports'));
const TaskModal = lazy(() => import('./components/TaskModal'));
const DeleteTasks = lazy(() => import('./components/DeleteTasks'));
const RecurringTasksManager = lazy(() => import('./components/RecurringTasksManager'));
const PerformanceReports = lazy(() => import('./components/PerformanceReports'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const LeaveManagement = lazy(() => import('./components/LeaveManagement'));
const PunchInOut = lazy(() => import('./components/hr/PunchInOut'));
const AttendanceDashboard = lazy(() => import('./components/hr/AttendanceDashboard'));
import { Task, TaskType, User, OrganizationSettings, TaskStatus, TaskPriority } from './models/task';

// Define interfaces for raw Supabase response data
interface RawSupabaseUser {
  id: string;
  name: string;
  whatsapp_number: string;
  role: string;
  department: string;
}

interface RawSupabaseTask {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  patient_id?: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  due_date?: string;
  completed_at?: string;
  location?: string;
  round_type?: string;
  follow_up_type?: string;
  advisory_type?: string;
  contact_number?: string;
  manual_whatsapp_number?: string;
  hours_to_complete?: number;
  organization_id: string;
  created_by?: string;
  assigned_to?: RawSupabaseUser[] | RawSupabaseUser | null;
}

interface RawSupabasePersonalTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  assignee_id?: string;
  assignee?: RawSupabaseUser[] | RawSupabaseUser | null;
}

function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState<TaskType | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [personalTasks, setPersonalTasks] = useState<Task[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [userOrganizationId, setUserOrganizationId] = useState<string | null>(null);
  const [isProfileEnsured, setIsProfileEnsured] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [hasInitialDataLoaded, setHasInitialDataLoaded] = useState(false);
  const isFetchingRef = useRef(false);

  // Add organization settings state with setter
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings>({
    id: '1',
    organizationId: '1',
    name: 'Clinic Task Manager',
    advisoryTypes: ['Medication', 'Diet', 'Lifestyle', 'Emergency'],
    roundTypes: ['Morning Round', 'Evening Round', 'Emergency Round'],
    followUpTypes: ['Post Surgery', 'Treatment Progress', 'Test Results', 'General Check-up'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Global refresh function to refresh all data
  const handleGlobalRefresh = async () => {
    if (session && userOrganizationId) {
      if (isFetchingRef.current) {
        console.log('Skipping refresh - fetch already in progress');
        return;
      }
      
      isFetchingRef.current = true;
      setLoading(true);
      await Promise.all([
        fetchTasks(),
        fetchPersonalTasks(),
        fetchTeamMembers(),
        fetchOrganizationSettings()
      ]);
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    // Check active sessions and subscribe to auth changes
    const setupAuth = async () => {
      console.log('Setting up auth...');
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      console.log('Initial auth session:', initialSession ? 'Logged in' : 'Not logged in');
      setSession(initialSession);
      setLoading(false);
    };
    
    setupAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const setupUserProfile = async () => {
      if (!session) {
        console.log('No session, skipping profile setup');
        return;
      }
      
      setLoading(true);
      
      try {
        console.log('Setting up user profile...');
        const organizationId = await ensureUserProfile();
        
        if (organizationId) {
          console.log('User profile setup complete with organization ID:', organizationId);
          setUserOrganizationId(organizationId);
          setOrganizationSettings(prevSettings => ({ 
            ...prevSettings, 
            id: organizationId, 
            organizationId: organizationId 
          }));
          
          // Fetch initial data only once
          setIsProfileEnsured(true);
        }
      } catch (error) {
        console.error('Error in user profile setup:', error);
        setProfileError('Failed to set up user profile. Please try again or contact support.');
      } finally {
        setIsProfileEnsured(true);
        setLoading(false); 
      }
    };
    
    if (session && !isProfileEnsured) {
      setupUserProfile();
    }
  }, [session, isProfileEnsured]);

  // New useEffect for initial data loading
  useEffect(() => {
    const loadInitialData = async () => {
      // Only proceed if we have a session, organization ID, profile is ensured, and data hasn't been loaded yet
      if (!session || !userOrganizationId || !isProfileEnsured || hasInitialDataLoaded || isFetchingRef.current) {
        return;
      }
      
      console.log('Loading initial application data...');
      isFetchingRef.current = true;
      setLoading(true);
      
      try {
        await Promise.all([
          fetchTasks(),
          fetchPersonalTasks(),
          fetchTeamMembers(),
          fetchOrganizationSettings()
        ]);
        
        console.log('Initial data load complete');
        setHasInitialDataLoaded(true);
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    };
    
    loadInitialData();
  }, [session, userOrganizationId, isProfileEnsured, hasInitialDataLoaded]);

  // Initialize default notification preferences for new users
  const initializeDefaultNotificationPreferences = async (userId: string) => {
    try {
      // Define default notification preferences
      const defaultPreferences = [
        { type: 'task_assigned', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_updated', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_completed', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_comment', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_due', enabled: true, advance_notice: '1 day' } // This will handle multiple notifications
      ];

      // Check which preferences already exist
      const { data: existingPrefs, error: checkError } = await supabase
        .from('notification_preferences')
        .select('type')
        .eq('user_id', userId);

      if (checkError) {
        console.error('Error checking existing preferences:', checkError);
        return;
      }

      const existingTypes = new Set(existingPrefs?.map(p => p.type) || []);

      // Insert missing default preferences
      const missingPreferences = defaultPreferences.filter(pref => !existingTypes.has(pref.type));

      if (missingPreferences.length > 0) {
        const prefsToInsert = missingPreferences.map(pref => ({
          user_id: userId,
          type: pref.type,
          enabled: pref.enabled,
          advance_notice: pref.advance_notice
        }));

        const { error: insertError } = await supabase
          .from('notification_preferences')
          .insert(prefsToInsert);

        if (insertError) {
          console.error('Error inserting default notification preferences:', insertError);
        } else {
          console.log(`Initialized ${missingPreferences.length} default notification preferences for user`);
        }
      }
    } catch (error) {
      console.error('Error initializing default notification preferences:', error);
    }
  };

  // Fetch organization settings
  const fetchOrganizationSettings = async () => {
    try {
      if (!userOrganizationId) {
        console.warn('No organization ID available, skipping organization settings fetch');
        return;
      }
      
      console.log('Fetching organization settings...');
      if (!userOrganizationId) return;

      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userOrganizationId)
        .single();

      if (error) throw error;
      if (!data) return;

      setOrganizationSettings({
        id: data.id,
        organizationId: data.id,
        name: data.name || 'Clinic Task Manager',
        advisoryTypes: data.advisory_types || [],
        roundTypes: data.round_types || [],
        followUpTypes: data.follow_up_types || [],
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      });
    } catch (error) {
      console.error('Error fetching organization settings:', error);
    }
  };

  // Ensure user profile exists with organization_id
  const ensureUserProfile = async (): Promise<string | null> => {
    try {
      // If we already have an organization ID and profile is ensured, return it
      if (userOrganizationId && isProfileEnsured) {
        console.log('Using existing organization ID:', userOrganizationId);
        return userOrganizationId;
      }
      
      return await retryOperation(async () => {
        if (!session?.user?.id) throw new Error('No authenticated user');

        console.log('Ensuring user profile for auth ID:', session.user.id);
        
        // Check if user exists in users table
        const { data: existingUser, error: userError } = await supabase
          .from('users')
          .select('id, organization_id, role')
          .eq('auth_id', session.user.id)
          .single();

        console.log('User lookup result:', { existingUser, error: userError?.message });
        
        // If user doesn't exist or has no organization_id, we need to fix it
        if (userError || !existingUser || !existingUser.organization_id) {
          console.log('User needs organization setup');
          
          // First, try to find an existing organization
          const { data: organizations, error: orgError } = await supabase
            .from('organizations')
            .select('id')
            .limit(1);

          if (orgError) throw orgError;
          console.log('Organizations lookup result:', { organizations });

          let organizationId: string;

          if (organizations && organizations.length > 0) {
            // Use existing organization
            organizationId = organizations[0].id;
            console.log('Using existing organization:', organizationId);
          } else {
            // Create a new organization if none exists
            console.log('Creating new organization');
            const { data: newOrg, error: createOrgError } = await supabase
              .from('organizations')
              .insert([{
                name: 'Default Organization',
                max_users: 10,
                current_users: 0
              }])
              .select('id')
              .single();

            if (createOrgError) throw createOrgError;
            organizationId = newOrg.id;
          }

          if (existingUser) {
            // Update existing user with organization_id
            console.log('Updating existing user with organization ID');
            const { error: updateError } = await supabase
              .from('users')
              .update({ 
                organization_id: organizationId,
                role: existingUser.role || 'user'
              })
              .eq('id', existingUser.id);

            if (updateError) throw updateError;

            // Initialize default notification preferences for existing user
            await initializeDefaultNotificationPreferences(existingUser.id);
          } else {
            // Create new user profile
            console.log('Creating new user profile');
            const { data: newUser, error: insertError } = await supabase
              .from('users')
              .insert([{
                auth_id: session.user.id,
                organization_id: organizationId,
                name: session.user.email?.split('@')[0] || 'User',
                email: session.user.email || '',
                whatsapp_number: session.user.phone || `temp_${Date.now()}`,
                role: 'user',
                department: 'General'
              }])
              .select('id')
              .single();

            if (insertError) throw insertError;

            // Initialize default notification preferences for new user
            if (newUser) {
              await initializeDefaultNotificationPreferences(newUser.id);
            }
          }

          return organizationId;
        }

        console.log('User profile exists with organization ID:', existingUser.organization_id);
        // User exists and has organization_id, just initialize preferences if missing
        await initializeDefaultNotificationPreferences(existingUser.id);

        console.log('User profile setup complete');
        return existingUser.organization_id;
      });
    } catch (error) {
      console.error('Error ensuring user profile:', error);
      setProfileError('Failed to set up user profile. Please contact support.');
      return null;
    }
  };

  const fetchPersonalTasks = async () => {
    try {
      console.log('Fetching personal tasks...');
      // Check if session and user ID are available
      if (!session?.user?.id || !userOrganizationId) {
        console.warn('No authenticated user session available');
        return;
      }

      await retryOperation(async () => {
        // Get current user's ID
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', session?.user?.id)
          .single();

        if (!userData) throw new Error('User not found');

        console.log('Fetching personal tasks for user ID:', userData.id);

        // Fetch personal tasks where user is either creator or assignee
        const { data: tasksData, error } = await supabase
          .from('personal_tasks')
          .select(`
            *,
            assignee:users!personal_tasks_assignee_id_fkey (
              id,
              name,
              whatsapp_number,
              role,
              department
            )
          `)
          .or(`user_id.eq.${userData.id},assignee_id.eq.${userData.id}`);

        console.log('Raw personal tasks data from Supabase:', tasksData);

        if (error) throw error;

        console.log('Processing personal tasks data, focusing on assignee field:');
        const typedPersonalTasksData = tasksData as RawSupabasePersonalTask[];
        typedPersonalTasksData.forEach((task, index) => {
          console.log(`Personal task ${index} (${task.id}) assignee:`, task.assignee);
        });

        const formattedTasks: Task[] = typedPersonalTasksData.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          type: TaskType.PersonalTask,
          status: task.status as TaskStatus,
          priority: task.priority as TaskPriority,
          dueDate: task.due_date ? new Date(task.due_date) : undefined,
          createdAt: new Date(task.created_at),
          assignees: task.assignee && Array.isArray(task.assignee) && task.assignee.length > 0 ? [{
            id: task.assignee[0].id,
            name: task.assignee[0].name,
            whatsappNumber: task.assignee[0].whatsapp_number,
            role: task.assignee[0].role,
            department: task.assignee[0].department
          }] : task.assignee && !Array.isArray(task.assignee) ? [{
            id: task.assignee.id,
            name: task.assignee.name,
            whatsappNumber: task.assignee.whatsapp_number,
            role: task.assignee.role,
            department: task.assignee.department
          }] : []
        }));

        console.log('Formatted personal tasks with assignees:', formattedTasks);
        console.log('Personal tasks with empty assignees:', formattedTasks.filter(t => !t.assignees || t.assignees.length === 0).length);
        console.log('Personal tasks with assignees:', formattedTasks.filter(t => t.assignees && t.assignees.length > 0).length);

        setPersonalTasks(formattedTasks);
      });
    } catch (error) {
      console.error('Error fetching personal tasks:', error);
      alert('Failed to load personal tasks. Please check your connection and try again.');
    }
  };

  const fetchTeamMembers = async () => {
    try {
      console.log('Fetching team members...');
      // Check if session and user ID are available
      if (!session?.user?.id || !userOrganizationId) {
        console.warn('No authenticated user session available');
        return;
      }

      await retryOperation(async () => {
        // Use the stored organization ID if available, otherwise fetch from database
        let organizationId = userOrganizationId;
        let userRole = '';

        if (!organizationId) {
          // First get the user's organization ID
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('organization_id, role')
            .eq('auth_id', session?.user?.id)
            .single();

          if (userError) throw userError;
          if (!userData?.organization_id) throw new Error('No organization found');

          organizationId = userData.organization_id;
          userRole = userData.role || '';
          setUserOrganizationId(organizationId);
        } else {
          // Get user role if we don't have it
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('auth_id', session?.user?.id)
            .single();

          if (userError) throw userError;
          userRole = userData?.role || '';
        }

        // Set user role
        setUserRole(userRole);

        // Then fetch all team members from that organization
        const { data: members, error: membersError } = await supabase
          .from('users')
          .select('id, name, whatsapp_number, role, department')
          .eq('organization_id', organizationId);

        if (membersError) throw membersError;

        // Transform the data to match our User interface
        const formattedMembers: User[] = members.map(member => ({
          id: member.id,
          name: member.name,
          whatsappNumber: member.whatsapp_number,
          role: member.role,
          department: member.department
        }));

        setTeamMembers(formattedMembers);
      });
    } catch (error: any) {
      console.error('Error fetching team members:', error);
      alert('Failed to load team members. Please check your connection and try again.');
    }
  };

  const fetchTasks = async () => {
    try {
      console.log('Fetching tasks...');
      // Check if session and user ID are available
      if (!session?.user?.id || !userOrganizationId) {
        console.warn('No authenticated user session available');
        return;
      }

      await retryOperation(async () => {
        // Use the stored organization ID if available, otherwise fetch from database
        let organizationId = userOrganizationId;

        if (!organizationId) {
          const { data: userData } = await supabase
            .from('users')
            .select('organization_id')
            .eq('auth_id', session?.user?.id)
            .single();

          if (!userData?.organization_id) {
            console.warn('User organization not found');
            return;
          }
          organizationId = userData.organization_id;
          setUserOrganizationId(organizationId);
        }

        console.log('Fetching tasks for organization ID:', organizationId);

        const { data: tasksData, error } = await supabase
          .from('tasks')
          .select(`
            id,
            type,
            title,
            description,
            patient_id,
            priority,
            status,
            created_at,
            updated_at,
            due_date,
            completed_at,
            location,
            round_type,
            follow_up_type,
            advisory_type,
            contact_number,
            manual_whatsapp_number,
            hours_to_complete,
            organization_id,
            created_by,
            assigned_to:users!tasks_assigned_to_fkey (
              id,
              name,
              whatsapp_number,
              role,
              department
            )
          `)
          .eq('organization_id', organizationId);

        console.log('Raw tasks data from Supabase:', tasksData);

        if (error) {
          console.error('Error fetching tasks from database:', error);
          // If it's a network error, don't throw - just log and return
          if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch')) {
            console.warn('Network error fetching tasks, skipping update');
            return;
          }
          throw error;
        }

        // Ensure tasksData is an array before processing
        const typedTasksData = tasksData as RawSupabaseTask[];
        if (!Array.isArray(typedTasksData)) {
          console.warn('Tasks data is not an array:', tasksData);
          return;
        }

        console.log('Processing tasks data, focusing on assigned_to field:');
        tasksData.forEach((task, index) => {
          console.log(`Task ${index} (${task.id}) assigned_to:`, task.assigned_to);
        });

        const formattedTasks: Task[] = typedTasksData.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          type: task.type,
          status: task.status as TaskStatus,
          priority: task.priority as TaskPriority,
          manualWhatsappNumber: task.manual_whatsapp_number,
          contactNumber: task.contact_number,
          assignees: task.assigned_to && Array.isArray(task.assigned_to) && task.assigned_to.length > 0 ? [{
            id: task.assigned_to[0].id,
            name: task.assigned_to[0].name,
            whatsappNumber: task.assigned_to[0].whatsapp_number,
            role: task.assigned_to[0].role,
            department: task.assigned_to[0].department
          }] : task.assigned_to && !Array.isArray(task.assigned_to) ? [{
            id: task.assigned_to.id,
            name: task.assigned_to.name,
            whatsappNumber: task.assigned_to.whatsapp_number,
            role: task.assigned_to.role,
            department: task.assigned_to.department
          }] : [],
          patientId: task.patient_id,
          dueDate: task.due_date ? new Date(task.due_date) : undefined,
          location: task.location,
          roundType: task.round_type,
          followUpType: task.follow_up_type,
          advisoryType: task.advisory_type,
          hoursToComplete: task.hours_to_complete,
          createdAt: new Date(task.created_at)
        }));

        console.log('Formatted tasks with assignees:', formattedTasks);
        console.log('Tasks with empty assignees:', formattedTasks.filter(t => !t.assignees || t.assignees.length === 0).length);
        console.log('Tasks with assignees:', formattedTasks.filter(t => t.assignees && t.assignees.length > 0).length);

        setTasks(formattedTasks);
      });
    } catch (error) {
      console.error('Error fetching tasks:', error);
      // Only show alert for non-network errors
      if (error instanceof Error && !error.message?.includes('Failed to fetch')) {
        alert('Failed to load tasks. Please check your connection and try again.');
      }
    }
  };

  // Handle adding new tasks or updating existing tasks
  const handleAddTasks = async (newTasks: Task[]) => {
    try {
      if (isFetchingRef.current) {
        console.log('Skipping task add/update - fetch already in progress');
        return;
      }
      
      // Handle personal tasks separately
      const task = newTasks[0];
      if (task.type === TaskType.PersonalTask) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', session?.user?.id)
          .single();

        if (!userData) throw new Error('User not found');
        const personalTask = {
          user_id: userData.id,
          assignee_id: task.assignees?.[0]?.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
          due_date: task.dueDate?.toISOString()
        };

        if (editingTask) {
          const { error: updateError } = await supabase
            .from('personal_tasks')
            .update(personalTask)
            .eq('id', editingTask.id);

          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from('personal_tasks')
            .insert([personalTask]);

          if (insertError) throw insertError;
        }

        await fetchPersonalTasks();
        setEditingTask(null);
        setShowTaskModal(false);
        setSelectedTaskType(null);
        return;
      }

      await retryOperation(async () => {
        // Use the stored organization ID if available, otherwise fetch from database
        let organizationId = userOrganizationId;
        let userId = '';

        if (!organizationId) {
          const { data: userData } = await supabase
            .from('users')
            .select('organization_id, id')
            .eq('auth_id', session?.user?.id)
            .single();

          if (!userData?.organization_id) throw new Error('User organization not found');
          organizationId = userData.organization_id;
          userId = userData.id;
          setUserOrganizationId(organizationId);
        } else {
          // Get user ID
          const { data: userData } = await supabase
            .from('users')
            .select('id')
            .eq('auth_id', session?.user?.id)
            .single();

          if (!userData) throw new Error('User not found');
          userId = userData.id;
        }

        const tasksToInsert = newTasks.map(task => ({
          organization_id: organizationId,
          type: task.type,
          title: task.title,
          description: task.description,
          patient_id: task.patientId,
          assigned_to: task.assignees?.[0]?.id,
          priority: task.priority,
          status: task.status,
          due_date: task.dueDate?.toISOString(),
          location: task.location,
          round_type: task.roundType,
          follow_up_type: task.followUpType,
          advisory_type: task.advisoryType,
          contact_number: task.contactNumber,
          manual_whatsapp_number: task.manualWhatsappNumber,
          hours_to_complete: task.hoursToComplete,
          created_by: userId, // Use database user ID instead of auth ID
        } as const));

        if (editingTask) {
          // Update task
          const { error: updateError } = await supabase
            .from('tasks')
            .update(tasksToInsert[0])
            .eq('id', editingTask.id);

          if (updateError) throw updateError;

          // Log the update activity
          const { error: logError } = await supabase
            .from('task_activity_logs')
            .insert([{
              task_id: editingTask.id,
              user_id: userId,
              action_type: 'update',
              action_details: {
                previous: editingTask,
                updated: tasksToInsert[0],
                changes: Object.keys(tasksToInsert[0]).reduce((acc: Record<string, { from: any; to: any }>, key) => {
                  if (tasksToInsert[0][key as keyof typeof tasksToInsert[0]] !== (editingTask as any)[key]) {
                    acc[key] = {
                      from: (editingTask as any)[key],
                      to: tasksToInsert[0][key as keyof typeof tasksToInsert[0]]
                    };
                  }
                  return acc;
                }, {})
              }
            }]);

          if (logError) throw logError;
        } else {
          // Insert new task
          const { error: insertError } = await supabase
            .from('tasks')
            .insert(tasksToInsert);

          if (insertError) throw insertError;

          // Log the creation activity for each task
          // Since we can't get the inserted task IDs easily without select(), 
          // we'll skip activity logging for new tasks for now
          // The fetchTasks() call below will refresh the UI with the new data
          /*
          const activityLogs = tasksToInsert.map(task => ({
              task_id: 'unknown', // We don't have the ID without select()
              user_id: userId,
              action_type: 'create',
              action_details: {
                task: task
              }
            }));

            const { error: logError } = await supabase
              .from('task_activity_logs')
              .insert(activityLogs);

            if (logError) throw logError;
          */
        }

        // Refresh tasks list
        await fetchTasks();

        setEditingTask(null);
        setShowTaskModal(false);
        setSelectedTaskType(null);
      });
    } catch (error: any) {
      console.error('Error saving tasks:', error);
      alert(`Failed to save tasks: ${error.message || 'Unknown error'}`);
    }
  };

  // Handle editing a task
  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setShowTaskModal(true);
  };

  // Handle the "Add Task" button click
  const handleAddTaskClick = (type: TaskType) => {
    setSelectedTaskType(type);
    setShowTaskModal(true);
  };

  const handleRefreshTasks = async () => {
    try {
      await Promise.all([
        fetchTasks(),
        fetchPersonalTasks()
      ]);
    } catch (error) {
      console.error('Error refreshing tasks:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading application...</p>
          {profileError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md mt-4">
              {profileError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Navigation handler for sidebar
  const handleNavigation = (view: string) => {
    navigate(`/${view === 'dashboard' ? '' : view}`);
  };

  if (!session) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar for larger screens */}
      <div className="hidden lg:block lg:w-64 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30">
        <Sidebar 
          isOpen={true} 
          onClose={() => {}} 
          onNavigate={handleNavigation} 
          userRole={userRole}
          organizationSettings={organizationSettings}
        />
      </div>
      
      {/* Sidebar for smaller screens (mobile) */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setSidebarOpen(false)} />
          <Sidebar 
            isOpen={sidebarOpen} 
            onClose={() => setSidebarOpen(false)} 
            onNavigate={(view) => {
              handleNavigation(view);
              setSidebarOpen(false);
            }}
            userRole={userRole}
            organizationSettings={organizationSettings}
          />
        </div>
      )}
      
      {/* Main content area */}
      <div className="lg:ml-64">
        {/* Header */}
        <Header onMenuClick={() => setSidebarOpen(true)} onRefresh={handleGlobalRefresh} organizationSettings={organizationSettings} />
        
        {/* Main content with Routes */}
        <main className="p-4 lg:p-6">
          <Routes>
            <Route path="/" element={
              <DashboardContainer 
                currentUserId={session?.user?.id}
                tasks={tasks} 
                personalTasks={personalTasks}
                onAddTask={handleAddTaskClick}
                onEditTask={handleEditTask}
                onTaskUpdate={handleRefreshTasks}
                teamMembers={teamMembers}
              />
            } />
            <Route path="/settings" element={
              <Suspense fallback={<div className="p-4">Loading settings...</div>}>
                <Settings />
              </Suspense>
            } />
            <Route path="/team" element={
              <Suspense fallback={<div className="p-4">Loading team management...</div>}>
                <TeamManagement />
              </Suspense>
            } />
            <Route path="/reports" element={
              <Suspense fallback={<div className="p-4">Loading reports...</div>}>
                <Reports />
              </Suspense>
            } />
            <Route path="/deleteTasks" element={
              <Suspense fallback={<div className="p-4">Loading delete tasks...</div>}>
                <DeleteTasks teamMembers={teamMembers} onTasksRefreshed={handleGlobalRefresh} />
              </Suspense>
            } />
            <Route path="/recurringTasks" element={
              <Suspense fallback={<div className="p-4">Loading recurring tasks...</div>}>
                <RecurringTasksManager teamMembers={teamMembers} organizationSettings={organizationSettings} />
              </Suspense>
            } />
            <Route path="/performanceReports" element={
              <Suspense fallback={<div className="p-4">Loading performance reports...</div>}>
                <PerformanceReports />
              </Suspense>
            } />
            <Route path="/conversations" element={
              <Suspense fallback={<div className="p-4">Loading conversation dashboard...</div>}>
                <ConversationDashboard />
              </Suspense>
            } />
            <Route path="/adminDashboard" element={
              <Suspense fallback={<div className="p-4">Loading admin dashboard...</div>}>
                <AdminDashboard adminUserId={session?.user?.id || ''} />
              </Suspense>
            } />
            <Route path="/leaveManagement" element={
              <Suspense fallback={<div className="p-4">Loading leave management...</div>}>
                <LeaveManagement userId={session?.user?.id} isAdmin={userRole === 'admin' || userRole === 'superadmin'} />
              </Suspense>
            } />
            <Route path="/attendance" element={
              <Suspense fallback={<div className="p-4">Loading attendance...</div>}>
                <AttendanceDashboard />
              </Suspense>
            } />
            <Route path="/punch" element={
              <Suspense fallback={<div className="p-4">Loading punch in/out...</div>}>
                <PunchInOut />
              </Suspense>
            } />
            {/* Catch-all route - redirect to dashboard */}
            <Route path="*" element={
              <DashboardContainer 
                currentUserId={session?.user?.id}
                tasks={tasks} 
                personalTasks={personalTasks}
                onAddTask={handleAddTaskClick}
                onEditTask={handleEditTask}
                onTaskUpdate={handleRefreshTasks}
                teamMembers={teamMembers}
              />
            } />
          </Routes>
        </main>

        {/* Task Modal */}
        <Suspense fallback={null}>
          {showTaskModal && (
            <TaskModal 
              isOpen={showTaskModal}
              onClose={() => {
                setShowTaskModal(false);
                setSelectedTaskType(null);
                setEditingTask(null);
              }}
              onSubmit={handleAddTasks}
              initialTaskType={selectedTaskType}
              editingTask={editingTask}
              teamMembers={teamMembers}
              organizationSettings={organizationSettings}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}

export default App;
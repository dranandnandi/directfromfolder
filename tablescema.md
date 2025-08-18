-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.conversation_analysis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_log_id uuid,
  overall_tone text,
  response_quality text,
  misbehavior_detected boolean DEFAULT false,
  red_flags ARRAY,
  sentiment_score numeric,
  recommendation text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT conversation_analysis_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_analysis_conversation_log_id_fkey FOREIGN KEY (conversation_log_id) REFERENCES public.conversation_logs(id)
);
CREATE TABLE public.conversation_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid,
  customer_identifier text,
  audio_file_url text,
  transcribed_text text,
  ai_summary text,
  duration integer,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'transcribed'::text, 'analyzed'::text, 'error'::text])),
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT conversation_logs_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id)
);
CREATE TABLE public.device_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  token text NOT NULL UNIQUE,
  device_type text NOT NULL CHECK (device_type = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT device_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.employee_hr_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  leaves integer DEFAULT 0,
  uninformed_absences integer DEFAULT 0,
  late_logins integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT employee_hr_data_pkey PRIMARY KEY (id),
  CONSTRAINT employee_hr_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  type text NOT NULL CHECK (type = ANY (ARRAY['task_due'::text, 'task_assigned'::text, 'task_updated'::text, 'task_completed'::text, 'task_comment'::text])),
  enabled boolean DEFAULT true,
  advance_notice interval DEFAULT '1 day'::interval,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  task_id uuid,
  type text NOT NULL CHECK (type = ANY (ARRAY['task_due'::text, 'task_assigned'::text, 'task_updated'::text, 'task_completed'::text, 'task_comment'::text])),
  title text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  scheduled_for timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  whatsapp_number text,
  ai_generated_message text,
  whatsapp_sent boolean DEFAULT false,
  whatsapp_sent_at timestamp with time zone,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  advisory_types ARRAY DEFAULT ARRAY['Medication'::text, 'Diet'::text, 'Lifestyle'::text, 'Emergency'::text],
  round_types ARRAY DEFAULT ARRAY['Morning Round'::text, 'Evening Round'::text, 'Emergency Round'::text],
  follow_up_types ARRAY DEFAULT ARRAY['Post Surgery'::text, 'Treatment Progress'::text, 'Test Results'::text, 'General Check-up'::text],
  departments ARRAY DEFAULT ARRAY['Management'::text, 'Medical'::text, 'Nursing'::text],
  max_users integer DEFAULT 10,
  current_users integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.performance_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  generated_by_user_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  report_type text NOT NULL CHECK (report_type = ANY (ARRAY['monthly'::text, '6monthly'::text, 'yearly'::text])),
  metrics jsonb NOT NULL,
  gemini_summary text,
  ai_rating integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT performance_reports_pkey PRIMARY KEY (id),
  CONSTRAINT performance_reports_generated_by_user_id_fkey FOREIGN KEY (generated_by_user_id) REFERENCES public.users(id),
  CONSTRAINT performance_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.personal_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL CHECK (priority = ANY (ARRAY['critical'::text, 'moderate'::text, 'lessImportant'::text])),
  status text NOT NULL CHECK (status = ANY (ARRAY['new'::text, 'pending'::text, 'inProgress'::text, 'completed'::text, 'overdue'::text])),
  due_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  assignee_id uuid,
  CONSTRAINT personal_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT personal_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT personal_tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id)
);
CREATE TABLE public.quality_control_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid,
  user_id uuid,
  entry_date timestamp with time zone NOT NULL,
  entry_description text NOT NULL,
  remark text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT quality_control_entries_pkey PRIMARY KEY (id),
  CONSTRAINT quality_control_entries_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT quality_control_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.recurring_task_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  created_by uuid,
  assigned_to uuid,
  title text NOT NULL,
  description text NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['quickAdvisory'::text, 'clinicalRound'::text, 'followUp'::text, 'personalTask'::text])),
  priority text NOT NULL CHECK (priority = ANY (ARRAY['critical'::text, 'moderate'::text, 'lessImportant'::text])),
  recurrence_frequency text NOT NULL CHECK (recurrence_frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'quarterly'::text, '6monthly'::text, 'yearly'::text])),
  start_date timestamp with time zone NOT NULL,
  end_date timestamp with time zone,
  number_of_occurrences integer,
  completion_within_hours integer,
  completion_within_days integer,
  last_generated_date timestamp with time zone,
  is_active boolean DEFAULT true,
  patient_id text,
  location text,
  round_type text,
  follow_up_type text,
  advisory_type text,
  contact_number text,
  manual_whatsapp_number text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT recurring_task_templates_pkey PRIMARY KEY (id),
  CONSTRAINT recurring_task_templates_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id),
  CONSTRAINT recurring_task_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT recurring_task_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.task_activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid,
  user_id uuid,
  action_type text NOT NULL,
  action_details jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT task_activity_logs_pkey PRIMARY KEY (id),
  CONSTRAINT task_activity_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.task_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid,
  user_id uuid,
  message text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT task_messages_pkey PRIMARY KEY (id),
  CONSTRAINT task_messages_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  type text NOT NULL DEFAULT 'task'::text CHECK (type = ANY (ARRAY['quickAdvisory'::text, 'clinicalRound'::text, 'followUp'::text, 'personalTask'::text])),
  title text NOT NULL,
  description text NOT NULL,
  patient_id text,
  priority text NOT NULL DEFAULT 'low'::text CHECK (priority = ANY (ARRAY['critical'::text, 'moderate'::text, 'lessImportant'::text])),
  status text NOT NULL DEFAULT 'Pending'::text,
  created_by uuid,
  assigned_to uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  due_date timestamp with time zone,
  completed_at timestamp with time zone,
  location text,
  round_type text,
  follow_up_type text,
  advisory_type text,
  contact_number text,
  manual_whatsapp_number text,
  hours_to_complete integer,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id),
  CONSTRAINT tasks_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_id uuid,
  organization_id uuid,
  name text NOT NULL,
  whatsapp_number text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role = ANY (ARRAY['superadmin'::text, 'admin'::text, 'user'::text])),
  department text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  email text NOT NULL UNIQUE,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id),
  CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
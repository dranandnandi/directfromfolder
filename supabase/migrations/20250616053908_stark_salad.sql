/*
  # Add Recurring Tasks Support

  1. New Tables
    - `recurring_task_templates`: Stores recurring task definitions
      - `id` (uuid, primary key)
      - `organization_id` (uuid, references organizations)
      - `created_by` (uuid, references users)
      - `assigned_to` (uuid, references users)
      - `title` (text)
      - `description` (text)
      - `type` (text)
      - `priority` (text)
      - `recurrence_frequency` (text) - daily, weekly, monthly, quarterly, 6monthly, yearly
      - `start_date` (timestamptz)
      - `end_date` (timestamptz, nullable)
      - `number_of_occurrences` (integer, nullable)
      - `completion_within_hours` (integer, nullable)
      - `completion_within_days` (integer, nullable)
      - `last_generated_date` (timestamptz, nullable)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Functions
    - Function to generate recurring tasks
    - Function to calculate next occurrence date

  3. Security
    - Enable RLS on recurring_task_templates table
    - Add policies for organization-based access
*/

-- Create recurring_task_templates table
CREATE TABLE IF NOT EXISTS recurring_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  type text NOT NULL CHECK (type IN ('quickAdvisory', 'clinicalRound', 'followUp', 'personalTask')),
  priority text NOT NULL CHECK (priority IN ('critical', 'moderate', 'lessImportant')),
  recurrence_frequency text NOT NULL CHECK (recurrence_frequency IN ('daily', 'weekly', 'monthly', 'quarterly', '6monthly', 'yearly')),
  start_date timestamptz NOT NULL,
  end_date timestamptz,
  number_of_occurrences integer,
  completion_within_hours integer,
  completion_within_days integer,
  last_generated_date timestamptz,
  is_active boolean DEFAULT true,
  patient_id text,
  location text,
  round_type text,
  follow_up_type text,
  advisory_type text,
  contact_number text,
  manual_whatsapp_number text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_recurring_templates_org ON recurring_task_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_active ON recurring_task_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_frequency ON recurring_task_templates(recurrence_frequency);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_next_gen ON recurring_task_templates(last_generated_date);

-- Enable RLS
ALTER TABLE recurring_task_templates ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "allow_recurring_templates_select"
  ON recurring_task_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = recurring_task_templates.organization_id
    )
  );

CREATE POLICY "allow_recurring_templates_insert"
  ON recurring_task_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = organization_id
    )
  );

CREATE POLICY "allow_recurring_templates_update"
  ON recurring_task_templates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.organization_id = recurring_task_templates.organization_id
    )
  );

CREATE POLICY "allow_recurring_templates_delete"
  ON recurring_task_templates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM user_org_mapping m 
      WHERE m.auth_id = auth.uid()
      AND m.role IN ('admin', 'superadmin')
      AND m.organization_id = recurring_task_templates.organization_id
    )
  );

-- Function to calculate next occurrence date
CREATE OR REPLACE FUNCTION calculate_next_occurrence(
  p_last_date timestamptz,
  p_frequency text,
  p_start_date timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_next_date timestamptz;
  v_base_date timestamptz;
BEGIN
  -- Use last_date if available, otherwise use start_date
  v_base_date := COALESCE(p_last_date, p_start_date);
  
  CASE p_frequency
    WHEN 'daily' THEN
      v_next_date := v_base_date + interval '1 day';
    WHEN 'weekly' THEN
      v_next_date := v_base_date + interval '1 week';
    WHEN 'monthly' THEN
      v_next_date := v_base_date + interval '1 month';
    WHEN 'quarterly' THEN
      v_next_date := v_base_date + interval '3 months';
    WHEN '6monthly' THEN
      v_next_date := v_base_date + interval '6 months';
    WHEN 'yearly' THEN
      v_next_date := v_base_date + interval '1 year';
    ELSE
      v_next_date := v_base_date + interval '1 day';
  END CASE;
  
  RETURN v_next_date;
END;
$$;

-- Function to generate recurring tasks
CREATE OR REPLACE FUNCTION generate_recurring_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_template RECORD;
  v_next_occurrence timestamptz;
  v_due_date timestamptz;
  v_tasks_created integer := 0;
  v_occurrence_count integer;
BEGIN
  -- Loop through active recurring task templates
  FOR v_template IN 
    SELECT * FROM recurring_task_templates 
    WHERE is_active = true
    AND (end_date IS NULL OR end_date > now())
  LOOP
    -- Calculate next occurrence
    v_next_occurrence := calculate_next_occurrence(
      v_template.last_generated_date,
      v_template.recurrence_frequency,
      v_template.start_date
    );
    
    -- Check if it's time to generate the next task
    IF v_next_occurrence <= now() + interval '1 day' THEN
      -- Calculate due date based on completion requirements
      v_due_date := v_next_occurrence;
      
      IF v_template.completion_within_hours IS NOT NULL THEN
        v_due_date := v_next_occurrence + (v_template.completion_within_hours || ' hours')::interval;
      ELSIF v_template.completion_within_days IS NOT NULL THEN
        v_due_date := v_next_occurrence + (v_template.completion_within_days || ' days')::interval;
      END IF;
      
      -- Check if we've reached the occurrence limit
      IF v_template.number_of_occurrences IS NOT NULL THEN
        SELECT COUNT(*) INTO v_occurrence_count
        FROM tasks
        WHERE organization_id = v_template.organization_id
        AND title = v_template.title
        AND description = v_template.description
        AND created_at >= v_template.start_date;
        
        IF v_occurrence_count >= v_template.number_of_occurrences THEN
          -- Deactivate the template
          UPDATE recurring_task_templates
          SET is_active = false, updated_at = now()
          WHERE id = v_template.id;
          CONTINUE;
        END IF;
      END IF;
      
      -- Create the new task
      INSERT INTO tasks (
        organization_id,
        type,
        title,
        description,
        patient_id,
        priority,
        status,
        assigned_to,
        due_date,
        location,
        round_type,
        follow_up_type,
        advisory_type,
        contact_number,
        manual_whatsapp_number,
        hours_to_complete,
        created_by
      ) VALUES (
        v_template.organization_id,
        v_template.type,
        v_template.title,
        v_template.description,
        v_template.patient_id,
        v_template.priority,
        'new',
        v_template.assigned_to,
        v_due_date,
        v_template.location,
        v_template.round_type,
        v_template.follow_up_type,
        v_template.advisory_type,
        v_template.contact_number,
        v_template.manual_whatsapp_number,
        v_template.completion_within_hours,
        v_template.created_by
      );
      
      -- Update the last generated date
      UPDATE recurring_task_templates
      SET 
        last_generated_date = v_next_occurrence,
        updated_at = now()
      WHERE id = v_template.id;
      
      v_tasks_created := v_tasks_created + 1;
    END IF;
  END LOOP;
  
  RETURN v_tasks_created;
END;
$$;

-- Create updated_at trigger for recurring_task_templates
CREATE OR REPLACE TRIGGER update_recurring_templates_timestamp
  BEFORE UPDATE ON recurring_task_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add manual_whatsapp_number column to tasks table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'manual_whatsapp_number'
  ) THEN
    ALTER TABLE tasks ADD COLUMN manual_whatsapp_number text;
  END IF;
END $$;
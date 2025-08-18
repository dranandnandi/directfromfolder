/*
  # Conversation Monitoring System

  1. New Tables
    - `conversation_logs`: Stores recorded conversations between employees and customers
      - `id` (uuid, primary key)
      - `employee_id` (uuid, references users)
      - `customer_identifier` (text)
      - `audio_file_url` (text)
      - `transcribed_text` (text)
      - `ai_summary` (text)
      - `duration` (integer)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `status` (text) - Status of processing (pending, processing, transcribed, analyzed)
    
    - `conversation_analysis`: Stores AI analysis of conversations
      - `id` (uuid, primary key)
      - `conversation_log_id` (uuid, references conversation_logs)
      - `overall_tone` (text)
      - `response_quality` (text)
      - `misbehavior_detected` (boolean)
      - `red_flags` (text[])
      - `sentiment_score` (numeric)
      - `recommendation` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for organization-based access
    - Only allow employees to view their own conversations
    - Allow admins to view all conversations in their organization
*/

-- Create conversation_logs table
CREATE TABLE IF NOT EXISTS conversation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_identifier text,
  audio_file_url text,
  transcribed_text text,
  ai_summary text,
  duration integer,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'transcribed', 'analyzed', 'error')) DEFAULT 'pending',
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create conversation_analysis table
CREATE TABLE IF NOT EXISTS conversation_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_log_id uuid REFERENCES conversation_logs(id) ON DELETE CASCADE,
  overall_tone text,
  response_quality text,
  misbehavior_detected boolean DEFAULT false,
  red_flags text[],
  sentiment_score numeric,
  recommendation text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_conversation_logs_employee_id ON conversation_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_status ON conversation_logs(status);
CREATE INDEX IF NOT EXISTS idx_conversation_analysis_conversation_log_id ON conversation_analysis(conversation_log_id);
CREATE INDEX IF NOT EXISTS idx_conversation_analysis_misbehavior ON conversation_analysis(misbehavior_detected);

-- Enable RLS
ALTER TABLE conversation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_analysis ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for conversation_logs
CREATE POLICY "conversation_logs_select_own"
  ON conversation_logs FOR SELECT
  TO authenticated
  USING (
    employee_id = get_current_user_id()
  );

CREATE POLICY "conversation_logs_insert_own"
  ON conversation_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    employee_id = get_current_user_id()
  );

CREATE POLICY "conversation_logs_update_own"
  ON conversation_logs FOR UPDATE
  TO authenticated
  USING (
    employee_id = get_current_user_id()
  )
  WITH CHECK (
    employee_id = get_current_user_id()
  );

CREATE POLICY "conversation_logs_admin_select"
  ON conversation_logs FOR SELECT
  TO authenticated
  USING (
    is_current_user_admin_safe() AND
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = conversation_logs.employee_id
      AND u.organization_id = get_current_user_org_id_safe()
    )
  );

CREATE POLICY "conversation_logs_admin_update"
  ON conversation_logs FOR UPDATE
  TO authenticated
  USING (
    is_current_user_admin_safe() AND
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = conversation_logs.employee_id
      AND u.organization_id = get_current_user_org_id_safe()
    )
  );

-- Create RLS policies for conversation_analysis
CREATE POLICY "conversation_analysis_select_own"
  ON conversation_analysis FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM conversation_logs cl
      WHERE cl.id = conversation_analysis.conversation_log_id
      AND cl.employee_id = get_current_user_id()
    )
  );

CREATE POLICY "conversation_analysis_admin_select"
  ON conversation_analysis FOR SELECT
  TO authenticated
  USING (
    is_current_user_admin_safe() AND
    EXISTS (
      SELECT 1
      FROM conversation_logs cl
      JOIN users u ON u.id = cl.employee_id
      WHERE cl.id = conversation_analysis.conversation_log_id
      AND u.organization_id = get_current_user_org_id_safe()
    )
  );

-- Create updated_at trigger for conversation_logs
CREATE TRIGGER update_conversation_logs_timestamp
  BEFORE UPDATE ON conversation_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
export interface ConversationLog {
  id: string;
  employee_id: string;
  customer_identifier: string | null;
  audio_file_url: string;
  transcribed_text: string | null;
  ai_summary: string | null;
  duration: number;
  status: 'pending' | 'processing' | 'transcribed' | 'analyzed' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
  task_id?: string | null;
  supervisor_notes?: string | null;
}

export interface ConversationAnalysis {
  id: string;
  conversation_log_id: string;
  overall_tone: string;
  response_quality: string;
  misbehavior_detected: boolean;
  red_flags: string[];
  sentiment_score: number;
  recommendation: string;
  created_at: string;
}

export interface ConversationStats {
  total: number;
  analyzed: number;
  issuesDetected: number;
  averageSentiment: number;
  employeePerformance?: {
    employeeId: string;
    employeeName: string;
    conversationCount: number;
    issueRate: number;
    averageSentiment: number;
  }[];
}

export interface ConversationFilters {
  status?: string;
  timeframe?: string;
  employeeId?: string;
  misbehavior?: string;
}
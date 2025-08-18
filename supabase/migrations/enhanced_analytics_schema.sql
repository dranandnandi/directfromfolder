-- Enhanced Conversation Analysis Schema
-- Add new columns to conversation_analysis table to support comprehensive analysis

ALTER TABLE public.conversation_analysis 
ADD COLUMN IF NOT EXISTS communication_effectiveness NUMERIC,
ADD COLUMN IF NOT EXISTS empathy_level NUMERIC,
ADD COLUMN IF NOT EXISTS problem_resolution TEXT CHECK (problem_resolution IN ('resolved', 'partially_resolved', 'unresolved', 'escalated')),
ADD COLUMN IF NOT EXISTS customer_satisfaction_indicator NUMERIC,
ADD COLUMN IF NOT EXISTS key_issues TEXT[],
ADD COLUMN IF NOT EXISTS positive_aspects TEXT[],
ADD COLUMN IF NOT EXISTS improvement_areas TEXT[],
ADD COLUMN IF NOT EXISTS urgency_level TEXT CHECK (urgency_level IN ('low', 'medium', 'high', 'critical')),
ADD COLUMN IF NOT EXISTS follow_up_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS compliance_score NUMERIC;

-- Update performance_reports table to include more comprehensive metrics
ALTER TABLE public.performance_reports 
ADD COLUMN IF NOT EXISTS conversation_metrics JSONB,
ADD COLUMN IF NOT EXISTS quality_metrics JSONB,
ADD COLUMN IF NOT EXISTS collaboration_metrics JSONB,
ADD COLUMN IF NOT EXISTS improvement_plan JSONB,
ADD COLUMN IF NOT EXISTS strengths TEXT[],
ADD COLUMN IF NOT EXISTS development_areas TEXT[];

-- Create index for better performance on conversation analysis queries
CREATE INDEX IF NOT EXISTS idx_conversation_analysis_sentiment ON public.conversation_analysis(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_conversation_analysis_urgency ON public.conversation_analysis(urgency_level);
CREATE INDEX IF NOT EXISTS idx_conversation_analysis_resolution ON public.conversation_analysis(problem_resolution);

-- Create index for performance reports
CREATE INDEX IF NOT EXISTS idx_performance_reports_period ON public.performance_reports(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_performance_reports_user_period ON public.performance_reports(user_id, period_start, period_end);

-- Create view for comprehensive conversation insights
CREATE OR REPLACE VIEW conversation_insights AS
SELECT 
    cl.id,
    cl.employee_id,
    cl.created_at,
    cl.duration,
    cl.status,
    u.name as employee_name,
    u.department,
    ca.overall_tone,
    ca.response_quality,
    ca.sentiment_score,
    ca.misbehavior_detected,
    ca.red_flags,
    ca.communication_effectiveness,
    ca.empathy_level,
    ca.problem_resolution,
    ca.customer_satisfaction_indicator,
    ca.urgency_level,
    ca.follow_up_required,
    ca.compliance_score,
    CASE 
        WHEN ca.sentiment_score >= 0.8 THEN 'Excellent'
        WHEN ca.sentiment_score >= 0.6 THEN 'Good'
        WHEN ca.sentiment_score >= 0.4 THEN 'Fair'
        ELSE 'Poor'
    END as sentiment_category,
    CASE 
        WHEN ca.compliance_score >= 0.9 THEN 'Compliant'
        WHEN ca.compliance_score >= 0.7 THEN 'Mostly Compliant'
        ELSE 'Non-Compliant'
    END as compliance_status
FROM conversation_logs cl
LEFT JOIN conversation_analysis ca ON cl.id = ca.conversation_log_id
LEFT JOIN users u ON cl.employee_id = u.id;

-- Create view for performance analytics
CREATE OR REPLACE VIEW performance_analytics AS
WITH task_metrics AS (
    SELECT 
        u.id as user_id,
        u.name,
        u.department,
        u.role,
        COUNT(t.id) as total_tasks,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
        COUNT(CASE WHEN t.due_date < NOW() AND t.status != 'completed' THEN 1 END) as overdue_tasks,
        AVG(CASE 
            WHEN t.completed_at IS NOT NULL AND t.created_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600 
        END) as avg_completion_hours
    FROM users u
    LEFT JOIN tasks t ON u.id = t.assigned_to
    WHERE t.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY u.id, u.name, u.department, u.role
),
conversation_metrics AS (
    SELECT 
        employee_id,
        COUNT(*) as total_conversations,
        AVG(sentiment_score) as avg_sentiment,
        AVG(communication_effectiveness) as avg_communication,
        AVG(empathy_level) as avg_empathy,
        AVG(compliance_score) as avg_compliance,
        COUNT(CASE WHEN misbehavior_detected THEN 1 END) as issues_detected
    FROM conversation_insights
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY employee_id
)
SELECT 
    tm.*,
    COALESCE(cm.total_conversations, 0) as total_conversations,
    COALESCE(cm.avg_sentiment, 0) as avg_sentiment,
    COALESCE(cm.avg_communication, 0) as avg_communication,
    COALESCE(cm.avg_empathy, 0) as avg_empathy,
    COALESCE(cm.avg_compliance, 0) as avg_compliance,
    COALESCE(cm.issues_detected, 0) as issues_detected,
    CASE 
        WHEN tm.total_tasks > 0 
        THEN (tm.completed_tasks::FLOAT / tm.total_tasks * 100)
        ELSE 0 
    END as completion_rate,
    CASE 
        WHEN tm.total_tasks > 0 
        THEN (tm.overdue_tasks::FLOAT / tm.total_tasks * 100)
        ELSE 0 
    END as overdue_rate
FROM task_metrics tm
LEFT JOIN conversation_metrics cm ON tm.user_id = cm.employee_id;

-- Create function to generate performance score
CREATE OR REPLACE FUNCTION calculate_performance_score(
    p_completion_rate NUMERIC,
    p_avg_sentiment NUMERIC,
    p_avg_communication NUMERIC,
    p_avg_compliance NUMERIC,
    p_overdue_rate NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
    RETURN (
        (COALESCE(p_completion_rate, 0) * 0.25) +
        (COALESCE(p_avg_sentiment, 0) * 100 * 0.20) +
        (COALESCE(p_avg_communication, 0) * 100 * 0.20) +
        (COALESCE(p_avg_compliance, 0) * 100 * 0.15) +
        ((100 - COALESCE(p_overdue_rate, 0)) * 0.20)
    );
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update conversation analysis timestamps
CREATE OR REPLACE FUNCTION update_conversation_analysis_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_conversation_analysis_timestamp ON conversation_analysis;
CREATE TRIGGER trigger_update_conversation_analysis_timestamp
    BEFORE INSERT ON conversation_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_analysis_timestamp();

-- Create function to generate automatic performance reports
CREATE OR REPLACE FUNCTION generate_performance_report(
    p_user_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_report_type TEXT
) RETURNS UUID AS $$
DECLARE
    v_report_id UUID;
    v_metrics JSONB;
    v_conversation_metrics JSONB;
    v_quality_metrics JSONB;
    v_ai_summary TEXT;
    v_ai_rating INTEGER;
BEGIN
    -- Generate unique report ID
    v_report_id := gen_random_uuid();
    
    -- Calculate comprehensive metrics
    SELECT jsonb_build_object(
        'tasks_completed', COALESCE(COUNT(CASE WHEN status = 'completed' THEN 1 END), 0),
        'tasks_assigned', COALESCE(COUNT(*), 0),
        'completion_rate', CASE 
            WHEN COUNT(*) > 0 
            THEN (COUNT(CASE WHEN status = 'completed' THEN 1 END)::FLOAT / COUNT(*) * 100)
            ELSE 0 
        END,
        'overdue_tasks', COALESCE(COUNT(CASE WHEN due_date < NOW() AND status != 'completed' THEN 1 END), 0),
        'avg_completion_time', AVG(CASE 
            WHEN completed_at IS NOT NULL AND created_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600 
        END)
    ) INTO v_metrics
    FROM tasks 
    WHERE assigned_to = p_user_id 
        AND created_at >= p_period_start 
        AND created_at <= p_period_end;
    
    -- Calculate conversation metrics
    SELECT jsonb_build_object(
        'total_conversations', COUNT(*),
        'avg_sentiment', AVG(sentiment_score),
        'avg_communication', AVG(communication_effectiveness),
        'avg_empathy', AVG(empathy_level),
        'avg_compliance', AVG(compliance_score),
        'issues_detected', COUNT(CASE WHEN misbehavior_detected THEN 1 END)
    ) INTO v_conversation_metrics
    FROM conversation_insights
    WHERE employee_id = p_user_id 
        AND created_at >= p_period_start 
        AND created_at <= p_period_end;
    
    -- Calculate quality metrics
    SELECT jsonb_build_object(
        'quality_entries', COUNT(*),
        'average_quality_score', 85 -- Placeholder - would calculate from actual quality data
    ) INTO v_quality_metrics
    FROM quality_control_entries
    WHERE user_id = p_user_id 
        AND created_at >= p_period_start 
        AND created_at <= p_period_end;
    
    -- Generate AI summary (placeholder)
    v_ai_summary := 'Performance report generated for period ' || p_period_start || ' to ' || p_period_end;
    v_ai_rating := CASE 
        WHEN (v_metrics->>'completion_rate')::NUMERIC > 90 THEN 5
        WHEN (v_metrics->>'completion_rate')::NUMERIC > 80 THEN 4
        WHEN (v_metrics->>'completion_rate')::NUMERIC > 70 THEN 3
        WHEN (v_metrics->>'completion_rate')::NUMERIC > 60 THEN 2
        ELSE 1
    END;
    
    -- Insert the performance report
    INSERT INTO performance_reports (
        id,
        user_id,
        period_start,
        period_end,
        report_type,
        metrics,
        conversation_metrics,
        quality_metrics,
        gemini_summary,
        ai_rating,
        created_at
    ) VALUES (
        v_report_id,
        p_user_id,
        p_period_start,
        p_period_end,
        p_report_type,
        v_metrics,
        v_conversation_metrics,
        v_quality_metrics,
        v_ai_summary,
        v_ai_rating,
        NOW()
    );
    
    RETURN v_report_id;
END;
$$ LANGUAGE plpgsql;

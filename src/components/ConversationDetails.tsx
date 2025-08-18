import React, { useState, useEffect } from 'react';
import { HiX, HiCalendar, HiClock, HiUser, HiDocumentText, HiExclamation, HiDownload } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import clsx from 'clsx';

interface ConversationAnalysis {
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

interface ConversationLog {
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
  employee?: {
    name: string;
    department: string;
    email?: string;
  };
}

interface ConversationDetailsProps {
  conversationId: string;
  onClose: () => void;
  isAdmin?: boolean;
}

const ConversationDetails: React.FC<ConversationDetailsProps> = ({
  conversationId,
  onClose,
  isAdmin = false
}) => {
  const [conversation, setConversation] = useState<ConversationLog | null>(null);
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Fetch conversation details on component mount
  useEffect(() => {
    fetchConversationDetails();
  }, [conversationId]);

  // Function to fetch conversation details
  const fetchConversationDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch conversation log
      const { data: conversationData, error: conversationError } = await supabase
        .from('conversation_logs')
        .select(`
          *,
          employee:users!conversation_logs_employee_id_fkey (
            name,
            department,
            email
          )
        `)
        .eq('id', conversationId)
        .single();
      
      if (conversationError) throw conversationError;
      
      // Fetch analysis
      const { data: analysisData, error: analysisError } = await supabase
        .from('conversation_analysis')
        .select('*')
        .eq('conversation_log_id', conversationId)
        .maybeSingle();
      
      if (analysisError) {
        throw analysisError;
      }
      
      setConversation(conversationData);
      setAnalysis(analysisData || null);
      
    } catch (err: any) {
      console.error('Error fetching conversation details:', err);
      setError(err.message || 'Failed to load conversation details');
    } finally {
      setLoading(false);
    }
  };

  // Function to save supervisor notes
  const handleSaveNotes = async () => {
    if (!conversation) return;
    
    try {
      setSavingNotes(true);
      
      // Update conversation log with supervisor notes
      const { error } = await supabase
        .from('conversation_logs')
        .update({ supervisor_notes: supervisorNotes })
        .eq('id', conversation.id);
      
      if (error) throw error;
      
      // Update local state
      setConversation(prev => prev ? { ...prev, supervisor_notes: supervisorNotes } : null);
      
    } catch (err: any) {
      console.error('Error saving notes:', err);
      alert('Failed to save notes. Please try again.');
    } finally {
      setSavingNotes(false);
    }
  };

  // Function to download transcript
  const handleDownloadTranscript = () => {
    if (!conversation?.transcribed_text) return;
    
    const element = document.createElement('a');
    const file = new Blob([conversation.transcribed_text], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcript_${conversation.id}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Function to format duration in MM:SS
  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Function to get tone badge color
  const getToneColor = (tone: string): string => {
    switch (tone) {
      case 'professional': return 'bg-green-100 text-green-800';
      case 'casual': return 'bg-blue-100 text-blue-800';
      case 'impatient': return 'bg-yellow-100 text-yellow-800';
      case 'rude': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Function to get quality badge color
  const getQualityColor = (quality: string): string => {
    switch (quality) {
      case 'good': return 'bg-green-100 text-green-800';
      case 'vague': return 'bg-yellow-100 text-yellow-800';
      case 'unhelpful': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Function to get sentiment score color
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="text-lg font-semibold">Conversation Details</h3>
            <button onClick={onClose}>
              <HiX className="w-6 h-6" />
            </button>
          </div>
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-2 text-gray-600">Loading conversation details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="text-lg font-semibold">Conversation Details</h3>
            <button onClick={onClose}>
              <HiX className="w-6 h-6" />
            </button>
          </div>
          <div className="p-8 text-center">
            <div className="text-red-600 mb-2">
              <HiExclamation className="w-8 h-8 inline-block" />
            </div>
            <p className="text-red-600">{error || 'Conversation not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold">
            Conversation with {conversation.customer_identifier || 'Unnamed Customer'}
          </h3>
          <button onClick={onClose}>
            <HiX className="w-6 h-6" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-4rem)]">
          {/* Metadata */}
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">Date & Time</h4>
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <HiCalendar className="w-4 h-4" />
                  {new Date(conversation.created_at).toLocaleString()}
                </p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">Duration</h4>
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <HiClock className="w-4 h-4" />
                  {formatDuration(conversation.duration || 0)}
                </p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">Employee</h4>
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <HiUser className="w-4 h-4" />
                  {conversation.employee?.name || 'Unknown'} ({conversation.employee?.department || 'Unknown'})
                </p>
              </div>
            </div>
          </div>
          
          {/* Audio player */}
          {conversation.audio_file_url && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Recording</h4>
              <audio src={conversation.audio_file_url} controls className="w-full" />
            </div>
          )}
          
          {/* Analysis section */}
          {analysis && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-medium text-gray-700">Analysis</h4>
                <div className="flex gap-2">
                  <span className={clsx(
                    'px-2 py-1 text-xs rounded-full',
                    getToneColor(analysis.overall_tone)
                  )}>
                    Tone: {analysis.overall_tone}
                  </span>
                  <span className={clsx(
                    'px-2 py-1 text-xs rounded-full',
                    getQualityColor(analysis.response_quality)
                  )}>
                    Quality: {analysis.response_quality}
                  </span>
                  <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                    Sentiment: {analysis.sentiment_score.toFixed(1)}
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-lg">
                {/* Left column */}
                <div>
                  {analysis.red_flags && analysis.red_flags.length > 0 && (
                    <div className="mb-4">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Issues Detected:</h5>
                      <ul className="text-sm text-red-600 list-disc list-inside space-y-1">
                        {analysis.red_flags.map((flag, index) => (
                          <li key={index}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {conversation.ai_summary && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">AI Summary:</h5>
                      <p className="text-sm text-gray-600">{conversation.ai_summary}</p>
                    </div>
                  )}
                </div>
                
                {/* Right column */}
                <div>
                  {analysis.recommendation && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Recommendations:</h5>
                      <p className="text-sm text-gray-600">{analysis.recommendation}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Transcript */}
          {conversation.transcribed_text && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <HiDocumentText className="w-4 h-4" />
                  Transcript
                </h4>
                <button
                  onClick={handleDownloadTranscript}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <HiDownload className="w-4 h-4" />
                  Download
                </button>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg max-h-80 overflow-y-auto">
                <p className="text-sm text-gray-600 whitespace-pre-line">
                  {conversation.transcribed_text}
                </p>
              </div>
            </div>
          )}
          
          {/* Supervisor notes (admin only) */}
          {isAdmin && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Supervisor Notes</h4>
              <textarea
                value={supervisorNotes}
                onChange={(e) => setSupervisorNotes(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                rows={4}
                placeholder="Add notes about this conversation..."
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                >
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          )}
          
          {/* Error message */}
          {conversation.status === 'error' && conversation.error_message && (
            <div className="bg-red-50 p-4 rounded-lg mb-6">
              <h4 className="text-sm font-medium text-red-700 mb-2">Error</h4>
              <p className="text-sm text-red-600">{conversation.error_message}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversationDetails;
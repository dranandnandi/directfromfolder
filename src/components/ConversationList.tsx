import React, { useState, useEffect } from 'react';
import { HiCalendar, HiClock, HiUser, HiDocumentText, HiExclamation, HiChevronDown, HiChevronRight, HiFilter } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import clsx from 'clsx';

interface ConversationAnalysis {
  overall_tone: string;
  response_quality: string;
  misbehavior_detected: boolean;
  red_flags: string[];
  sentiment_score: number;
  recommendation: string;
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
  };
  analysis?: ConversationAnalysis[];
}

interface ConversationListProps {
  isAdmin?: boolean;
  employeeId?: string;
  onSelectConversation?: (conversation: ConversationLog) => void;
}

const ConversationList: React.FC<ConversationListProps> = ({
  isAdmin = false,
  employeeId,
  onSelectConversation
}) => {
  const [conversations, setConversations] = useState<ConversationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    status: 'all',
    timeframe: 'week',
    misbehavior: 'all',
    employee: 'all'
  });
  const [employees, setEmployees] = useState<{id: string, name: string}[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch conversations on component mount and when filters change
  useEffect(() => {
    fetchConversations();
  }, [isAdmin, employeeId, filters]);

  // Fetch employees for admin filter
  useEffect(() => {
    if (isAdmin) {
      fetchEmployees();
    }
  }, [isAdmin]);

  // Function to fetch employees
  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setEmployees(data || []);
    } catch (err: any) {
      console.error('Error fetching employees:', err);
    }
  };

  // Function to fetch conversations
  const fetchConversations = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Start building the query
      let query = supabase
        .from('conversation_logs')
        .select(`
          *,
          employee:users!conversation_logs_employee_id_fkey (
            name,
            department
          ),
          analysis:conversation_analysis (
            overall_tone,
            response_quality,
            misbehavior_detected,
            red_flags,
            sentiment_score,
            recommendation
          )
        `);
      
      // Apply employee filter
      if (!isAdmin || (isAdmin && filters.employee !== 'all')) {
        query = query.eq('employee_id', isAdmin ? filters.employee : employeeId);
      }
      
      // Apply status filter
      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      
      // Apply timeframe filter
      const now = new Date();
      let startDate: Date;
      
      switch (filters.timeframe) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate = new Date(now);
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'all':
        default:
          startDate = new Date(0); // Beginning of time
          break;
      }
      
      query = query.gte('created_at', startDate.toISOString());
      
      // Apply misbehavior filter if status is 'analyzed'
      if (filters.misbehavior !== 'all' && filters.status === 'analyzed') {
        query = query.eq('analysis.misbehavior_detected', filters.misbehavior === 'yes');
      }
      
      // Order by creation date, newest first
      query = query.order('created_at', { ascending: false });
      
      // Execute the query
      const { data, error } = await query;
      
      if (error) throw error;
      
      // Filter by misbehavior if needed (since we can't do this in the query directly)
      let filteredData = data || [];
      if (filters.misbehavior !== 'all' && filters.status !== 'analyzed') {
        filteredData = filteredData.filter(conv => {
          const hasMisbehavior = conv.analysis && conv.analysis.some((a: ConversationAnalysis) => a.misbehavior_detected);
          return filters.misbehavior === 'yes' ? hasMisbehavior : !hasMisbehavior;
        });
      }
      
      setConversations(filteredData);
    } catch (err: any) {
      console.error('Error fetching conversations:', err);
      setError(err.message || 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  // Function to toggle expanded state of a conversation
  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Function to format duration in MM:SS
  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Function to get status badge color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'transcribed': return 'bg-purple-100 text-purple-800';
      case 'analyzed': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
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

  return (
    <div className="bg-white rounded-lg shadow-sm">
      {/* Header with filters */}
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="text-lg font-medium">Conversation Logs</h3>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 px-3 py-1 text-gray-600 hover:text-gray-800 border rounded-lg hover:bg-gray-50"
        >
          <HiFilter className="w-4 h-4" />
          <span>Filters</span>
          {showFilters ? <HiChevronDown className="w-4 h-4" /> : <HiChevronRight className="w-4 h-4" />}
        </button>
      </div>
      
      {/* Filters */}
      {showFilters && (
        <div className="p-4 border-b bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="transcribed">Transcribed</option>
                <option value="analyzed">Analyzed</option>
                <option value="error">Error</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Period</label>
              <select
                value={filters.timeframe}
                onChange={(e) => setFilters(prev => ({ ...prev, timeframe: e.target.value }))}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
                <option value="all">All Time</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Issues Detected</label>
              <select
                value={filters.misbehavior}
                onChange={(e) => setFilters(prev => ({ ...prev, misbehavior: e.target.value }))}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="all">All Conversations</option>
                <option value="yes">Issues Detected</option>
                <option value="no">No Issues</option>
              </select>
            </div>
            
            {isAdmin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <select
                  value={filters.employee}
                  onChange={(e) => setFilters(prev => ({ ...prev, employee: e.target.value }))}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="all">All Employees</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => setFilters({
                status: 'all',
                timeframe: 'week',
                misbehavior: 'all',
                employee: 'all'
              })}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Reset Filters
            </button>
          </div>
        </div>
      )}
      
      {/* Loading state */}
      {loading && (
        <div className="p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          <p className="mt-2 text-gray-600">Loading conversations...</p>
        </div>
      )}
      
      {/* Error state */}
      {error && (
        <div className="p-8 text-center">
          <div className="text-red-600 mb-2">
            <HiExclamation className="w-8 h-8 inline-block" />
          </div>
          <p className="text-red-600">{error}</p>
        </div>
      )}
      
      {/* Empty state */}
      {!loading && !error && conversations.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-gray-500">No conversations found matching the current filters.</p>
        </div>
      )}
      
      {/* Conversation list */}
      {!loading && !error && conversations.length > 0 && (
        <div className="divide-y divide-gray-200">
          {conversations.map(conversation => {
            const isExpanded = expandedIds.has(conversation.id);
            const hasAnalysis = conversation.analysis && conversation.analysis.length > 0;
            const analysis = hasAnalysis ? (conversation.analysis as ConversationAnalysis[])[0] : null;
            
            return (
              <div key={conversation.id} className="p-4 hover:bg-gray-50">
                {/* Conversation header - always visible */}
                <div 
                  className="flex justify-between items-start cursor-pointer"
                  onClick={() => toggleExpanded(conversation.id)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {conversation.customer_identifier || 'Unnamed Customer'}
                      </span>
                      <span className={clsx(
                        'px-2 py-0.5 text-xs rounded-full',
                        getStatusColor(conversation.status)
                      )}>
                        {conversation.status}
                      </span>
                      {analysis && analysis.misbehavior_detected && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800">
                          Issues Detected
                        </span>
                      )}
                    </div>
                    
                    <div className="text-sm text-gray-500 mt-1 flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <HiCalendar className="w-4 h-4" />
                        {new Date(conversation.created_at).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <HiClock className="w-4 h-4" />
                        {formatDuration(conversation.duration || 0)}
                      </span>
                      {isAdmin && (
                        <span className="flex items-center gap-1">
                          <HiUser className="w-4 h-4" />
                          {conversation.employee?.name || 'Unknown Employee'}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    {isExpanded ? (
                      <HiChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <HiChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                </div>
                
                {/* Expanded content */}
                {isExpanded && (
                  <div className="mt-4 space-y-4">
                    {/* Audio player */}
                    {conversation.audio_file_url && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Recording</h4>
                        <audio src={conversation.audio_file_url} controls className="w-full" />
                      </div>
                    )}
                    
                    {/* Analysis section */}
                    {analysis && (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Analysis</h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="flex flex-wrap gap-2 mb-3">
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
                            
                            {analysis.red_flags && analysis.red_flags.length > 0 && (
                              <div className="mb-3">
                                <h5 className="text-xs font-medium text-gray-700 mb-1">Issues Detected:</h5>
                                <ul className="text-xs text-red-600 list-disc list-inside">
                                  {analysis.red_flags.map((flag, index) => (
                                    <li key={index}>{flag}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                          
                          <div>
                            {analysis.recommendation && (
                              <div>
                                <h5 className="text-xs font-medium text-gray-700 mb-1">Recommendations:</h5>
                                <p className="text-xs text-gray-600">{analysis.recommendation}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Transcript */}
                    {conversation.transcribed_text && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <HiDocumentText className="w-4 h-4" />
                          Transcript
                        </h4>
                        <div className="bg-gray-50 p-4 rounded-lg max-h-60 overflow-y-auto">
                          <p className="text-sm text-gray-600 whitespace-pre-line">
                            {conversation.transcribed_text}
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* Summary */}
                    {conversation.ai_summary && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Summary</h4>
                        <div className="bg-blue-50 p-4 rounded-lg">
                          <p className="text-sm text-blue-700">{conversation.ai_summary}</p>
                        </div>
                      </div>
                    )}
                    
                    {/* Error message */}
                    {conversation.status === 'error' && conversation.error_message && (
                      <div className="bg-red-50 p-4 rounded-lg">
                        <h4 className="text-sm font-medium text-red-700 mb-2">Error</h4>
                        <p className="text-sm text-red-600">{conversation.error_message}</p>
                      </div>
                    )}
                    
                    {/* View details button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => onSelectConversation && onSelectConversation(conversation)}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        View Full Details
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ConversationList;
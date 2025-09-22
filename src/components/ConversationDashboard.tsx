import React, { useState, useEffect, useRef } from 'react';
import { HiDocumentText, HiChartBar, HiExclamation, HiClock } from 'react-icons/hi';
// import ConversationRecorder from './SimplifiedConversationRecorder'; // Hidden temporarily
import ConversationList from './ConversationList';
import ConversationDetails from './ConversationDetails';
import PunchInOut from './hr/PunchInOut';
import { supabase } from '../utils/supabaseClient';

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

interface ConversationDashboardProps {
  isAdmin?: boolean;
}

const ConversationDashboard: React.FC<ConversationDashboardProps> = ({
  isAdmin = false
}) => {
  const [activeTab, setActiveTab] = useState<'record' | 'list' | 'stats' | 'attendance'>('list');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ConversationLog | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    analyzed: 0,
    issuesDetected: 0,
    averageSentiment: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedCurrentUserRef = useRef<boolean>(false);

  // Fetch current user ID only once on component mount
  useEffect(() => {
    if (!hasFetchedCurrentUserRef.current) {
      console.trace("Fetching current user triggered");
      fetchCurrentUser();
      hasFetchedCurrentUserRef.current = true;
    }
  }, []);
  
  // Fetch stats only when currentUserId is available or isAdmin changes
  useEffect(() => {
    if (currentUserId || isAdmin) {
      console.trace("Fetching stats triggered");
      fetchStats();
    }
  }, [currentUserId, isAdmin]);

  // Function to fetch current user
  const fetchCurrentUser = async () => {
    try {
      console.trace("Fetching current user");
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', data.user.id)
          .single();
        
        if (userData) {
          console.log("Current user ID fetched:", userData.id);
          setCurrentUserId(userData.id);
        }
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
    }
  };

  // Function to fetch conversation stats
  const fetchStats = async () => {
    try {
      console.trace("Fetching conversation stats");
      setLoading(true);
      
      // Build the query based on admin status
      let query = supabase.from('conversation_logs').select('id, status');
      
      if (!isAdmin && currentUserId) {
        query = query.eq('employee_id', currentUserId);
      }
      
      // Get total count
      const { data: totalData, error: totalError } = await query;
      
      if (totalError) throw totalError;
      
      // Get analyzed count
      const { data: analyzedData, error: analyzedError } = await query
        .eq('status', 'analyzed');
      
      if (analyzedError) throw analyzedError;
      
      // Get issues detected count and average sentiment
      let issuesDetected = 0;
      let totalSentiment = 0;
      let sentimentCount = 0;
      
      if (analyzedData && analyzedData.length > 0) {
        const { data: analysisData, error: analysisError } = await supabase
          .from('conversation_analysis')
          .select('misbehavior_detected, sentiment_score')
          .in('conversation_log_id', analyzedData.map(log => log.id));
        
        if (analysisError) throw analysisError;
        
        if (analysisData) {
          issuesDetected = analysisData.filter(a => a.misbehavior_detected).length;
          
          analysisData.forEach(a => {
            if (a.sentiment_score !== null) {
              totalSentiment += a.sentiment_score;
              sentimentCount++;
            }
          });
        }
      }
      
      setStats({
        total: totalData?.length || 0,
        analyzed: analyzedData?.length || 0,
        issuesDetected,
        averageSentiment: sentimentCount > 0 ? totalSentiment / sentimentCount : 0
      });
      console.log("Stats fetched successfully:", {
        total: totalData?.length || 0,
        analyzed: analyzedData?.length || 0,
        issuesDetected,
        averageSentiment: sentimentCount > 0 ? totalSentiment / sentimentCount : 0
      });
      
    } catch (err: any) {
      console.error('Error fetching stats:', err);
      setError(err.message || 'Failed to load conversation statistics');
    } finally {
      setLoading(false);
    }
  };

  // Function to handle recording complete - Hidden with conversation recording
  // const handleRecordingComplete = () => {
  //   // Refresh stats
  //   fetchStats();
  //   // Switch to list view
  //   setActiveTab('list');
  // };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Conversation Monitoring</h2>
        
        {/* Tabs */}
        <div className="flex space-x-2">
          {/* Hidden temporarily - conversation recording */}
          {/* <button
            onClick={() => setActiveTab('record')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
              activeTab === 'record'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <HiMicrophone className="w-5 h-5" />
            <span className="hidden sm:inline">Record</span>
          </button> */}
          <button
            onClick={() => setActiveTab('attendance')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
              activeTab === 'attendance'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <HiClock className="w-5 h-5" />
            <span className="hidden sm:inline">Attendance</span>
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
              activeTab === 'list'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <HiDocumentText className="w-5 h-5" />
            <span className="hidden sm:inline">Conversations</span>
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
              activeTab === 'stats'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <HiChartBar className="w-5 h-5" />
            <span className="hidden sm:inline">Stats</span>
          </button>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Total Conversations</div>
          <div className="text-2xl font-semibold">{stats.total}</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Analyzed</div>
          <div className="text-2xl font-semibold">{stats.analyzed}</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Issues Detected</div>
          <div className="text-2xl font-semibold text-red-600">{stats.issuesDetected}</div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Avg. Sentiment</div>
          <div className={`text-2xl font-semibold ${
            stats.averageSentiment >= 0.7 ? 'text-green-600' :
            stats.averageSentiment >= 0.4 ? 'text-blue-600' :
            stats.averageSentiment >= 0 ? 'text-yellow-600' : 'text-red-600'
          }`}>
            {stats.averageSentiment.toFixed(1)}
          </div>
        </div>
      </div>
      
      {/* Main Content */}
      {/* Hidden temporarily - conversation recording */}
      {/* {activeTab === 'record' && (
        <ConversationRecorder
          onRecordingComplete={handleRecordingComplete}
        />
      )} */}
      
      {activeTab === 'list' && (
        <ConversationList
          isAdmin={isAdmin}
          employeeId={currentUserId || undefined}
          onSelectConversation={setSelectedConversation}
        />
      )}
      
      {activeTab === 'attendance' && <PunchInOut />}
      
      {activeTab === 'stats' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-medium mb-4">Conversation Statistics</h3>
          
          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <p className="mt-2 text-gray-600">Loading statistics...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <div className="text-red-600 mb-2">
                <HiExclamation className="w-8 h-8 inline-block" />
              </div>
              <p className="text-red-600">{error}</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Placeholder for charts - in a real app, you'd use a charting library */}
                <div className="bg-gray-50 p-4 rounded-lg h-64 flex items-center justify-center">
                  <p className="text-gray-500">Conversation Volume Chart</p>
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg h-64 flex items-center justify-center">
                  <p className="text-gray-500">Sentiment Trend Chart</p>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-4">Performance Metrics</h4>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">Conversation Quality</span>
                      <span className="text-sm text-gray-600">75%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: '75%' }}></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">Issue Rate</span>
                      <span className="text-sm text-gray-600">
                        {stats.analyzed > 0 ? ((stats.issuesDetected / stats.analyzed) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-red-600 h-2 rounded-full" 
                        style={{ 
                          width: `${stats.analyzed > 0 ? ((stats.issuesDetected / stats.analyzed) * 100) : 0}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">Analysis Completion</span>
                      <span className="text-sm text-gray-600">
                        {stats.total > 0 ? ((stats.analyzed / stats.total) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-600 h-2 rounded-full" 
                        style={{ 
                          width: `${stats.total > 0 ? ((stats.analyzed / stats.total) * 100) : 0}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Conversation Details Modal */}
      {selectedConversation && (
        <ConversationDetails
          conversationId={selectedConversation.id}
          onClose={() => setSelectedConversation(null)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};

export default ConversationDashboard;
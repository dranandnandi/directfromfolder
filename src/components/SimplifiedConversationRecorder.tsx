import React, { useState, useEffect, useRef } from 'react';
import { HiMicrophone, HiStop, HiUser, HiDocumentText, HiSparkles } from 'react-icons/hi';
import { ConversationTranscriber, stopAllSpeechRecognition } from '../utils/voiceUtils';
import { supabase } from '../utils/supabaseClient';

interface SimplifiedConversationRecorderProps {
  customerIdentifier?: string;
  onRecordingComplete?: (conversationLogId: string) => void;
}

const SimplifiedConversationRecorder: React.FC<SimplifiedConversationRecorderProps> = ({
  customerIdentifier,
  onRecordingComplete
}) => {
  // State management
  const [customerId, setCustomerId] = useState(customerIdentifier || '');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [realtimeTranscript, setRealtimeTranscript] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Audio visualization
  const [audioLevel, setAudioLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  
  // Transcriber reference
  const transcriber = useRef<ConversationTranscriber | null>(null);
  const recordingTimer = useRef<number | null>(null);

  // Get current user on mount
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', data.user.id)
          .single();
        
        if (userData) {
          setCurrentUserId(userData.id);
        }
      }
    };
    fetchCurrentUser();
  }, []);

  // Initialize transcriber
  useEffect(() => {
    if (!transcriber.current) {
      try {
        transcriber.current = new ConversationTranscriber(
          (transcript, isComplete) => {
            setRealtimeTranscript(transcript);
            if (isComplete) {
              console.log('Final transcript:', transcript);
            }
          },
          (error) => {
            console.error('Transcription error:', error);
            setError(`Transcription error: ${error}`);
            setIsRecording(false);
          }
        );
      } catch (error) {
        console.error('Failed to initialize transcriber:', error);
        setError('Speech recognition not supported in this browser');
      }
    }

    // Cleanup on unmount
    return () => {
      stopAllSpeechRecognition();
      stopAudioVisualization();
    };
  }, []);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      recordingTimer.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
    }

    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      // Cleanup audio visualization
      stopAudioVisualization();
    };
  }, [isRecording]);

  const startRecording = async () => {
    if (!transcriber.current || !currentUserId) {
      setError('Please ensure you are logged in and transcription is available');
      return;
    }

    if (!customerId.trim()) {
      setError('Please enter a customer identifier');
      return;
    }

    try {
      // Stop any existing speech recognition first
      stopAllSpeechRecognition();
      
      setError(null);
      setSuccess(null);
      setRealtimeTranscript('');
      setRecordingTime(0);
      setIsRecording(true);
      setIsListening(true);

      // Start audio visualization
      await startAudioVisualization();

      // Start transcription with audio recording
      transcriber.current.startTranscription();
    } catch (error) {
      console.error('Failed to start recording:', error);
      setError('Failed to start recording. Please check microphone permissions.');
      setIsRecording(false);
      setIsListening(false);
    }
  };

  const stopRecording = async () => {
    if (!transcriber.current || !isRecording) return;

    setIsRecording(false);
    setIsListening(false);
    setIsProcessing(true);

    // Stop audio visualization
    stopAudioVisualization();

    try {
      // Stop transcription and get results
      const result = transcriber.current.stopTranscription();
      
      if (!result.transcript.trim()) {
        setError('No speech was detected in the recording');
        setIsProcessing(false);
        return;
      }

      console.log('Recording completed:', {
        transcript: result.transcript,
        duration: result.duration,
        hasAudio: !!result.audioBlob
      });

      // Save conversation to database
      const saveResult = await transcriber.current.saveConversation(
        currentUserId!,
        customerId,
        result.transcript,
        result.audioBlob,
        result.duration
      );

      console.log('Conversation saved:', saveResult);

      // Get AI analysis
      try {
        await transcriber.current.getAIAnalysis(saveResult.conversationId, result.transcript);
        console.log('AI analysis completed');
      } catch (analysisError) {
        console.warn('AI analysis failed:', analysisError);
        // Continue anyway, conversation is saved
      }

      setSuccess(`Conversation recorded successfully! Duration: ${result.duration}s`);
      
      // Reset form
      setCustomerId('');
      setRealtimeTranscript('');
      setRecordingTime(0);

      // Notify parent component
      if (onRecordingComplete) {
        onRecordingComplete(saveResult.conversationId);
      }

    } catch (error) {
      console.error('Failed to save conversation:', error);
      setError(`Failed to save conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Audio visualization methods
  const startAudioVisualization = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      const updateAudioLevel = () => {
        if (!analyserRef.current || !isListening) return;
        
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const normalizedLevel = Math.min(average / 128, 1); // Normalize to 0-1
        
        setAudioLevel(normalizedLevel);
        
        if (isListening) {
          animationRef.current = requestAnimationFrame(updateAudioLevel);
        }
      };
      
      updateAudioLevel();
    } catch (error) {
      console.error('Failed to start audio visualization:', error);
    }
  };

  const stopAudioVisualization = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    setAudioLevel(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Check if transcription is supported
  const isSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  if (!isSupported) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800">
          Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center gap-2 mb-4">
        <HiMicrophone className="w-6 h-6 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">Record Conversation</h3>
      </div>

      {/* Customer ID Input */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
          <HiUser className="w-4 h-4" />
          Customer Identifier
        </label>
        <input
          type="text"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          placeholder="Enter customer ID or identifier"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isRecording || isProcessing}
        />
      </div>

      {/* Recording Controls */}
      <div className="flex items-center gap-4 mb-4">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={isProcessing || !currentUserId}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            <HiMicrophone className="w-5 h-5" />
            Start Recording
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors animate-pulse"
          >
            <HiStop className="w-5 h-5" />
            Stop Recording
          </button>
        )}

        {isRecording && (
          <div className="flex items-center gap-2 text-red-600">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="font-mono text-lg">{formatTime(recordingTime)}</span>
            
            {/* Audio Level Visualization */}
            <div className="flex items-center gap-1 ml-4">
              <span className="text-sm text-gray-600">Volume:</span>
              <div className="flex items-end gap-1 h-8">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className={`w-2 bg-gradient-to-t transition-all duration-100 ${
                      audioLevel * 10 > i
                        ? 'from-green-400 to-green-600'
                        : 'from-gray-200 to-gray-300'
                    }`}
                    style={{
                      height: `${8 + (i * 3)}px`,
                      opacity: audioLevel * 10 > i ? 1 : 0.3
                    }}
                  />
                ))}
              </div>
              <span className="text-xs text-gray-500 ml-2">
                {audioLevel > 0.1 ? '🎤 Detecting' : '🔇 Silent'}
              </span>
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center gap-2 text-blue-600">
            <HiSparkles className="w-5 h-5 animate-spin" />
            <span>Processing & Analyzing...</span>
          </div>
        )}
      </div>

      {/* Real-time Transcript */}
      {(isRecording || realtimeTranscript) && (
        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <HiDocumentText className="w-4 h-4" />
            Live Transcript
          </label>
          <div className="bg-gray-50 border rounded-lg p-3 min-h-[100px] max-h-[200px] overflow-y-auto">
            {realtimeTranscript ? (
              <p className="text-gray-900 whitespace-pre-wrap">{realtimeTranscript}</p>
            ) : (
              <p className="text-gray-500 italic">
                {isRecording ? 'Listening... Start speaking to see transcript here.' : 'Transcript will appear here...'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <p className="text-green-800 text-sm">{success}</p>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <h4 className="font-medium text-blue-900 mb-1">How it works:</h4>
        <ul className="text-blue-800 text-sm space-y-1">
          <li>• Enter a customer identifier and click "Start Recording"</li>
          <li>• Speak naturally - transcript appears in real-time</li>
          <li>• Click "Stop Recording" when finished</li>
          <li>• AI analysis happens automatically</li>
        </ul>
      </div>
    </div>
  );
};

export default SimplifiedConversationRecorder;

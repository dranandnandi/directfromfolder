import React, { useState, useEffect, useRef } from 'react';
import { HiMicrophone, HiStop, HiPause, HiPlay, HiTrash, HiUpload, HiUser, HiDocumentText } from 'react-icons/hi';
import { useAudioRecorder, formatRecordingTime } from '../utils/audioRecorder';
import { uploadConversationRecording } from '../utils/conversationUtils';
import { ConversationTranscriber } from '../utils/voiceUtils';
import { supabase } from '../utils/supabaseClient';

interface ConversationRecorderProps {
  customerIdentifier?: string;
  onRecordingComplete?: (conversationLogId: string) => void;
}

const ConversationRecorder: React.FC<ConversationRecorderProps> = ({
  customerIdentifier,
  onRecordingComplete
}) => {
  // State for customer identifier input
  const [customerId, setCustomerId] = useState(customerIdentifier || '');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // Real-time transcription state
  const [realtimeTranscript, setRealtimeTranscript] = useState('');
  const [isTranscriptionEnabled, setIsTranscriptionEnabled] = useState(false);
  const [transcriptionSupported, setTranscriptionSupported] = useState(false);
  const transcriber = useRef<ConversationTranscriber | null>(null);
  
  // Initialize transcription support check
  useEffect(() => {
    const checkTranscriptionSupport = () => {
      const supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
      setTranscriptionSupported(supported);
    };
    checkTranscriptionSupport();
  }, []);

  // Initialize transcriber when enabled
  useEffect(() => {
    if (isTranscriptionEnabled && transcriptionSupported && !transcriber.current) {
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
            setIsTranscriptionEnabled(false);
          }
        );
      } catch (error) {
        console.error('Failed to initialize transcriber:', error);
        setTranscriptionSupported(false);
      }
    }
  }, [isTranscriptionEnabled, transcriptionSupported]);
  
  // Use the audio recorder hook with VAD enabled
  const {
    isRecording,
    isPaused,
    recordingTime,
    audioBlob,
    audioUrl,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
    error: recordingError
  } = useAudioRecorder({
    mimeType: 'audio/webm',
    audioBitsPerSecond: 128000,
    autoChunkDuration: 5 * 60 * 1000, // 5 minutes auto-chunking
    vadOptions: {
      enabled: true,
      silenceThreshold: -50,
      silenceDuration: 2000, // 2 seconds of silence to auto-stop
      speakingThreshold: -35
    }
  });

  // Get current user ID on component mount
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

  // Enhanced recording functions with transcription
  const handleStartRecording = () => {
    startRecording();
    if (isTranscriptionEnabled && transcriber.current) {
      transcriber.current.startTranscription();
      setRealtimeTranscript('');
    }
  };

  const handleStopRecording = () => {
    stopRecording();
    if (isTranscriptionEnabled && transcriber.current) {
      const finalTranscript = transcriber.current.stopTranscription();
      console.log('Recording stopped. Final transcript:', finalTranscript);
    }
  };

  const handlePauseRecording = () => {
    pauseRecording();
    if (isTranscriptionEnabled && transcriber.current) {
      transcriber.current.stopTranscription();
    }
  };

  const handleResumeRecording = () => {
    resumeRecording();
    if (isTranscriptionEnabled && transcriber.current) {
      transcriber.current.startTranscription();
    }
  };

  const handleResetRecording = () => {
    resetRecording();
    if (transcriber.current) {
      transcriber.current.stopTranscription();
    }
    setRealtimeTranscript('');
  };

  // Function to handle upload
  const handleUpload = async () => {
    if (!audioBlob || !currentUserId) return;
    
    try {
      setIsUploading(true);
      setUploadProgress(0);
      setUploadError(null);
      
      // Simulate upload progress (in a real app, you'd use actual progress events)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          const newProgress = prev + 10;
          return newProgress >= 90 ? 90 : newProgress;
        });
      }, 300);
      
      // Upload the audio
      const { data, error } = await uploadConversationRecording(
        audioBlob,
        currentUserId,
        customerId || undefined
      );
      
      clearInterval(progressInterval);
      
      if (error) {
        throw error;
      }
      
      setUploadProgress(100);
      
      // Call the callback with the new conversation log ID
      if (onRecordingComplete && data) {
        onRecordingComplete(data.id);
      }
      
      // Reset after successful upload
      setTimeout(() => {
        resetRecording();
        setCustomerId('');
        setIsUploading(false);
        setUploadProgress(0);
      }, 1000);
      
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload recording');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
      <h3 className="text-lg font-medium">Conversation Recorder</h3>
      
      {/* Real-time Transcription Toggle */}
      {transcriptionSupported && (
        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center">
            <HiDocumentText className="text-blue-600 mr-2" />
            <span className="text-sm font-medium text-blue-800">Real-time Transcription</span>
          </div>
          <button
            onClick={() => setIsTranscriptionEnabled(!isTranscriptionEnabled)}
            disabled={isRecording}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              isTranscriptionEnabled
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            } disabled:opacity-50`}
          >
            {isTranscriptionEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      {/* Real-time Transcript Display */}
      {isTranscriptionEnabled && realtimeTranscript && (
        <div className="p-3 bg-gray-50 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Live Transcript:</h4>
          <div className="text-sm text-gray-600 max-h-32 overflow-y-auto">
            {realtimeTranscript}
          </div>
        </div>
      )}

      {/* Customer Identifier Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Customer Identifier
        </label>
        <div className="flex items-center">
          <HiUser className="text-gray-400 mr-2" />
          <input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="Enter customer ID or name"
            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            disabled={isRecording || isPaused || isUploading}
          />
        </div>
      </div>
      
      {/* Recording Timer */}
      <div className="flex justify-center">
        <div className={`text-2xl font-mono ${isRecording && !isPaused ? 'text-red-600' : 'text-gray-700'}`}>
          {formatRecordingTime(recordingTime)}
        </div>
      </div>
      
      {/* Recording Controls */}
      <div className="flex justify-center space-x-4">
        {!isRecording && !audioBlob && (
          <button
            onClick={handleStartRecording}
            disabled={isUploading}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-300"
          >
            <HiMicrophone className="w-5 h-5" />
            Start Recording
          </button>
        )}
        
        {isRecording && !isPaused && (
          <>
            <button
              onClick={handlePauseRecording}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
            >
              <HiPause className="w-5 h-5" />
              Pause
            </button>
            <button
              onClick={handleStopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              <HiStop className="w-5 h-5" />
              Stop
            </button>
          </>
        )}
        
        {isRecording && isPaused && (
          <>
            <button
              onClick={handleResumeRecording}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <HiPlay className="w-5 h-5" />
              Resume
            </button>
            <button
              onClick={handleStopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              <HiStop className="w-5 h-5" />
              Stop
            </button>
          </>
        )}
        
        {audioBlob && !isRecording && (
          <>
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
            >
              <HiUpload className="w-5 h-5" />
              {isUploading ? `Uploading ${uploadProgress}%` : 'Upload Recording'}
            </button>
            <button
              onClick={handleResetRecording}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-300"
            >
              <HiTrash className="w-5 h-5" />
              Discard
            </button>
          </>
        )}
      </div>
      
      {/* Audio Playback */}
      {audioUrl && !isRecording && (
        <div className="mt-4">
          <audio src={audioUrl} controls className="w-full" />
        </div>
      )}
      
      {/* Error Messages */}
      {(recordingError || uploadError) && (
        <div className="bg-red-50 text-red-600 p-3 rounded-md">
          {recordingError || uploadError}
        </div>
      )}
      
      {/* Voice Activity Detection Indicator */}
      {isRecording && !isPaused && (
        <div className="flex justify-center mt-2">
          <div className="flex space-x-1">
            <div className="w-2 h-8 bg-red-400 rounded-full animate-pulse"></div>
            <div className="w-2 h-8 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-2 h-8 bg-red-600 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
            <div className="w-2 h-8 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }}></div>
            <div className="w-2 h-8 bg-red-400 rounded-full animate-pulse" style={{ animationDelay: '0.8s' }}></div>
          </div>
        </div>
      )}
      
      {/* Instructions */}
      <div className="text-sm text-gray-500 mt-4">
        <p>
          {!isRecording && !audioBlob 
            ? "Click 'Start Recording' to begin capturing the conversation. The recording will automatically stop after 5 minutes of continuous recording or 2 seconds of silence."
            : isRecording 
              ? "Recording in progress. Speak clearly and ensure both sides of the conversation are audible."
              : "Review the recording and upload it for analysis, or discard and try again."}
        </p>
      </div>
    </div>
  );
};

export default ConversationRecorder;
import { useEffect, useState, useRef } from 'react';

// Interface for the audio recorder hook return value
export interface AudioRecorderHook {
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  resetRecording: () => void;
  error: string | null;
}

// Voice Activity Detection (VAD) configuration
interface VADOptions {
  enabled: boolean;
  silenceThreshold: number; // in decibels
  silenceDuration: number; // in milliseconds
  speakingThreshold: number; // in decibels
}

// Options for the audio recorder
interface AudioRecorderOptions {
  mimeType?: string;
  audioBitsPerSecond?: number;
  autoChunkDuration?: number; // in milliseconds, 0 means no auto-chunking
  vadOptions?: VADOptions;
}

// Default options
const defaultOptions: AudioRecorderOptions = {
  mimeType: 'audio/webm',
  audioBitsPerSecond: 128000,
  autoChunkDuration: 0, // No auto-chunking by default
  vadOptions: {
    enabled: false,
    silenceThreshold: -50, // dB
    silenceDuration: 1500, // ms
    speakingThreshold: -35 // dB
  }
};

/**
 * Custom hook for recording audio with advanced features like
 * Voice Activity Detection and auto-chunking
 */
export const useAudioRecorder = (options: AudioRecorderOptions = {}): AudioRecorderHook => {
  // Merge default options with provided options
  const mergedOptions = { ...defaultOptions, ...options };
  
  // State variables
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs to hold values that shouldn't trigger re-renders
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const vadTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const isSilentRef = useRef<boolean>(true);
  const autoChunkTimeoutRef = useRef<number | null>(null);

  // Timer management using useEffect and setInterval
  useEffect(() => {
    let intervalId: number | null = null;

    if (isRecording && !isPaused) {
      intervalId = window.setInterval(() => {
        setRecordingTime(Date.now() - startTimeRef.current);
      }, 100);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isRecording, isPaused]);
  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      resetRecording();
    };
  }, []);

  // Function to detect voice activity
  const detectVoiceActivity = () => {
    if (!analyserRef.current || !dataArrayRef.current || !mergedOptions.vadOptions?.enabled) return;
    
    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < dataArrayRef.current.length; i++) {
      sum += dataArrayRef.current[i];
    }
    const average = sum / dataArrayRef.current.length;
    
    // Convert to decibels (rough approximation)
    const db = 20 * Math.log10(average / 255);
    
    // Check if speaking or silent
    if (db > mergedOptions.vadOptions.speakingThreshold && isSilentRef.current) {
      // Voice detected
      isSilentRef.current = false;
      if (vadTimeoutRef.current) {
        window.clearTimeout(vadTimeoutRef.current);
        vadTimeoutRef.current = null;
      }
    } else if (db < mergedOptions.vadOptions.silenceThreshold && !isSilentRef.current) {
      // Silence detected
      if (!vadTimeoutRef.current) {
        vadTimeoutRef.current = window.setTimeout(() => {
          // If still recording and silence persists, stop recording
          if (isRecording && !isPaused) {
            stopRecording();
          }
          isSilentRef.current = true;
          vadTimeoutRef.current = null;
        }, mergedOptions.vadOptions.silenceDuration);
      }
    } else if (db > mergedOptions.vadOptions.silenceThreshold && vadTimeoutRef.current) {
      // Voice detected again before timeout
      window.clearTimeout(vadTimeoutRef.current);
      vadTimeoutRef.current = null;
    }
    
    // Continue monitoring if still recording
    if (isRecording && !isPaused) {
      requestAnimationFrame(detectVoiceActivity);
    }
  };

  // Function to set up VAD
  const setupVAD = (stream: MediaStream) => {
    if (!mergedOptions.vadOptions?.enabled) return;
    
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);
      
      // Start monitoring
      detectVoiceActivity();
    } catch (err) {
      console.error('Error setting up VAD:', err);
      // Continue without VAD
    }
  };


  // Function to start recording
  const startRecording = async (): Promise<void> => {
    try {
      // Reset previous recording
      resetRecording();
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Set up VAD if enabled
      if (mergedOptions.vadOptions?.enabled) {
        setupVAD(stream);
      }
      
      // Create MediaRecorder
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: mergedOptions.mimeType || 'audio/webm',
        audioBitsPerSecond: mergedOptions.audioBitsPerSecond
      });
      
      // Set up event handlers
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = () => {
        // Create blob from chunks
        const blob = new Blob(chunksRef.current, { type: mergedOptions.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        
        // Create URL for the blob
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        
        // Clean up
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        setIsRecording(false);
        setIsPaused(false);
        
        if (vadTimeoutRef.current) {
          clearTimeout(vadTimeoutRef.current);
          vadTimeoutRef.current = null;
        }
        
        if (autoChunkTimeoutRef.current) {
          clearTimeout(autoChunkTimeoutRef.current);
          autoChunkTimeoutRef.current = null;
        }
      };
      
      // Start recording
      mediaRecorderRef.current.start();
      setIsRecording(true);
      startTimeRef.current = Date.now();
      
      // Set up auto-chunking if enabled
      if (mergedOptions.autoChunkDuration && mergedOptions.autoChunkDuration > 0) {
        autoChunkTimeoutRef.current = window.setTimeout(() => {
          if (isRecording && !isPaused) {
            stopRecording();
          }
        }, mergedOptions.autoChunkDuration);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start recording');
      console.error('Error starting recording:', err);
    }
  };

  // Function to stop recording
  const stopRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Function to pause recording
  const pauseRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  // Function to resume recording
  const resumeRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      startTimeRef.current = Date.now() - recordingTime;
    }
  };

  // Function to reset recording
  const resetRecording = (): void => {
    // Stop any ongoing recording
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    // Stop all tracks in the stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Clear all timeouts
    if (vadTimeoutRef.current) {
      clearTimeout(vadTimeoutRef.current);
      vadTimeoutRef.current = null;
    }
    
    if (autoChunkTimeoutRef.current) {
      clearTimeout(autoChunkTimeoutRef.current);
      autoChunkTimeoutRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
    }
    
    // Revoke any existing audio URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    
    // Reset state
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setError(null);
    
    // Reset refs
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    startTimeRef.current = 0;
    isSilentRef.current = true;
  };

  return {
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
    error
  };
};

/**
 * Utility function to format recording time in MM:SS format
 */
export const formatRecordingTime = (milliseconds: number): string => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};
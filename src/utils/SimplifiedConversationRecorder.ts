// Type definitions for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// Simplified Frontend Audio Recording with Direct Analysis
import { supabase } from '../utils/supabaseClient';

interface ConversationData {
  employeeId: string;
  customerIdentifier: string;
  transcript: string;
  duration: number;
}

class SimplifiedConversationRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recognition: any = null;
  private transcript = '';
  private startTime = 0;

  constructor() {
    // Use browser's built-in speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.setupSpeechRecognition();
    }
  }

  private setupSpeechRecognition() {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        }
      }
      this.transcript += finalTranscript;
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
    };
  }

  async startRecording(): Promise<void> {
    try {
      // Start both audio recording (for backup) and speech recognition
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.mediaRecorder = new MediaRecorder(stream);
      this.startTime = Date.now();
      
      // Start speech recognition immediately
      if (this.recognition) {
        this.recognition.start();
      }

      this.mediaRecorder.start();
      
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  async stopRecording(): Promise<ConversationData> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No recording in progress'));
        return;
      }

      const duration = (Date.now() - this.startTime) / 1000;

      // Stop speech recognition
      if (this.recognition) {
        this.recognition.stop();
      }

      this.mediaRecorder.stop();

      this.mediaRecorder.ondataavailable = async () => {
        try {
          // We have both transcript and audio blob
          const conversationData: ConversationData = {
            employeeId: '00000000-0000-0000-0000-000000000018', // Get from context
            customerIdentifier: 'customer_' + Date.now(),
            transcript: this.transcript.trim(),
            duration: Math.round(duration)
          };

          resolve(conversationData);
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  // Save conversation and get AI analysis
  async saveAndAnalyze(conversationData: ConversationData) {
    try {
      // 1. Save to conversation_logs table directly
      const { data: logData, error: logError } = await supabase
        .from('conversation_logs')
        .insert({
          employee_id: conversationData.employeeId,
          customer_identifier: conversationData.customerIdentifier,
          transcribed_text: conversationData.transcript,
          duration: conversationData.duration,
          status: 'transcribed'
        })
        .select()
        .single();

      if (logError) throw logError;

      // 2. Get AI analysis via simple function call
      const { data: analysisData, error: analysisError } = await supabase.functions
        .invoke('simple-analyze', {
          body: { 
            conversationId: logData.id,
            transcript: conversationData.transcript 
          }
        });

      if (analysisError) throw analysisError;

      return { conversationId: logData.id, analysis: analysisData };

    } catch (error) {
      console.error('Error saving conversation:', error);
      throw error;
    }
  }
}

export default SimplifiedConversationRecorder;

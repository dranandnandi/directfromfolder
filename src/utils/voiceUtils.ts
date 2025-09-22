declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
    globalRecognition: any;
  }
}

// Global cleanup function to stop all speech recognition
export function stopAllSpeechRecognition() {
  try {
    // Stop speech synthesis
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    
    // Stop any global recognition instance
    if (window.globalRecognition) {
      window.globalRecognition.stop();
      window.globalRecognition = null;
    }
    
    console.log('All speech recognition instances stopped');
  } catch (error) {
    console.warn('Error stopping speech recognition:', error);
  }
}

export class VoiceCommandManager {
  private recognition: any;
  private isListening: boolean = false;
  private onResultCallback: (text: string) => void;
  private onErrorCallback: (error: string) => void;

  constructor(onResult: (text: string) => void, onError: (error: string) => void) {
    // Stop any existing recognition instances first
    this.stopAnyExistingRecognition();
    
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      this.recognition = new (window.webkitSpeechRecognition || window.SpeechRecognition)();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.onResultCallback = onResult;
      this.onErrorCallback = onError;

      this.recognition.onresult = (event: any) => {
        if (event.results && event.results[0]) {
          const text = event.results[0][0].transcript;
          this.onResultCallback(text);
        }
      };

      this.recognition.onerror = (event: any) => {
        this.isListening = false;
        this.onErrorCallback(event.error);
      };

      this.recognition.onend = () => {
        this.isListening = false;
      };
    } else {
      throw new Error('Speech recognition not supported in this browser');
    }
  }

  private stopAnyExistingRecognition() {
    // Force stop any existing speech recognition
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      // Try to access and stop any global recognition instance
      if ((window as any).globalRecognition) {
        (window as any).globalRecognition.stop();
        (window as any).globalRecognition = null;
      }
    } catch (error) {
      // Ignore errors, just ensuring cleanup
    }
  }

  startListening() {
    if (!this.isListening) {
      try {
        // Stop any existing recognition first
        stopAllSpeechRecognition();
        
        // Wait a moment before starting
        setTimeout(() => {
          this.isListening = true;
          this.recognition.start();
        }, 100);
      } catch (error) {
        this.isListening = false;
        this.onErrorCallback('Failed to start listening');
      }
    }
  }

  stopListening() {
    if (this.isListening) {
      try {
        this.isListening = false;
        this.recognition.stop();
      } catch (error) {
        // Ignore errors during stop
      }
    }
  }

  isSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }
}

/**
 * Enhanced real-time conversation transcriber with audio recording
 */
export class ConversationTranscriber {
  private recognition: any;
  private isTranscribing: boolean = false;
  private transcript: string = '';
  private onTranscriptUpdate: (transcript: string, isComplete: boolean) => void;
  private onError: (error: string) => void;
  private restartTimeout: number | null = null;
  private maxSilenceTime: number = 3000; // 3 seconds of silence before restart
  
  // Audio recording properties
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private startTime: number = 0;

  constructor(
    onTranscriptUpdate: (transcript: string, isComplete: boolean) => void,
    onError: (error: string) => void
  ) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onError = onError;
    this.initRecognition();
  }

  private initRecognition() {
    if (!this.isSupported()) {
      throw new Error('Speech recognition not supported in this browser');
    }

    // Stop any existing recognition first
    this.forceStopAllRecognition();

    this.recognition = new (window.webkitSpeechRecognition || window.SpeechRecognition)();
    
    // Use same configuration as VoiceCommandManager to avoid conflicts
    this.recognition.continuous = false;  // Changed from true
    this.recognition.interimResults = true; // Keep for real-time display
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        this.transcript += finalTranscript;
        this.onTranscriptUpdate(this.transcript, false);
      }

      // Show interim results for real-time feedback
      if (interimTranscript) {
        this.onTranscriptUpdate(this.transcript + interimTranscript, false);
      }

      // Reset silence timeout
      this.resetSilenceTimeout();
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        // Automatically restart for common errors
        this.restartRecognition();
      } else if (event.error === 'not-allowed') {
        this.onError('Microphone access denied');
      } else {
        this.onError(`Speech recognition error: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      if (this.isTranscribing) {
        // Automatically restart since we're using non-continuous mode
        setTimeout(() => this.restartRecognition(), 100);
      }
    };

    this.recognition.onstart = () => {
      console.log('Speech recognition started');
    };
  }

  private resetSilenceTimeout() {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    
    this.restartTimeout = window.setTimeout(() => {
      if (this.isTranscribing) {
        this.restartRecognition();
      }
    }, this.maxSilenceTime);
  }

  private restartRecognition() {
    if (this.isTranscribing) {
      try {
        this.recognition.stop();
        setTimeout(() => {
          if (this.isTranscribing) {
            this.recognition.start();
          }
        }, 100);
      } catch (error) {
        console.error('Error restarting recognition:', error);
      }
    }
  }

  startTranscription(): void {
    if (this.isTranscribing) return;

    // Force stop any existing instances first
    this.forceStopAllRecognition();
    
    // Wait a moment before starting new instance
    setTimeout(() => {
      this.isTranscribing = true;
      this.transcript = '';
      this.audioChunks = [];
      this.startTime = Date.now();
      
      // Start audio recording
      this.startAudioRecording();
      
      try {
        this.recognition.start();
        this.resetSilenceTimeout();
      } catch (error) {
        this.isTranscribing = false;
        this.onError('Failed to start speech recognition: ' + error);
      }
    }, 200); // Give time for cleanup
  }

  stopTranscription(): { transcript: string; audioBlob: Blob | null; duration: number } {
    this.isTranscribing = false;
    
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    try {
      this.recognition.stop();
    } catch (error) {
      console.error('Error stopping recognition:', error);
    }

    // Stop audio recording and get the blob
    const audioBlob = this.stopAudioRecording();
    const duration = this.getRecordingDuration();

    // Return final transcript
    this.onTranscriptUpdate(this.transcript, true);
    
    return {
      transcript: this.transcript.trim(),
      audioBlob,
      duration
    };
  }

  getCurrentTranscript(): string {
    return this.transcript.trim();
  }

  isSupported(): boolean {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  setLanguage(language: string): void {
    this.recognition.lang = language;
  }

  setSilenceTimeout(ms: number): void {
    this.maxSilenceTime = ms;
  }

  // Force cleanup of all speech recognition instances
  private forceStopAllRecognition() {
    try {
      // Stop speech synthesis
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      
      // Stop any existing recognition instance
      if (this.recognition) {
        this.recognition.stop();
      }
      
      // Clear any global references
      if ((window as any).globalRecognition) {
        (window as any).globalRecognition.stop();
        (window as any).globalRecognition = null;
      }
      
      // Wait a moment for cleanup
      setTimeout(() => {
        this.isTranscribing = false;
      }, 100);
    } catch (error) {
      console.warn('Error during recognition cleanup:', error);
    }
  }

  // Audio recording methods
  private async startAudioRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(1000); // Collect data every second
    } catch (error) {
      console.error('Failed to start audio recording:', error);
    }
  }

  private stopAudioRecording(): Blob | null {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      
      // Stop all tracks to release microphone
      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    }

    if (this.audioChunks.length > 0) {
      return new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
    }
    return null;
  }

  getRecordingDuration(): number {
    if (this.startTime === 0) return 0;
    return Math.round((Date.now() - this.startTime) / 1000);
  }

  // Save conversation to database with optional audio file
  async saveConversation(
    employeeId: string, 
    customerIdentifier: string,
    transcript: string,
    audioBlob: Blob | null,
    duration: number
  ): Promise<{ conversationId: string; audioUrl?: string }> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!
    );

    try {
      // 1. Save conversation log first
      const { data: logData, error: logError } = await supabase
        .from('conversation_logs')
        .insert({
          employee_id: employeeId,
          customer_identifier: customerIdentifier,
          transcribed_text: transcript,
          duration: duration,
          status: 'transcribed'
        })
        .select()
        .single();

      if (logError) throw logError;

      let audioUrl: string | undefined;

      // 2. Upload audio file if available
      if (audioBlob) {
        const fileName = `${employeeId}_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('conversation-recordings')
          .upload(fileName, audioBlob, {
            contentType: 'audio/webm'
          });

        if (uploadError) {
          console.warn('Audio upload failed:', uploadError);
        } else {
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('conversation-recordings')
            .getPublicUrl(uploadData.path);
          
          audioUrl = urlData.publicUrl;

          // Update conversation log with audio URL
          await supabase
            .from('conversation_logs')
            .update({ audio_file_url: audioUrl })
            .eq('id', logData.id);
        }
      }

      return { 
        conversationId: logData.id, 
        audioUrl 
      };

    } catch (error) {
      console.error('Error saving conversation:', error);
      throw error;
    }
  }

  // Get AI analysis for conversation
  async getAIAnalysis(conversationId: string, transcript: string): Promise<any> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!
    );

    try {
      const { data, error } = await supabase.functions.invoke('simple-analyze', {
        body: {
          conversationId,
          transcript
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting AI analysis:', error);
      throw error;
    }
  }
}
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

export class VoiceCommandManager {
  private recognition: any;
  private isListening: boolean = false;
  private onResultCallback: (text: string) => void;
  private onErrorCallback: (error: string) => void;

  constructor(onResult: (text: string) => void, onError: (error: string) => void) {
    if ('webkitSpeechRecognition' in window) {
      this.recognition = new window.webkitSpeechRecognition();
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

  startListening() {
    if (!this.isListening) {
      try {
        this.isListening = true;
        this.recognition.start();
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
    return 'webkitSpeechRecognition' in window;
  }
}
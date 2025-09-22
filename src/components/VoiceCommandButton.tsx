import React, { useState, useEffect } from 'react';
import { HiMicrophone } from 'react-icons/hi';
import { VoiceCommandManager } from '../utils/voiceUtils';

interface VoiceCommandButtonProps {
  onVoiceCommand: (text: string) => void;
}

const VoiceCommandButton: React.FC<VoiceCommandButtonProps> = ({ onVoiceCommand }) => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceManager, setVoiceManager] = useState<VoiceCommandManager | null>(null);

  useEffect(() => {
    // Cleanup function
    return () => {
      if (voiceManager) {
        voiceManager.stopListening();
      }
    };
  }, [voiceManager]);

  const initializeVoiceManager = () => {
    if (!voiceManager) {
      try {
        const manager = new VoiceCommandManager(
          (text) => {
            onVoiceCommand(text);
            setIsListening(false);
          },
          (error) => {
            setError(error);
            setIsListening(false);
          }
        );
        setVoiceManager(manager);
        return manager;
      } catch (err) {
        setError('Voice commands not supported in this browser');
        return null;
      }
    }
    return voiceManager;
  };

  const handleClick = () => {
    const manager = initializeVoiceManager();
    if (!manager) return;

    if (!isListening) {
      setIsListening(true);
      manager.startListening();
    } else {
      setIsListening(false);
      manager.stopListening();
    }
  };

  if (error) {
    return (
      <button
        className="bg-gray-100 text-gray-400 px-3 py-2 rounded-lg cursor-not-allowed min-h-[44px] flex items-center"
        disabled
        title={error}
      >
        <HiMicrophone className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`px-3 sm:px-3 py-2 sm:py-2 rounded-lg flex items-center gap-2 transition-colors min-h-[44px] ${
        isListening
          ? 'bg-red-100 text-red-600 animate-pulse'
          : 'bg-blue-100 text-blue-600 hover:bg-blue-200 active:bg-blue-300'
      }`}
      title={isListening ? 'Stop listening' : 'Start voice command'}
    >
      <HiMicrophone className="w-5 h-5 sm:w-5 sm:h-5" />
      {isListening && <span className="text-sm hidden sm:inline">Listening...</span>}
      {isListening && <span className="text-xs sm:hidden">●</span>}
    </button>
  );
};

export default VoiceCommandButton;
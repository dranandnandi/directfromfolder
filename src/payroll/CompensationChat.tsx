import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';

interface CompensationComponent {
  component_code: string;
  amount: number;
}

interface CompensationData {
  ctc_annual: number;
  pay_schedule: "monthly" | "weekly" | "biweekly";
  currency: string;
  components: CompensationComponent[];
  notes: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  compensation?: CompensationData;
  timestamp: Date;
}

interface CompensationChatProps {
  currentCompensation?: CompensationData;
  availableComponents: Array<{
    code: string;
    name: string;
    type: "earning" | "deduction" | "employer_cost";
  }>;
  onCompensationUpdate: (compensation: CompensationData) => void;
  onConversationComplete: () => void;
}

export default function CompensationChat({
  currentCompensation,
  availableComponents,
  onCompensationUpdate,
  onConversationComplete
}: CompensationChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: "Hi! I'm here to help you structure compensation packages. You can tell me things like:\n\n• \"Create compensation for 12 lacs CTC monthly with all regular components\"\n• \"Adjust the HRA to 15,000\"\n• \"Add medical allowance of 2500\"\n\nWhat would you like to do?",
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const callEdgeFunction = async (userInput: string) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-compensation-assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        user_input: userInput,
        current_compensation: currentCompensation,
        conversation_history: messages.slice(-6), // Last 6 messages for context
        available_components: availableComponents
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    // Check if the response has an error field (indicates an error response)
    if (result.error) {
      throw new Error(result.error);
    }

    // The edge function returns the compensation response directly
    return result;
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const aiResponse = await callEdgeFunction(userMessage.content);

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: aiResponse.explanation,
        compensation: aiResponse.compensation,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Update the compensation form with AI suggestions
      if (aiResponse.compensation) {
        onCompensationUpdate(aiResponse.compensation);
      }

      // Check if conversation is complete
      if (aiResponse.conversation_complete) {
        setTimeout(() => {
          onConversationComplete();
        }, 1000);
      }

    } catch (error: any) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const handleAiResponse = (aiResponse: any) => {
    if (aiResponse.compensation) {
      const { ctc_annual, pay_schedule, currency, components, notes } = aiResponse.compensation;
      
      // Update form fields
      onFormUpdate({
        ctcAnnual: ctc_annual,
        paySchedule: pay_schedule,
        currency: currency,
        notes: notes || ''
      });

      // Process components - merge duplicates and handle deductions properly
      const processedComponents: Array<{ component_code: string; amount: number }> = [];
      const componentMap = new Map<string, number>();

      // First, sum up all amounts for each component code
      components.forEach((comp: { component_code: string; amount: number }) => {
        const existing = componentMap.get(comp.component_code) || 0;
        componentMap.set(comp.component_code, existing + comp.amount);
      });

      // Convert map back to array, filtering out zero amounts
      componentMap.forEach((amount, code) => {
        if (amount !== 0) {
          processedComponents.push({
            component_code: code,
            amount: amount
          });
        }
      });

      // Update component lines
      onComponentsUpdate(processedComponents);
    }

    // Add AI message to conversation
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      type: 'bot',
      content: aiResponse.explanation || 'Compensation structure updated.',
      timestamp: new Date()
    }]);

    setIsComplete(aiResponse.conversation_complete || false);
    setIsLoading(false);
  };

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      <div className="p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600" />
          <h3 className="font-medium text-gray-900">AI Compensation Assistant</h3>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Describe your compensation needs and I'll help structure the package
        </p>
      </div>

      <div className="h-80 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
            )}
            
            <div className={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${
              message.role === 'user' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-900'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              
              {/* Show compensation preview if available */}
              {message.compensation && (
                <div className="mt-2 p-2 bg-white bg-opacity-20 rounded text-xs">
                  <div className="font-medium">Suggested Structure:</div>
                  <div>CTC: {formatCurrency(message.compensation.ctc_annual)}/year</div>
                  <div>Components: {message.compensation.components.length}</div>
                </div>
              )}
              
              <div className="text-xs opacity-75 mt-1">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {message.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-blue-600" />
            </div>
            <div className="bg-gray-100 px-3 py-2 rounded-lg">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm text-gray-600">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe your compensation requirements..."
            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            disabled={isLoading}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        
        <div className="mt-2 flex flex-wrap gap-1">
          {['12 lacs CTC monthly', 'Add HRA 15000', 'Include PF and ESI', 'Done'].map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setInputValue(suggestion)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
              disabled={isLoading}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
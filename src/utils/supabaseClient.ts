import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create a Supabase client with automatic retries
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  global: {
    headers: {
      'x-application-name': 'healthcare-task-manager'
    }
  },
  db: {
    schema: 'public'
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

// Add a helper function to handle retries
function isErrorWithMessage(error: any): error is { message: string } {
  return error && typeof error === 'object' && typeof error.message === 'string';
}

export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  delay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (i > 0) {
        console.log(`Retry attempt ${i+1}/${maxRetries}`);
      } else {
        console.log('Executing operation (first attempt)');
      }
      return await operation();
    } catch (error) {
      lastError = error;
      console.error(`Operation failed (attempt ${i+1}/${maxRetries}):`, error);
      
      // Don't retry on authentication or permission errors
      if (isErrorWithMessage(error) && (
          error.message.includes('JWT') || 
          error.message.includes('permission') || 
          error.message.includes('policy') || 
          error.message.includes('auth') ||
          error.message.includes('401') ||
          error.message.includes('403'))) {
        console.warn('Not retrying due to auth/permission error');
        break;
      }
      
      if (i < maxRetries - 1) {
        const retryDelay = delay * Math.pow(2, i);
        console.log(`Waiting ${retryDelay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay)); 
      } else {
        console.warn('Maximum retry attempts reached');
      }
    }
  }
  
  console.error('All retry attempts failed');
  throw lastError;
}
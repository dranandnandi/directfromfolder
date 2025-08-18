/**
 * Retry utility for handling transient network failures
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on certain types of errors
      if (error instanceof Error) {
        // Don't retry on authentication errors or permission errors
        if (error.message.includes('JWT') || 
            error.message.includes('permission') || 
            error.message.includes('unauthorized')) {
          throw error;
        }
      }

      if (attempt === maxRetries) {
        break;
      }

      // Wait before retrying with exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }

  throw lastError!;
}
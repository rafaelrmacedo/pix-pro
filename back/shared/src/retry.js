/**
 * Exponential backoff utility with jitter.
 */
async function withRetry(operation, options = {}) {
  const {
    maxRetries = 4,
    initialDelay = 1000,
    factor = 2,
    useJitter = true,
    onRetry = (err, attempt) => { }
  } = options;

  let attempt = 1;
  let delay = initialDelay;

  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      onRetry(error, attempt);

      // Exponential backoff
      const jitter = useJitter ? Math.random() * 0.1 * delay : 0;
      const sleepTime = delay + jitter;

      await new Promise(resolve => setTimeout(resolve, sleepTime));

      delay *= factor;
      attempt++;
    }
  }
}

export default { withRetry };
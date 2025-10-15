export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  let timeoutHandle: Timer | undefined

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)
      )
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    if (timeoutHandle) clearTimeout(timeoutHandle)
    return result
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    throw error
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  delayMs: number = 1000,
  operationName?: string
): Promise<T> {
  let lastError: any
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (attempt < maxRetries) {
        console.log(
          `[RETRY] ${operationName || 'Operation'} failed (attempt ${attempt}/${maxRetries}): ${errorMessage}. Retrying in ${delayMs}ms...`
        )
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else {
        console.error(
          `[RETRY] ${operationName || 'Operation'} failed after ${maxRetries} attempts: ${errorMessage}`
        )
      }
    }
  }
  
  throw lastError
}

export async function withTimeoutAndRetry<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  maxRetries: number = 5,
  delayMs: number = 1000,
  operationName?: string
): Promise<T> {
  return withRetry(
    () => withTimeout(operation(), timeoutMs, `${operationName || 'Operation'} timed out after ${timeoutMs}ms`),
    maxRetries,
    delayMs,
    operationName
  )
}

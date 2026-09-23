export function getServiceErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (message.includes("network") || message.includes("fetch") || message.includes("failed")) {
      return "Unable to connect. Please check your internet connection and try again.";
    }
    if (message.includes("row")) {
      return "You do not have permission to perform this action.";
    }
  }
  return "Something went wrong. Please try again.";
}

export function throwServiceError(err: unknown): never {
  throw new Error(getServiceErrorMessage(err));
}

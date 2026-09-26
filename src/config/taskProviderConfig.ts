/**
 * Runtime configuration for the task-intelligence provider.
 *
 * The switch that decides whether the AI option is *offered* is a build-time
 * Vite value, which is safe because it selects a feature and never carries a
 * credential.
 *
 * The OpenAI API key is NOT part of this file, is not a Vite variable, and
 * never reaches the browser. It lives only in the Edge Function's server-side
 * environment.
 *
 * The default is deterministic, so an existing user is never switched onto a
 * paid provider by a deploy they did not ask for.
 */

/** The provider ids the application understands. */
export type ConfiguredProviderId = "deterministic" | "openai";

/** Build-time flag; undefined means "not configured". */
const configuredProvider = (
  import.meta.env.VITE_AI_TASK_PROVIDER as string | undefined
)?.trim();

/**
 * The provider configured for this build.
 *
 * Anything other than the exact string `openai` resolves to `deterministic`, so
 * a typo, an empty value, or a missing value can never enable the AI path.
 */
export function getConfiguredProviderId(): ConfiguredProviderId {
  return configuredProvider === "openai" ? "openai" : "deterministic";
}

/** True when the AI option should be shown to the user. */
export function isAiProviderConfigured(): boolean {
  return getConfiguredProviderId() === "openai";
}

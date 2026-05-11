import { getLangfuse } from '@/lib/tracing/langfuse';

export async function withLangfuseGeneration<T>(
  params: {
    name: string;
    provider: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const lf = getLangfuse();
  const modelParameters: Record<string, number> = {};
  if (params.temperature !== undefined) modelParameters.temperature = params.temperature;
  if (params.maxTokens !== undefined) modelParameters.maxTokens = params.maxTokens;

  const trace = lf?.trace({
    name: params.name,
    input: {
      system_prompt_chars: params.systemPrompt.length,
      user_message_chars: params.userMessage.length,
    },
    metadata: { provider: params.provider, model: params.model },
  });
  const generation = trace?.generation({
    name: params.provider,
    model: params.model,
    input: {
      system_prompt_chars: params.systemPrompt.length,
      user_message_chars: params.userMessage.length,
    },
    modelParameters,
  });
  try {
    const result = await fn();
    generation?.end({ output: { type: 'provider-result' } });
    trace?.update({ output: { type: 'provider-result' } });
    lf?.flushAsync();
    return result;
  } catch (err) {
    generation?.end({ level: 'ERROR', statusMessage: (err as Error).message });
    lf?.flushAsync();
    throw err;
  }
}

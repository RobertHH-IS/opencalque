import Anthropic from '@anthropic-ai/sdk'
import { t } from '../i18n'
import { PICTURE_GONE, shorten, type Picture, type Provider, type ToolResult, type TurnInput } from './types'

type Message = Anthropic.Beta.BetaMessageParam
type Block = Anthropic.Beta.BetaContentBlockParam

const imageBlock = (picture: Picture): Anthropic.Beta.BetaImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: picture.mime as Anthropic.Beta.BetaBase64ImageSource['media_type'], data: picture.data },
})

function resultBlock(result: ToolResult): Block {
  const content: Anthropic.Beta.BetaToolResultBlockParam['content'] = [{ type: 'text', text: result.content }]
  if (result.image) content.push(imageBlock(result.image))
  return { type: 'tool_result', tool_use_id: result.id, content, is_error: result.isError }
}

/** What `snapshot` returns and `createSession` takes back. */
interface History {
  messages: Message[]
  unanswered: string[]
}

/**
 * A copy of the conversation that is small enough to store and can be continued later, possibly
 * by another Claude model: no pictures, no old copies of the drawing, and no reasoning blocks,
 * which are only valid in the unchanged conversation that produced them.
 */
function compact(messages: Message[]): Message[] {
  const slim = (block: Block): Block[] => {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') return []
    if (block.type === 'image') return [{ type: 'text', text: PICTURE_GONE }]
    if (block.type === 'text') return [{ ...block, text: shorten(block.text) }]
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      const content = block.content.map((part) => (part.type === 'text' ? { ...part, text: shorten(part.text) } : { type: 'text' as const, text: PICTURE_GONE }))
      return [{ ...block, content }]
    }
    return [block]
  }
  return messages.map((message): Message => {
    if (typeof message.content === 'string') return { ...message, content: shorten(message.content) }
    const content = message.content.flatMap(slim)
    // A reply that was nothing but reasoning still needs something in it to be a valid message.
    return { ...message, content: content.length > 0 ? content : [{ type: 'text', text: '(No reply.)' }] }
  })
}

/**
 * What each Claude model the app offers takes besides a plain request: adaptive thinking, the
 * effort setting, and the server-side fallback that retries a request a safety classifier declined
 * on the model Anthropic recommends (Claude Haiku 5.5 has no such fallback). A model not listed,
 * such as one chosen in an older version of the app, gets a plain request, which every model takes.
 */
export const CLAUDE_FEATURES: Record<string, { thinking: boolean; effort: boolean; fallbacks: boolean }> = {
  'claude-fable-5-1': { thinking: true, effort: true, fallbacks: true },
  'claude-opus-5-5': { thinking: true, effort: true, fallbacks: true },
  'claude-sonnet-5-5': { thinking: true, effort: true, fallbacks: true },
  'claude-haiku-5-5': { thinking: true, effort: true, fallbacks: false },
}

/** The parts of a request that depend on the model (see CLAUDE_FEATURES). */
export function modelOptions(model: string) {
  const features = CLAUDE_FEATURES[model] ?? { thinking: false, effort: false, fallbacks: false }
  return {
    ...(features.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(features.effort ? { output_config: { effort: 'medium' as const } } : {}),
    // If a safety classifier declines the request, it is retried on the model Anthropic recommends.
    ...(features.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  }
}

/**
 * Claude through the Anthropic API, called straight from the app with the user's own key. That is
 * the right shape for a local app; a hosted version should route through a server that holds the key.
 */
export function anthropicProvider(config: { apiKey: string; model: string }): Provider {
  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })

  return {
    pictures: true,
    createSession({ system, tools, history }) {
      const earlier = history as History | undefined
      let messages: Message[] = earlier?.messages ?? []
      /** Tool calls the model made that have not been answered yet. */
      let unanswered: string[] = earlier?.unanswered ?? []

      return {
        async send(input: TurnInput, onText, signal) {
          const content: Block[] =
            'results' in input
              ? input.results.map(resultBlock)
              : [
                  // A step that failed or was stopped leaves calls hanging; the API requires an answer to each.
                  ...unanswered.map((id): Block => ({ type: 'tool_result', tool_use_id: id, content: 'Interrupted before it ran.', is_error: true })),
                  ...(input.images ?? []).map(imageBlock),
                  { type: 'text', text: input.text },
                ]
          const next: Message[] = [...messages, { role: 'user', content }]

          const request = () =>
            client.beta.messages.stream(
              {
                model: config.model,
                max_tokens: 64000,
                // Caches the system prompt, tools and conversation so far between steps.
                cache_control: { type: 'ephemeral' },
                system,
                // Tool inputs stream as they are written instead of arriving in one burst. The API
                // then no longer validates them, so every input is validated before a tool runs.
                tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool['input_schema'], eager_input_streaming: true })),
                messages: next,
                ...modelOptions(config.model),
              },
              { signal },
            )

          let message: Anthropic.Beta.BetaMessage
          for (let attempt = 0; ; attempt++) {
            try {
              const stream = request()
              stream.on('text', onText)
              message = await stream.finalMessage()
              break
            } catch (error) {
              // Anything the SDK does not classify is a tool input that was not parseable JSON: ask again.
              if (error instanceof Anthropic.APIError || signal.aborted || attempt >= 2) throw error
            }
          }

          const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          // A refusal can cut a tool call off mid-input, and so can running out of output: the
          // step is dropped rather than run or remembered.
          if (message.stop_reason === 'refusal') return { calls: [], stop: 'refused' }
          if (message.stop_reason === 'max_tokens' && calls.length > 0) return { calls: [], stop: 'truncated' }

          // The reply is stored exactly as received; the API needs its reasoning blocks back unchanged.
          messages = [...next, { role: 'assistant', content: message.content }]
          unanswered = calls.map((call) => call.id)
          return { calls: calls.map(({ id, name, input }) => ({ id, name, input })), stop: calls.length > 0 ? 'tools' : 'done' }
        },
        snapshot: (): History => ({ messages: compact(messages), unanswered }),
      }
    },

    describeError(error) {
      if (error instanceof Anthropic.APIUserAbortError) return ''
      if (error instanceof Anthropic.AuthenticationError) return t('The API key was rejected. Check it in Preferences.')
      if (error instanceof Anthropic.PermissionDeniedError) return t('This API key is not allowed to use that model.')
      if (error instanceof Anthropic.NotFoundError) return t('The model “{model}” was not found. Pick another one.', { model: config.model })
      if (error instanceof Anthropic.RateLimitError) return t('Rate limit reached. Wait a moment and try again.')
      if (error instanceof Anthropic.BadRequestError) return t('The request was rejected: {reason}', { reason: error.message })
      if (error instanceof Anthropic.APIConnectionError) return t('Could not reach the Anthropic API. Check your connection.')
      if (error instanceof Anthropic.APIError) return t('The service returned an error ({status}): {reason}', { status: String(error.status), reason: error.message })
      return error instanceof Error ? error.message : String(error)
    },
  }
}

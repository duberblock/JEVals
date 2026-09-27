'use client'

import { CopyButton } from './copy-button'
import { PayloadBlock } from './payload-block'
import type { JudgeEvidence } from '../../lib/execution-snapshot'
import type { Dictionary } from '../../lib/i18n'

// §45 Full LLM Exchange: the six inspectable blocks — Configuration, System
// instruction, LLM input, Output schema, Raw model response and the Parsed
// application result — each with its own copy action, plus Copy full
// exchange. Secrets are redacted server-side; the web renders verbatim.
export function FullLlmExchange({
  dictionary,
  evidence,
  parsedResult,
  query,
}: {
  dictionary: Dictionary['investigation']
  evidence: JudgeEvidence
  parsedResult: unknown
  query: string
}) {
  const blocks = [
    {
      key: 'configuration',
      title: dictionary.llm.configuration,
      copyLabel: dictionary.llm.copyConfiguration,
      value: evidence.configuration,
    },
    {
      key: 'system_instruction',
      title: dictionary.llm.systemInstruction,
      copyLabel: dictionary.llm.copySystemInstruction,
      value: evidence.system_instruction,
    },
    {
      key: 'input',
      title: dictionary.llm.llmInput,
      copyLabel: dictionary.llm.copyLlmInput,
      value: evidence.input,
    },
    {
      key: 'output_schema',
      title: dictionary.llm.outputSchema,
      copyLabel: dictionary.llm.copySchema,
      value: evidence.output_schema,
    },
    {
      key: 'raw_response',
      title: dictionary.llm.rawResponse,
      copyLabel: dictionary.llm.copyRawResponse,
      value: evidence.raw_response,
    },
    {
      key: 'parsed_result',
      title: dictionary.llm.parsedResult,
      copyLabel: dictionary.llm.copyParsedResult,
      value: parsedResult,
    },
  ]

  const fullExchange = {
    configuration: evidence.configuration ?? null,
    system_instruction: evidence.system_instruction ?? null,
    input: evidence.input ?? null,
    output_schema: evidence.output_schema ?? null,
    raw_response: evidence.raw_response ?? null,
    parsed_application_result: parsedResult ?? null,
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4" data-testid="full-llm-exchange">
      <CopyButton
        copiedLabel={dictionary.copied}
        label={dictionary.llm.copyFullExchange}
        size="sm"
        value={() => JSON.stringify(fullExchange, null, 2)}
      />
      {blocks.map((block) => (
        <PayloadBlock
          copiedLabel={dictionary.copied}
          copyLabel={block.copyLabel}
          dictionary={dictionary}
          key={block.key}
          query={query}
          title={block.title}
          value={block.value}
        />
      ))}
    </div>
  )
}

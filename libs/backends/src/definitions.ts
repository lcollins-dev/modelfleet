import { BackendId } from './backend-id';
import { kokoroDefinition } from './backends/kokoro/definition';
import { llamaCppDefinition } from './backends/llama-cpp/definition';
import { vllmOmniDefinition } from './backends/vllm-omni/definition';
import { vllmDefinition } from './backends/vllm/definition';
import { whisperCppDefinition } from './backends/whisper-cpp/definition';
import { BackendDeclaration } from './configuration';
import { BackendDefinition } from './definition';

/** Import each definition file directly. Taking a backend's hooks pulls its mapping and sizing into the browser. */
export const backendDefinitions: Readonly<Record<BackendId, BackendDefinition>> = {
  [BackendId.LLAMA_CPP]: llamaCppDefinition,
  [BackendId.VLLM]: vllmDefinition,
  [BackendId.VLLM_OMNI]: vllmOmniDefinition,
  [BackendId.WHISPER_CPP]: whisperCppDefinition,
  [BackendId.KOKORO]: kokoroDefinition,
};

export function definitionFor(backend: BackendId): BackendDefinition {
  return backendDefinitions[backend];
}

export function declarationFor(backend: BackendId): BackendDeclaration {
  return definitionFor(backend).declaration;
}

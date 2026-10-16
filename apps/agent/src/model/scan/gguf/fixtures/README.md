# GGUF header fixtures

Real headers test the parser against files whose contents disagree with their metadata. The model headers come from
[unsloth/Qwen3-0.6B-GGUF](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF).

| File                                | `general.file_type` | What its tensors hold                                            |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `Qwen3-0.6B-Q8_0.header.gguf`       | 7, `Q8_0`           | Q8_0 throughout, so the header is honest                         |
| `Qwen3-0.6B-UD-Q8_K_XL.header.gguf` | 7, `Q8_0`           | 63% Q8_0 and 37% F16, so 205 MB larger than the plain Q8_0 above |
| `Qwen3-0.6B-UD-Q4_K_XL.header.gguf` | 15, `Q4_K_M`        | Q4_K, Q6_K, Q5_K and IQ4_XS, which no single name covers         |

## Capturing another

1. Download enough of the published file to include the tensor info block:
   `curl -L -r 0-8388607 -o <name>.gguf https://huggingface.co/<repo>/resolve/main/<name>.gguf`.
2. Remove every array value and update the header's key-value count. Arrays are not needed by the parser and the
   tokenizer vocabulary accounts for most of the original header.
3. Keep scalar values and the tensor info block unchanged, then stop at the end of the block.

The result is a valid GGUF header carrying no tensor data, around 24 KB.

## Projectors

| File                                      | From                                                                                  | What it pins                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `mmproj-Qwen3-ASR-0.6B-Q8_0.header.gguf`  | [ggml-org/Qwen3-ASR-0.6B-GGUF](https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF)   | `clip.has_audio_encoder` alone, and `general.license` `apache-2.0`  |
| `mmproj-Qwen2.5-Omni-3B-Q8_0.header.gguf` | [ggml-org/Qwen2.5-Omni-3B-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Omni-3B-GGUF) | Both encoder flags, and a licence of `other` with its name and link |

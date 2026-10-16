# ggml header fixtures

The first 64 bytes of real whisper.cpp files, containing the `ggml` magic and following fields.

| File                            | From                                                                  | What it pins                                             |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `ggml-tiny.en.header.bin`       | [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) | Whisper's hyperparameters, read as a transcription model |
| `ggml-silero-v5.1.2.header.bin` | [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad)   | The same magic over a voice activity model, refused      |

Capture another:

```sh
curl -L -r 0-63 -o <name>.header.bin https://huggingface.co/<repo>/resolve/main/<name>.bin
```

import {
  BackendField,
  BackendFieldType,
  CONFIGURATION_SCHEMA_VERSION,
  BackendDeclaration,
  extraFlagsField,
} from '../../configuration';
import { BackendImages, imageField } from '../../definition';
import { ModelFormat } from '../../model';

/** v1.9.5's commit, since the registry publishes no version tags. */
const RELEASE = 'd1be6fde11ac6e0407606b4e42fe72d34add8037';

export const WHISPER_CPP_IMAGES: BackendImages = {
  cuda: `ghcr.io/ggml-org/whisper.cpp:main-cuda-${RELEASE}`,
  cpu: `ghcr.io/ggml-org/whisper.cpp:main-${RELEASE}`,
};

const CONTAINER = 'container';
const DECODING = 'decoding';
const CPU = 'cpu';
const ADVANCED = 'advanced';

const fields: BackendField[] = [
  imageField({
    group: CONTAINER,
    images: WHISPER_CPP_IMAGES,
    description:
      'Choose the container image and tag for each instance. The image must carry whisper-server and ffmpeg, which ' +
      'converts uploads to the WAV the server reads.',
  }),

  {
    name: 'language',
    flag: '--language',
    label: 'Language',
    description:
      'Set the spoken language as a code such as en, or auto to detect it. A request naming its own language ' +
      'overrides this.',
    group: DECODING,
    type: BackendFieldType.TEXT,
    default: 'auto',
    minLength: 1,
  },
  {
    name: 'beamSize',
    flag: '--beam-size',
    label: 'Beam size',
    description: 'Set the number of beams searched while decoding. Leave this unset to decode greedily.',
    group: DECODING,
    type: BackendFieldType.INTEGER,
    min: 1,
  },
  {
    name: 'flashAttn',
    flag: '--flash-attn',
    offFlag: '--no-flash-attn',
    label: 'Flash attention',
    description: 'Choose whether to use flash attention kernels.',
    group: DECODING,
    type: BackendFieldType.BOOLEAN,
  },

  {
    name: 'threads',
    flag: '--threads',
    label: 'Threads',
    description: 'Set the number of threads used for computation.',
    group: CPU,
    type: BackendFieldType.INTEGER,
    min: 1,
  },

  extraFlagsField(ADVANCED),
];

export const whisperCppDeclaration: BackendDeclaration = {
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  formats: [ModelFormat.GGML],
  groups: [
    { group: CONTAINER, label: 'Container' },
    { group: DECODING, label: 'Decoding' },
    { group: CPU, label: 'CPU' },
    { group: ADVANCED, label: 'Advanced' },
  ],
  fields,
};

import { CONFIGURATION_SCHEMA_VERSION, BackendDeclaration } from '../../configuration';
import { BackendImages, imageField } from '../../definition';
import { ModelFormat } from '../../model';

export const KOKORO_IMAGES: BackendImages = {
  cuda: 'ghcr.io/remsky/kokoro-fastapi-gpu:v0.9.0',
  cpu: 'ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0',
};

const CONTAINER = 'container';

export const kokoroDeclaration: BackendDeclaration = {
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  formats: [ModelFormat.PYTORCH],
  groups: [{ group: CONTAINER, label: 'Container' }],
  fields: [
    imageField({
      group: CONTAINER,
      images: KOKORO_IMAGES,
      description:
        'Choose the container image and tag for each instance. The definition relies on how Kokoro-FastAPI v0.9 ' +
        'finds its weights and which model names it accepts, so test another tag before deploying it.',
    }),
  ],
};

import { fileURLToPath } from 'node:url';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import icons from 'unplugin-icons/vite';

export const iconsPlugin = () =>
  icons({
    compiler: 'vue3',
    scale: 1,
    defaultClass: 'shrink-0',
    customCollections: {
      modelfleet: FileSystemIconLoader(fileURLToPath(new URL('./public', import.meta.url))),
    },
  });

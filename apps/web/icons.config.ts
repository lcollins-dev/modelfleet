import icons from 'unplugin-icons/vite';

export const iconsPlugin = () =>
  icons({
    compiler: 'vue3',
    scale: 1,
    defaultClass: 'shrink-0',
  });

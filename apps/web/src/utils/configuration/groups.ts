import type { Component } from 'vue';
import IconDeveloperBoard from '~icons/material-symbols/developer-board-outline-rounded';
import IconDns from '~icons/material-symbols/dns-outline-rounded';
import IconImage from '~icons/material-symbols/image-outline-rounded';
import IconInventory2 from '~icons/material-symbols/inventory-2-outline-rounded';
import IconLayers from '~icons/material-symbols/layers-outline-rounded';
import IconMemory from '~icons/material-symbols/memory-outline-rounded';
import IconStorage from '~icons/material-symbols/storage-rounded';
import IconTerminal from '~icons/material-symbols/terminal-rounded';
import IconTune from '~icons/material-symbols/tune-rounded';
import IconUnfoldMore from '~icons/material-symbols/unfold-more-rounded';

interface IGroupPresentation {
  icon: Component;
  description: string;
}

const GROUP_PRESENTATION: Record<string, IGroupPresentation | undefined> = {
  container: {
    icon: IconInventory2,
    description: 'Choose the image each instance runs.',
  },
  context: {
    icon: IconLayers,
    description: 'Configure the context length and request batching.',
  },
  gpu: {
    icon: IconMemory,
    description: 'Configure GPU offloading and how to split a model across several GPUs.',
  },
  memory: {
    icon: IconStorage,
    description: 'Configure how the instance loads weights and stores its key-value cache.',
  },
  cpu: {
    icon: IconDeveloperBoard,
    description: 'Configure threads and memory placement for work performed by the host.',
  },
  rope: {
    icon: IconUnfoldMore,
    description: 'Configure how to extend a model beyond its trained context length.',
  },
  multimodal: {
    icon: IconImage,
    description: 'Attach the companion files a model needs to read anything but text.',
  },
  server: {
    icon: IconDns,
    description: 'Configure HTTP endpoints, chat templates and embedding pooling.',
  },
  advanced: {
    icon: IconTerminal,
    description: 'Pass extra options directly to the backend. These options are not validated.',
  },
};

export const configurationGroupIcon = (group: string): Component => GROUP_PRESENTATION[group]?.icon ?? IconTune;

export const configurationGroupDescription = (group: string): string => GROUP_PRESENTATION[group]?.description ?? '';

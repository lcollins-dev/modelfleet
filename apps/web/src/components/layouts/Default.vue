<template>
  <app-shell :sections="sections">
    <template #actions>
      <signed-in-header-actions />
    </template>

    <slot />
  </app-shell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconDatabase from '~icons/material-symbols/database-outline-rounded';
import IconDns from '~icons/material-symbols/dns-outline-rounded';
import IconDownload from '~icons/material-symbols/download-outline-rounded';
import IconKey from '~icons/material-symbols/key-outline-rounded';
import IconPerson from '~icons/material-symbols/person-outline-rounded';
import IconReceiptLong from '~icons/material-symbols/receipt-long-outline-rounded';
import IconRocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded';
import IconSchedule from '~icons/material-symbols/schedule-outline-rounded';
import IconSpaceDashboard from '~icons/material-symbols/space-dashboard-outline-rounded';
import IconTune from '~icons/material-symbols/tune-outline-rounded';

import { UserRoleId } from '@libs/dto';

import { useUserStore } from '@/stores/user';

import AppShell from '@/components/shell/AppShell.vue';
import { INavItem, INavSection } from '@/components/shell/AppSidebar.vue';
import SignedInHeaderActions from '@/components/shell/SignedInHeaderActions.vue';

interface IGatedNavItem extends INavItem {
  roleId?: UserRoleId;
}

interface IGatedNavSection {
  title: string;
  items: IGatedNavItem[];
}

const NAV_SECTIONS: IGatedNavSection[] = [
  {
    title: 'Fleet',
    items: [
      { label: 'Overview', icon: IconSpaceDashboard, to: '/dashboard' },
      { label: 'Nodes', icon: IconDns, to: '/nodes', roleId: UserRoleId.SYSTEM_ADMIN },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { label: 'Models', icon: IconDatabase, to: '/models', roleId: UserRoleId.SYSTEM_ADMIN },
      { label: 'Downloads', icon: IconDownload, to: '/downloads', roleId: UserRoleId.SYSTEM_ADMIN },
    ],
  },
  {
    title: 'Serving',
    items: [
      { label: 'Deployments', icon: IconRocketLaunch, to: '/deployments', roleId: UserRoleId.SYSTEM_ADMIN },
      { label: 'Presets', icon: IconTune, to: '/presets', roleId: UserRoleId.SYSTEM_ADMIN },
    ],
  },
  {
    title: 'Access',
    items: [
      { label: 'API keys', icon: IconKey, to: '/api-keys', roleId: UserRoleId.SYSTEM_ADMIN },
      { label: 'Users', icon: IconPerson, to: '/users', roleId: UserRoleId.USER_ADMIN },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Event log', icon: IconReceiptLong, to: '/events', roleId: UserRoleId.SYSTEM_ADMIN },
      { label: 'Batch jobs', icon: IconSchedule, to: '/batch-jobs', roleId: UserRoleId.SYSTEM_ADMIN },
    ],
  },
];

const userStore = useUserStore();

const sections = computed<INavSection[]>(() =>
  NAV_SECTIONS.map(section => ({
    title: section.title,
    items: section.items.filter(item => item.roleId === undefined || userStore.hasRole(item.roleId)),
  })).filter(section => section.items.length > 0)
);
</script>

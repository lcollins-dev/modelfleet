/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RouteRecordRaw } from 'vue-router';

import { UserRoleId } from '@libs/dto';

import { Layout } from '@/components/layouts';

import Dashboard from '@/pages/loggedin/Dashboard.vue';
import EditProfile from '@/pages/loggedin/EditProfile.vue';
import FirstTimeSetup from '@/pages/loggedin/FirstTimeSetup.vue';
import ApiKeysCreate from '@/pages/loggedin/api-keys/Create.vue';
import ApiKeys from '@/pages/loggedin/api-keys/Index.vue';
import BatchJobsBatchJob from '@/pages/loggedin/batch-jobs/BatchJob.vue';
import BatchJobs from '@/pages/loggedin/batch-jobs/Index.vue';
import DeploymentsConfiguration from '@/pages/loggedin/deployments/Configuration.vue';
import DeploymentsCreate from '@/pages/loggedin/deployments/Create.vue';
import DeploymentsDeployment from '@/pages/loggedin/deployments/Deployment.vue';
import Deployments from '@/pages/loggedin/deployments/Index.vue';
import DeploymentsInstance from '@/pages/loggedin/deployments/Instance.vue';
import DownloadsCreate from '@/pages/loggedin/downloads/Create.vue';
import DownloadsDownload from '@/pages/loggedin/downloads/Download.vue';
import Downloads from '@/pages/loggedin/downloads/Index.vue';
import Events from '@/pages/loggedin/events/Index.vue';
import Models from '@/pages/loggedin/models/Index.vue';
import ModelsModel from '@/pages/loggedin/models/Model.vue';
import Nodes from '@/pages/loggedin/nodes/Index.vue';
import NodesNode from '@/pages/loggedin/nodes/Node.vue';
import NodesRegister from '@/pages/loggedin/nodes/Register.vue';
import PresetsCreate from '@/pages/loggedin/presets/Create.vue';
import Presets from '@/pages/loggedin/presets/Index.vue';
import PresetsPreset from '@/pages/loggedin/presets/Preset.vue';
import UsersCreate from '@/pages/loggedin/users/Create.vue';
import Users from '@/pages/loggedin/users/Index.vue';
import UsersUser from '@/pages/loggedin/users/User.vue';

export const loggedInRoutes: RouteRecordRaw[] = [
  {
    path: '/dashboard',
    component: Dashboard,
  },
  {
    path: '/edit-profile',
    component: EditProfile,
  },
  {
    path: '/setup',
    component: FirstTimeSetup,
    meta: {
      layout: Layout.LOGGED_OUT,
    },
  },
  {
    path: '/users',
    meta: {
      requiresRoleId: UserRoleId.USER_ADMIN,
    },
    children: [
      {
        path: '',
        component: Users,
      },
      {
        path: 'create',
        component: UsersCreate,
      },
      {
        path: ':userId(\\d+)',
        component: UsersUser,
      },
    ],
  },
  {
    path: '/nodes',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: Nodes,
      },
      {
        path: 'register',
        component: NodesRegister,
      },
      {
        path: ':nodeId(\\d+)',
        component: NodesNode,
      },
    ],
  },
  {
    path: '/downloads',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: Downloads,
      },
      {
        path: 'create',
        component: DownloadsCreate,
      },
      {
        path: ':downloadId(\\d+)',
        component: DownloadsDownload,
      },
    ],
  },
  {
    path: '/models',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: Models,
      },
      {
        path: ':modelId(\\d+)',
        component: ModelsModel,
      },
    ],
  },
  {
    path: '/deployments',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: Deployments,
      },
      {
        path: 'create',
        component: DeploymentsCreate,
      },
      {
        path: ':deploymentId(\\d+)',
        component: DeploymentsDeployment,
      },
      {
        path: ':deploymentId(\\d+)/configuration',
        component: DeploymentsConfiguration,
      },
      {
        path: ':deploymentId(\\d+)/instance/:instanceKey',
        component: DeploymentsInstance,
      },
    ],
  },
  {
    path: '/presets',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: Presets,
      },
      {
        path: 'create',
        component: PresetsCreate,
      },
      {
        path: ':presetId(\\d+)',
        component: PresetsPreset,
      },
    ],
  },
  {
    path: '/api-keys',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: ApiKeys,
      },
      {
        path: 'create',
        component: ApiKeysCreate,
      },
    ],
  },
  {
    path: '/events',
    component: Events,
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
  },
  {
    path: '/batch-jobs',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: BatchJobs,
      },
      {
        path: ':batchJobId(\\d+)',
        component: BatchJobsBatchJob,
      },
    ],
  },
];

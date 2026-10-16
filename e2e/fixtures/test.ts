import { BatchJobPage } from '../pages/BatchJobPage';
import { BatchJobsPage } from '../pages/BatchJobsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DownloadCreatePage } from '../pages/DownloadCreatePage';
import { DownloadPage } from '../pages/DownloadPage';
import { DownloadsPage } from '../pages/DownloadsPage';
import { EditProfilePage } from '../pages/EditProfilePage';
import { EventsPage } from '../pages/EventsPage';
import { HeaderMenu } from '../pages/HeaderMenu';
import { NodePage } from '../pages/NodePage';
import { NodeRegisterPage } from '../pages/NodeRegisterPage';
import { NodesPage } from '../pages/NodesPage';
import { NotificationsPanel } from '../pages/NotificationsPanel';
import { SignInPage } from '../pages/SignInPage';
import { UserCreatePage } from '../pages/UserCreatePage';
import { UserPage } from '../pages/UserPage';
import { UsersPage } from '../pages/UsersPage';
import { test as base } from './error-guards';

interface IPageFixtures {
  signInPage: SignInPage;
  dashboardPage: DashboardPage;
  editProfilePage: EditProfilePage;
  headerMenu: HeaderMenu;
  notificationsPanel: NotificationsPanel;
  usersPage: UsersPage;
  userCreatePage: UserCreatePage;
  userPage: UserPage;
  batchJobsPage: BatchJobsPage;
  batchJobPage: BatchJobPage;
  eventsPage: EventsPage;
  nodesPage: NodesPage;
  nodeRegisterPage: NodeRegisterPage;
  nodePage: NodePage;
  downloadsPage: DownloadsPage;
  downloadCreatePage: DownloadCreatePage;
  downloadPage: DownloadPage;
}

export const test = base.extend<IPageFixtures>({
  signInPage: async ({ page }, use) => {
    await use(new SignInPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  editProfilePage: async ({ page }, use) => {
    await use(new EditProfilePage(page));
  },
  headerMenu: async ({ page }, use) => {
    await use(new HeaderMenu(page));
  },
  notificationsPanel: async ({ page }, use) => {
    await use(new NotificationsPanel(page));
  },
  usersPage: async ({ page }, use) => {
    await use(new UsersPage(page));
  },
  userCreatePage: async ({ page }, use) => {
    await use(new UserCreatePage(page));
  },
  userPage: async ({ page }, use) => {
    await use(new UserPage(page));
  },
  batchJobsPage: async ({ page }, use) => {
    await use(new BatchJobsPage(page));
  },
  batchJobPage: async ({ page }, use) => {
    await use(new BatchJobPage(page));
  },
  eventsPage: async ({ page }, use) => {
    await use(new EventsPage(page));
  },
  nodesPage: async ({ page }, use) => {
    await use(new NodesPage(page));
  },
  nodeRegisterPage: async ({ page }, use) => {
    await use(new NodeRegisterPage(page));
  },
  nodePage: async ({ page }, use) => {
    await use(new NodePage(page));
  },
  downloadsPage: async ({ page }, use) => {
    await use(new DownloadsPage(page));
  },
  downloadCreatePage: async ({ page }, use) => {
    await use(new DownloadCreatePage(page));
  },
  downloadPage: async ({ page }, use) => {
    await use(new DownloadPage(page));
  },
});

export { expect } from '@playwright/test';

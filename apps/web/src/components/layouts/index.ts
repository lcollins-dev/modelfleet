/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Component } from 'vue';

import Default from './Default.vue';
import LoggedOut from './LoggedOut.vue';
import Minimal from './Minimal.vue';

export enum Layout {
  LOGGED_OUT = 'logged-out',
  DEFAULT = 'default',
  MINIMAL = 'minimal',
}

export const LAYOUT_COMPONENTS: { [key in Layout]: Component } = {
  [Layout.LOGGED_OUT]: LoggedOut,
  [Layout.DEFAULT]: Default,
  [Layout.MINIMAL]: Minimal,
};

import type { CleanerModule } from '../core/types';
import { systemModule } from './system';
import { aiModule } from './ai';
import { devModule } from './dev';
import { containersModule } from './containers';
import { privacyModule } from './privacy';
import { largeFilesModule, duplicatesModule } from './files';
import { downloadsModule } from './downloads';
import { binsModule } from './bins';
import { startupModule } from './startup';
import { macosModule } from './macos';
import { windowsModule } from './windows';
import { appsModule } from './apps';
import { appTracesModule } from './app-traces';
import { hiddenSpaceModule } from './hidden-space';

/** Registry of all scan modules in display order. */
export const ALL_MODULES: CleanerModule[] = [
  aiModule,
  devModule,
  systemModule,
  hiddenSpaceModule,
  appsModule,
  appTracesModule,
  containersModule,
  privacyModule,
  largeFilesModule,
  duplicatesModule,
  downloadsModule,
  binsModule,
  startupModule,
  macosModule,
  windowsModule,
];

import { createDarwinAdapter } from './darwin.js';
import { createLinuxAdapter } from './linux.js';
import { createWin32Adapter } from './win32.js';

export function getPlatformAdapter(platform = process.platform, options = {}) {
  if (platform === 'win32') return createWin32Adapter(options);
  if (platform === 'darwin') return createDarwinAdapter(options);
  // Linux and other Unix-like systems.
  return createLinuxAdapter(options);
}

#!/usr/bin/env node

require('dotenv').config({ quiet: true });
const { spawnSync } = require('child_process');
const { getMediaToolStatus } = require('../backend/services/ytdlpService');

const status = getMediaToolStatus();
if (!status.ready) {
  for (const tool of status.tools.filter(entry => !entry.available)) {
    console.error(`[MediaTools] Thiếu ${tool.name}`);
  }
  process.exitCode = 1;
} else {
  for (const tool of status.tools) {
    const versionArgs = tool.name === 'yt-dlp' ? ['--ignore-config', '--version'] : ['-version'];
    const result = spawnSync(tool.path, versionArgs, {
      encoding: 'utf8',
      shell: false,
      timeout: 15_000,
      windowsHide: true
    });
    const firstLine = String(result.stdout || result.stderr || '')
      .split(/\r?\n/)
      .find(Boolean);
    if (result.status !== 0) {
      console.error(`[MediaTools] ${tool.name} tồn tại nhưng không chạy được: ${result.error?.message || firstLine || 'unknown error'}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`[MediaTools] ${tool.name}: ${firstLine || tool.path}`);
  }
}

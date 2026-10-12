import {execFileSync} from 'node:child_process';
import {buildInjector} from '../electron-injector/build.mjs';
import {upstream} from './upstream.mjs';
execFileSync(process.execPath, ['tasks/build.js', '--release', '--firefox', '--chrome-mv3', '--api'], {cwd: upstream, stdio: 'inherit'});
if (process.platform === 'linux' && process.arch === 'x64') await buildInjector({buildAPI: false});

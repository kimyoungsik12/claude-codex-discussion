import {build} from 'esbuild';
import {mkdirSync, chmodSync} from 'node:fs';
mkdirSync('dist', {recursive:true});
await build({entryPoints:['src/cli.ts'], outfile:'dist/cli.cjs', bundle:true, platform:'node', target:'node22', format:'cjs', banner:{js:'#!/usr/bin/env node'}, legalComments:'inline'});
await build({entryPoints:['src/index.ts'], outfile:'dist/index.cjs', bundle:true, platform:'node', target:'node22', format:'cjs'});
chmodSync('dist/cli.cjs', 0o755);

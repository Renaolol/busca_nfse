#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function requireArg(args, key) {
  const value = args[key];
  if (!value || value === 'true') {
    throw new Error(`Parametro obrigatorio ausente: --${key}`);
  }
  return value;
}

function main() {
  const cwd = process.cwd();
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const args = parseArgs(process.argv.slice(2));

  const version = args.version || packageJson.version;
  const channel = args.channel || 'stable';
  const packageUrl = requireArg(args, 'win-package-url');
  const sha256 = requireArg(args, 'win-package-sha256');
  const publishedAt = args['published-at'] || new Date().toISOString();
  const outPath = path.resolve(cwd, args.out || `release-manifest-${channel}.json`);
  const sizeBytes = args['win-package-size'] ? Number(args['win-package-size']) : undefined;

  const manifest = {
    app: 'notasync-gcont',
    channel,
    version,
    publishedAt,
    minimumSupportedVersion: args['minimum-supported-version'] || undefined,
    notesUrl: args['notes-url'] || undefined,
    windows: {
      packageUrl,
      sha256,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined
    },
    docker: {
      image: args['docker-image'] || undefined,
      tag: args['docker-tag'] || undefined
    }
  };

  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${outPath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

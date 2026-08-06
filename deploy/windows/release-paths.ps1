function Get-NotaSyncReleasePaths {
  return @(
    'package.json',
    'package-lock.json',
    'nest-cli.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'jest.config.ts',
    'README.md',
    'Dockerfile',
    'docker-compose.yml',
    'src',
    'frontend',
    'prisma',
    'scripts',
    'deploy',
    'dist'
  )
}

function Get-NotaSyncPreservePaths {
  return @(
    '.env',
    'storage',
    'logs',
    'releases',
    'backups',
    'coverage',
    'node_modules',
    '.git',
    '.codex',
    '.agents',
    'NotaSyncGCONT.exe',
    'NotaSyncGCONT.xml'
  )
}

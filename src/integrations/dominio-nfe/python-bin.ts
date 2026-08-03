import { spawnSync } from 'node:child_process';

const WINDOWS_PYTHON_CANDIDATES = [
  'C:\\Program Files\\PostgreSQL\\18\\pgAdmin 4\\python\\python.exe'
];

function isUsablePythonBin(candidate: string | undefined): candidate is string {
  if (!candidate?.trim()) {
    return false;
  }

  const result = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    windowsHide: true
  });

  return !result.error && result.status === 0;
}

export function resolveDominioPythonBin(): string {
  const preferredCandidates = [
    process.env.DOMINIO_PYTHON_BIN,
    process.env.PYTHON,
    ...(process.platform === 'win32' ? WINDOWS_PYTHON_CANDIDATES : []),
    'python',
    ...(process.platform === 'win32' ? ['py'] : [])
  ];

  const resolved = preferredCandidates.find((candidate) => isUsablePythonBin(candidate));
  return resolved ?? process.env.DOMINIO_PYTHON_BIN ?? process.env.PYTHON ?? 'python';
}

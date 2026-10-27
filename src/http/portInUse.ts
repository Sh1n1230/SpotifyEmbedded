/**
 * ポート衝突（EADDRINUSE）のときに出す案内。開発中によく起きるので、スタックトレース
 * ではなく対処法を出す。PORT=3001 npm run dev や lsof は POSIX のシェル向けで、
 * Windows（cmd.exe / PowerShell）ではそのまま使えないため、プラットフォームで分ける。
 */
export function portInUseHelp(port: number, platform: NodeJS.Platform): string[] {
  const head = `✗ ポート ${port} はすでに別のプロセスが使用しています。`;
  if (platform === 'win32') {
    return [
      head,
      '   別のポートで起動する:  set PORT=3001 && npm run dev（cmd）',
      '                         $env:PORT=3001; npm run dev（PowerShell）',
      `   使用中のプロセスを調べる:  netstat -ano | findstr :${port}`,
    ];
  }
  return [
    head,
    '   別のポートで起動する:  PORT=3001 npm run dev',
    `   使用中のプロセスを調べる:  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
  ];
}

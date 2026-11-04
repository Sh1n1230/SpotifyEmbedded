/**
 * ポート衝突（EADDRINUSE）のときに出す案内。開発中によく起きるので、スタックトレース
 * ではなく対処法を出す。PORT=3001 npm run dev や lsof は POSIX のシェル向けで、
 * Windows（cmd.exe / PowerShell）ではそのまま使えないため、プラットフォームで分ける。
 *
 * @param script 起動した npm のスクリプト（npm_lifecycle_event）。auth なら Redirect URI も変える必要がある
 */
export function portInUseHelp(port: number, platform: NodeJS.Platform, script = 'dev'): string[] {
  const head = `✗ ポート ${port} はすでに別のプロセスが使用しています。`;
  // 使用中のポートとは別のポートを例に出す
  const other = port < 65535 ? port + 1 : port - 1;
  const command = `npm run ${script === 'auth' ? 'auth' : 'dev'}`;
  const redirectNote =
    script === 'auth'
      ? [`   npm run auth では、SPOTIFY_REDIRECT_URI と Spotify の Dashboard の Redirect URI も、同じポート（${other}）にしてください。`]
      : [];
  if (platform === 'win32') {
    return [
      head,
      // set PORT=3001 && … は、&& の前の空白まで値に入る。引用符で囲むと入らない
      `   別のポートで起動する:  set "PORT=${other}" && ${command}（cmd）`,
      `                         $env:PORT=${other}; ${command}（PowerShell）`,
      `   使用中のプロセスを調べる:  netstat -ano | findstr :${port}`,
      ...redirectNote,
    ];
  }
  return [
    head,
    `   別のポートで起動する:  PORT=${other} ${command}`,
    `   使用中のプロセスを調べる:  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    ...redirectNote,
  ];
}

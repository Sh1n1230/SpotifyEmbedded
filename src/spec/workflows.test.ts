/** GitHub Actions のワークフロー定義。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';

describe('ワークフロー定義 (.github/workflows/deploy-workers.yml)', () => {
  interface Step {
    id?: string;
    run?: string;
  }
  const workflow = yaml.load(
    readFileSync(new URL('../../.github/workflows/deploy-workers.yml', import.meta.url), 'utf8')
  ) as { jobs: Record<string, { steps: Step[] }> };
  const steps = workflow.jobs['deploy']!.steps;
  const indexOfRun = (script: string) => steps.findIndex((step) => step.run === script);

  // CI（ci.yml）とは並行して走り、その結果を待たない
  it.each(['npm run typecheck', 'npm run lint', 'npm test'])('デプロイの前に `%s` を通す', (script) => {
    const deploy = steps.findIndex((step) => step.id === 'deploy');

    expect(indexOfRun(script)).toBeGreaterThanOrEqual(0);
    expect(indexOfRun(script)).toBeLessThan(deploy);
  });
});

interface Job {
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  steps: { run?: string; uses?: string; with?: Record<string, unknown> }[];
}

function loadWorkflow(name: string): { permissions?: Record<string, string>; jobs: Record<string, Job> } {
  return yaml.load(
    readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8')
  ) as { permissions?: Record<string, string>; jobs: Record<string, Job> };
}

const WORKFLOWS = readdirSync(new URL('../../.github/workflows/', import.meta.url)).filter((f) =>
  f.endsWith('.yml')
);

describe('すべてのワークフロー', () => {
  it.each(WORKFLOWS)('%s のすべてのジョブに timeout-minutes がある（既定の6時間まで止まり続けない）', (name) => {
    for (const [id, job] of Object.entries(loadWorkflow(name).jobs)) {
      expect(job['timeout-minutes'], `${name} の ${id}`).toBeGreaterThan(0);
      expect(job['timeout-minutes'], `${name} の ${id}`).toBeLessThanOrEqual(15);
    }
  });

  it.each(WORKFLOWS)('%s の外部の action はコミット SHA で固定している', (name) => {
    for (const job of Object.values(loadWorkflow(name).jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it.each(WORKFLOWS)('%s の actions/checkout はすべて persist-credentials: false（トークンを .git/config に残さない）', (name) => {
    for (const job of Object.values(loadWorkflow(name).jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false);
      }
    }
  });

  it.each(WORKFLOWS)('%s は最上位に permissions を持ち、write-all ではない', (name) => {
    const { permissions } = loadWorkflow(name);
    expect(permissions).toBeDefined();
    expect(permissions as unknown).not.toBe('write-all');
  });

  it.each(WORKFLOWS)('%s の SHA で固定した uses には版のコメント（# vX.Y.Z）がある', (name) => {
    const text = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
    for (const line of text.split('\n').filter((candidate) => /uses:\s*\S+@[0-9a-f]{40}/.test(candidate))) {
      expect(line).toMatch(/# v\d/);
    }
  });

  it.each(WORKFLOWS)('%s は pull_request_target を使わず、run の中で信頼できない入力を展開しない', (name) => {
    const workflow = loadWorkflow(name) as unknown as { on: Record<string, unknown> };
    expect(Object.keys(workflow.on)).not.toContain('pull_request_target');
    for (const job of Object.values(loadWorkflow(name).jobs)) {
      for (const step of job.steps) {
        expect(step.run ?? '').not.toMatch(/\$\{\{\s*(github\.event\.|inputs\.)/);
      }
    }
  });
});

describe('本番へのデプロイは途中で取り消さない', () => {
  it.each(['deploy-pages.yml', 'deploy-workers.yml'])('%s は cancel-in-progress: false', (name) => {
    const workflow = loadWorkflow(name) as unknown as { concurrency: { 'cancel-in-progress': boolean } };
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  it('deploy-workers.yml はデプロイの後に /health を確かめる', () => {
    const steps = loadWorkflow('deploy-workers.yml').jobs['deploy']!.steps.map((step) => step.run ?? '');
    expect(steps.join('\n')).toContain('/health');
  });
});

describe('ワークフロー定義 (.github/workflows/deploy-workers.yml) の権限', () => {
  it('GITHUB_TOKEN には contents: read だけを与える（Deployments API は使わない）', () => {
    expect(loadWorkflow('deploy-workers.yml').permissions).toEqual({ contents: 'read' });
  });
});

describe('ワークフロー定義 (.github/workflows/ci.yml)', () => {
  const ci = loadWorkflow('ci.yml');
  const runs = (job: string) => (ci.jobs[job]?.steps ?? []).map((step) => step.run ?? '').join('\n');

  it('Workers 向けのバンドルを、Cloudflare の認証情報なしの --dry-run で確かめる', () => {
    expect(runs('workers-bundle')).toContain('wrangler deploy --dry-run');
    expect(JSON.stringify(ci.jobs['workers-bundle'])).not.toContain('secrets.');
  });

  it('Docker イメージをビルドして起動し、/health を確かめる（push はしない）', () => {
    expect(runs('docker')).toContain('docker build');
    expect(runs('docker')).toContain('/health');
    // HEALTHCHECK・root で動かないこと・SIGTERM ですぐ終わること
    expect(runs('docker')).toContain('.State.Health.Status');
    expect(runs('docker')).toContain('id -u');
    expect(runs('docker')).toContain('docker stop');
    expect(runs('docker')).not.toContain('docker push');
    expect(JSON.stringify(ci.jobs['docker'])).not.toContain('secrets.');
  });

  it('npm pack の成果物を空のフォルダに入れて、CLI が起動することを確かめる', () => {
    expect(runs('package')).toContain('npm pack');
    expect(runs('package')).toContain('npm install --ignore-scripts');
    expect(runs('package')).toContain('spotify-embedded help');
  });

  it('カバレッジのレポートを残す（ゲートにはしない）', () => {
    expect(runs('validate')).toContain('npm run test:coverage');
  });

  it('ワークフロー全体の権限は contents: read のまま', () => {
    expect(ci.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(ci.jobs)) expect(job.permissions).toBeUndefined();
  });
});

describe('リリースは CHANGELOG.md に版の見出しがあるときだけ作る', () => {
  it('release.yml がタグの版の見出しを確かめる', () => {
    const runs = loadWorkflow('release.yml').jobs['release']!.steps.map((step) => step.run ?? '').join('\n');

    expect(runs).toContain('CHANGELOG.md');
    expect(runs).toContain('## [$version]');
  });

  it('CHANGELOG.md には package.json の今の版の見出しがある', () => {
    const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

    expect(changelog).toContain(`## [${pkg.version}]`);
    expect(changelog).toContain('## [Unreleased]');
  });
});

describe('ワークフローの細かな約束', () => {
  const read = (name: string) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');

  it('deploy-workers.yml は、ロックファイルだけの依存の更新でもデプロイする', () => {
    const workflow = yaml.load(read('deploy-workers.yml')) as { on: { push: { paths: string[] } } };

    expect(workflow.on.push.paths).toContain('package-lock.json');
  });

  it('update-spotify.yml の定期実行は、混みやすい毎時0分・30分を避ける', () => {
    const workflow = yaml.load(read('update-spotify.yml')) as { on: { schedule: { cron: string }[] } };

    for (const { cron } of workflow.on.schedule) {
      const minutes = cron.split(' ')[0]!.split(',');
      expect(minutes).not.toContain('0');
      expect(minutes).not.toContain('30');
      expect(minutes.some((minute) => minute.startsWith('*'))).toBe(false);
    }
  });

  it('security.yml は、変更の無い期間も定期的に実行する', () => {
    const workflow = yaml.load(read('security.yml')) as { on: { schedule?: unknown[] } };

    expect(workflow.on.schedule?.length).toBeGreaterThan(0);
  });

  it.each(WORKFLOWS)('%s は、存在しない master ブランチを対象にしない', (name) => {
    expect(read(name)).not.toMatch(/branches: \[[^\]]*master/);
  });
});

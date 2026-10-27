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

/** GitHub Actions のワークフロー定義。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

describe('ワークフロー定義 (.github/workflows/deploy-workers.yml)', () => {
  interface Step {
    id?: string;
    run?: string;
  }
  const workflow = yaml.load(
    readFileSync(new URL('../../.github/workflows/deploy-workers.yml', import.meta.url), 'utf8')
  ) as { jobs: Record<string, { steps: Step[] }> };
  const steps = workflow.jobs['deploy'].steps;
  const indexOfRun = (script: string) => steps.findIndex((step) => step.run === script);

  // CI（ci.yml）とは並行して走り、その結果を待たない
  it.each(['npm run typecheck', 'npm run lint', 'npm test'])('デプロイの前に `%s` を通す', (script) => {
    const deploy = steps.findIndex((step) => step.id === 'deploy');

    expect(indexOfRun(script)).toBeGreaterThanOrEqual(0);
    expect(indexOfRun(script)).toBeLessThan(deploy);
  });
});

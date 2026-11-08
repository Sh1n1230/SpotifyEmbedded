import yaml from 'js-yaml';

/** YAML の書式は静的モードとライブAPIで同じにする（同じスキーマを約束しているため）。 */
export function toYaml(data: unknown): string {
  return yaml.dump(data, { lineWidth: 120 });
}

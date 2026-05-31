import type { Request, Response, NextFunction } from 'express';
import yaml from 'js-yaml';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Response {
      sendFormatted(data: unknown): void;
    }
  }
}

function wantsYaml(req: Request): boolean {
  if (req.query['format'] === 'yaml') return true;
  const accept = req.headers.accept ?? '';
  return accept.includes('application/yaml') || accept.includes('text/yaml');
}

export function formatResponseMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.sendFormatted = (data: unknown) => {
    if (wantsYaml(req)) {
      res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
      res.send(yaml.dump(data, { lineWidth: 120 }));
    } else {
      res.json(data);
    }
  };
  next();
}

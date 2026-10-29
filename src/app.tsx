import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/read.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { DigestNotFound, DigestPage } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    // Only a plain date may reach the filesystem: no path can escape runsDir.
    const data = /^\d{4}-\d{2}-\d{2}$/.test(night) ? readNight(config.runsDir, night) : null;
    if (!data) {
      return c.html(
        <Layout title={`digest ${night}`} lane={lane()}>
          <DigestNotFound night={night} />
        </Layout>,
        404,
      );
    }
    return c.html(
      <Layout title={`digest ${night}`} lane={lane()}>
        <DigestPage night={night} data={data} />
      </Layout>,
    );
  });

  return app;
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError } from '../auth.ts';
import { audit, one, withPlatform, withTenant } from '../db.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const Id = z.object({ id: z.string().uuid() });
const FILE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Identify the image by its magic bytes, never by the client's content-type or filename. */
function sniff(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Menu photos: stored on disk under UPLOAD_DIR/<tenant>/, referenced from menu_items.image_url, served only to that shop's signed-in staff. */
export async function uploadRoutes(app: FastifyInstance, ctx: Ctx) {
  const root = resolve(ctx.uploadDir ?? './uploads');

  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));

  const removeFile = (tenantId: string, url: string | null) => {
    const name = url?.split('/').pop();
    return name && FILE.test(name) ? unlink(join(root, tenantId, name)).catch(() => {}) : Promise.resolve();
  };

  app.post('/api/menu/items/:id/image', { preHandler: ctx.auth(atLeast('manager')), bodyLimit: MAX_BYTES }, async (req) => {
    const { id } = Id.parse(req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body)) throw new HttpError(415, 'invalid_image', 'send a JPEG, PNG or WebP image');
    const ext = sniff(body);
    if (!ext) throw new HttpError(415, 'invalid_image', 'file is not a JPEG, PNG or WebP image');
    const tenantId = req.session.tenantId;
    const name = `${randomUUID()}.${ext}`;
    const dir = join(root, tenantId);
    await mkdir(dir, { recursive: true });
    // write then rename so a crash never leaves a half-written photo that a menu row points at
    await writeFile(join(dir, `${name}.tmp`), body);
    await rename(join(dir, `${name}.tmp`), join(dir, name));
    try {
      const { before, item } = await withTenant(ctx.db, tenantId, async (c) => {
        const before = await one(c, `SELECT image_url FROM menu_items WHERE id = $1`, [id]);
        if (!before) throw new HttpError(404, 'not_found');
        const item = await one(c, `UPDATE menu_items SET image_url = $2 WHERE id = $1 RETURNING id, image_url`, [id, `/api/uploads/${tenantId}/${name}`]);
        await audit(c, req.session.userId, 'menu.image', 'menu_item', id, { bytes: body.length });
        return { before, item };
      });
      await removeFile(tenantId, before.image_url);
      return item;
    } catch (e) {
      await removeFile(tenantId, name);
      throw e;
    }
  });

  app.delete('/api/menu/items/:id/image', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const tenantId = req.session.tenantId;
    const before = await withTenant(ctx.db, tenantId, async (c) => {
      const b = await one(c, `SELECT image_url FROM menu_items WHERE id = $1`, [id]);
      if (!b) throw new HttpError(404, 'not_found');
      await c.query(`UPDATE menu_items SET image_url = NULL WHERE id = $1`, [id]);
      return b;
    });
    await removeFile(tenantId, before.image_url);
    return { id, image_url: null };
  });

  // The shop's own logo, shown in the header and on receipts. Owner only; stored beside the menu photos.
  app.post('/api/settings/logo', { preHandler: ctx.auth(['owner']), bodyLimit: MAX_BYTES }, async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body)) throw new HttpError(415, 'invalid_image', 'send a JPEG, PNG or WebP image');
    const ext = sniff(body);
    if (!ext) throw new HttpError(415, 'invalid_image', 'file is not a JPEG, PNG or WebP image');
    const tenantId = req.session.tenantId;
    const name = `${randomUUID()}.${ext}`;
    const dir = join(root, tenantId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.tmp`), body);
    await rename(join(dir, `${name}.tmp`), join(dir, name));
    try {
      const before = await withPlatform(ctx.db, (c) => one(c, `SELECT logo_url FROM tenants WHERE id = $1`, [tenantId]));
      await withPlatform(ctx.db, (c) => c.query(`UPDATE tenants SET logo_url = $2 WHERE id = $1`, [tenantId, `/api/uploads/${tenantId}/${name}`]));
      await withTenant(ctx.db, tenantId, (c) => audit(c, req.session.userId, 'settings.logo', 'tenant', tenantId, { bytes: body.length }));
      await removeFile(tenantId, before?.logo_url ?? null);
      return { logo_url: `/api/uploads/${tenantId}/${name}` };
    } catch (e) {
      await removeFile(tenantId, name);
      throw e;
    }
  });

  app.delete('/api/settings/logo', { preHandler: ctx.auth(['owner']) }, async (req) => {
    const tenantId = req.session.tenantId;
    const before = await withPlatform(ctx.db, (c) => one(c, `SELECT logo_url FROM tenants WHERE id = $1`, [tenantId]));
    await withPlatform(ctx.db, (c) => c.query(`UPDATE tenants SET logo_url = NULL WHERE id = $1`, [tenantId]));
    await removeFile(tenantId, before?.logo_url ?? null);
    return { logo_url: null };
  });

  app.get('/api/uploads/:tenant/:file', { preHandler: ctx.auth() }, async (req, reply) => {
    const { tenant, file } = z.object({ tenant: z.string().uuid(), file: z.string().regex(FILE) }).parse(req.params);
    if (tenant !== req.session.tenantId) throw new HttpError(404, 'not_found');
    const path = join(root, tenant, file);
    if (!path.startsWith(root + sep)) throw new HttpError(404, 'not_found');
    const data = await readFile(path).catch(() => null);
    if (!data) throw new HttpError(404, 'not_found');
    // file names are random and never reused, so the browser may cache them for good
    return reply.header('content-type', TYPES[file.split('.')[1]!]).header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff').send(data);
  });
}

import { ImageResponse } from 'next/og';
import { BrandMark } from '@/lib/brandIcon';

const SIZES = new Set([192, 512]);

/** PNG icons for the web app manifest: /pwa/192, /pwa/512, and /pwa/512?maskable */
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('not found', { status: 404 });
  const maskable = new URL(req.url).searchParams.has('maskable');
  return new ImageResponse(<BrandMark size={size} padded={maskable} />, { width: size, height: size });
}

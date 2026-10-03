import { ImageResponse } from 'next/og';
import { BrandMark } from '@/lib/brandIcon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS rounds the corners itself, so the tile is square and padded.
export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} padded />, size);
}

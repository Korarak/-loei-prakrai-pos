import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ประกาย POS',
    short_name: 'ประกาย',
    description: 'ระบบขายหน้าร้านสำหรับร้านอาหาร',
    start_url: '/pos',
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#f5f6f3',
    theme_color: '#17784A',
    lang: 'th',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/pwa/192', sizes: '192x192', type: 'image/png' },
      { src: '/pwa/512', sizes: '512x512', type: 'image/png' },
      { src: '/pwa/512?maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

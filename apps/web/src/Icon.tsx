import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  arena: 'M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z M9 21v-7h6v7',
  practice: 'M12 2v11m4-7a4 4 0 0 1-8 0m-4 5a8 8 0 0 0 16 0m-8 8v3m-4 0h8',
  battle: 'M14.5 6.5 17 4l3 3-2.5 2.5m-3-3 3 3M4 20l9-9m-6-2 4 4m-4-8 3 3m5 5 4 4m-14-1 3 3',
  progress: 'M4 19V5m0 14h17M7 15l4-4 3 2 6-7m-3 0h3v3',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-6v3m0 17v-3m10-7h-3M5 12H2m17.1-7.1-2.1 2.1M7 17l-2.1 2.1m14.2 0L17 17M7 7 4.9 4.9',
  play: 'm8 5 11 7-11 7z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'm15 18-6-6 6-6M20 12H9',
  volume: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13',
  mute: 'M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6',
  sound: 'M4 10v4h3l4 3V7l-4 3zm11-2a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2',
  retry: 'M3 12a9 9 0 0 1 15.4-6.4L21 8m0-5v5h-5m5 4a9 9 0 0 1-15.4 6.4L3 16m0 5v-5h5',
  check: 'm5 12 4 4L19 6',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-7z',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z M9 12l2 2 4-4',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  close: 'm18 6-12 12M6 6l12 12',
};

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name]} />
    </svg>
  );
}

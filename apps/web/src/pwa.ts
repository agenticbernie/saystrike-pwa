import { registerSW } from 'virtual:pwa-register';

export function registerPwa() {
  if (import.meta.env.PROD) registerSW({ immediate: true });
}

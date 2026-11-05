import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker, SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

import { routes } from './app.routes';

/**
 * Quando esce una nuova versione dell'app, avvisa l'utente e propone di ricaricare.
 * Senza questo avviso, chi ha l'app installata resterebbe sulla versione vecchia
 * finché non la chiude e la riapre.
 */
function watchForUpdates(): void {
  const swUpdate = inject(SwUpdate);
  if (!swUpdate.isEnabled) return; // in sviluppo (ng serve) il service worker è spento

  swUpdate.versionUpdates
    .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
    .subscribe(() => {
      if (confirm('È disponibile una nuova versione di ContoAcapo. Vuoi aggiornare ora?')) {
        document.location.reload();
      }
    });

  // Controlla gli aggiornamenti anche quando si torna sull'app dopo averla lasciata in background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      swUpdate.checkForUpdate().catch(() => {});
    }
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(watchForUpdates),
  ],
};

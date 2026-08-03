import { listEpisodes, saveEpisode } from './store.js';

// Wird eine Folge gerade verarbeitet und der Server startet neu (Deploy, Absturz,
// Ruhezustand des Gratis-Plans), ist der Vorgang verloren – die Folge bliebe sonst
// für immer im Zustand „wird verarbeitet" hängen.
// Beim Start werden solche Folgen deshalb freigegeben und klar gekennzeichnet.
export function haengendeFolgenFreigeben() {
  const haengend = listEpisodes().filter((e) => e.status === 'processing');
  for (const ep of haengend) {
    saveEpisode({
      ...ep,
      status: 'error',
      error: 'Die Verarbeitung wurde durch einen Neustart des Servers unterbrochen. '
           + 'Du kannst sie erneut starten oder die Folge löschen.',
      fortschritt: null,
    });
  }
  if (haengend.length) {
    console.log(`${haengend.length} unterbrochene Folge(n) freigegeben.`);
  }
  return haengend.length;
}

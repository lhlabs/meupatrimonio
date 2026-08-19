(() => {
  if (!globalThis.AndroidSpeech?.start) return;

  let active = null;

  class AndroidSpeechRecognition {
    constructor() {
      this.lang = 'pt-BR';
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }

    start() {
      active = this;
      globalThis.AndroidSpeech.start();
    }

    stop() { }
    abort() { }
  }

  globalThis.__mpAndroidSpeechResult = text => {
    if (!active?.onresult) return;
    active.onresult({ results: [[{ transcript: String(text || '') }]] });
  };
  globalThis.__mpAndroidSpeechError = message => {
    active?.onerror?.({ error: 'native-speech', message: String(message || '') });
  };
  globalThis.__mpAndroidSpeechEnd = () => {
    const current = active;
    active = null;
    current?.onend?.();
  };

  globalThis.SpeechRecognition = AndroidSpeechRecognition;
  globalThis.webkitSpeechRecognition = AndroidSpeechRecognition;
})();

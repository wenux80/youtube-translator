// Text-to-Speech (TTS) engine using Web Speech API with audio ducking

class TTSEngine {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = [];
    this.currentUtterance = null;
    this.originalVideoVolume = null;
    this.isDucking = false;
    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => {
        this.voices = this.synth.getVoices();
      };
    }
  }

  getVoicesForLang(langCode) {
    if (!this.voices || this.voices.length === 0) {
      this.voices = this.synth ? this.synth.getVoices() : [];
    }
    const cleanLang = (langCode || 'zh').toLowerCase().split('-')[0];
    return this.voices.filter(v => v.lang.toLowerCase().startsWith(cleanLang));
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
    this.restoreVideoVolume();
  }

  speak(text, options = {}) {
    if (!this.synth || !text) return;

    this.stop();

    const {
      lang = 'zh-CN',
      voiceURI = '',
      rate = 1.0,
      pitch = 1.0,
      volume = 1.0,
      videoElement = null,
      ducking = true,
      duckingLevel = 0.3
    } = options;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = Math.min(Math.max(rate, 0.5), 2.0);
    utterance.pitch = pitch;
    utterance.volume = volume;

    if (voiceURI) {
      const voice = this.voices.find(v => v.voiceURI === voiceURI);
      if (voice) utterance.voice = voice;
    } else {
      // Pick appropriate voice for lang
      const matching = this.getVoicesForLang(lang);
      if (matching.length > 0) utterance.voice = matching[0];
    }

    // Audio ducking: lower video volume during TTS
    if (ducking && videoElement && !this.isDucking) {
      this.originalVideoVolume = videoElement.volume;
      videoElement.volume = Math.max(0, this.originalVideoVolume * duckingLevel);
      this.isDucking = true;
      this.targetVideo = videoElement;
    }

    utterance.onend = () => {
      this.restoreVideoVolume();
    };

    utterance.onerror = () => {
      this.restoreVideoVolume();
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  restoreVideoVolume() {
    if (this.isDucking && this.targetVideo && this.originalVideoVolume !== null) {
      this.targetVideo.volume = this.originalVideoVolume;
      this.isDucking = false;
      this.originalVideoVolume = null;
      this.targetVideo = null;
    }
  }
}

export const tts = new TTSEngine();

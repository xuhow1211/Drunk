/**
 * 程式合成的酒吧環境音。
 *
 * 當線上電台串流連不上（離線、網路被擋、公司防火牆）時，
 * 由這個模組接手，讓首頁仍然有酒吧氛圍而不是一片死寂。
 *
 * 合成內容：
 *   1. 和弦音床（pad）：四個振盪器組成爵士常見的 ii-V-I 和弦進行，
 *      每 6 秒換一個和弦，切換時以頻率漸變過渡，不會有突兀的跳動。
 *   2. 黑膠底噪：帶通濾波過的白噪音，模擬老唱片的底噪。
 *   3. 刷鼓：稀疏的高頻噪音短音，帶一點爵士鼓刷的節奏感。
 *   4. 殘響：以程式生成的脈衝響應做卷積混響，讓音床有空間感。
 *
 * 整體刻意壓低輸出，定位是「背景」而不是「主角」。
 */
import { DEFAULT_BAR_MUSIC_VOLUME } from './barMusic';

/** 和弦進行，每組四個音，以酒吧爵士常見的 ii-V-I 為骨架。 */
const CHORD_PROGRESSION: readonly number[][] = [
  [146.83, 174.61, 220.0, 261.63], // Dm7
  [98.0, 123.47, 146.83, 174.61], // G7
  [130.81, 164.81, 196.0, 246.94], // Cmaj7
  [110.0, 130.81, 164.81, 196.0], // Am7
  [87.31, 110.0, 130.81, 164.81], // Fmaj7
  [82.41, 103.83, 116.54, 146.83], // Em7b5
];

/** 每個和弦停留的毫秒數。 */
const CHORD_INTERVAL_MS = 6000;

/** 刷鼓節拍間隔（毫秒），約 68 BPM。 */
const BEAT_INTERVAL_MS = 880;

/** 合成音的輸出倍率：再壓低一截，確保只是背景。 */
const OUTPUT_GAIN = 0.28;

/** 淡入淡出時間（毫秒）。 */
const FADE_MS = 1200;

/** 支援 webkit 前綴的音訊脈絡建構子。 */
type AudioContextConstructor = new () => AudioContext;

/**
 * 取得瀏覽器的音訊脈絡建構子。
 *
 * 舊版 Safari 只提供 webkitAudioContext，因此要另外找。
 */
function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * 產生一段白噪音緩衝，供黑膠底噪與刷鼓重複取用。
 */
function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * 產生混響用的脈衝響應。
 *
 * 衰減越快，尾音越短；以指數衰減模擬酒吧這種空間不大的場所。
 */
function createImpulseResponse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** decay;
    }
  }
  return impulse;
}

/** 合成環境音的控制介面。 */
export interface AmbientSynth {
  /** 開始播放。瀏覽器要求先有使用者互動，必要時會 resume 脈絡。 */
  start(): Promise<void>;
  /** 停止播放並釋放資源。 */
  stop(): void;
  /** 調整音量（0 至 1）。 */
  setVolume(volume: number): void;
  /**
   * 目前音訊脈絡是否真的在運作。
   *
   * 瀏覽器規定 AudioContext 必須在使用者互動之後才能啟動，
   * 沒有互動時會停在 suspended（靜音）。介面要靠這個判斷
   * 該不該提示使用者「點一下即可啟動」。
   */
  isRunning(): boolean;
  /** 目前是否正在播放。 */
  readonly running: boolean;
}

/**
 * 建立一個酒吧環境音合成器。
 *
 * 實例建立後呼叫 start() 才會產生音訊，stop() 之後可再次 start()。
 */
export function createAmbientSynth(): AmbientSynth {
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let fadeGain: GainNode | null = null;
  /** 和弦音床的振盪器，換和弦時要重設頻率。 */
  let chordOscillators: OscillatorNode[] = [];
  /** 所有會發聲的節點，停止時要一併關掉。 */
  let sources: AudioScheduledSourceNode[] = [];
  let noiseBuffer: AudioBuffer | null = null;
  let chordTimer: number | null = null;
  let brushTimer: number | null = null;
  let chordIndex = 0;
  let volume = DEFAULT_BAR_MUSIC_VOLUME;

  /** 把某個和弦的頻率套用到各振盪器，切換時以漸變過渡。 */
  function applyChord(frequencies: readonly number[], startAt: number) {
    if (!context) return;
    chordOscillators.forEach((oscillator, index) => {
      const frequency = frequencies[index % frequencies.length];
      if (frequency === undefined) return;
      oscillator.frequency.cancelScheduledValues(startAt);
      oscillator.frequency.setValueAtTime(oscillator.frequency.value, startAt);
      oscillator.frequency.linearRampToValueAtTime(frequency, startAt + CHORD_INTERVAL_MS * 0.45);
    });
  }

  /** 排程下一個和弦。 */
  function scheduleNextChord() {
    if (!context) return;
    chordIndex = (chordIndex + 1) % CHORD_PROGRESSION.length;
    applyChord(CHORD_PROGRESSION[chordIndex] ?? CHORD_PROGRESSION[0]!, context.currentTime);
  }

  /** 敲一記刷鼓。 */
  function playBrush(at: number, strength: number) {
    if (!context || !masterGain || !noiseBuffer) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.9;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(strength, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(masterGain);
    source.start(at, Math.random() * 1.5);
    source.stop(at + 0.28);
  }

  /** 建立音訊節點並串接。 */
  function buildGraph(active: AudioContext) {
    masterGain = active.createGain();
    masterGain.gain.value = 0;

    fadeGain = active.createGain();
    fadeGain.gain.value = 0;

    const reverb = active.createConvolver();
    reverb.buffer = createImpulseResponse(active, 2.4, 2.6);

    const padBus = active.createGain();
    padBus.gain.value = 0.55;

    const padFilter = active.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.8;

    padFilter.connect(padBus);
    padBus.connect(fadeGain);
    padBus.connect(reverb);
    reverb.connect(fadeGain);
    fadeGain.connect(masterGain);
    masterGain.connect(active.destination);

    // 和弦音床：四個振盪器，各自略微失諧以避免 Soundscape 太合成
    const firstChord = CHORD_PROGRESSION[0]!;
    for (let index = 0; index < 4; index += 1) {
      const oscillator = active.createOscillator();
      oscillator.type = index % 2 === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = firstChord[index] ?? firstChord[0]!;
      oscillator.detune.value = index % 2 === 0 ? -4 : 5;

      const voiceGain = active.createGain();
      voiceGain.gain.value = 0.16;

      oscillator.connect(voiceGain);
      voiceGain.connect(padFilter);
      oscillator.start();
      chordOscillators.push(oscillator);
      sources.push(oscillator);
    }

    // 慢速 LFO 讓濾波器頻率起伏，音床就不會死板
    const lfo = active.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoDepth = active.createGain();
    lfoDepth.gain.value = 260;
    lfo.connect(lfoDepth);
    lfoDepth.connect(padFilter.frequency);
    lfo.start();
    sources.push(lfo);

    // 黑膠底噪
    noiseBuffer = createNoiseBuffer(active, 2);
    const noise = active.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = active.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1400;
    noiseFilter.Q.value = 0.7;
    const noiseGain = active.createGain();
    noiseGain.gain.value = 0.035;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(fadeGain);
    noise.start();
    sources.push(noise);
  }

  return {
    get running() {
      return context !== null && context.state === 'running';
    },

    isRunning() {
      return context !== null && context.state === 'running';
    },

    async start() {
      if (context) {
        if (context.state === 'suspended') await context.resume();
        return;
      }

      const Constructor = getAudioContextConstructor();
      if (!Constructor) return;

      const active = new Constructor();
      context = active;
      buildGraph(active);
      if (active.state === 'suspended') await active.resume();

      masterGain?.gain.setValueAtTime(0, active.currentTime);
      masterGain?.gain.linearRampToValueAtTime(volume * OUTPUT_GAIN, active.currentTime + FADE_MS / 1000);
      fadeGain?.gain.setValueAtTime(0, active.currentTime);
      fadeGain?.gain.linearRampToValueAtTime(1, active.currentTime + FADE_MS / 1000);

      chordTimer = window.setInterval(scheduleNextChord, CHORD_INTERVAL_MS);
      brushTimer = window.setInterval(() => {
        if (!context) return;
        // 偶爾加重音，聽起來才像爵士鼓的 ride 而不是規律的滴答聲
        const accent = Math.random() < 0.22;
        playBrush(context.currentTime, accent ? 0.05 : 0.022);
      }, BEAT_INTERVAL_MS);
    },

    stop() {
      if (chordTimer !== null) {
        window.clearInterval(chordTimer);
        chordTimer = null;
      }
      if (brushTimer !== null) {
        window.clearInterval(brushTimer);
        brushTimer = null;
      }

      const active = context;
      if (!active) return;

      const now = active.currentTime;
      fadeGain?.gain.cancelScheduledValues(now);
      fadeGain?.gain.setValueAtTime(fadeGain.gain.value, now);
      fadeGain?.gain.linearRampToValueAtTime(0, now + 0.5);

      for (const source of sources) {
        try {
          source.stop(now + 0.6);
        } catch {
          // 已經停止的振盪器再 stop 一次會丟出例外，忽略即可
        }
      }
      chordOscillators = [];
      sources = [];

      window.setTimeout(() => {
        void active.close();
      }, 700);

      context = null;
      masterGain = null;
      fadeGain = null;
      noiseBuffer = null;
      chordIndex = 0;
    },

    setVolume(next: number) {
      volume = Math.min(1, Math.max(0, next));
      if (!context || !masterGain) return;
      masterGain.gain.setTargetAtTime(
        volume * OUTPUT_GAIN,
        context.currentTime,
        0.08,
      );
    },
  };
}

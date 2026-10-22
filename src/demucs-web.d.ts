// demucs-web ships plain JS; the parts Kinora uses.
declare module 'demucs-web' {
  interface Stereo { left: Float32Array; right: Float32Array }
  export class DemucsProcessor {
    constructor(options: { ort: unknown; onProgress?: (p: { progress: number; currentSegment: number; totalSegments: number }) => void; sessionOptions?: Record<string, unknown> });
    loadModel(model: string | ArrayBuffer): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<{ drums: Stereo; bass: Stereo; other: Stereo; vocals: Stereo }>;
  }
  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string };
}

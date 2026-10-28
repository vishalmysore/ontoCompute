// One WebLLM engine in a worker. Every call is a fresh conversation, so repeated runs of a question are independent.
import { CreateWebWorkerMLCEngine, prebuiltAppConfig, type MLCEngineInterface } from "@mlc-ai/web-llm";

// Small instruct models. q4f32 first: f16 shaders misbehave on some integrated GPUs.
const WANTED = /^(Qwen2\.5-(0\.5|1\.5|3|7)B-Instruct|Llama-3\.2-(1|3)B-Instruct|Llama-3\.1-8B-Instruct|Phi-3\.5-mini-instruct|Hermes-3-Llama-3\.2-3B)-q4f(32|16)_1-MLC$/;
const PREFERRED = ["Qwen2.5-3B-Instruct-q4f32_1-MLC", "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", "Llama-3.2-3B-Instruct-q4f32_1-MLC"];

export function modelChoices(): { ids: string[]; preferred: string } {
  const ids = prebuiltAppConfig.model_list.map((m) => m.model_id).filter((id) => WANTED.test(id));
  ids.sort((a, b) => Number(b.includes("q4f32")) - Number(a.includes("q4f32")) || a.localeCompare(b));
  return { ids, preferred: PREFERRED.find((p) => ids.includes(p)) ?? ids[0] };
}

export const hasWebGPU = (): boolean => "gpu" in navigator;

export interface Reply {
  text: string;
  tokens: number;
  seconds: number;
}

export class Model {
  private constructor(
    private engine: MLCEngineInterface,
    readonly id: string,
  ) {}

  static async load(id: string, onProgress: (text: string, fraction: number) => void): Promise<Model> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const engine = await CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: (p) => onProgress(p.text, p.progress) });
    return new Model(engine, id);
  }

  /** One independent completion, streamed; `onText` gets the whole text so far. */
  async ask(system: string, user: string, opt: { temperature: number; maxTokens: number }, onText?: (text: string) => void): Promise<Reply> {
    const t0 = performance.now();
    const chunks = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: opt.temperature,
      top_p: 0.95,
      max_tokens: opt.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = "";
    let tokens = 0;
    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        text += delta;
        onText?.(text);
      }
      if (chunk.usage) tokens = chunk.usage.completion_tokens;
    }
    return { text, tokens, seconds: (performance.now() - t0) / 1000 };
  }

  interrupt() {
    this.engine.interruptGenerate();
  }

  async unload() {
    await this.engine.unload();
  }
}

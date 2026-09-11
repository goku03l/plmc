import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentEnabled, runAgent, type AgentEvent } from "../agent/chat.js";
import { ttsEnabled, synthesize } from "../agent/tts.js";
import { sttEnabled, transcribe } from "../agent/stt.js";

const MODEL = process.env.AGENT_MODEL || "claude-sonnet-5";

const chatBody = z.object({
  language: z.enum(["en", "hi", "ta"]).default("en"),
  operate: z.boolean().default(false), // "allow changes" — exposes the write tools for this request
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.any(),
      }),
    )
    .min(1)
    .max(200),
});

const ttsBody = z.object({
  language: z.enum(["en", "hi", "ta"]).default("en"),
  text: z.string().min(1).max(5000),
});

const sttBody = z.object({
  language: z.enum(["en", "hi", "ta"]).default("en"),
  mime: z.string().min(3).max(80),
  audio: z.string().min(16).max(12_000_000), // base64
});

export async function agentRoutes(app: FastifyInstance) {
  app.get("/agent/status", async () => ({
    enabled: agentEnabled,
    model: MODEL,
    tts: ttsEnabled,
    stt: sttEnabled,
    languages: ["en", "hi", "ta"],
  }));

  app.post("/agent/stt", async (req, reply) => {
    const { language, mime, audio } = sttBody.parse(req.body);
    if (!sttEnabled) {
      return reply.code(503).send({ error: "Speech-to-text is not configured — set GOOGLE_TTS_API_KEY on the API." });
    }
    try {
      const out = await transcribe(audio, mime, language);
      return reply.send(out);
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/agent/tts", async (req, reply) => {
    const { language, text } = ttsBody.parse(req.body);
    if (!ttsEnabled) {
      return reply.code(503).send({ error: "Text-to-speech is not configured — set GOOGLE_TTS_API_KEY on the API." });
    }
    try {
      const { audio, mime } = await synthesize(text, language);
      return reply.send({ audio, mime });
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/agent/chat", async (req, reply) => {
    const { language, operate, messages } = chatBody.parse(req.body);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (e: AgentEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    const ac = new AbortController();
    reply.raw.on("close", () => ac.abort());

    try {
      await runAgent({ messages: messages as never, language, operate, onEvent: send, signal: ac.signal });
    } catch (err) {
      send({ type: "error", message: (err as Error).message });
    }
    if (!reply.raw.writableEnded) reply.raw.end();
  });
}
